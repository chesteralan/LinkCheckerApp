use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use chromiumoxide::browser::{Browser, BrowserConfig};
use futures::StreamExt;
use serde::Deserialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::a11y_runner::{apply_a11y_origin_override, apply_a11y_url_postfix};
use crate::models::*;
use crate::AppState;

const AXE_SOURCE: &str = include_str!("../assets/axe.min.js");
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
            "wcag21" | "en301549" => {
                for t in ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] {
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

fn violations_to_issues(violations: &[AxeViolation]) -> Vec<A11yIssue> {
    let mut issues = Vec::new();
    'outer: for v in violations {
        let wcag = wcag_from_tags(&v.tags);
        let standards = standards_from_tags(&v.tags);
        let severity = v.impact.clone().unwrap_or_else(|| "moderate".into());
        let message = v
            .help
            .clone()
            .or_else(|| {
                v.nodes
                    .first()
                    .and_then(|n| n.html.clone())
                    .map(|_| String::new())
            })
            .filter(|m| !m.is_empty())
            .unwrap_or_else(|| v.id.clone());
        let nodes: Vec<&AxeNode> = v.nodes.iter().take(MAX_NODES_PER_VIOLATION).collect();
        if nodes.is_empty() {
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
        } else {
            for node in nodes {
                if issues.len() >= MAX_TOTAL_ISSUES {
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
    }
    issues
}

pub async fn run_axe_audit(
    app: &AppHandle,
    audit: &A11yAudit,
    target_list: &TargetList,
    cancel_flag: Arc<AtomicBool>,
) -> Result<A11yReport, String> {
    let exe = find_browser_executable().ok_or_else(|| {
        "No Chromium-based browser found. Install Chrome/Chromium or set A11Y_CHROME_PATH."
            .to_string()
    })?;

    let report_id = uuid::Uuid::new_v4().to_string();
    let started_at = chrono::Utc::now().to_rfc3339();
    let total = target_list.urls.len();

    let user_data_dir = std::env::temp_dir().join(format!("a11y-profile-{}", report_id));
    std::fs::create_dir_all(&user_data_dir).ok();

    let config = BrowserConfig::builder()
        .chrome_executable(&exe)
        .new_headless_mode()
        .user_data_dir(&user_data_dir)
        .hide()
        .build()
        .map_err(|e| format!("browser config: {}", e))?;

    let (mut browser, mut handler) = Browser::launch(config)
        .await
        .map_err(|e| format!("failed to launch browser: {}", e))?;

    tokio::spawn(async move { while handler.next().await.is_some() {} });

    let results = Arc::new(std::sync::Mutex::new(Vec::with_capacity(total)));
    let checked = Arc::new(std::sync::Mutex::new(0usize));
    let urls: Vec<String> = target_list
        .urls
        .iter()
        .map(|u| apply_a11y_origin_override(u, &audit.origin_override))
        .map(|u| apply_a11y_url_postfix(&u, &audit.url_postfix))
        .collect();
    let a11y_config = audit.a11y_config.clone();
    let page_timeout = Duration::from_secs(audit.config.timeout_secs.max(15));

    for url in urls {
        if cancel_flag.load(Ordering::SeqCst) {
            break;
        }

        let page_result = match tokio::time::timeout(
            page_timeout,
            scan_page_with_browser(&browser, &url, &a11y_config),
        )
        .await
        {
            Ok(Ok(r)) => r,
            Ok(Err(e)) => A11yPageResult {
                url,
                page_title: None,
                status: None,
                status_text: "error".into(),
                response_time_ms: None,
                error: Some(e),
                issues: Vec::new(),
            },
            Err(_) => A11yPageResult {
                url,
                page_title: None,
                status: None,
                status_text: "error".into(),
                response_time_ms: None,
                error: Some(format!("page timed out after {}s", page_timeout.as_secs())),
                issues: Vec::new(),
            },
        };

        {
            let mut results = results.lock().unwrap();
            results.push(page_result.clone());
            let mut checked = checked.lock().unwrap();
            *checked += 1;
            let _ = app.emit(
                "a11y:progress",
                serde_json::json!({
                    "checked": *checked,
                    "total": total,
                }),
            );
            let _ = app.emit("a11y:result", &page_result);

            let partial = A11yReport {
                id: report_id.clone(),
                audit_id: audit.id.clone(),
                started_at: started_at.clone(),
                completed_at: None,
                status: "running".into(),
                results: results.clone(),
                summary: compute_browser_summary(&results),
            };
            if let Some(state) = app.try_state::<AppState>() {
                let _ = state.storage.save_a11y_report(&partial);
            }
        }
    }

    let _ = browser.close().await;
    let _ = browser.wait().await;
    std::fs::remove_dir_all(&user_data_dir).ok();

    let completed_at = chrono::Utc::now().to_rfc3339();
    let status = if cancel_flag.load(Ordering::SeqCst) {
        "cancelled".into()
    } else {
        "completed".into()
    };

    let results = results.lock().unwrap().clone();
    let summary = compute_browser_summary(&results);

    if status == "cancelled" {
        let _ = app.emit("a11y:cancelled", ());
    }

    let report = A11yReport {
        id: report_id,
        audit_id: audit.id.clone(),
        started_at,
        completed_at: Some(completed_at),
        status,
        results,
        summary,
    };

    let _ = app.emit("a11y:complete", &report);
    Ok(report)
}

async fn scan_page_with_browser(
    browser: &Browser,
    url: &str,
    config: &A11yCheckConfig,
) -> Result<A11yPageResult, String> {
    let start = Instant::now();
    let page = browser
        .new_page("about:blank")
        .await
        .map_err(|e| format!("new page: {}", e))?;

    let result = async {
        page.goto(url.to_string())
            .await
            .map_err(|e| format!("navigate: {}", e))?;

        // Inject axe-core and run it
        page.evaluate(AXE_SOURCE)
            .await
            .map_err(|e| format!("inject axe: {}", e))?;

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

        let violations: Vec<AxeViolation> =
            serde_json::from_str(&violations_json).unwrap_or_default();

        let mut issues = violations_to_issues(&violations);
        issues.retain(|i| severity_rank(&i.severity) >= severity_rank(&config.min_severity));

        let title: Option<String> = page
            .get_title()
            .await
            .ok()
            .flatten()
            .filter(|t| !t.trim().is_empty());

        let elapsed = start.elapsed().as_millis() as u64;
        Ok::<A11yPageResult, String>(A11yPageResult {
            url: url.to_string(),
            page_title: title,
            status: Some(200),
            status_text: "OK".into(),
            response_time_ms: Some(elapsed),
            error: None,
            issues,
        })
    }
    .await;

    let _ = page.close().await;
    result
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

        // EN 301 549 approximated by WCAG 2.1 tags
        let t = axe_tags_for_standards(&["en301549".into()]);
        assert!(t.contains(&"wcag21aa".to_string()));
        assert!(!t.contains(&"wcag22aa".to_string()));
    }

    #[tokio::test]
    #[ignore]
    async fn smoke_axe_scan_real_page() {
        let exe = find_browser_executable().expect("no browser found");
        let dir = std::env::temp_dir().join("a11y-test-profile");
        let config = BrowserConfig::builder()
            .chrome_executable(&exe)
            .new_headless_mode()
            .user_data_dir(&dir)
            .hide()
            .build()
            .unwrap();
        let (mut browser, mut handler) = Browser::launch(config).await.unwrap();
        tokio::spawn(async move { while handler.next().await.is_some() {} });

        let url = std::env::var("A11Y_TEST_URL").unwrap_or_else(|_| "https://example.com".into());
        let result = scan_page_with_browser(&browser, &url, &A11yCheckConfig::default())
            .await
            .unwrap();
        eprintln!(
            "title={:?} issues={}",
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

        let _ = browser.close().await;
        let _ = std::fs::remove_dir_all(&dir);
    }
}

fn compute_browser_summary(results: &[A11yPageResult]) -> A11ySummary {
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
