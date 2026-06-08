use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Instant;
use tauri::{AppHandle, Emitter};
use tokio::sync::Semaphore;

use crate::models::*;

pub struct Checker {
    cancel_flag: Arc<AtomicBool>,
}

impl Checker {
    pub fn new() -> Self {
        Self {
            cancel_flag: Arc::new(AtomicBool::new(false)),
        }
    }

    pub fn cancel(&self) {
        self.cancel_flag.store(true, Ordering::SeqCst);
    }

    pub fn reset(&self) {
        self.cancel_flag.store(false, Ordering::SeqCst);
    }

    pub async fn run(
        &self,
        app: &AppHandle,
        audit: &Audit,
        target_list: &TargetList,
        check_template: &CheckTemplate,
    ) -> AuditRun {
        self.reset();

        let run_id = uuid::Uuid::new_v4().to_string();
        let started_at = chrono::Utc::now().to_rfc3339();
        let total = target_list.urls.len();

        let semaphore = match audit.config.mode.as_str() {
            "sequential" => Arc::new(Semaphore::new(1)),
            _ => Arc::new(Semaphore::new(audit.config.batch_size as usize)),
        };

        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(audit.config.timeout_secs))
            .redirect(reqwest::redirect::Policy::limited(10))
            .build()
            .expect("failed to build HTTP client");

        let results = Arc::new(std::sync::Mutex::new(Vec::with_capacity(total)));
        let checked = Arc::new(std::sync::Mutex::new(0usize));
        let urls: Vec<String> = target_list
            .urls
            .iter()
            .map(|u| apply_origin_override(u, &audit.origin_override))
            .map(|u| apply_url_postfix(&u, &audit.url_postfix))
            .collect();
        let checks = check_template.checks.clone();

        let mut fetches = Vec::new();
        for url in urls {
            let permit = semaphore.clone().acquire_owned().await.unwrap();
            let client = client.clone();
            let checks = checks.clone();
            let cancel = self.cancel_flag.clone();
            let results = results.clone();
            let checked = checked.clone();
            let app = app.clone();

            fetches.push(tokio::spawn(async move {
                let _permit = permit;
                let page_result = check_url(client, url, checks, cancel).await;

                let mut results = results.lock().unwrap();
                results.push(page_result.clone());
                let mut checked = checked.lock().unwrap();
                *checked += 1;
                let _ = app.emit("run:progress", serde_json::json!({
                    "checked": *checked,
                    "total": total,
                }));
                let _ = app.emit("run:result", &page_result);
            }));
        }

        for fetch in fetches {
            if self.cancel_flag.load(Ordering::SeqCst) {
                break;
            }
            let _ = fetch.await;
        }

        let completed_at = chrono::Utc::now().to_rfc3339();
        let status = if self.cancel_flag.load(Ordering::SeqCst) {
            "cancelled".into()
        } else {
            "completed".into()
        };

        let results = results.lock().unwrap().clone();
        let summary = compute_summary(&results);

        if self.cancel_flag.load(Ordering::SeqCst) {
            let _ = app.emit("run:cancelled", ());
        }

        let run = AuditRun {
            id: run_id,
            audit_id: audit.id.clone(),
            started_at,
            completed_at: Some(completed_at),
            status,
            results,
            summary: summary.clone(),
        };

        let _ = app.emit("run:complete", &run);
        run
    }
}

async fn check_url(
    client: reqwest::Client,
    url: String,
    checks: Vec<SelectorCheck>,
    cancel_flag: Arc<AtomicBool>,
) -> PageResult {
    if cancel_flag.load(Ordering::SeqCst) {
        return PageResult {
            url,
            page_title: None,
            status: None,
            status_text: "cancelled".into(),
            response_time_ms: None,
            error: Some("cancelled before request".into()),
            checks: Vec::new(),
        };
    }

    let start = Instant::now();
    match client.get(&url).send().await {
        Ok(response) => {
            let status = response.status();
            let status_code = status.as_u16();
            let status_text = status.canonical_reason().unwrap_or("unknown").to_string();
            let elapsed = start.elapsed().as_millis() as u64;

            match response.text().await {
                Ok(html) => {
                    let check_results = run_checks(status_code, &html, &checks);
                    PageResult {
                        page_title: extract_title(&html),
                        url,
                        status: Some(status_code),
                        status_text,
                        response_time_ms: Some(elapsed),
                        error: None,
                        checks: check_results,
                    }
                }
                Err(e) => PageResult {
                    page_title: None,
                    url,
                    status: Some(status_code),
                    status_text,
                    response_time_ms: Some(elapsed),
                    error: Some(format!("body read error: {}", e)),
                    checks: Vec::new(),
                },
            }
        }
        Err(e) => {
            let elapsed = start.elapsed().as_millis() as u64;
            PageResult {
                url,
                page_title: None,
                status: None,
                status_text: "error".into(),
                response_time_ms: Some(elapsed),
                error: Some(e.to_string()),
                checks: Vec::new(),
            }
        }
    }
}

