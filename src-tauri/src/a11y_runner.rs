use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, PoisonError};
use std::time::Instant;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::{Notify, Semaphore};

use crate::a11y::run_a11y_scan;
use crate::models::*;
use crate::AppState;

/// Upper bound for concurrent page fetches in batch mode.
pub(crate) const MAX_BATCH_SIZE: u32 = 50;

// ─── Cancellation ───

/// Per-job cancellation token: a flag plus a `Notify` so in-flight work can
/// `select!` on `cancelled()` and stop immediately instead of polling.
pub struct CancelToken {
    flag: AtomicBool,
    notify: Notify,
}

impl CancelToken {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            flag: AtomicBool::new(false),
            notify: Notify::new(),
        })
    }

    pub fn cancel(&self) {
        self.flag.store(true, Ordering::SeqCst);
        self.notify.notify_waiters();
    }

    pub fn is_cancelled(&self) -> bool {
        self.flag.load(Ordering::SeqCst)
    }

    /// Resolves once `cancel()` has been called (immediately if it already was).
    pub async fn cancelled(&self) {
        loop {
            let notified = self.notify.notified();
            tokio::pin!(notified);
            // Register before checking the flag so a concurrent cancel() can't
            // slip between the check and the await.
            notified.as_mut().enable();
            if self.is_cancelled() {
                return;
            }
            notified.await;
        }
    }
}

struct ActiveJob {
    id: String,
    token: Arc<CancelToken>,
}

/// Owns the single active accessibility job (run or re-run). Only one job may
/// run at a time; each job gets its own cancel token, so starting a new job can
/// never "un-cancel" another one.
pub struct A11yRunner {
    active: Arc<Mutex<Option<ActiveJob>>>,
}

/// Held for the lifetime of a job; releases the runner slot on drop (including
/// on early return / panic).
pub struct JobGuard {
    active: Arc<Mutex<Option<ActiveJob>>>,
    id: String,
    token: Arc<CancelToken>,
}

impl JobGuard {
    pub fn id(&self) -> &str {
        &self.id
    }

    pub fn token(&self) -> Arc<CancelToken> {
        self.token.clone()
    }
}

impl Drop for JobGuard {
    fn drop(&mut self) {
        let mut active = self.active.lock().unwrap_or_else(PoisonError::into_inner);
        if active.as_ref().map(|j| j.id == self.id).unwrap_or(false) {
            *active = None;
        }
    }
}

impl Default for A11yRunner {
    fn default() -> Self {
        Self::new()
    }
}

impl A11yRunner {
    pub fn new() -> Self {
        Self {
            active: Arc::new(Mutex::new(None)),
        }
    }

    /// Claim the runner for `job_id`. Fails if another job is in progress.
    pub fn begin(&self, job_id: &str) -> Result<JobGuard, String> {
        let mut active = self.active.lock().unwrap_or_else(PoisonError::into_inner);
        if active.is_some() {
            return Err("An accessibility run is already in progress".into());
        }
        let token = CancelToken::new();
        *active = Some(ActiveJob {
            id: job_id.to_string(),
            token: token.clone(),
        });
        Ok(JobGuard {
            active: self.active.clone(),
            id: job_id.to_string(),
            token,
        })
    }

    /// Cancel the active job, if any.
    pub fn cancel(&self) {
        let active = self.active.lock().unwrap_or_else(PoisonError::into_inner);
        if let Some(job) = active.as_ref() {
            job.token.cancel();
        }
    }

    pub fn is_running(&self) -> bool {
        self.active
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .is_some()
    }
}

// ─── Config sanitising (A-07) ───

/// Batch size clamped to 1..=MAX_BATCH_SIZE (0 would deadlock the semaphore).
pub(crate) fn effective_batch_size(config: &AuditConfig) -> usize {
    config.batch_size.clamp(1, MAX_BATCH_SIZE) as usize
}

/// Request timeout of at least one second.
pub(crate) fn effective_timeout_secs(config: &AuditConfig) -> u64 {
    config.timeout_secs.max(1)
}

/// Normalise an `AuditConfig` in place (used when saving audits).
pub(crate) fn sanitize_audit_config(config: &mut AuditConfig) {
    config.batch_size = config.batch_size.clamp(1, MAX_BATCH_SIZE);
    config.timeout_secs = config.timeout_secs.max(1);
}

