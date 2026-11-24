use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};

use chromiumoxide::browser::{Browser, BrowserConfig};
use chromiumoxide::cdp::browser_protocol::network::{
    CookieParam, EventResponseReceived, Headers, ResourceType, SetCookiesParams,
    SetExtraHttpHeadersParams,
};
use chromiumoxide::Page;
use futures::{FutureExt, StreamExt};
use serde::Deserialize;
use tauri::AppHandle;

use crate::a11y_runner::{
    build_report, effective_timeout_secs, emit_progress, emit_result, save_partial, target_urls,
    CancelToken,
};
use crate::models::*;

const AXE_SOURCE: &str = include_str!("../assets/axe.min.js");
/// Custom rules for checks IBM Equal Access reports that axe misses (SVG
/// names, ARIA ID references).
const AXE_EXTRA_RULES: &str = include_str!("../assets/axe-extra-rules.js");
const MAX_NODES_PER_VIOLATION: usize = 25;
const MAX_TOTAL_ISSUES: usize = 1000;

#[derive(Debug, Deserialize)]
struct AxeViolation {
    id: String,
    impact: Option<String>,
    help: Option<String>,
    #[serde(rename = "helpUrl")]
    help_url: Option<String>,
    tags: Vec<String>,
    #[serde(default)]
    nodes: Vec<AxeNode>,
}

#[derive(Debug, Deserialize)]
struct AxeNode {
    #[serde(default)]
    target: Vec<serde_json::Value>,
    html: Option<String>,
}

fn find_browser_executable() -> Option<PathBuf> {
    if let Ok(p) = std::env::var("A11Y_CHROME_PATH") {
        let pb = PathBuf::from(p);
        if pb.exists() {
            return Some(pb);
        }
    }
    let candidates = [
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
        "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
        "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
        "/opt/homebrew/bin/chromium",
        "/usr/bin/chromium",
        "/usr/bin/chromium-browser",
        "/usr/bin/google-chrome",
        "/usr/bin/google-chrome-stable",
    ];
    for c in candidates {
        let p = PathBuf::from(c);
        if p.exists() {
            return Some(p);
        }
    }
    for name in [
        "chromium",
        "google-chrome",
        "google-chrome-stable",
        "chrome",
    ] {
        if let Ok(out) = std::process::Command::new("which").arg(name).output() {
            if out.status.success() {
                let p = String::from_utf8_lossy(&out.stdout).trim().to_string();
                if !p.is_empty() {
                    return Some(PathBuf::from(p));
                }
            }
        }
    }
    None
}

// Map selected standards to axe runOnly tag values. WCAG levels are
// cumulative (2.2 conformance includes 2.0/2.1). EN 301 549 has no dedicated
// axe tag — it's approximated by WCAG 2.1 tags. Empty selection = all.
fn axe_tags_for_standards(standards: &[String]) -> Vec<String> {
    if standards.is_empty() {
        return vec![
            "wcag2a".into(),
            "wcag2aa".into(),
            "wcag21a".into(),
            "wcag21aa".into(),
            "wcag22a".into(),
            "wcag22aa".into(),
            "best-practice".into(),
        ];
    }
    let mut tags: Vec<String> = Vec::new();
    let push = |t: &str, tags: &mut Vec<String>| {
        if !tags.iter().any(|x| x == t) {
            tags.push(t.into());
        }
    };
    for s in standards {
        match s.as_str() {
            "wcag20" => {
                push("wcag2a", &mut tags);
                push("wcag2aa", &mut tags);
            }
            "wcag21" => {
                for t in ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] {
                    push(t, &mut tags);
                }
            }
            "en301549" => {
                // EN 301 549 ≈ WCAG 2.1 AA; axe also tags rules natively with
                // EN-301-549, so include that tag for full coverage
                for t in ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "EN-301-549"] {
                    push(t, &mut tags);
                }
            }
            "wcag22" => {
                for t in [
                    "wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa",
                ] {
                    push(t, &mut tags);
                }
            }
            "section508" => {
                for t in ["section508", "wcag2a", "wcag2aa"] {
                    push(t, &mut tags);
                }
            }
            "bestpractice" => push("best-practice", &mut tags),
            _ => {}
        }
    }
    tags
}

