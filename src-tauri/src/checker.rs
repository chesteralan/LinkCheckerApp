use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::{mpsc, Notify, Semaphore};
use tokio::task::JoinSet;

use crate::commands::lock_or_recover;
use crate::models::*;
use crate::AppState;

/// Upper bound on concurrent requests per run (A-07).
pub const MAX_BATCH_SIZE: u32 = 50;
/// Maximum number of response-body bytes read per page (A-38).
pub const MAX_BODY_BYTES: usize = 5 * 1024 * 1024;
/// Write a partial checkpoint at most every this many pages… (A-37)
const CHECKPOINT_EVERY_PAGES: usize = 25;
/// …or when this much time has passed since the last checkpoint.
const CHECKPOINT_INTERVAL: Duration = Duration::from_secs(3);
/// Wall-clock limit for evaluating all checks against one page (A-06).
const CHECK_EVAL_TIMEOUT: Duration = Duration::from_secs(30);
/// Boa limits for JavaScript checks (A-06).
const JS_LOOP_ITERATION_LIMIT: u64 = 1_000_000;
const JS_RECURSION_LIMIT: usize = 256;
/// Stack for the thread that runs Boa (reserved, committed only as used).
const JS_THREAD_STACK_BYTES: usize = 64 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Cancellation
// ---------------------------------------------------------------------------

/// A cancellation token that can be both polled and awaited.
#[derive(Default)]
pub struct CancelToken {
    flag: AtomicBool,
    notify: Notify,
}

impl CancelToken {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn cancel(&self) {
        self.flag.store(true, Ordering::SeqCst);
        self.notify.notify_waiters();
    }

    pub fn is_cancelled(&self) -> bool {
        self.flag.load(Ordering::SeqCst)
    }

    /// Resolves once `cancel()` has been called.
    pub async fn cancelled(&self) {
        loop {
            // A `Notified` future receives `notify_waiters` wake-ups from the
            // moment it is created, so creating it before checking the flag
            // closes the race with a concurrent `cancel()`.
            let notified = self.notify.notified();
            if self.is_cancelled() {
                return;
            }
            notified.await;
        }
    }
}

/// Active operations keyed by ID, each with its own cancel token (A-15).
#[derive(Default)]
pub struct CancelRegistry {
    inner: Mutex<HashMap<String, Arc<CancelToken>>>,
}

impl CancelRegistry {
    /// Registers `id` and returns a guard that unregisters it on drop.
    pub fn register(&self, id: &str) -> Registration<'_> {
        let token = Arc::new(CancelToken::new());
        lock_or_recover(&self.inner).insert(id.to_string(), token.clone());
        Registration {
            registry: self,
            id: id.to_string(),
            token,
        }
    }

    /// Cancels one operation. Returns `true` if it was active.
    pub fn cancel(&self, id: &str) -> bool {
        let token = lock_or_recover(&self.inner).get(id).cloned();
        match token {
            Some(t) => {
                t.cancel();
                true
            }
            None => false,
        }
    }

    /// Cancels every active operation. Returns how many were cancelled.
    pub fn cancel_all(&self) -> usize {
        let tokens: Vec<_> = lock_or_recover(&self.inner).values().cloned().collect();
        for t in &tokens {
            t.cancel();
        }
        tokens.len()
    }

    pub fn active_ids(&self) -> Vec<String> {
        lock_or_recover(&self.inner).keys().cloned().collect()
    }
}

pub struct Registration<'a> {
    registry: &'a CancelRegistry,
    id: String,
    token: Arc<CancelToken>,
}

impl Registration<'_> {
    pub fn token(&self) -> Arc<CancelToken> {
        self.token.clone()
    }

    pub fn id(&self) -> &str {
        &self.id
    }
}

impl Drop for Registration<'_> {
    fn drop(&mut self) {
        let mut map = lock_or_recover(&self.registry.inner);
        // Only remove our own entry; a later registration may have reused
        // the same ID.
        if map
            .get(&self.id)
            .map(|t| Arc::ptr_eq(t, &self.token))
            .unwrap_or(false)
        {
            map.remove(&self.id);
        }
    }
}

/// Returns `requested` if it is a valid UUID (it ends up in a file name),
/// otherwise a fresh UUID.
pub fn resolve_operation_id(requested: Option<String>) -> String {
    requested
        .and_then(|id| uuid::Uuid::parse_str(id.trim()).ok())
        .map(|u| u.to_string())
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string())
}

// ---------------------------------------------------------------------------
// Event sink (abstracts AppHandle so run orchestration is testable)
// ---------------------------------------------------------------------------

pub(crate) trait RunSink: Clone + Send + Sync + 'static {
    fn emit(&self, event: &str, payload: serde_json::Value);
    /// Persists a (partial or final) run. Called from a blocking thread.
    fn save(&self, run: &AuditRun) -> Result<(), String>;
}

impl RunSink for AppHandle {
    fn emit(&self, event: &str, payload: serde_json::Value) {
        let _ = Emitter::emit(self, event, payload);
    }

    fn save(&self, run: &AuditRun) -> Result<(), String> {
        match self.try_state::<AppState>() {
            Some(state) => state.storage.save_run(run),
            None => Err("app state unavailable".into()),
        }
    }
}

/// Serialises `value` and adds a `runId` field to the resulting object.
pub(crate) fn with_run_id<T: serde::Serialize>(run_id: &str, value: &T) -> serde_json::Value {
    let mut v = serde_json::to_value(value).unwrap_or(serde_json::Value::Null);
    match v {
        serde_json::Value::Object(ref mut map) => {
            map.insert("runId".into(), serde_json::Value::String(run_id.into()));
            v
        }
        other => serde_json::json!({ "runId": run_id, "value": other }),
    }
}

pub(crate) fn emit_run_error<S: RunSink>(sink: &S, run_id: &str, message: &str) {
    sink.emit(
        "run:error",
        serde_json::json!({ "runId": run_id, "message": message }),
    );
}

// ---------------------------------------------------------------------------
// Checker
// ---------------------------------------------------------------------------

pub struct Checker {
    runs: CancelRegistry,
    link_scans: CancelRegistry,
}

impl Default for Checker {
    fn default() -> Self {
        Self::new()
    }
}

impl Checker {
    pub fn new() -> Self {
        Self {
            runs: CancelRegistry::default(),
            link_scans: CancelRegistry::default(),
        }
    }

    pub fn register_run(&self, run_id: &str) -> Registration<'_> {
        self.runs.register(run_id)
    }

    /// Cancels one run, or every active run when `run_id` is `None`.
    pub fn cancel(&self, run_id: Option<&str>) {
        match run_id {
            Some(id) => {
                self.runs.cancel(id);
            }
            None => {
                self.runs.cancel_all();
            }
        }
    }

    pub fn active_runs(&self) -> Vec<String> {
        self.runs.active_ids()
    }

    pub fn register_link_scan(&self, scan_id: &str) -> Registration<'_> {
        self.link_scans.register(scan_id)
    }

    /// Cancels one link scan, or every active scan when `scan_id` is `None`.
    pub fn cancel_link_scan(&self, scan_id: Option<&str>) {
        match scan_id {
            Some(id) => {
                self.link_scans.cancel(id);
            }
            None => {
                self.link_scans.cancel_all();
            }
        }
    }

    /// Runs an audit. Emits `run:progress`, `run:result`, `run:cancelled`
    /// and `run:complete` (each payload carries `runId`), and persists the
    /// final run before `run:complete` is emitted. Returns `Err` when the run
    /// could not start or the final save failed; the caller emits `run:error`.
    pub async fn run(
        &self,
        app: &AppHandle,
        run_id: &str,
        token: Arc<CancelToken>,
        audit: &Audit,
        target_list: &TargetList,
        check_template: &CheckTemplate,
    ) -> Result<AuditRun, String> {
        execute_run(
            app.clone(),
            run_id.to_string(),
            token,
            audit,
            target_list,
            check_template,
        )
        .await
    }
}