fn run_checks(status_code: u16, html: &str, checks: &[SelectorCheck]) -> Vec<SelectorResult> {
    checks
        .iter()
        .map(|check| {
            let check_type = &check.check_type;
            match check_type {
                CheckType::Status => run_status_check(check, status_code),
                CheckType::Regex => run_regex_check(check, html),
                CheckType::Attribute => run_attribute_check(check, html),
                CheckType::Selector => run_selector_check(check, html),
            }
        })
        .collect()
}

fn run_selector_check(check: &SelectorCheck, html: &str) -> SelectorResult {
    let document = scraper::Html::parse_document(html);
    match scraper::Selector::parse(&check.selector) {
        Ok(sel) => {
            let matches: Vec<_> = document.select(&sel).collect();
            let count = matches.len();
            let text_content = matches.first().and_then(|el| {
                let text: String = el.text().collect::<Vec<_>>().join(" ");
                if text.is_empty() { None } else { Some(text) }
            });
            SelectorResult {
                selector_check_id: check.id.clone(),
                selector: check.selector.clone(),
                label: check.label.clone(),
                found: count > 0,
                count,
                text_content,
                check_type: CheckType::Selector,
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
        },
    }
}

fn run_status_check(check: &SelectorCheck, status_code: u16) -> SelectorResult {
    let expected = check.expected_status.unwrap_or(200);
    let found = status_code == expected;
    SelectorResult {
        selector_check_id: check.id.clone(),
        selector: check.selector.clone(),
        label: check.label.clone(),
        found,
        count: if found { 1 } else { 0 },
        text_content: Some(format!("HTTP {}", status_code)),
        check_type: CheckType::Status,
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
        },
    }
}

fn run_attribute_check(check: &SelectorCheck, html: &str) -> SelectorResult {
    let document = scraper::Html::parse_document(html);
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
                text_content: if texts.is_empty() { None } else { Some(texts.join(", ")) },
                check_type: CheckType::Attribute,
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
        },
    }
}

fn extract_title(html: &str) -> Option<String> {
    let document = scraper::Html::parse_document(html);
    let selector = scraper::Selector::parse("title").ok()?;
    document
        .select(&selector)
        .next()
        .map(|el| el.text().collect::<String>().trim().to_string())
}

fn apply_url_postfix(url: &str, postfix: &Option<String>) -> String {
    match postfix {
        Some(p) if !p.is_empty() => format!("{}{}", url, p),
        _ => url.to_string(),
    }
}