fn wcag_from_tags(tags: &[String]) -> String {
    for tag in tags {
        if let Some(digits) = tag.strip_prefix("wcag") {
            // Criterion tags look like wcag111 (1.1.1) or wcag2411 (2.4.11):
            // first digit = major, second = minor, rest = success criterion.
            if digits.len() >= 3 && digits.chars().all(|c| c.is_ascii_digit()) {
                return format!("{}.{}.{}", &digits[0..1], &digits[1..2], &digits[2..]);
            }
        }
    }
    String::new()
}

fn standards_from_tags(tags: &[String]) -> Vec<String> {
    tags.iter()
        .filter(|t| {
            let l = t.to_lowercase();
            l.starts_with("section508")
                || l.starts_with("en-301")
                || l == "act"
                || l == "best-practice"
                || l == "experimental"
        })
        .cloned()
        .collect()
}

fn element_name_from_html(html: &str) -> String {
    let trimmed = html.trim_start();
    if let Some(rest) = trimmed.strip_prefix('<') {
        let name: String = rest
            .chars()
            .take_while(|c| c.is_ascii_alphabetic())
            .collect();
        if !name.is_empty() {
            return name;
        }
    }
    "unknown".into()
}

fn node_selector(node: &AxeNode) -> String {
    node.target
        .iter()
        .map(|v| match v {
            serde_json::Value::String(s) => s.clone(),
            other => other.to_string(),
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// Convert axe violations to issues, capping nodes per rule and the total per
/// page. Returns `(issues, truncated)` where `truncated` is true if any cap
/// dropped results.
fn violations_to_issues(violations: &[AxeViolation]) -> (Vec<A11yIssue>, bool) {
    let mut issues = Vec::new();
    let mut truncated = false;
    'outer: for v in violations {
        let wcag = wcag_from_tags(&v.tags);
        let standards = standards_from_tags(&v.tags);
        let severity = v.impact.clone().unwrap_or_else(|| "moderate".into());
        let message = v
            .help
            .clone()
            .filter(|m| !m.is_empty())
            .unwrap_or_else(|| v.id.clone());
        if v.nodes.len() > MAX_NODES_PER_VIOLATION {
            truncated = true;
        }
        if v.nodes.is_empty() {
            if issues.len() >= MAX_TOTAL_ISSUES {
                truncated = true;
                break 'outer;
            }
            issues.push(A11yIssue {
                issue_type: v.id.clone(),
                element: "document".into(),
                selector: "document".into(),
                message,
                severity,
                wcag,
                standards,
                help_url: v.help_url.clone(),
            });
            continue;
        }
        for node in v.nodes.iter().take(MAX_NODES_PER_VIOLATION) {
            if issues.len() >= MAX_TOTAL_ISSUES {
                truncated = true;
                break 'outer;
            }
            issues.push(A11yIssue {
                issue_type: v.id.clone(),
                element: node
                    .html
                    .as_deref()
                    .map(element_name_from_html)
                    .unwrap_or_else(|| "unknown".into()),
                selector: node_selector(node),
                message: message.clone(),
                severity: severity.clone(),
                wcag: wcag.clone(),
                standards: standards.clone(),
                help_url: v.help_url.clone(),
            });
        }
    }
    (issues, truncated)
}

/// Parse axe's JSON-serialised violations. A parse failure is an error (the
/// page is recorded as errored and can be re-run) rather than "no violations".
fn parse_violations(json: &str) -> Result<Vec<AxeViolation>, String> {
    serde_json::from_str(json).map_err(|e| format!("parse axe results: {}", e))
}

// ─── Browser session ───

/// Removes the temporary Chrome profile directory when dropped, including when
/// launching the browser fails.
struct TempDirGuard(PathBuf);

impl Drop for TempDirGuard {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

struct AxeSession {
    browser: Browser,
    handler: tokio::task::JoinHandle<()>,
    // Declared last so it is dropped after the browser.
    _profile: TempDirGuard,
}

impl AxeSession {
    async fn launch(profile_tag: &str) -> Result<Self, String> {
        let exe = find_browser_executable().ok_or_else(|| {
            "No Chromium-based browser found. Install Chrome/Chromium or set A11Y_CHROME_PATH."
                .to_string()
        })?;

        let dir = std::env::temp_dir().join(format!("a11y-profile-{}", profile_tag));
        std::fs::create_dir_all(&dir).ok();
        let profile = TempDirGuard(dir.clone());

        let config = BrowserConfig::builder()
            .chrome_executable(&exe)
            .new_headless_mode()
            .user_data_dir(&dir)
            .hide()
            .build()
            .map_err(|e| format!("browser config: {}", e))?;

        let (browser, mut handler) = Browser::launch(config)
            .await
            .map_err(|e| format!("failed to launch browser: {}", e))?;
        let handler = tokio::spawn(async move { while handler.next().await.is_some() {} });

        Ok(Self {
            browser,
            handler,
            _profile: profile,
        })
    }

    async fn shutdown(mut self) {
        let _ = tokio::time::timeout(Duration::from_secs(5), self.browser.close()).await;
        let _ = tokio::time::timeout(Duration::from_secs(5), self.browser.wait()).await;
        self.handler.abort();
        // `self` (browser, then profile dir guard) drops here.
    }
}

fn page_timeout(config: &AuditConfig) -> Duration {
    // Real browsers need longer than a plain HTTP fetch; keep the 15s floor.
    Duration::from_secs(effective_timeout_secs(config).max(15))
}

fn errored_page(url: &str, start: Instant, error: String) -> A11yPageResult {
    A11yPageResult {
        url: url.to_string(),
        page_title: None,
        status: None,
        status_text: "error".into(),
        response_time_ms: Some(start.elapsed().as_millis() as u64),
        error: Some(error),
        issues: Vec::new(),
        truncated: false,
    }
}

/// Scan one URL in a fresh tab. The tab is always closed afterwards (also on
/// timeout and cancel). Returns `None` when the job was cancelled before a
/// result was produced.
async fn scan_one(
    browser: &Browser,
    url: &str,
    a11y_config: &A11yCheckConfig,
    audit_config: &AuditConfig,
    token: &CancelToken,
) -> Option<A11yPageResult> {
    if token.is_cancelled() {
        return None;
    }
    let timeout = page_timeout(audit_config);
    let start = Instant::now();

    let page = tokio::select! {
        biased;
        _ = token.cancelled() => return None,
        r = tokio::time::timeout(timeout, browser.new_page("about:blank")) => match r {
            Ok(Ok(page)) => page,
            Ok(Err(e)) => return Some(errored_page(url, start, format!("new page: {}", e))),
            Err(_) => {
                return Some(errored_page(
                    url,
                    start,
                    format!("timed out opening a tab after {}s", timeout.as_secs()),
                ))
            }
        },
    };

    let outcome = tokio::select! {
        biased;
        _ = token.cancelled() => None,
        r = tokio::time::timeout(
            timeout,
            scan_page(&page, url, a11y_config, audit_config, start),
        ) => Some(match r {
            Ok(Ok(result)) => result,
            Ok(Err(e)) => errored_page(url, start, e),
            Err(_) => errored_page(
                url,
                start,
                format!("page timed out after {}s", timeout.as_secs()),
            ),
        }),
    };

    let _ = tokio::time::timeout(Duration::from_secs(5), page.close()).await;
    outcome
}

/// Apply the audit's custom headers and cookies to the tab before navigating.
async fn apply_network_config(page: &Page, url: &str, config: &AuditConfig) -> Result<(), String> {
    if !config.headers.is_empty() {
        let map: serde_json::Map<String, serde_json::Value> = config
            .headers
            .iter()
            .filter(|(k, _)| !k.trim().is_empty())
            .map(|(k, v)| (k.clone(), serde_json::Value::String(v.clone())))
            .collect();
        page.execute(SetExtraHttpHeadersParams::new(Headers::new(
            serde_json::Value::Object(map),
        )))
        .await
        .map_err(|e| format!("set headers: {}", e))?;
    }
    let cookies: Vec<CookieParam> = config
        .cookies
        .iter()
        .filter(|kv| !kv.key.trim().is_empty())
        .map(|kv| {
            let mut c = CookieParam::new(kv.key.clone(), kv.value.clone());
            c.url = Some(url.to_string());
            c
        })
        .collect();
    if !cookies.is_empty() {
        page.execute(SetCookiesParams::new(cookies))
            .await
            .map_err(|e| format!("set cookies: {}", e))?;
    }
    Ok(())
}

fn reason_phrase(code: u16, reported: &str) -> String {
    if !reported.trim().is_empty() {
        return reported.trim().to_string();
    }
    reqwest::StatusCode::from_u16(code)
        .ok()
        .and_then(|s| s.canonical_reason())
        .unwrap_or("unknown")
        .to_string()
}

/// HTTP status of the main document, from `Network.responseReceived` events
/// (falls back to the Navigation Timing API when no event was captured).
async fn main_document_status(
    page: &Page,
    events: &mut chromiumoxide::listeners::EventStream<EventResponseReceived>,
) -> Option<(u16, String)> {
    let main_frame = page.mainframe().await.ok().flatten();
    let mut status = None;
    // Drain whatever has already been delivered; the last main-frame document
    // response is the one that was rendered (redirect hops are reported via
    // requestWillBeSent, not responseReceived).
    while let Some(Some(ev)) = events.next().now_or_never() {
        let is_main = match (&main_frame, &ev.frame_id) {
            (Some(main), Some(frame)) => main == frame,
            _ => true,
        };
        if ev.r#type == ResourceType::Document && is_main && ev.response.status > 0 {
            let code = ev.response.status as u16;
            status = Some((code, reason_phrase(code, &ev.response.status_text)));
        }
    }
    if status.is_some() {
        return status;
    }
    let code: u16 = page
        .evaluate(
            "(() => { const e = performance.getEntriesByType('navigation')[0]; return (e && e.responseStatus) || 0; })()",
        )
        .await
        .ok()?
        .into_value()
        .ok()?;
    (code > 0).then(|| (code, reason_phrase(code, "")))
}

async fn scan_page(
    page: &Page,
    url: &str,
    config: &A11yCheckConfig,
    audit_config: &AuditConfig,
    start: Instant,
) -> Result<A11yPageResult, String> {
    apply_network_config(page, url, audit_config).await?;

    let mut responses = page
        .event_listener::<EventResponseReceived>()
        .await
        .map_err(|e| format!("listen: {}", e))?;

    page.goto(url.to_string())
        .await
        .map_err(|e| format!("navigate: {}", e))?;

    let status = main_document_status(page, &mut responses).await;
    drop(responses);

    let (status_code, status_text) = match status {
        Some((code, text)) => (Some(code), text),
        None => (None, "unknown".to_string()),
    };

    // Error responses are errored pages (eligible for re-run), not pages to
    // audit.
    if let Some(code) = status_code.filter(|c| *c >= 400) {
        return Ok(A11yPageResult {
            url: url.to_string(),
            page_title: None,
            status: Some(code),
            error: Some(format!("HTTP {} {}", code, status_text)),
            status_text,
            response_time_ms: Some(start.elapsed().as_millis() as u64),
            issues: Vec::new(),
            truncated: false,
        });
    }

    // Inject axe-core and run it
    page.evaluate(AXE_SOURCE)
        .await
        .map_err(|e| format!("inject axe: {}", e))?;
    page.evaluate(AXE_EXTRA_RULES)
        .await
        .map_err(|e| format!("inject axe rules: {}", e))?;

    let tags = axe_tags_for_standards(&config.standards);
    let tags_json = serde_json::to_string(&tags).unwrap_or_else(|_| "[]".into());
    let run_expr = format!(
        "axe.run({{ runOnly: {{ type: 'tag', values: {} }}, resultTypes: ['violations'] }}).then(r => JSON.stringify(r.violations))",
        tags_json
    );

    let violations_json: String = page
        .evaluate(run_expr)
        .await
        .map_err(|e| format!("axe.run: {}", e))?
        .into_value()
        .map_err(|e| format!("parse result: {}", e))?;

    let violations = parse_violations(&violations_json)?;

    let (mut issues, truncated) = violations_to_issues(&violations);
    issues.retain(|i| severity_rank(&i.severity) >= severity_rank(&config.min_severity));

    let title: Option<String> = page
        .get_title()
        .await
        .ok()
        .flatten()
        .filter(|t| !t.trim().is_empty());

    Ok(A11yPageResult {
        url: url.to_string(),
        page_title: title,
        status: status_code,
        status_text,
        response_time_ms: Some(start.elapsed().as_millis() as u64),
        error: None,
        issues,
        truncated,
    })
}

/// Re-scan a subset of URLs with the axe engine (used by report re-run).
/// URLs are expected to be final URLs as stored on report results.
pub async fn scan_urls_axe(
    app: &AppHandle,
    audit: &A11yAudit,
    report_id: &str,
    urls: Vec<String>,
    token: Arc<CancelToken>,
) -> Result<Vec<A11yPageResult>, String> {
    let session = AxeSession::launch(&format!("rerun-{}", uuid::Uuid::new_v4())).await?;

    let total = urls.len();
    let mut out = Vec::with_capacity(total);
    for url in urls {
        let Some(page_result) = scan_one(
            &session.browser,
            &url,
            &audit.a11y_config,
            &audit.config,
            &token,
        )
        .await
        else {
            break;
        };
        emit_progress(app, report_id, out.len() + 1, total, true);
        emit_result(app, report_id, &page_result, true);
        out.push(page_result);
    }

    session.shutdown().await;
    Ok(out)
}

/// Run a full axe-core audit. Returns `Err` only when the browser cannot be
/// started; per-page failures become errored results.
pub async fn run_axe_audit(
    app: &AppHandle,
    audit: &A11yAudit,
    target_list: &TargetList,
    report_id: &str,
    token: Arc<CancelToken>,
) -> Result<A11yReport, String> {
    let started_at = chrono::Utc::now().to_rfc3339();
    let session = AxeSession::launch(report_id).await?;

    let urls = target_urls(audit, target_list);
    let total = urls.len();
    let mut results: Vec<A11yPageResult> = Vec::with_capacity(total);

    for url in urls {
        let Some(page_result) = scan_one(
            &session.browser,
            &url,
            &audit.a11y_config,
            &audit.config,
            &token,
        )
        .await
        else {
            break;
        };
        results.push(page_result);
        let page_result = results.last().expect("just pushed");
        emit_progress(app, report_id, results.len(), total, false);
        emit_result(app, report_id, page_result, false);

        let partial = build_report(
            report_id,
            audit,
            started_at.clone(),
            None,
            "running",
            results.clone(),
        );
        save_partial(app, &token, &partial);
    }

    session.shutdown().await;

    let status = if token.is_cancelled() {
        "cancelled"
    } else {
        "completed"
    };
    Ok(build_report(
        report_id,
        audit,
        started_at,
        Some(chrono::Utc::now().to_rfc3339()),
        status,
        results,
    ))
}

fn severity_rank(s: &str) -> u8 {
    match s {
        "critical" => 4,
        "serious" => 3,
        "moderate" => 2,
        "minor" => 1,
        _ => 0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn axe_tags_for_standards_mapping() {
        // Empty = all tags
        assert!(axe_tags_for_standards(&[]).contains(&"wcag22aa".to_string()));
        assert!(axe_tags_for_standards(&[]).contains(&"best-practice".to_string()));

        // WCAG 2.2 is cumulative
        let t = axe_tags_for_standards(&["wcag22".into()]);
        for expected in [
            "wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa",
        ] {
            assert!(t.contains(&expected.to_string()), "missing {}", expected);
        }
        assert!(!t.contains(&"best-practice".to_string()));
        assert!(!t.contains(&"section508".to_string()));

        // Section 508 + best practices
        let t = axe_tags_for_standards(&["section508".into(), "bestpractice".into()]);
        assert!(t.contains(&"section508".to_string()));
        assert!(t.contains(&"best-practice".to_string()));

        // EN 301 549 → WCAG 2.1 tags plus axe's native EN-301-549 tag
        let t = axe_tags_for_standards(&["en301549".into()]);
        assert!(t.contains(&"wcag21aa".to_string()));
        assert!(t.contains(&"EN-301-549".to_string()));
        assert!(!t.contains(&"wcag22aa".to_string()));
    }

    fn violation(id: &str, nodes: usize) -> AxeViolation {
        AxeViolation {
            id: id.into(),
            impact: Some("serious".into()),
            help: Some("help".into()),
            help_url: None,
            tags: vec!["wcag2a".into(), "wcag111".into()],
            nodes: (0..nodes)
                .map(|i| AxeNode {
                    target: vec![serde_json::Value::String(format!("#n{}", i))],
                    html: Some("<div>".into()),
                })
                .collect(),
        }
    }

    #[test]
    fn violations_cap_and_truncation_flag() {
        // within limits -> not truncated
        let (issues, truncated) = violations_to_issues(&[violation("a", 3), violation("b", 0)]);
        assert_eq!(issues.len(), 4);
        assert!(!truncated);
        assert_eq!(issues[0].wcag, "1.1.1");

        // per-rule node cap
        let (issues, truncated) =
            violations_to_issues(&[violation("a", MAX_NODES_PER_VIOLATION + 5)]);
        assert_eq!(issues.len(), MAX_NODES_PER_VIOLATION);
        assert!(truncated);

        // global cap also applies to node-less violations
        let many: Vec<AxeViolation> = (0..MAX_TOTAL_ISSUES + 10)
            .map(|i| violation(&format!("r{}", i), 0))
            .collect();
        let (issues, truncated) = violations_to_issues(&many);
        assert_eq!(issues.len(), MAX_TOTAL_ISSUES);
        assert!(truncated);
    }

    #[test]
    fn parse_violations_rejects_garbage() {
        assert!(parse_violations("[]").unwrap().is_empty());
        assert!(parse_violations("not json").is_err());
        assert!(parse_violations("{\"oops\":1}").is_err());
    }

    #[test]
    fn reason_phrase_fallback() {
        assert_eq!(reason_phrase(404, ""), "Not Found");
        assert_eq!(reason_phrase(200, "OK"), "OK");
    }

    #[tokio::test]
    #[ignore]
    async fn smoke_axe_scan_real_page() {
        let session = AxeSession::launch("test").await.expect("launch browser");
        let url = std::env::var("A11Y_TEST_URL").unwrap_or_else(|_| "https://example.com".into());
        let token = CancelToken::new();
        let result = scan_one(
            &session.browser,
            &url,
            &A11yCheckConfig::default(),
            &AuditConfig::default(),
            &token,
        )
        .await
        .expect("not cancelled");
        eprintln!(
            "status={:?} title={:?} issues={}",
            result.status,
            result.page_title,
            result.issues.len()
        );
        for i in result.issues.iter().take(10) {
            eprintln!(
                "  [{}] {} {} — {}",
                i.severity, i.wcag, i.issue_type, i.message
            );
        }
        assert!(result.error.is_none());
        session.shutdown().await;
    }
}