// ─── Events ───
//
// Every event carries `reportId` (the job id) so listeners can ignore events
// that belong to a different job; re-run events additionally carry
// `rerun: true`.

pub(crate) fn emit_progress(
    app: &AppHandle,
    report_id: &str,
    checked: usize,
    total: usize,
    rerun: bool,
) {
    let _ = app.emit(
        "a11y:progress",
        serde_json::json!({
            "reportId": report_id,
            "checked": checked,
            "total": total,
            "rerun": rerun,
        }),
    );
}

pub(crate) fn emit_result(app: &AppHandle, report_id: &str, page: &A11yPageResult, rerun: bool) {
    let mut payload = serde_json::to_value(page).unwrap_or_else(|_| serde_json::json!({}));
    if let Some(obj) = payload.as_object_mut() {
        obj.insert("reportId".into(), report_id.into());
        obj.insert("rerun".into(), rerun.into());
    }
    let _ = app.emit("a11y:result", payload);
}

pub(crate) fn emit_error(app: &AppHandle, report_id: Option<&str>, message: &str) {
    let _ = app.emit(
        "a11y:error",
        serde_json::json!({ "reportId": report_id, "message": message }),
    );
}

/// Build a report stamped with the settings it was scanned with, so re-runs
/// can reproduce them (A-10).
pub(crate) fn build_report(
    report_id: &str,
    audit: &A11yAudit,
    started_at: String,
    completed_at: Option<String>,
    status: &str,
    results: Vec<A11yPageResult>,
) -> A11yReport {
    let summary = compute_a11y_summary(&results);
    A11yReport {
        id: report_id.to_string(),
        audit_id: audit.id.clone(),
        started_at,
        completed_at,
        status: status.into(),
        results,
        summary,
        standards: audit.a11y_config.standards.clone(),
        engine: Some(audit.engine.clone()),
        min_severity: Some(audit.a11y_config.min_severity.clone()),
        categories: Some(audit.a11y_config.categories.clone()),
    }
}

/// Persist an in-progress snapshot unless the job has been cancelled (the
/// final cancelled report must never be overwritten by a stale partial).
pub(crate) fn save_partial(app: &AppHandle, token: &CancelToken, partial: &A11yReport) {
    if token.is_cancelled() {
        return;
    }
    if let Some(state) = app.try_state::<AppState>() {
        let _ = state.storage.save_a11y_report(partial);
    }
}

pub(crate) fn target_urls(audit: &A11yAudit, target_list: &TargetList) -> Vec<String> {
    target_list
        .urls
        .iter()
        .map(|u| apply_a11y_origin_override(u, &audit.origin_override))
        .map(|u| apply_a11y_url_postfix(&u, &audit.url_postfix))
        .collect()
}

// ─── Static engine ───

/// Run a full static-engine audit. Cancellation stops spawning new pages,
/// aborts in-flight requests, and all tasks are joined before the final report
/// is built, so nothing can write after it (A-09).
pub async fn run_static_audit(
    app: &AppHandle,
    audit: &A11yAudit,
    target_list: &TargetList,
    report_id: &str,
    token: Arc<CancelToken>,
) -> A11yReport {
    let started_at = chrono::Utc::now().to_rfc3339();
    let urls = target_urls(audit, target_list);
    let total = urls.len();

    let concurrency = match audit.config.mode.as_str() {
        "sequential" => 1,
        _ => effective_batch_size(&audit.config),
    };
    let semaphore = Arc::new(Semaphore::new(concurrency));
    let client = build_a11y_client(audit);
    let results: Arc<Mutex<Vec<A11yPageResult>>> = Arc::new(Mutex::new(Vec::with_capacity(total)));

    let mut tasks = Vec::with_capacity(total);
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
        let token = token.clone();
        let results = results.clone();
        let app = app.clone();
        let report_id = report_id.to_string();
        let audit = audit.clone();
        let started_at = started_at.clone();

        tasks.push(tokio::spawn(async move {
            let _permit = permit;
            let page_result = tokio::select! {
                biased;
                _ = token.cancelled() => return,
                r = scan_url(client, url, &audit.a11y_config) => r,
            };
            if token.is_cancelled() {
                return;
            }

            let mut results = results.lock().unwrap_or_else(PoisonError::into_inner);
            results.push(page_result.clone());
            emit_progress(&app, &report_id, results.len(), total, false);
            emit_result(&app, &report_id, &page_result, false);

            let partial = build_report(
                &report_id,
                &audit,
                started_at,
                None,
                "running",
                results.clone(),
            );
            save_partial(&app, &token, &partial);
        }));
    }

    for task in tasks {
        let _ = task.await;
    }

    let status = if token.is_cancelled() {
        "cancelled"
    } else {
        "completed"
    };
    let results = std::mem::take(&mut *results.lock().unwrap_or_else(PoisonError::into_inner));
    build_report(
        report_id,
        audit,
        started_at,
        Some(chrono::Utc::now().to_rfc3339()),
        status,
        results,
    )
}