/// Clamps user-supplied concurrency/timeout settings (A-07).
pub(crate) fn effective_limits(config: &AuditConfig) -> (usize, u64) {
    let batch = match config.mode.as_str() {
        "sequential" => 1,
        _ => config.batch_size.clamp(1, MAX_BATCH_SIZE) as usize,
    };
    (batch, config.timeout_secs.max(1))
}

fn build_client(audit: &Audit, follow_redirects: bool) -> Result<reqwest::Client, String> {
    let (_, timeout_secs) = effective_limits(&audit.config);
    let mut headers = reqwest::header::HeaderMap::new();
    for (key, value) in &audit.config.headers {
        if let (Ok(k), Ok(v)) = (
            reqwest::header::HeaderName::from_bytes(key.as_bytes()),
            reqwest::header::HeaderValue::from_str(value),
        ) {
            headers.insert(k, v);
        }
    }
    if !audit.config.cookies.is_empty() {
        let cookie_str: String = audit
            .config
            .cookies
            .iter()
            .map(|kv| format!("{}={}", kv.key, kv.value))
            .collect::<Vec<_>>()
            .join("; ");
        if let Ok(v) = reqwest::header::HeaderValue::from_str(&cookie_str) {
            headers.insert(reqwest::header::COOKIE, v);
        }
    }
    let policy = if follow_redirects {
        reqwest::redirect::Policy::limited(10)
    } else {
        reqwest::redirect::Policy::none()
    };
    reqwest::Client::builder()
        .timeout(Duration::from_secs(timeout_secs))
        .redirect(policy)
        .default_headers(headers)
        .build()
        .map_err(|e| format!("failed to build HTTP client: {}", e))
}

/// A template that asserts a 3xx status needs to see the redirect response
/// itself, so redirects are not followed for it (A-43).
fn template_expects_redirect(checks: &[SelectorCheck]) -> bool {
    checks.iter().any(|c| {
        c.check_type == CheckType::Status
            && c.expected_status
                .map(|s| (300..400).contains(&s))
                .unwrap_or(false)
    })
}

pub(crate) async fn execute_run<S: RunSink>(
    sink: S,
    run_id: String,
    token: Arc<CancelToken>,
    audit: &Audit,
    target_list: &TargetList,
    check_template: &CheckTemplate,
) -> Result<AuditRun, String> {
    let started_at = chrono::Utc::now().to_rfc3339();
    let total = target_list.urls.len();
    let (batch, _) = effective_limits(&audit.config);
    let semaphore = Arc::new(Semaphore::new(batch));
    let checks = Arc::new(check_template.checks.clone());
    let client = build_client(audit, !template_expects_redirect(&checks))?;

    let urls: Vec<String> = target_list
        .urls
        .iter()
        .map(|u| apply_origin_override(u, &audit.origin_override))
        .map(|u| apply_url_postfix(&u, &audit.url_postfix))
        .collect();

    // Single collector: owns the results, emits events in order and is the
    // only writer of checkpoints (A-05, A-37).
    let (tx, mut rx) = mpsc::unbounded_channel::<PageResult>();
    let collector = {
        let sink = sink.clone();
        let token = token.clone();
        let run_id = run_id.clone();
        let audit_id = audit.id.clone();
        let started_at = started_at.clone();
        tokio::spawn(async move {
            let mut results: Vec<PageResult> = Vec::with_capacity(total);
            let mut since_save = 0usize;
            let mut last_save = Instant::now();
            while let Some(page) = rx.recv().await {
                results.push(page);
                if token.is_cancelled() {
                    // Keep what finished, but emit and checkpoint nothing
                    // once the run has been cancelled.
                    continue;
                }
                let page = results.last().expect("just pushed");
                sink.emit(
                    "run:progress",
                    serde_json::json!({
                        "runId": run_id,
                        "checked": results.len(),
                        "total": total,
                    }),
                );
                sink.emit("run:result", with_run_id(&run_id, page));

                since_save += 1;
                if since_save >= CHECKPOINT_EVERY_PAGES
                    || last_save.elapsed() >= CHECKPOINT_INTERVAL
                {
                    let partial = AuditRun {
                        id: run_id.clone(),
                        audit_id: audit_id.clone(),
                        started_at: started_at.clone(),
                        completed_at: None,
                        status: "running".into(),
                        summary: compute_summary(&results),
                        results: results.clone(),
                    };
                    let sink = sink.clone();
                    let _ = tokio::task::spawn_blocking(move || sink.save(&partial)).await;
                    since_save = 0;
                    last_save = Instant::now();
                }
            }
            results
        })
    };

    let mut tasks = JoinSet::new();
    for url in urls {
        let permit = tokio::select! {
            biased;
            _ = token.cancelled() => break,
            p = semaphore.clone().acquire_owned() => match p {
                Ok(p) => p,
                Err(_) => break,
            },
        };
        let client = client.clone();
        let checks = checks.clone();
        let tx = tx.clone();
        let token = token.clone();
        tasks.spawn(async move {
            let _permit = permit;
            let page = tokio::select! {
                biased;
                _ = token.cancelled() => return,
                page = check_url(client, url, checks) => page,
            };
            let _ = tx.send(page);
        });
    }
    drop(tx);

    loop {
        tokio::select! {
            biased;
            _ = token.cancelled() => {
                tasks.abort_all();
                while tasks.join_next().await.is_some() {}
                break;
            }
            next = tasks.join_next() => {
                if next.is_none() {
                    break;
                }
            }
        }
    }

    // All senders are gone now, so the collector drains and finishes; any
    // checkpoint it started has completed before this returns.
    let results = collector.await.unwrap_or_default();
    let cancelled = token.is_cancelled();

    let run = AuditRun {
        id: run_id.clone(),
        audit_id: audit.id.clone(),
        started_at,
        completed_at: Some(chrono::Utc::now().to_rfc3339()),
        status: if cancelled { "cancelled" } else { "completed" }.into(),
        summary: compute_summary(&results),
        results,
    };

    let save_result = {
        let sink = sink.clone();
        let run = run.clone();
        tokio::task::spawn_blocking(move || sink.save(&run))
            .await
            .unwrap_or_else(|e| Err(format!("save task failed: {}", e)))
    };

    if cancelled {
        sink.emit("run:cancelled", serde_json::json!({ "runId": run_id }));
    }
    sink.emit("run:complete", with_run_id(&run_id, &run));

    save_result.map(|_| run)
}