fn apply_origin_override(url: &str, origin_override: &Option<String>) -> String {
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

#[cfg(test)]
mod tests {
    use super::*;

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
        assert_eq!(apply_url_postfix("https://example.com", &None), "https://example.com");
    }

    #[test]
    fn test_apply_url_postfix_empty() {
        assert_eq!(apply_url_postfix("https://example.com", &Some(String::new())), "https://example.com");
    }

    #[test]
    fn test_apply_url_postfix_applied() {
        assert_eq!(apply_url_postfix("https://example.com/page", &Some(".html".to_string())), "https://example.com/page.html");
    }

    #[test]
    fn test_apply_origin_override_no_override() {
        assert_eq!(apply_origin_override("https://example.com/page", &None), "https://example.com/page");
    }

    #[test]
    fn test_apply_origin_override_empty() {
        assert_eq!(apply_origin_override("https://example.com/page", &Some(String::new())), "https://example.com/page");
    }

    #[test]
    fn test_apply_origin_override_replaces_origin() {
        assert_eq!(
            apply_origin_override("https://old.com/path?q=1", &Some("https://new.com".to_string())),
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
    fn test_apply_origin_override_trailing_slash() {
        assert_eq!(
            apply_origin_override("https://old.com/path", &Some("https://new.com/".to_string())),
            "https://new.com/path"
        );
    }

    #[test]
    fn test_apply_origin_override_no_scheme_fallback() {
        assert_eq!(
            apply_origin_override("no-scheme-url", &Some("https://new.com".to_string())),
            "no-scheme-url"
        );
    }

    #[test]
    fn test_compute_summary_all_passed() {
        let results = vec![
            PageResult {
                url: "https://a.com".into(),
                error: None,
                checks: vec![
                    SelectorResult { selector_check_id: "1".into(), selector: "h1".into(), label: "Heading".into(), found: true, count: 1, text_content: Some("Hi".into()), check_type: CheckType::Selector },
                ],
                response_time_ms: Some(100),
                page_title: None,
                status: Some(200),
                status_text: "OK".into(),
            },
            PageResult {
                url: "https://b.com".into(),
                error: None,
                checks: vec![
                    SelectorResult { selector_check_id: "1".into(), selector: "h1".into(), label: "Heading".into(), found: true, count: 1, text_content: Some("Hi".into()), check_type: CheckType::Selector },
                ],
                response_time_ms: Some(200),
                page_title: None,
                status: Some(200),
                status_text: "OK".into(),
            },
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
            PageResult {
                url: "https://a.com".into(),
                error: None,
                checks: vec![
                    SelectorResult { selector_check_id: "1".into(), selector: "h1".into(), label: "Heading".into(), found: true, count: 1, text_content: None, check_type: CheckType::Selector },
                ],
                response_time_ms: Some(100),
                page_title: None,
                status: Some(200),
                status_text: "OK".into(),
            },
            PageResult {
                url: "https://b.com".into(),
                error: None,
                checks: vec![
                    SelectorResult { selector_check_id: "1".into(), selector: "h1".into(), label: "Heading".into(), found: false, count: 0, text_content: None, check_type: CheckType::Selector },
                ],
                response_time_ms: Some(200),
                page_title: None,
                status: Some(200),
                status_text: "OK".into(),
            },
            PageResult {
                url: "https://c.com".into(),
                error: Some("timeout".into()),
                checks: vec![],
                response_time_ms: None,
                page_title: None,
                status: None,
                status_text: "Error".into(),
            },
        ];
        let summary = compute_summary(&results);
        assert_eq!(summary.total, 3);
        assert_eq!(summary.passed, 1);
        assert_eq!(summary.failed, 1);
        assert_eq!(summary.errored, 1);
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
        let results = run_checks(200, html, &checks);
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
        let checks = vec![
            make_check("c1", "[[invalid", "Bad"),
        ];
        let results = run_checks(200, html, &checks);
        assert_eq!(results.len(), 1);
        assert!(!results[0].found);
    }

    #[test]
    fn test_run_checks_status() {
        let check = SelectorCheck {
            id: "s1".into(),
            selector: String::new(),
            label: "Status 200".into(),
            check_type: CheckType::Status,
            expected_status: Some(200),
            pattern: None,
            attribute_name: None,
            attribute_value: None,
        };
        let results = run_checks(200, "", &[check]);
        assert!(results[0].found);
        assert_eq!(results[0].text_content.as_deref(), Some("HTTP 200"));
    }

    #[test]
    fn test_run_checks_regex() {
        let html = "hello world hello";
        let check = SelectorCheck {
            id: "r1".into(),
            selector: String::new(),
            label: "Match hello".into(),
            check_type: CheckType::Regex,
            expected_status: None,
            pattern: Some("hello".into()),
            attribute_name: None,
            attribute_value: None,
        };
        let results = run_checks(200, html, &[check]);
        assert!(results[0].found);
        assert_eq!(results[0].count, 2);
    }

    #[test]
    fn test_run_checks_regex_invalid() {
        let check = SelectorCheck {
            id: "r2".into(),
            selector: String::new(),
            label: "Bad regex".into(),
            check_type: CheckType::Regex,
            expected_status: None,
            pattern: Some("[invalid".into()),
            attribute_name: None,
            attribute_value: None,
        };
        let results = run_checks(200, "", &[check]);
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
        };
        let results = run_checks(200, html, &[check]);
        assert!(results[0].found);
        assert_eq!(results[0].count, 1);
    }
}

fn compute_summary(results: &[PageResult]) -> RunSummary {
    let total = results.len();
    let mut passed = 0usize;
    let mut failed = 0usize;
    let mut errored = 0usize;
    let mut total_time = 0u64;

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
        }
    }

    let avg = if total > 0 {
        total_time as f64 / total as f64
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