fn error_page(
    url: String,
    status: Option<u16>,
    status_text: String,
    elapsed: Option<u64>,
    error: String,
) -> A11yPageResult {
    A11yPageResult {
        url,
        page_title: None,
        status,
        status_text,
        response_time_ms: elapsed,
        error: Some(error),
        issues: Vec::new(),
        truncated: false,
    }
}

async fn scan_url(
    client: reqwest::Client,
    url: String,
    config: &A11yCheckConfig,
) -> A11yPageResult {
    let start = Instant::now();
    match client.get(&url).send().await {
        Ok(response) => {
            let status = response.status();
            let status_code = status.as_u16();
            let status_text = status.canonical_reason().unwrap_or("unknown").to_string();

            // HTTP error pages are errored results (and eligible for re-run),
            // not pages to audit.
            if status_code >= 400 {
                let elapsed = start.elapsed().as_millis() as u64;
                let error = format!("HTTP {} {}", status_code, status_text);
                return error_page(url, Some(status_code), status_text, Some(elapsed), error);
            }

            match response.text().await {
                Ok(html) => {
                    let elapsed = start.elapsed().as_millis() as u64;
                    let issues = run_a11y_scan(&html, config);
                    A11yPageResult {
                        page_title: extract_a11y_title(&html),
                        url,
                        status: Some(status_code),
                        status_text,
                        response_time_ms: Some(elapsed),
                        error: None,
                        issues,
                        truncated: false,
                    }
                }
                Err(e) => {
                    let elapsed = start.elapsed().as_millis() as u64;
                    error_page(
                        url,
                        Some(status_code),
                        status_text,
                        Some(elapsed),
                        format!("body read error: {}", e),
                    )
                }
            }
        }
        Err(e) => {
            let elapsed = start.elapsed().as_millis() as u64;
            error_page(url, None, "error".into(), Some(elapsed), e.to_string())
        }
    }
}

fn extract_a11y_title(html: &str) -> Option<String> {
    let document = scraper::Html::parse_document(html);
    let selector = scraper::Selector::parse("title").ok()?;
    document
        .select(&selector)
        .next()
        .map(|el| el.text().collect::<String>().trim().to_string())
}

pub(crate) fn apply_a11y_url_postfix(url: &str, postfix: &Option<String>) -> String {
    match postfix {
        Some(p) if !p.is_empty() => format!("{}{}", url, p),
        _ => url.to_string(),
    }
}

pub(crate) fn apply_a11y_origin_override(url: &str, origin_override: &Option<String>) -> String {
    let new_origin = match origin_override {
        Some(oo) if !oo.is_empty() => oo.trim_end_matches('/'),
        _ => return url.to_string(),
    };

    if let Some(scheme_end) = url.find("://") {
        let after_scheme = &url[scheme_end + 3..];
        if let Some(path_start) = after_scheme.find('/') {
            let path_and_query = &after_scheme[path_start..];
            return format!("{}{}", new_origin, path_and_query);
        }
        return format!("{}/", new_origin);
    }

    url.to_string()
}

pub(crate) fn build_a11y_client(audit: &A11yAudit) -> reqwest::Client {
    let mut client_builder = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(effective_timeout_secs(
            &audit.config,
        )))
        .redirect(reqwest::redirect::Policy::limited(10));
    if !audit.config.headers.is_empty() {
        let mut headers = reqwest::header::HeaderMap::new();
        for (key, value) in &audit.config.headers {
            if let (Ok(k), Ok(v)) = (
                reqwest::header::HeaderName::from_bytes(key.as_bytes()),
                reqwest::header::HeaderValue::from_str(value),
            ) {
                headers.insert(k, v);
            }
        }
        client_builder = client_builder.default_headers(headers);
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
            client_builder = client_builder.default_headers(reqwest::header::HeaderMap::from_iter(
                [(reqwest::header::COOKIE, v)],
            ));
        }
    }
    client_builder
        .build()
        .unwrap_or_else(|_| reqwest::Client::new())
}