// ---------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------

/// Whether a response's body is worth reading as text (A-38).
pub(crate) fn is_textual_content_type(headers: &reqwest::header::HeaderMap) -> bool {
    let ct = match headers
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
    {
        Some(ct) => ct.to_ascii_lowercase(),
        None => return true,
    };
    ct.starts_with("text/")
        || ct.contains("html")
        || ct.contains("xml")
        || ct.contains("json")
        || ct.contains("javascript")
        || ct.contains("ecmascript")
}

/// Streams a response body up to `cap` bytes; non-text bodies are skipped
/// and return an empty string (A-38).
pub(crate) async fn read_body_capped(
    mut response: reqwest::Response,
    cap: usize,
) -> Result<String, String> {
    if !is_textual_content_type(response.headers()) {
        return Ok(String::new());
    }
    let mut buf: Vec<u8> = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
        let remaining = cap.saturating_sub(buf.len());
        if chunk.len() >= remaining {
            buf.extend_from_slice(&chunk[..remaining]);
            break;
        }
        buf.extend_from_slice(&chunk);
    }
    Ok(String::from_utf8_lossy(&buf).into_owned())
}

/// What the checks need to know about the HTTP response.
#[derive(Debug, Clone, Default)]
pub(crate) struct ResponseMeta {
    pub status: u16,
    /// `Location` header of a 3xx response that was not followed.
    pub location: Option<String>,
    /// Final URL when redirects were followed and it differs from the request.
    pub redirected_to: Option<String>,
}

async fn check_url(
    client: reqwest::Client,
    url: String,
    checks: Arc<Vec<SelectorCheck>>,
) -> PageResult {
    let start = Instant::now();
    let response = match client.get(&url).send().await {
        Ok(r) => r,
        Err(e) => {
            return PageResult {
                url,
                page_title: None,
                status: None,
                status_text: "error".into(),
                response_time_ms: Some(start.elapsed().as_millis() as u64),
                error: Some(e.to_string()),
                checks: Vec::new(),
            }
        }
    };

    let status = response.status();
    let status_code = status.as_u16();
    let status_text = status.canonical_reason().unwrap_or("unknown").to_string();
    let elapsed = start.elapsed().as_millis() as u64;
    let location = if status.is_redirection() {
        response
            .headers()
            .get(reqwest::header::LOCATION)
            .and_then(|v| v.to_str().ok())
            .map(|s| s.to_string())
    } else {
        None
    };
    let final_url = response.url().to_string();
    let redirected_to = reqwest::Url::parse(&url)
        .map(|u| u.as_str() != final_url)
        .unwrap_or(false)
        .then_some(final_url);

    let html = match read_body_capped(response, MAX_BODY_BYTES).await {
        Ok(h) => h,
        Err(e) => {
            return PageResult {
                page_title: None,
                url,
                status: Some(status_code),
                status_text,
                response_time_ms: Some(elapsed),
                error: Some(format!("body read error: {}", e)),
                checks: Vec::new(),
            }
        }
    };

    let meta = ResponseMeta {
        status: status_code,
        location,
        redirected_to,
    };
    let page_url = url.clone();
    // Parsing and check evaluation (including Boa) are CPU-bound: keep them
    // off the async workers and bound them in time (A-06, A-42).
    let job = tokio::task::spawn_blocking(move || evaluate_page(&meta, &html, &page_url, &checks));
    match tokio::time::timeout(CHECK_EVAL_TIMEOUT, job).await {
        Ok(Ok((page_title, check_results))) => PageResult {
            page_title,
            url,
            status: Some(status_code),
            status_text,
            response_time_ms: Some(elapsed),
            error: None,
            checks: check_results,
        },
        Ok(Err(e)) => PageResult {
            page_title: None,
            url,
            status: Some(status_code),
            status_text,
            response_time_ms: Some(elapsed),
            error: Some(format!("check evaluation failed: {}", e)),
            checks: Vec::new(),
        },
        Err(_) => PageResult {
            page_title: None,
            url,
            status: Some(status_code),
            status_text,
            response_time_ms: Some(elapsed),
            error: Some(format!(
                "check evaluation timed out after {}s",
                CHECK_EVAL_TIMEOUT.as_secs()
            )),
            checks: Vec::new(),
        },
    }
}

/// Parses the page once and runs every check against it (A-42).
pub(crate) fn evaluate_page(
    meta: &ResponseMeta,
    html: &str,
    page_url: &str,
    checks: &[SelectorCheck],
) -> (Option<String>, Vec<SelectorResult>) {
    let document = scraper::Html::parse_document(html);
    let title = extract_title_doc(&document);
    let results = checks
        .iter()
        .map(|check| match check.check_type {
            CheckType::Status => run_status_check(check, meta),
            CheckType::Regex => run_regex_check(check, html),
            CheckType::Attribute => run_attribute_check(check, &document),
            CheckType::Selector => run_selector_check(check, &document),
            CheckType::Accessibility => run_accessibility_check(check, html),
            CheckType::JavaScript => run_js_check(check, &document, page_url, title.as_deref()),
        })
        .collect();
    (title, results)
}

#[cfg(test)]
fn run_checks(
    status_code: u16,
    html: &str,
    page_url: &str,
    checks: &[SelectorCheck],
) -> Vec<SelectorResult> {
    let meta = ResponseMeta {
        status: status_code,
        ..Default::default()
    };
    evaluate_page(&meta, html, page_url, checks).1
}

fn run_selector_check(check: &SelectorCheck, document: &scraper::Html) -> SelectorResult {
    match scraper::Selector::parse(&check.selector) {
        Ok(sel) => {
            let matches: Vec<_> = document.select(&sel).collect();
            let count = matches.len();
            let text_content = matches.first().and_then(|el| {
                let text: String = el.text().collect::<Vec<_>>().join(" ");
                if text.is_empty() {
                    None
                } else {
                    Some(text)
                }
            });
            SelectorResult {
                selector_check_id: check.id.clone(),
                selector: check.selector.clone(),
                label: check.label.clone(),
                found: count > 0,
                count,
                text_content,
                check_type: CheckType::Selector,
                a11y_issues: vec![],
            }
        }
        Err(_) => SelectorResult {
            selector_check_id: check.id.clone(),
            selector: check.selector.clone(),
            label: check.label.clone(),
            found: false,
            count: 0,
            text_content: None,
            check_type: CheckType::Selector,
            a11y_issues: vec![],
        },
    }
}

fn run_status_check(check: &SelectorCheck, meta: &ResponseMeta) -> SelectorResult {
    let expected = check.expected_status.unwrap_or(200);
    let found = meta.status == expected;
    let text = match (&meta.location, &meta.redirected_to) {
        (Some(loc), _) => format!("HTTP {} → {}", meta.status, loc),
        (None, Some(final_url)) => format!("HTTP {} (redirected to {})", meta.status, final_url),
        _ => format!("HTTP {}", meta.status),
    };
    SelectorResult {
        selector_check_id: check.id.clone(),
        selector: check.selector.clone(),
        label: check.label.clone(),
        found,
        count: if found { 1 } else { 0 },
        text_content: Some(text),
        check_type: CheckType::Status,
        a11y_issues: vec![],
    }
}

