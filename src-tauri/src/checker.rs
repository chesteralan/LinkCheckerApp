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
                    let check_results = run_selectors(&html, &checks);
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

fn run_selectors(html: &str, checks: &[SelectorCheck]) -> Vec<SelectorResult> {
    let document = scraper::Html::parse_document(html);
    checks
        .iter()
        .map(|check| {
            let selector = scraper::Selector::parse(&check.selector);
            match selector {
                Ok(sel) => {
                    let matches: Vec<_> = document.select(&sel).collect();
                    let count = matches.len();
                    let text_content = matches
                        .first()
                        .and_then(|el| {
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
                    }
                }
                Err(_) => SelectorResult {
                    selector_check_id: check.id.clone(),
                    selector: check.selector.clone(),
                    label: check.label.clone(),
                    found: false,
                    count: 0,
                    text_content: None,
                },
            }
        })
        .collect()
}

fn extract_title(html: &str) -> Option<String> {
    let document = scraper::Html::parse_document(html);
    let selector = scraper::Selector::parse("title").ok()?;
    document
        .select(&selector)
        .next()
        .map(|el| el.text().collect::<String>().trim().to_string())
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