/// Re-scan a subset of URLs with the static engine (used by report re-run).
/// URLs are expected to be final (already origin/postfix-transformed) URLs
/// as stored on report results.
pub async fn scan_urls_static(
    app: &AppHandle,
    audit: &A11yAudit,
    report_id: &str,
    urls: Vec<String>,
    token: Arc<CancelToken>,
) -> Vec<A11yPageResult> {
    let client = build_a11y_client(audit);
    let total = urls.len();
    let mut out = Vec::with_capacity(total);
    for url in urls {
        let page_result = tokio::select! {
            biased;
            _ = token.cancelled() => break,
            r = scan_url(client.clone(), url, &audit.a11y_config) => r,
        };
        out.push(page_result);
        let page_result = out.last().expect("just pushed");
        emit_progress(app, report_id, out.len(), total, true);
        emit_result(app, report_id, page_result, true);
    }
    out
}

pub(crate) fn compute_a11y_summary(results: &[A11yPageResult]) -> A11ySummary {
    let mut summary = A11ySummary {
        total_pages: results.len(),
        ..Default::default()
    };
    for r in results {
        if r.error.is_some() {
            summary.errored += 1;
            continue;
        }
        if !r.issues.is_empty() {
            summary.pages_with_issues += 1;
        }
        for issue in &r.issues {
            match issue.severity.as_str() {
                "critical" => summary.critical += 1,
                "serious" => summary.serious += 1,
                "moderate" => summary.moderate += 1,
                _ => summary.minor += 1,
            }
        }
    }
    summary
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn batch_size_and_timeout_are_clamped() {
        let mut cfg = AuditConfig {
            batch_size: 0,
            timeout_secs: 0,
            ..AuditConfig::default()
        };
        assert_eq!(effective_batch_size(&cfg), 1);
        assert_eq!(effective_timeout_secs(&cfg), 1);
        cfg.batch_size = 500;
        assert_eq!(effective_batch_size(&cfg), MAX_BATCH_SIZE as usize);
        sanitize_audit_config(&mut cfg);
        assert_eq!(cfg.batch_size, MAX_BATCH_SIZE);
        assert_eq!(cfg.timeout_secs, 1);
    }

    #[test]
    fn runner_allows_one_job_and_releases_on_drop() {
        let runner = A11yRunner::new();
        let guard = runner.begin("a").unwrap();
        assert!(runner.is_running());
        assert!(runner.begin("b").is_err());
        runner.cancel();
        assert!(guard.token().is_cancelled());
        drop(guard);
        assert!(!runner.is_running());
        // a new job gets a fresh, un-cancelled token
        let g2 = runner.begin("b").unwrap();
        assert!(!g2.token().is_cancelled());
    }

    #[tokio::test]
    async fn cancel_token_wakes_waiters() {
        let token = CancelToken::new();
        let t2 = token.clone();
        let waiter = tokio::spawn(async move { t2.cancelled().await });
        tokio::task::yield_now().await;
        token.cancel();
        tokio::time::timeout(std::time::Duration::from_secs(1), waiter)
            .await
            .expect("waiter should wake")
            .unwrap();
        // already-cancelled resolves immediately
        tokio::time::timeout(std::time::Duration::from_millis(50), token.cancelled())
            .await
            .unwrap();
    }

    #[test]
    fn summary_counts_errors() {
        let ok = A11yPageResult {
            url: "a".into(),
            page_title: None,
            status: Some(200),
            status_text: "OK".into(),
            response_time_ms: None,
            error: None,
            issues: Vec::new(),
            truncated: false,
        };
        let err = error_page(
            "b".into(),
            Some(404),
            "Not Found".into(),
            None,
            "HTTP 404".into(),
        );
        let s = compute_a11y_summary(&[ok, err]);
        assert_eq!(s.total_pages, 2);
        assert_eq!(s.errored, 1);
    }
}