fn run_regex_check(check: &SelectorCheck, html: &str) -> SelectorResult {
    let pattern = match &check.pattern {
        Some(p) if !p.is_empty() => p,
        _ => {
            return SelectorResult {
                selector_check_id: check.id.clone(),
                selector: check.selector.clone(),
                label: check.label.clone(),
                found: false,
                count: 0,
                text_content: None,
                check_type: CheckType::Regex,
                a11y_issues: vec![],
            }
        }
    };
    match ::regex::Regex::new(pattern) {
        Ok(re) => {
            let count = re.find_iter(html).count();
            SelectorResult {
                selector_check_id: check.id.clone(),
                selector: check.selector.clone(),
                label: check.label.clone(),
                found: count > 0,
                count,
                text_content: re.find(html).map(|m| m.as_str().to_string()),
                check_type: CheckType::Regex,
                a11y_issues: vec![],
            }
        }
        Err(e) => SelectorResult {
            selector_check_id: check.id.clone(),
            selector: check.selector.clone(),
            label: check.label.clone(),
            found: false,
            count: 0,
            text_content: Some(format!("invalid regex: {}", e)),
            check_type: CheckType::Regex,
            a11y_issues: vec![],
        },
    }
}

fn run_attribute_check(check: &SelectorCheck, document: &scraper::Html) -> SelectorResult {
    let attr = match &check.attribute_name {
        Some(a) if !a.is_empty() => a.clone(),
        _ => {
            return SelectorResult {
                selector_check_id: check.id.clone(),
                selector: check.selector.clone(),
                label: check.label.clone(),
                found: false,
                count: 0,
                text_content: None,
                check_type: CheckType::Attribute,
                a11y_issues: vec![],
            }
        }
    };
    match scraper::Selector::parse(&check.selector) {
        Ok(sel) => {
            let mut count = 0usize;
            let mut texts: Vec<String> = Vec::new();
            for el in document.select(&sel) {
                if let Some(val) = el.value().attr(&attr) {
                    count += 1;
                    if let Some(ref expected) = check.attribute_value {
                        if val == expected {
                            texts.push(format!("{}={}", attr, val));
                        }
                    } else {
                        texts.push(format!("{}={}", attr, val));
                    }
                }
            }
            let found = if let Some(ref expected) = check.attribute_value {
                texts.iter().any(|t| t.contains(expected))
            } else {
                count > 0
            };
            SelectorResult {
                selector_check_id: check.id.clone(),
                selector: check.selector.clone(),
                label: check.label.clone(),
                found,
                count,
                text_content: if texts.is_empty() {
                    None
                } else {
                    Some(texts.join(", "))
                },
                check_type: CheckType::Attribute,
                a11y_issues: vec![],
            }
        }
        Err(_) => SelectorResult {
            selector_check_id: check.id.clone(),
            selector: check.selector.clone(),
            label: check.label.clone(),
            found: false,
            count: 0,
            text_content: None,
            check_type: CheckType::Attribute,
            a11y_issues: vec![],
        },
    }
}

fn run_accessibility_check(check: &SelectorCheck, html: &str) -> SelectorResult {
    let config = check.a11y_config.clone().unwrap_or_default();
    let issues = crate::a11y::run_a11y_scan(html, &config);
    let found_count = issues.len();

    SelectorResult {
        selector_check_id: check.id.clone(),
        selector: check.selector.clone(),
        label: check.label.clone(),
        found: found_count == 0,
        count: found_count,
        text_content: if found_count > 0 {
            Some(format!("Found {} accessibility issues", found_count))
        } else {
            Some("No issues found".into())
        },
        check_type: CheckType::Accessibility,
        a11y_issues: issues,
    }
}

fn run_js_check(
    check: &SelectorCheck,
    document: &scraper::Html,
    page_url: &str,
    page_title: Option<&str>,
) -> SelectorResult {
    let js_result = |found: bool, text: String| SelectorResult {
        selector_check_id: check.id.clone(),
        selector: check.selector.clone(),
        label: check.label.clone(),
        found,
        count: if found { 1 } else { 0 },
        text_content: Some(text),
        check_type: CheckType::JavaScript,
        a11y_issues: vec![],
    };

    let js_code = match &check.pattern {
        Some(p) if !p.is_empty() => p.clone(),
        _ => return js_result(false, "No JS snippet provided".into()),
    };

    let page_text = document.root_element().text().collect::<String>();

    // Boa recurses on the native stack, so a deep JS call chain could
    // overflow a 2 MiB worker stack and abort the whole app. Evaluate on a
    // dedicated thread with a large stack, and cap JS recursion well below it.
    let outcome = std::thread::scope(|scope| {
        std::thread::Builder::new()
            .name("js-check".into())
            .stack_size(JS_THREAD_STACK_BYTES)
            .spawn_scoped(scope, || {
                eval_js_snippet(&js_code, &page_text, page_url, page_title)
            })
            .map_err(|e| format!("failed to start JS thread: {}", e))
            .and_then(|h| h.join().map_err(|_| "JS evaluation panicked".to_string()))
    });
    match outcome {
        Ok((found, text)) => js_result(found, text),
        Err(e) => js_result(false, e),
    }
}

/// Evaluates a JS check snippet. Returns `(passed, display text)`.
fn eval_js_snippet(
    js_code: &str,
    page_text: &str,
    page_url: &str,
    page_title: Option<&str>,
) -> (bool, String) {
    use boa_engine::{Context, Source};

    let mut context = Context::default();
    {
        // Bound runaway snippets such as `while(true){}` (A-06). Boa's
        // runtime-limit errors cannot be caught by script code.
        let limits = context.runtime_limits_mut();
        limits.set_loop_iteration_limit(JS_LOOP_ITERATION_LIMIT);
        limits.set_recursion_limit(JS_RECURSION_LIMIT);
    }
    if let Err(e) = context.eval(Source::from_bytes(&format!(
        "const pageText = {}; const pageUrl = {}; const pageTitle = {};",
        serde_json::to_string(page_text).unwrap_or_default(),
        serde_json::to_string(page_url).unwrap_or_default(),
        serde_json::to_string(&page_title).unwrap_or_default(),
    ))) {
        return (false, format!("Failed to set up context: {}", e));
    }

    match context.eval(Source::from_bytes(js_code)) {
        Ok(val) => {
            let pass = val.as_boolean().unwrap_or(false);
            let display = val
                .to_string(&mut context)
                .map(|s| s.to_std_string().unwrap_or_default())
                .unwrap_or_default();
            (pass, display)
        }
        Err(e) => (false, format!("JS error: {}", e)),
    }
}

fn extract_title_doc(document: &scraper::Html) -> Option<String> {
    let selector = scraper::Selector::parse("title").ok()?;
    document
        .select(&selector)
        .next()
        .map(|el| el.text().collect::<String>().trim().to_string())
}

// ---------------------------------------------------------------------------
// URL rewriting
// ---------------------------------------------------------------------------

