use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Instant;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::Semaphore;

use crate::a11y::run_a11y_scan;
use crate::models::*;
use crate::AppState;

pub struct A11yRunner {
    cancel_flag: Arc<AtomicBool>,
}

impl A11yRunner {
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

    pub fn cancel_flag(&self) -> Arc<AtomicBool> {
        self.cancel_flag.clone()
    }

    pub async fn run(
        &self,
        app: &AppHandle,
        audit: &A11yAudit,
        target_list: &TargetList,
    ) -> A11yReport {
        self.reset();

        if audit.engine == "axe-core" {
            match crate::a11y_browser::run_axe_audit(app, audit, target_list, self.cancel_flag())
                .await
            {
                Ok(report) => return report,
                Err(e) => {
                    let _ = app.emit("a11y:error", serde_json::json!({ "message": e }));
                    return A11yReport {
                        id: uuid::Uuid::new_v4().to_string(),
                        audit_id: audit.id.clone(),
                        started_at: chrono::Utc::now().to_rfc3339(),
                        completed_at: Some(chrono::Utc::now().to_rfc3339()),
                        status: "error".into(),
                        results: Vec::new(),
                        summary: A11ySummary::default(),
                        standards: audit.a11y_config.standards.clone(),
                    };
                }
            }
        }

        let report_id = uuid::Uuid::new_v4().to_string();
        let started_at = chrono::Utc::now().to_rfc3339();
        let total = target_list.urls.len();

        let semaphore = match audit.config.mode.as_str() {
            "sequential" => Arc::new(Semaphore::new(1)),
            _ => Arc::new(Semaphore::new(audit.config.batch_size as usize)),
        };

        let mut client_builder = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(audit.config.timeout_secs))
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
                client_builder = client_builder.default_headers(
                    reqwest::header::HeaderMap::from_iter([(reqwest::header::COOKIE, v)]),
                );
            }
        }
        let client = client_builder.build().expect("failed to build HTTP client");

        let results = Arc::new(std::sync::Mutex::new(Vec::with_capacity(total)));
        let checked = Arc::new(std::sync::Mutex::new(0usize));
        let urls: Vec<String> = target_list
            .urls
            .iter()
            .map(|u| apply_a11y_origin_override(u, &audit.origin_override))
            .map(|u| apply_a11y_url_postfix(&u, &audit.url_postfix))
            .collect();
        let a11y_config = audit.a11y_config.clone();
        let standards = a11y_config.standards.clone();

        let mut fetches = Vec::new();
        for url in urls {
            let permit = semaphore.clone().acquire_owned().await.unwrap();
            let client = client.clone();
            let cancel = self.cancel_flag.clone();
            let results = results.clone();
            let checked = checked.clone();
            let app = app.clone();
            let report_id = report_id.clone();
            let audit_id = audit.id.clone();
            let started_at = started_at.clone();
            let a11y_config = a11y_config.clone();
            let standards = standards.clone();

            fetches.push(tokio::spawn(async move {
                let _permit = permit;
                let page_result = scan_url(client, url, a11y_config, cancel).await;

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
                    audit_id: audit_id.clone(),
                    started_at: started_at.clone(),
                    completed_at: None,
                    status: "running".into(),
                    results: results.clone(),
                    summary: compute_a11y_summary(&results),
                    standards: standards.clone(),
                };
                if let Some(state) = app.try_state::<AppState>() {
                    let _ = state.storage.save_a11y_report(&partial);
                }
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
        let summary = compute_a11y_summary(&results);

        if self.cancel_flag.load(Ordering::SeqCst) {
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
            standards,
        };

        let _ = app.emit("a11y:complete", &report);
        report
    }
}

async fn scan_url(
    client: reqwest::Client,
    url: String,
    config: A11yCheckConfig,
    cancel_flag: Arc<AtomicBool>,
) -> A11yPageResult {
    if cancel_flag.load(Ordering::SeqCst) {
        return A11yPageResult {
            url,
            page_title: None,
            status: None,
            status_text: "cancelled".into(),
            response_time_ms: None,
            error: Some("cancelled before request".into()),
            issues: Vec::new(),
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
                    let issues = run_a11y_scan(&html, &config);
                    A11yPageResult {
                        page_title: extract_a11y_title(&html),
                        url,
                        status: Some(status_code),
                        status_text,
                        response_time_ms: Some(elapsed),
                        error: None,
                        issues,
                    }
                }
                Err(e) => A11yPageResult {
                    page_title: None,
                    url,
                    status: Some(status_code),
                    status_text,
                    response_time_ms: Some(elapsed),
                    error: Some(format!("body read error: {}", e)),
                    issues: Vec::new(),
                },
            }
        }
        Err(e) => {
            let elapsed = start.elapsed().as_millis() as u64;
            A11yPageResult {
                url,
                page_title: None,
                status: None,
                status_text: "error".into(),
                response_time_ms: Some(elapsed),
                error: Some(e.to_string()),
                issues: Vec::new(),
            }
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

fn compute_a11y_summary(results: &[A11yPageResult]) -> A11ySummary {
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