/// Appends `postfix` to the URL's path, keeping any query and fragment
/// in place (A-39). A postfix that starts with `?`/`&` is merged into the
/// query, one that starts with `#` replaces the fragment, and a postfix
/// such as `.html?x=1` is split between path and query.
pub(crate) fn apply_url_postfix(url: &str, postfix: &Option<String>) -> String {
    let p = match postfix {
        Some(p) if !p.is_empty() => p.as_str(),
        _ => return url.to_string(),
    };
    let mut parsed = match reqwest::Url::parse(url) {
        Ok(u) if !u.cannot_be_a_base() => u,
        _ => return format!("{}{}", url, p),
    };

    let (before_frag, frag) = match p.find('#') {
        Some(i) => (&p[..i], Some(&p[i + 1..])),
        None => (p, None),
    };
    let (path_part, query_part) = if let Some(q) = before_frag.strip_prefix('&') {
        ("", Some(q))
    } else {
        match before_frag.find('?') {
            Some(i) => (&before_frag[..i], Some(&before_frag[i + 1..])),
            None => (before_frag, None),
        }
    };

    if !path_part.is_empty() {
        let new_path = format!("{}{}", parsed.path(), path_part);
        parsed.set_path(&new_path);
    }
    if let Some(q) = query_part.filter(|q| !q.is_empty()) {
        let merged = match parsed.query() {
            Some(existing) if !existing.is_empty() => format!("{}&{}", existing, q),
            _ => q.to_string(),
        };
        parsed.set_query(Some(&merged));
    }
    if let Some(f) = frag {
        parsed.set_fragment(Some(f));
    }
    parsed.to_string()
}

/// Replaces the scheme, host and port of `url` with those of the override,
/// keeping the path, query and fragment (A-40). A path in the override is
/// used as a prefix.
pub(crate) fn apply_origin_override(url: &str, origin_override: &Option<String>) -> String {
    let new_origin = match origin_override {
        Some(oo) if !oo.trim().is_empty() => oo.trim().trim_end_matches('/'),
        _ => return url.to_string(),
    };
    let parsed = match reqwest::Url::parse(url) {
        Ok(u) if !u.cannot_be_a_base() => u,
        _ => return url.to_string(),
    };
    let mut tail = parsed.path().to_string();
    if let Some(q) = parsed.query() {
        tail.push('?');
        tail.push_str(q);
    }
    if let Some(f) = parsed.fragment() {
        tail.push('#');
        tail.push_str(f);
    }
    format!("{}{}", new_origin, tail)
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

pub(crate) fn compute_summary(results: &[PageResult]) -> RunSummary {
    let total = results.len();
    let mut passed = 0usize;
    let mut failed = 0usize;
    let mut errored = 0usize;
    let mut total_time = 0u64;
    let mut timed = 0usize;

    for result in results {
        if result.error.is_some() {
            errored += 1;
            continue;
        }
        if result.checks.iter().all(|c| c.found) {
            passed += 1;
        } else {
            failed += 1;
        }
        if let Some(ms) = result.response_time_ms {
            total_time += ms;
            timed += 1;
        }
    }

    // Divide only by the pages that contributed a time (A-41).
    let avg = if timed > 0 {
        total_time as f64 / timed as f64
    } else {
        0.0
    };

    RunSummary {
        total,
        passed,
        failed,
        errored,
        avg_response_time_ms: avg,
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
pub(crate) mod test_support {
    //! A tiny HTTP/1.1 server for orchestration tests (no extra deps).
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    /// Routes:
    /// - `/ok`, `/ok2`, `/pN`: 200 HTML with a title and `<h1>`
    /// - `/slow`: waits 10 s, then 200
    /// - `/redirect`: 301 to `/ok`
    /// - `/big`: 200 HTML body of 6 MiB
    /// - `/image`: 200 `image/png`
    /// - `/links`: page linking to `/ok#a`, `/ok#b`, `/ok2`, `/slow`
    pub async fn spawn_server() -> String {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            loop {
                let (mut sock, _) = match listener.accept().await {
                    Ok(s) => s,
                    Err(_) => return,
                };
                tokio::spawn(async move {
                    let mut buf = vec![0u8; 4096];
                    let n = sock.read(&mut buf).await.unwrap_or(0);
                    let req = String::from_utf8_lossy(&buf[..n]).to_string();
                    let path = req
                        .lines()
                        .next()
                        .and_then(|l| l.split_whitespace().nth(1))
                        .unwrap_or("/")
                        .to_string();
                    let html = |title: &str| {
                        format!(
                            "<html><head><title>{}</title></head><body><h1>Hi</h1></body></html>",
                            title
                        )
                    };
                    let (status, ctype, extra, body): (&str, &str, String, Vec<u8>) =
                        match path.as_str() {
                            "/slow" => {
                                tokio::time::sleep(std::time::Duration::from_secs(10)).await;
                                ("200 OK", "text/html", String::new(), html("slow").into_bytes())
                            }
                            "/redirect" => (
                                "301 Moved Permanently",
                                "text/html",
                                "Location: /ok\r\n".into(),
                                Vec::new(),
                            ),
                            "/big" => {
                                let mut b = b"<html><body>".to_vec();
                                b.resize(6 * 1024 * 1024, b'a');
                                ("200 OK", "text/html", String::new(), b)
                            }
                            "/image" => ("200 OK", "image/png", String::new(), vec![0u8; 64]),
                            "/links" => (
                                "200 OK",
                                "text/html",
                                String::new(),
                                r#"<html><body><a href="/ok#a">a</a><a href="/ok#b">b</a><a href="/ok2">c</a><a href="/slow">d</a></body></html>"#
                                    .as_bytes()
                                    .to_vec(),
                            ),
                            p => ("200 OK", "text/html", String::new(), html(p).into_bytes()),
                        };
                    let head = format!(
                        "HTTP/1.1 {}\r\nContent-Type: {}\r\nContent-Length: {}\r\n{}Connection: close\r\n\r\n",
                        status,
                        ctype,
                        body.len(),
                        extra
                    );
                    let _ = sock.write_all(head.as_bytes()).await;
                    if !req.starts_with("HEAD") {
                        let _ = sock.write_all(&body).await;
                    }
                    let _ = sock.shutdown().await;
                });
            }
        });
        format!("http://{}", addr)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex as StdMutex;

    fn extract_title(html: &str) -> Option<String> {
        extract_title_doc(&scraper::Html::parse_document(html))
    }

    #[test]
    fn test_extract_title() {
        let html = "<html><head><title>  My Page Title  </title></head><body></body></html>";
        assert_eq!(extract_title(html), Some("My Page Title".to_string()));
    }

    #[test]
    fn test_extract_title_empty() {
        let html = "<html><head></head><body></body></html>";
        assert_eq!(extract_title(html), None);
    }

    #[test]
    fn test_extract_title_no_title() {
        assert_eq!(extract_title("no title here"), None);
    }

    #[test]
    fn test_apply_url_postfix_none() {
        assert_eq!(
            apply_url_postfix("https://example.com", &None),
            "https://example.com"
        );
    }

    #[test]
    fn test_apply_url_postfix_empty() {
        assert_eq!(
            apply_url_postfix("https://example.com", &Some(String::new())),
            "https://example.com"
        );
    }

    #[test]
    fn test_apply_url_postfix_applied() {
        assert_eq!(
            apply_url_postfix("https://example.com/page", &Some(".html".to_string())),
            "https://example.com/page.html"
        );
    }

    #[test]
    fn test_apply_url_postfix_keeps_query_and_fragment() {
        assert_eq!(
            apply_url_postfix(
                "https://example.com/page?a=1#top",
                &Some(".html".to_string())
            ),
            "https://example.com/page.html?a=1#top"
        );
    }

    #[test]
    fn test_apply_url_postfix_query_postfix_merges() {
        assert_eq!(
            apply_url_postfix("https://example.com/page?a=1", &Some("?b=2".to_string())),
            "https://example.com/page?a=1&b=2"
        );
        assert_eq!(
            apply_url_postfix("https://example.com/page", &Some("?b=2".to_string())),
            "https://example.com/page?b=2"
        );
        assert_eq!(
            apply_url_postfix("https://example.com/page", &Some(".html?b=2".to_string())),
            "https://example.com/page.html?b=2"
        );
    }

    #[test]
    fn test_apply_url_postfix_unparseable_falls_back() {
        assert_eq!(
            apply_url_postfix("not a url", &Some("/x".to_string())),
            "not a url/x"
        );
    }

    #[test]
    fn test_apply_origin_override_no_override() {
        assert_eq!(
            apply_origin_override("https://example.com/page", &None),
            "https://example.com/page"
        );
    }

    #[test]
    fn test_apply_origin_override_empty() {
        assert_eq!(
            apply_origin_override("https://example.com/page", &Some(String::new())),
            "https://example.com/page"
        );
    }

    #[test]
    fn test_apply_origin_override_replaces_origin() {
        assert_eq!(
            apply_origin_override(
                "https://old.com/path?q=1",
                &Some("https://new.com".to_string())
            ),
            "https://new.com/path?q=1"
        );
    }

    #[test]
    fn test_apply_origin_override_no_path() {
        assert_eq!(
            apply_origin_override("https://old.com", &Some("https://new.com".to_string())),
            "https://new.com/"
        );
    }

    #[test]
    fn test_apply_origin_override_no_path_keeps_query() {
        assert_eq!(
            apply_origin_override(
                "https://old.com?x=1#f",
                &Some("http://localhost:3000".to_string())
            ),
            "http://localhost:3000/?x=1#f"
        );
    }

    #[test]
    fn test_apply_origin_override_query_contains_url() {
        assert_eq!(
            apply_origin_override(
                "https://old.com/a?next=https://other.com/b",
                &Some("https://new.com".to_string())
            ),
            "https://new.com/a?next=https://other.com/b"
        );
    }

    #[test]
    fn test_apply_origin_override_trailing_slash() {
        assert_eq!(
            apply_origin_override(
                "https://old.com/path",
                &Some("https://new.com/".to_string())
            ),
            "https://new.com/path"
        );
    }

    #[test]
    fn test_apply_origin_override_no_scheme_fallback() {
        assert_eq!(
            apply_origin_override("no-scheme-url", &Some("https://new.com".to_string())),
            "no-scheme-url"
        );
        assert_eq!(
            apply_origin_override(
                "old.com/page?u=http://x.com",
                &Some("https://new.com".to_string())
            ),
            "old.com/page?u=http://x.com"
        );
    }

    fn page(url: &str, found: bool, ms: Option<u64>, error: Option<&str>) -> PageResult {
        PageResult {
            url: url.into(),
            error: error.map(|e| e.to_string()),
            checks: if error.is_some() {
                vec![]
            } else {
                vec![SelectorResult {
                    selector_check_id: "1".into(),
                    selector: "h1".into(),
                    label: "Heading".into(),
                    found,
                    count: if found { 1 } else { 0 },
                    text_content: None,
                    check_type: CheckType::Selector,
                    a11y_issues: vec![],
                }]
            },
            response_time_ms: ms,
            page_title: None,
            status: if error.is_some() { None } else { Some(200) },
            status_text: "OK".into(),
        }
    }

    #[test]
    fn test_compute_summary_all_passed() {
        let results = vec![
            page("https://a.com", true, Some(100), None),
            page("https://b.com", true, Some(200), None),
        ];
        let summary = compute_summary(&results);
        assert_eq!(summary.total, 2);
        assert_eq!(summary.passed, 2);
        assert_eq!(summary.failed, 0);
        assert_eq!(summary.errored, 0);
        assert!((summary.avg_response_time_ms - 150.0).abs() < 0.001);
    }

    #[test]
    fn test_compute_summary_mixed() {
        let results = vec![
            page("https://a.com", true, Some(100), None),
            page("https://b.com", false, Some(200), None),
            page("https://c.com", false, Some(5000), Some("timeout")),
        ];
        let summary = compute_summary(&results);
        assert_eq!(summary.total, 3);
        assert_eq!(summary.passed, 1);
        assert_eq!(summary.failed, 1);
        assert_eq!(summary.errored, 1);
        // Errored pages are excluded from both the sum and the divisor.
        assert!((summary.avg_response_time_ms - 150.0).abs() < 0.001);
    }

    #[test]
    fn test_compute_summary_empty() {
        let summary = compute_summary(&[]);
        assert_eq!(summary.total, 0);
        assert_eq!(summary.passed, 0);
        assert_eq!(summary.failed, 0);
        assert_eq!(summary.errored, 0);
        assert_eq!(summary.avg_response_time_ms, 0.0);
    }

    fn make_check(id: &str, selector: &str, label: &str) -> SelectorCheck {
        SelectorCheck {
            id: id.into(),
            selector: selector.into(),
            label: label.into(),
            check_type: CheckType::Selector,
            expected_status: None,
            pattern: None,
            attribute_name: None,
            attribute_value: None,
            a11y_config: None,
        }
    }

    fn typed_check(id: &str, check_type: CheckType) -> SelectorCheck {
        SelectorCheck {
            check_type,
            ..make_check(id, "", id)
        }
    }

    #[test]
    fn test_run_checks_valid() {
        let html = "<html><body><h1>Hello</h1><p>World</p></body></html>";
        let checks = vec![
            make_check("c1", "h1", "Heading"),
            make_check("c2", "p", "Paragraph"),
            make_check("c3", ".missing", "Missing"),
        ];
        let results = run_checks(200, html, "https://example.com", &checks);
        assert_eq!(results.len(), 3);
        assert!(results[0].found);
        assert_eq!(results[0].count, 1);
        assert_eq!(results[0].text_content.as_deref(), Some("Hello"));
        assert!(results[1].found);
        assert_eq!(results[1].count, 1);
        assert_eq!(results[1].text_content.as_deref(), Some("World"));
        assert!(!results[2].found);
        assert_eq!(results[2].count, 0);
        assert_eq!(results[2].text_content, None);
    }

    #[test]
    fn test_run_checks_invalid_selector() {
        let html = "<html><body></body></html>";
        let checks = vec![make_check("c1", "[[invalid", "Bad")];
        let results = run_checks(200, html, "https://example.com", &checks);
        assert_eq!(results.len(), 1);
        assert!(!results[0].found);
    }

    #[test]
    fn test_run_checks_status() {
        let check = SelectorCheck {
            expected_status: Some(200),
            ..typed_check("s1", CheckType::Status)
        };
        let results = run_checks(200, "", "https://example.com", &[check]);
        assert!(results[0].found);
        assert_eq!(results[0].text_content.as_deref(), Some("HTTP 200"));
    }

    #[test]
    fn test_status_check_redirect_meta() {
        let check = SelectorCheck {
            expected_status: Some(301),
            ..typed_check("s1", CheckType::Status)
        };
        let meta = ResponseMeta {
            status: 301,
            location: Some("/new".into()),
            redirected_to: None,
        };
        let r = run_status_check(&check, &meta);
        assert!(r.found);
        assert_eq!(r.text_content.as_deref(), Some("HTTP 301 → /new"));
    }

    #[test]
    fn test_template_expects_redirect() {
        let mut c = typed_check("s", CheckType::Status);
        c.expected_status = Some(200);
        assert!(!template_expects_redirect(std::slice::from_ref(&c)));
        c.expected_status = Some(302);
        assert!(template_expects_redirect(&[c]));
    }

    #[test]
    fn test_run_checks_regex() {
        let html = "hello world hello";
        let check = SelectorCheck {
            pattern: Some("hello".into()),
            ..typed_check("r1", CheckType::Regex)
        };
        let results = run_checks(200, html, "https://example.com", &[check]);
        assert!(results[0].found);
        assert_eq!(results[0].count, 2);
    }

    #[test]
    fn test_run_checks_regex_invalid() {
        let check = SelectorCheck {
            pattern: Some("[invalid".into()),
            ..typed_check("r2", CheckType::Regex)
        };
        let results = run_checks(200, "", "https://example.com", &[check]);
        assert!(!results[0].found);
    }

    #[test]
    fn test_run_checks_attribute() {
        let html = r#"<img src="logo.png" alt="Logo"><a href="/">Home</a>"#;
        let check = SelectorCheck {
            id: "a1".into(),
            selector: "img".into(),
            label: "Img alt".into(),
            check_type: CheckType::Attribute,
            expected_status: None,
            pattern: None,
            attribute_name: Some("alt".into()),
            attribute_value: Some("Logo".into()),
            a11y_config: None,
        };
        let results = run_checks(200, html, "https://example.com", &[check]);
        assert!(results[0].found);
        assert_eq!(results[0].count, 1);
    }

    #[test]
    fn test_js_check_uses_page_globals() {
        let html = "<html><head><title>T</title></head><body>needle</body></html>";
        let check = SelectorCheck {
            pattern: Some("pageText.includes('needle') && pageTitle === 'T'".into()),
            ..typed_check("j1", CheckType::JavaScript)
        };
        let results = run_checks(200, html, "https://example.com", &[check]);
        assert!(results[0].found, "{:?}", results[0].text_content);
    }

    #[test]
    fn test_js_check_infinite_loop_is_bounded() {
        let check = SelectorCheck {
            pattern: Some("while(true){} true".into()),
            ..typed_check("j2", CheckType::JavaScript)
        };
        let start = Instant::now();
        let results = run_checks(200, "<html></html>", "https://example.com", &[check]);
        assert!(!results[0].found);
        assert!(start.elapsed() < Duration::from_secs(20));
    }

    #[test]
    fn test_js_check_catch_cannot_swallow_limit() {
        let check = SelectorCheck {
            pattern: Some("try { while(true){} } catch(e) {} true".into()),
            ..typed_check("j3", CheckType::JavaScript)
        };
        let results = run_checks(200, "<html></html>", "https://example.com", &[check]);
        assert!(!results[0].found);
    }

    #[test]
    fn test_js_check_deep_recursion_is_bounded() {
        let check = SelectorCheck {
            pattern: Some("function f(n){ return f(n+1); } f(0)".into()),
            ..typed_check("j4", CheckType::JavaScript)
        };
        let results = run_checks(200, "<html></html>", "https://example.com", &[check]);
        assert!(!results[0].found);
    }

    #[test]
    fn test_effective_limits_clamps() {
        let mut cfg = AuditConfig {
            batch_size: 0,
            timeout_secs: 0,
            ..AuditConfig::default()
        };
        assert_eq!(effective_limits(&cfg), (1, 1));
        cfg.batch_size = 10_000;
        assert_eq!(effective_limits(&cfg).0, MAX_BATCH_SIZE as usize);
        cfg.mode = "sequential".into();
        assert_eq!(effective_limits(&cfg).0, 1);
    }

    #[test]
    fn test_resolve_operation_id() {
        let id = uuid::Uuid::new_v4().to_string();
        assert_eq!(resolve_operation_id(Some(id.clone())), id);
        let generated = resolve_operation_id(Some("../../etc/passwd".into()));
        assert!(uuid::Uuid::parse_str(&generated).is_ok());
        assert!(uuid::Uuid::parse_str(&resolve_operation_id(None)).is_ok());
    }

    #[test]
    fn test_with_run_id_flattens() {
        let v = with_run_id("r1", &page("https://a.com", true, Some(1), None));
        assert_eq!(v["runId"], "r1");
        assert_eq!(v["url"], "https://a.com");
    }

    #[test]
    fn test_registry_cancel_is_per_id_and_unregisters() {
        let reg = CancelRegistry::default();
        let a = reg.register("a");
        let b = reg.register("b");
        assert!(reg.cancel("a"));
        assert!(a.token().is_cancelled());
        assert!(!b.token().is_cancelled());
        drop(a);
        assert!(!reg.cancel("a"));
        assert_eq!(reg.cancel_all(), 1);
        assert!(b.token().is_cancelled());
    }

    #[tokio::test]
    async fn test_cancel_token_wakes_waiters() {
        let t = Arc::new(CancelToken::new());
        let t2 = t.clone();
        let h = tokio::spawn(async move { t2.cancelled().await });
        tokio::time::sleep(Duration::from_millis(20)).await;
        t.cancel();
        tokio::time::timeout(Duration::from_secs(2), h)
            .await
            .expect("waiter not woken")
            .unwrap();
    }

    // ---- orchestration ---------------------------------------------------

    #[derive(Clone, Default)]
    struct MockSink {
        events: Arc<StdMutex<Vec<(String, serde_json::Value)>>>,
        saves: Arc<StdMutex<Vec<AuditRun>>>,
        fail_save: bool,
    }

    impl RunSink for MockSink {
        fn emit(&self, event: &str, payload: serde_json::Value) {
            self.events.lock().unwrap().push((event.into(), payload));
        }
        fn save(&self, run: &AuditRun) -> Result<(), String> {
            self.saves.lock().unwrap().push(run.clone());
            if self.fail_save {
                Err("disk full".into())
            } else {
                Ok(())
            }
        }
    }

    impl MockSink {
        fn events_named(&self, name: &str) -> Vec<serde_json::Value> {
            self.events
                .lock()
                .unwrap()
                .iter()
                .filter(|(n, _)| n == name)
                .map(|(_, v)| v.clone())
                .collect()
        }
    }

    fn fixtures(
        urls: Vec<String>,
        checks: Vec<SelectorCheck>,
        batch: u32,
    ) -> (Audit, TargetList, CheckTemplate) {
        let audit = Audit {
            id: "audit-1".into(),
            name: "A".into(),
            target_list_id: String::new(),
            check_template_id: String::new(),
            config: AuditConfig {
                mode: "batch".into(),
                batch_size: batch,
                timeout_secs: 5,
                ..AuditConfig::default()
            },
            origin_override: None,
            url_postfix: None,
            created_at: String::new(),
            pinned: false,
            folder: None,
            baseline_run_id: None,
        };
        let tl = TargetList {
            id: String::new(),
            name: "L".into(),
            urls,
            created_at: String::new(),
            updated_at: String::new(),
            pinned: false,
            folder: None,
        };
        let ct = CheckTemplate {
            id: String::new(),
            name: "T".into(),
            checks,
            created_at: String::new(),
            updated_at: String::new(),
            pinned: false,
            folder: None,
        };
        (audit, tl, ct)
    }

    #[tokio::test]
    async fn test_run_completes_and_tags_events_with_run_id() {
        let base = test_support::spawn_server().await;
        let urls: Vec<String> = (0..5).map(|i| format!("{}/p{}", base, i)).collect();
        let (audit, tl, ct) = fixtures(urls, vec![make_check("h", "h1", "H")], 2);
        let sink = MockSink::default();
        let token = Arc::new(CancelToken::new());
        let run = execute_run(sink.clone(), "run-1".into(), token, &audit, &tl, &ct)
            .await
            .unwrap();
        assert_eq!(run.status, "completed");
        assert_eq!(run.results.len(), 5);
        assert_eq!(run.summary.passed, 5);
        assert!(run.results.iter().all(|r| r.page_title.is_some()));

        let results = sink.events_named("run:result");
        assert_eq!(results.len(), 5);
        assert!(results.iter().all(|v| v["runId"] == "run-1"));
        let progress = sink.events_named("run:progress");
        assert_eq!(progress.last().unwrap()["checked"], 5);
        assert!(progress.iter().all(|v| v["runId"] == "run-1"));
        let complete = sink.events_named("run:complete");
        assert_eq!(complete.len(), 1);
        assert_eq!(complete[0]["runId"], "run-1");
        assert_eq!(complete[0]["id"], "run-1");
        // Final save is the last write and is the completed record.
        let saves = sink.saves.lock().unwrap();
        assert_eq!(saves.last().unwrap().status, "completed");
        // Checkpoints are throttled: far fewer writes than pages would need
        // for large runs (here: at most one partial + the final save).
        assert!(saves.len() <= 2);
    }

    #[tokio::test]
    async fn test_batch_size_zero_does_not_hang() {
        let base = test_support::spawn_server().await;
        let (mut audit, tl, ct) = fixtures(vec![format!("{}/ok", base)], vec![], 0);
        audit.config.timeout_secs = 0;
        let sink = MockSink::default();
        let run = tokio::time::timeout(
            Duration::from_secs(10),
            execute_run(
                sink,
                "r".into(),
                Arc::new(CancelToken::new()),
                &audit,
                &tl,
                &ct,
            ),
        )
        .await
        .expect("run hung with batch_size 0")
        .unwrap();
        assert_eq!(run.results.len(), 1);
        assert!(run.results[0].error.is_none(), "{:?}", run.results[0].error);
    }

    #[tokio::test]
    async fn test_cancel_stops_promptly_and_final_record_is_cancelled() {
        let base = test_support::spawn_server().await;
        let mut urls = vec![format!("{}/ok", base)];
        urls.extend((0..6).map(|_| format!("{}/slow", base)));
        let (audit, tl, ct) = fixtures(urls, vec![], 2);
        let sink = MockSink::default();
        let token = Arc::new(CancelToken::new());
        let t2 = token.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(300)).await;
            t2.cancel();
        });
        let start = Instant::now();
        let run = execute_run(sink.clone(), "r".into(), token, &audit, &tl, &ct)
            .await
            .unwrap();
        assert!(
            start.elapsed() < Duration::from_secs(3),
            "cancel was not prompt"
        );
        assert_eq!(run.status, "cancelled");
        assert!(run.results.len() < 7);

        // Give any stray task time to misbehave, then make sure nothing was
        // emitted or saved after the final record.
        tokio::time::sleep(Duration::from_millis(500)).await;
        let events = sink.events.lock().unwrap();
        assert_eq!(events.last().unwrap().0, "run:complete");
        let cancelled_pos = events
            .iter()
            .position(|(n, _)| n == "run:cancelled")
            .unwrap();
        assert!(events[cancelled_pos + 1..]
            .iter()
            .all(|(n, _)| n == "run:complete"));
        assert_eq!(
            sink.saves.lock().unwrap().last().unwrap().status,
            "cancelled"
        );
    }

    #[tokio::test]
    async fn test_redirect_status_check_sees_3xx() {
        let base = test_support::spawn_server().await;
        let check = SelectorCheck {
            expected_status: Some(301),
            ..typed_check("s", CheckType::Status)
        };
        let (audit, tl, ct) = fixtures(vec![format!("{}/redirect", base)], vec![check], 1);
        let run = execute_run(
            MockSink::default(),
            "r".into(),
            Arc::new(CancelToken::new()),
            &audit,
            &tl,
            &ct,
        )
        .await
        .unwrap();
        assert_eq!(run.results[0].status, Some(301));
        assert!(run.results[0].checks[0].found);
        assert_eq!(
            run.results[0].checks[0].text_content.as_deref(),
            Some("HTTP 301 → /ok")
        );
    }

    #[tokio::test]
    async fn test_followed_redirect_is_reported() {
        let base = test_support::spawn_server().await;
        let check = SelectorCheck {
            expected_status: Some(200),
            ..typed_check("s", CheckType::Status)
        };
        let (audit, tl, ct) = fixtures(vec![format!("{}/redirect", base)], vec![check], 1);
        let run = execute_run(
            MockSink::default(),
            "r".into(),
            Arc::new(CancelToken::new()),
            &audit,
            &tl,
            &ct,
        )
        .await
        .unwrap();
        assert_eq!(run.results[0].status, Some(200));
        let text = run.results[0].checks[0].text_content.clone().unwrap();
        assert!(text.starts_with("HTTP 200 (redirected to"), "{}", text);
    }

    #[tokio::test]
    async fn test_body_is_capped_and_binary_skipped() {
        let base = test_support::spawn_server().await;
        let client = reqwest::Client::new();
        let resp = client.get(format!("{}/big", base)).send().await.unwrap();
        let body = read_body_capped(resp, 1024).await.unwrap();
        assert_eq!(body.len(), 1024);
        let resp = client.get(format!("{}/image", base)).send().await.unwrap();
        assert_eq!(read_body_capped(resp, 1024).await.unwrap(), "");
    }

    #[tokio::test]
    async fn test_final_save_failure_is_reported() {
        let base = test_support::spawn_server().await;
        let (audit, tl, ct) = fixtures(vec![format!("{}/ok", base)], vec![], 1);
        let sink = MockSink {
            fail_save: true,
            ..MockSink::default()
        };
        let res = execute_run(
            sink.clone(),
            "r".into(),
            Arc::new(CancelToken::new()),
            &audit,
            &tl,
            &ct,
        )
        .await;
        assert_eq!(res.unwrap_err(), "disk full");
        // The run still completes for the UI.
        assert_eq!(sink.events_named("run:complete").len(), 1);
    }
}
