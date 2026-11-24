use serde::Deserialize;
use std::collections::{BTreeSet, HashMap, HashSet};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::Semaphore;

use crate::checker::{
    emit_run_error, read_body_capped, resolve_operation_id, CancelToken, MAX_BODY_BYTES,
};
use crate::commands::lock_or_recover;
use crate::models::*;
use crate::AppState;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuickRunConfig {
    pub mode: String,
    pub batch_size: u32,
    pub timeout_secs: u64,
    #[serde(default)]
    pub headers: HashMap<String, String>,
    #[serde(default)]
    pub cookies: Vec<KeyValuePair>,
}

#[tauri::command(rename_all = "camelCase")]
pub async fn scrape_links(url: String) -> Result<Vec<String>, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::limited(5))
        .build()
        .map_err(|e| e.to_string())?;

    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch URL: {}", e))?;
    let html = read_body_capped(response, MAX_BODY_BYTES)
        .await
        .map_err(|e| format!("Failed to read response: {}", e))?;

    let document = scraper::Html::parse_document(&html);
    let selector =
        scraper::Selector::parse("a[href]").map_err(|_| "Invalid selector".to_string())?;

    let mut links: Vec<String> = document
        .select(&selector)
        .filter_map(|el| el.value().attr("href"))
        .filter(|h| !h.is_empty())
        .map(|h| h.to_string())
        .collect();

    links.sort();
    links.dedup();

    Ok(links)
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ScrapeSelectorsOptions {
    pub select_ids: bool,
    pub select_classes: bool,
    pub select_testids: bool,
    pub custom_selector: String,
}

#[tauri::command(rename_all = "camelCase")]
pub async fn scrape_selectors(
    urls: Vec<String>,
    options: ScrapeSelectorsOptions,
) -> Result<Vec<ScrapedSelector>, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::limited(5))
        .build()
        .map_err(|e| e.to_string())?;

    let semaphore = Arc::new(Semaphore::new(5));
    let mut handles = Vec::new();

    for url in urls {
        let client = client.clone();
        let options = options.clone();
        let permit = semaphore
            .clone()
            .acquire_owned()
            .await
            .map_err(|e| e.to_string())?;

        handles.push(tokio::spawn(async move {
            let _permit = permit;
            scrape_single(client, url, options).await
        }));
    }

    let mut all_results = BTreeSet::new();
    for handle in handles {
        if let Ok(Ok(results)) = handle.await {
            for r in results {
                all_results.insert(r.selector);
            }
        }
    }

    Ok(all_results
        .into_iter()
        .map(|selector| {
            let type_name = if selector.starts_with('#') {
                "id".into()
            } else if selector.starts_with('.') {
                "class".into()
            } else if selector.contains("data-testid") {
                "data-testid".into()
            } else {
                "custom".into()
            };
            ScrapedSelector {
                selector,
                type_name,
            }
        })
        .collect())
}

async fn scrape_single(
    client: reqwest::Client,
    url: String,
    options: ScrapeSelectorsOptions,
) -> Result<Vec<ScrapedSelector>, String> {
    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch {}: {}", url, e))?;
    let html = read_body_capped(response, MAX_BODY_BYTES)
        .await
        .map_err(|e| format!("Failed to read {}: {}", url, e))?;

    let document = scraper::Html::parse_document(&html);
    let mut results = BTreeSet::new();

    if options.select_ids {
        if let Ok(sel) = scraper::Selector::parse("[id]") {
            for el in document.select(&sel) {
                if let Some(id) = el.value().attr("id").filter(|v| !v.is_empty()) {
                    results.insert(format!("#{}", id));
                }
            }
        }
    }

    if options.select_classes {
        if let Ok(sel) = scraper::Selector::parse("[class]") {
            let mut seen = BTreeSet::new();
            for el in document.select(&sel) {
                if let Some(class_str) = el.value().attr("class") {
                    for cls in class_str.split_whitespace() {
                        if !cls.is_empty() && seen.insert(cls.to_string()) {
                            results.insert(format!(".{}", cls));
                        }
                    }
                }
            }
        }
    }

    if options.select_testids {
        if let Ok(sel) = scraper::Selector::parse("[data-testid]") {
            for el in document.select(&sel) {
                if let Some(tid) = el.value().attr("data-testid").filter(|v| !v.is_empty()) {
                    results.insert(format!("[data-testid=\"{}\"]", tid));
                }
            }
        }
    }

    if !options.custom_selector.is_empty() {
        if let Ok(sel) = scraper::Selector::parse(&options.custom_selector) {
            if document.select(&sel).next().is_some() {
                results.insert(options.custom_selector.clone());
            }
        }
    }

    Ok(results
        .into_iter()
        .map(|s| ScrapedSelector {
            selector: s.clone(),
            type_name: if s.starts_with('#') {
                "id".into()
            } else if s.starts_with('.') {
                "class".into()
            } else if s.contains("data-testid") {
                "data-testid".into()
            } else {
                "custom".into()
            },
        })
        .collect())
}

/// Starts a quick (ad-hoc) run.
///
/// `run_id` may be supplied by the frontend (a UUID) so it can filter
/// `run:*` events before the command returns; otherwise one is generated.
/// Resolves with the run ID once the run has finished and been saved. On
/// failure, emits `run:error` `{ runId, message }` and rejects.
#[allow(clippy::too_many_arguments)]
#[tauri::command(rename_all = "camelCase")]
pub async fn quick_run(
    app: AppHandle,
    state: State<'_, AppState>,
    urls: Vec<String>,
    checks: Vec<SelectorCheck>,
    config: QuickRunConfig,
    origin_override: Option<String>,
    url_postfix: Option<String>,
    run_id: Option<String>,
) -> Result<String, String> {
    let run_id = resolve_operation_id(run_id);
    let registration = state.checker.register_run(&run_id);

    let audit = Audit {
        id: uuid::Uuid::new_v4().to_string(),
        name: "Quick Audit".into(),
        target_list_id: String::new(),
        check_template_id: String::new(),
        config: AuditConfig {
            mode: config.mode,
            batch_size: config.batch_size,
            timeout_secs: config.timeout_secs,
            headers: config.headers,
            cookies: config.cookies,
        },
        origin_override: origin_override.filter(|o| !o.is_empty()),
        url_postfix: url_postfix.filter(|p| !p.is_empty()),
        created_at: chrono::Utc::now().to_rfc3339(),
        pinned: false,
        folder: None,
        baseline_run_id: None,
    };

    let target_list = TargetList {
        id: String::new(),
        name: "Quick URLs".into(),
        urls,
        created_at: String::new(),
        updated_at: String::new(),
        pinned: false,
        folder: None,
    };

    let check_template = CheckTemplate {
        id: String::new(),
        name: "Quick Checks".into(),
        checks,
        created_at: String::new(),
        updated_at: String::new(),
        pinned: false,
        folder: None,
    };

    let result = state
        .checker
        .run(
            &app,
            &run_id,
            registration.token(),
            &audit,
            &target_list,
            &check_template,
        )
        .await;
    if result.is_ok() {
        prune_after_run(&state);
    }
    finish_run_command(&app, &run_id, result)
}

fn finish_run_command(
    app: &AppHandle,
    run_id: &str,
    result: Result<AuditRun, String>,
) -> Result<String, String> {
    match result {
        Ok(_) => Ok(run_id.to_string()),
        Err(message) => {
            emit_run_error(app, run_id, &message);
            Err(message)
        }
    }
}

fn load_audit_inputs(
    state: &AppState,
    audit_id: &str,
) -> Result<(Audit, TargetList, CheckTemplate), String> {
    let data = state.lock_data();

    let audit = data
        .audits
        .iter()
        .find(|a| a.id == audit_id)
        .ok_or_else(|| "Audit not found".to_string())?
        .clone();

    let target_list = data
        .target_lists
        .iter()
        .find(|tl| tl.id == audit.target_list_id)
        .ok_or_else(|| "Target list not found".to_string())?
        .clone();

    let check_template = data
        .check_templates
        .iter()
        .find(|ct| ct.id == audit.check_template_id)
        .ok_or_else(|| "Check template not found".to_string())?
        .clone();

    Ok((audit, target_list, check_template))
}

/// Runs a saved audit. See [`quick_run`] for the `run_id` contract.
#[tauri::command(rename_all = "camelCase")]
pub async fn run_audit(
    app: AppHandle,
    state: State<'_, AppState>,
    audit_id: String,
    origin_override: Option<String>,
    url_postfix: Option<String>,
    run_id: Option<String>,
) -> Result<String, String> {
    let run_id = resolve_operation_id(run_id);
    let registration = state.checker.register_run(&run_id);

    let (mut audit, target_list, check_template) = match load_audit_inputs(&state, &audit_id) {
        Ok(v) => v,
        Err(message) => return finish_run_command(&app, &run_id, Err(message)),
    };

    if let Some(ref oo) = origin_override {
        if !oo.is_empty() {
            audit.origin_override = Some(oo.clone());
        }
    }
    if let Some(ref up) = url_postfix {
        if !up.is_empty() {
            audit.url_postfix = Some(up.clone());
        }
    }

    let result = state
        .checker
        .run(
            &app,
            &run_id,
            registration.token(),
            &audit,
            &target_list,
            &check_template,
        )
        .await;
    if result.is_ok() {
        prune_after_run(&state);
    }
    finish_run_command(&app, &run_id, result)
}

/// Cancels the run with `run_id`, or every active run when it is omitted.
#[tauri::command(rename_all = "camelCase")]
pub fn cancel_run(state: State<'_, AppState>, run_id: Option<String>) -> Result<(), String> {
    state.checker.cancel(run_id.as_deref());
    Ok(())
}

/// Cancels the link scan with `scan_id`, or every active scan when omitted.
#[tauri::command(rename_all = "camelCase")]
pub fn cancel_link_check(
    state: State<'_, AppState>,
    scan_id: Option<String>,
) -> Result<(), String> {
    state.checker.cancel_link_scan(scan_id.as_deref());
    Ok(())
}

#[tauri::command]
pub fn list_run_files(state: State<'_, AppState>) -> Result<Vec<RunFileInfo>, String> {
    Ok(state.storage.list_run_files())
}

#[tauri::command]
pub fn list_all_runs(state: State<'_, AppState>) -> Result<Vec<AuditRun>, String> {
    Ok(state.storage.load_recent_runs(100))
}

#[tauri::command(rename_all = "camelCase")]
pub fn list_audit_runs(
    state: State<'_, AppState>,
    audit_id: String,
) -> Result<Vec<AuditRun>, String> {
    // Filtered before limiting and parsed without per-page results (A-54).
    Ok(state.storage.load_audit_runs(&audit_id, None))
}

#[tauri::command]
pub fn get_data_path(state: State<'_, AppState>) -> Result<String, String> {
    let path = state.storage.app_dir();
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn get_run_results(state: State<'_, AppState>, run_id: String) -> Result<AuditRun, String> {
    state.storage.load_run(&run_id)
}

#[tauri::command]
pub fn clear_history(state: State<'_, AppState>) -> Result<(), String> {
    state.storage.clear_all_runs()?;
    Ok(())
}

#[tauri::command]
pub fn prune_history(state: State<'_, AppState>) -> Result<(), String> {
    let max_days = state.lock_data().max_history_days;
    state.storage.prune_history(max_days)?;
    Ok(())
}

/// Largest accepted retention (about 100 years).
const MAX_HISTORY_DAYS: u32 = 36_500;

/// How many days of run, accessibility and link-check history are kept.
#[tauri::command]
pub fn get_history_retention(state: State<'_, AppState>) -> Result<u32, String> {
    Ok(state.lock_data().max_history_days)
}

/// Sets how many days of history to keep (1..=36500) and applies it
/// immediately. `0` is rejected so a typo cannot be read as "delete
/// everything"; legacy data files with `0` are treated as keep-forever by
/// storage (A-53).
#[tauri::command]
pub fn set_history_retention(state: State<'_, AppState>, days: u32) -> Result<(), String> {
    validate_retention_days(days)?;
    state.mutate_data(|data| {
        data.max_history_days = days;
        Ok(())
    })?;
    state.storage.prune_history(days)?;
    Ok(())
}

fn validate_retention_days(days: u32) -> Result<(), String> {
    if days == 0 || days > MAX_HISTORY_DAYS {
        return Err(format!(
            "Retention must be between 1 and {} days",
            MAX_HISTORY_DAYS
        ));
    }
    Ok(())
}

/// Applies the configured history retention after a run has been saved
/// (A-53). Failures are logged, never surfaced: the run itself succeeded.
pub(crate) fn prune_after_run(state: &AppState) {
    let max_days = state.lock_data().max_history_days;
    if let Err(e) = state.storage.prune_history(max_days) {
        log::warn!("history pruning failed: {}", e);
    }
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CheckLinksOptions {
    #[serde(default = "default_max_depth")]
    pub max_depth: u32,
    #[serde(default = "default_check_timeout")]
    pub timeout_secs: u64,
    #[serde(default = "default_same_origin_only")]
    pub same_origin_only: bool,
    #[serde(default)]
    pub include_accessibility: bool,
}

fn default_max_depth() -> u32 {
    1
}
fn default_check_timeout() -> u64 {
    10
}
fn default_same_origin_only() -> bool {
    true
}

const MAX_A11Y_HTML_BYTES: usize = 2_000_000;

struct PageFetch {
    status: Option<u16>,
    status_text: String,
    error: Option<String>,
    html: Option<String>,
}

async fn get_page(client: &reqwest::Client, url: &str) -> PageFetch {
    match client.get(url).send().await {
        Ok(resp) => {
            let status = resp.status();
            // Stream at most MAX_A11Y_HTML_BYTES bytes; skip non-HTML bodies (A-38).
            let html = read_body_capped(resp, MAX_A11Y_HTML_BYTES)
                .await
                .ok()
                .filter(|h| !h.is_empty());
            PageFetch {
                status: Some(status.as_u16()),
                status_text: status.canonical_reason().unwrap_or("unknown").to_string(),
                error: None,
                html,
            }
        }
        Err(e) => PageFetch {
            status: None,
            status_text: "error".into(),
            error: Some(e.to_string()),
            html: None,
        },
    }
}

async fn head_page(client: &reqwest::Client, url: &str) -> PageFetch {
    match client.head(url).send().await {
        Ok(resp) => {
            let status = resp.status();
            PageFetch {
                status: Some(status.as_u16()),
                status_text: status.canonical_reason().unwrap_or("unknown").to_string(),
                error: None,
                html: None,
            }
        }
        Err(e) => PageFetch {
            status: None,
            status_text: "error".into(),
            error: Some(e.to_string()),
            html: None,
        },
    }
}

/// Parses and normalises a crawlable URL: http(s) only, fragment removed (A-44).
fn normalize_link(url: reqwest::Url) -> Option<String> {
    let mut url = url;
    if !matches!(url.scheme(), "http" | "https") {
        return None;
    }
    url.set_fragment(None);
    Some(url.to_string())
}

fn extract_links_from_html(html: &str, base_url: &str) -> Vec<String> {
    let base = match reqwest::Url::parse(base_url) {
        Ok(b) => b,
        Err(_) => return Vec::new(),
    };
    let document = scraper::Html::parse_document(html);
    let selector = scraper::Selector::parse("a[href]").expect("static selector");
    let mut links = Vec::new();

    for el in document.select(&selector) {
        if let Some(href) = el.value().attr("href") {
            let href = href.trim();
            if href.is_empty()
                || href.starts_with('#')
                || href.starts_with("javascript:")
                || href.starts_with("mailto:")
            {
                continue;
            }
            if let Some(s) = base.join(href).ok().and_then(normalize_link) {
                links.push(s);
            }
        }
    }

    links.sort();
    links.dedup();
    links
}

fn scan_a11y(html: Option<&str>) -> Vec<A11yIssue> {
    html.map(|h| crate::a11y::run_a11y_scan(h, &A11yCheckConfig::default()))
        .unwrap_or_default()
}

const MAX_LINK_CHECKS: usize = 500;

fn origin_matches(seed: &Option<reqwest::Url>, url: &str) -> bool {
    seed.as_ref().map_or(true, |o| {
        reqwest::Url::parse(url)
            .map(|u| u.origin() == o.origin())
            .unwrap_or(false)
    })
}

/// Marks `link` as visited if it is new and the crawl budget allows it.
/// The seed occupies one slot, so at most `MAX_LINK_CHECKS` links beyond the
/// seed are ever scheduled or announced (A-44).
fn try_visit(visited: &std::sync::Mutex<HashSet<String>>, link: &str) -> bool {
    let mut v = lock_or_recover(visited);
    if v.contains(link) || v.len() > MAX_LINK_CHECKS {
        return false;
    }
    v.insert(link.to_string());
    true
}

fn tag_scan(scan_id: &str, value: serde_json::Value) -> serde_json::Value {
    let mut value = value;
    if let serde_json::Value::Object(ref mut map) = value {
        map.insert("scanId".into(), serde_json::Value::String(scan_id.into()));
    }
    value
}

/// Crawls `url` and checks every discovered link.
///
/// `scan_id` (a UUID) may be supplied so the frontend can cancel the scan
/// with `cancel_link_check` and filter events; every `linkcheck:*` payload
/// carries `scanId`. A cancelled scan emits `linkcheck:cancelled` `{ scanId }`
/// and resolves with the partial results, which are also saved.
#[tauri::command(rename_all = "camelCase")]
pub async fn check_links(
    app: AppHandle,
    url: String,
    options: CheckLinksOptions,
    state: State<'_, AppState>,
    scan_id: Option<String>,
) -> Result<Vec<LinkCheckResult>, String> {
    let scan_id = resolve_operation_id(scan_id);
    let registration = state.checker.register_link_scan(&scan_id);
    let token: Arc<CancelToken> = registration.token();

    let started_at = chrono::Utc::now().to_rfc3339();
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(options.timeout_secs.max(1)))
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
        .map_err(|e| e.to_string())?;

    let parsed = reqwest::Url::parse(url.trim()).map_err(|_| "Invalid URL".to_string())?;
    let url = normalize_link(parsed.clone())
        .ok_or_else(|| "Only http(s) URLs can be checked".to_string())?;
    let origin = if options.same_origin_only {
        Some(parsed)
    } else {
        None
    };
    let max_depth = options.max_depth.min(5);
    let include_a11y = options.include_accessibility;
    let semaphore = Arc::new(Semaphore::new(10));
    let results = Arc::new(std::sync::Mutex::new(Vec::new()));
    let visited = Arc::new(std::sync::Mutex::new(HashSet::from([url.clone()])));

    // Seed page — always GET so the body can feed link extraction and a11y
    let seed_fetch = tokio::select! {
        biased;
        _ = token.cancelled() => None,
        f = get_page(&client, &url) => Some(f),
    };

    let mut seed_html = None;
    if let Some(seed_fetch) = seed_fetch {
        seed_html = seed_fetch.html.clone();
        let seed_result = LinkCheckResult {
            url: url.clone(),
            source_url: url.clone(),
            status: seed_fetch.status,
            status_text: seed_fetch.status_text,
            error: seed_fetch.error,
            depth: 0,
            a11y_issues: if include_a11y {
                scan_a11y(seed_html.as_deref())
            } else {
                Vec::new()
            },
        };
        let _ = app.emit(
            "linkcheck:result",
            tag_scan(
                &scan_id,
                serde_json::to_value(&seed_result).unwrap_or_default(),
            ),
        );
        lock_or_recover(&results).push(seed_result);
    }

    if max_depth > 0 && !token.is_cancelled() {
        // Level-order crawl: each level fetches its frontier (GET when the
        // body is needed for expansion or a11y, HEAD otherwise) and pages
        // that respond OK and aren't at max depth feed the next frontier.
        // Frontier entries are (url, source_url).
        let mut frontier: Vec<(String, String)> = seed_html
            .as_deref()
            .map(|h| extract_links_from_html(h, &url))
            .unwrap_or_default()
            .into_iter()
            .filter(|l| origin_matches(&origin, l))
            .filter(|l| try_visit(&visited, l))
            .map(|l| (l, url.clone()))
            .collect();
        frontier.sort();
        for (l, s) in &frontier {
            let _ = app.emit(
                "linkcheck:discovered",
                serde_json::json!({
                    "scanId": scan_id,
                    "url": l,
                    "depth": 1,
                    "sourceUrl": s,
                }),
            );
        }

        'levels: for depth in 1..=max_depth {
            if frontier.is_empty() {
                break;
            }
            let next_frontier = Arc::new(std::sync::Mutex::new(Vec::<(String, String)>::new()));
            let mut tasks = tokio::task::JoinSet::new();

            for (link, source) in frontier.drain(..) {
                let permit = tokio::select! {
                    biased;
                    _ = token.cancelled() => break,
                    p = semaphore.clone().acquire_owned() => p.map_err(|e| e.to_string())?,
                };

                let client = client.clone();
                let app = app.clone();
                let results = results.clone();
                let visited = visited.clone();
                let origin = origin.clone();
                let next_frontier = next_frontier.clone();
                let scan_id = scan_id.clone();
                let can_expand = depth < max_depth;
                let need_body = can_expand || include_a11y;

                tasks.spawn(async move {
                    let _permit = permit;
                    let _ = app.emit(
                        "linkcheck:checking",
                        serde_json::json!({
                            "scanId": scan_id,
                            "url": link.clone(),
                            "depth": depth,
                            "sourceUrl": source.clone(),
                        }),
                    );
                    let fetch = if need_body {
                        get_page(&client, &link).await
                    } else {
                        head_page(&client, &link).await
                    };
                    let ok = fetch.status.map(|s| s < 400).unwrap_or(false);
                    let a11y_issues = if include_a11y {
                        scan_a11y(fetch.html.as_deref())
                    } else {
                        Vec::new()
                    };
                    let result_entry = LinkCheckResult {
                        url: link.clone(),
                        source_url: source,
                        status: fetch.status,
                        status_text: fetch.status_text,
                        error: fetch.error,
                        depth,
                        a11y_issues,
                    };
                    let _ = app.emit(
                        "linkcheck:result",
                        tag_scan(
                            &scan_id,
                            serde_json::to_value(&result_entry).unwrap_or_default(),
                        ),
                    );
                    lock_or_recover(&results).push(result_entry);

                    if !can_expand || !ok {
                        return;
                    }
                    let sub_links = fetch
                        .html
                        .as_deref()
                        .map(|h| extract_links_from_html(h, &link))
                        .unwrap_or_default();
                    let mut next = lock_or_recover(&next_frontier);
                    for sub in sub_links {
                        if !origin_matches(&origin, &sub) {
                            continue;
                        }
                        if try_visit(&visited, &sub) {
                            let _ = app.emit(
                                "linkcheck:discovered",
                                serde_json::json!({
                                    "scanId": scan_id,
                                    "url": sub,
                                    "depth": depth + 1,
                                    "sourceUrl": link,
                                }),
                            );
                            next.push((sub, link.clone()));
                        }
                    }
                });
            }

            loop {
                tokio::select! {
                    biased;
                    _ = token.cancelled() => {
                        tasks.abort_all();
                        while tasks.join_next().await.is_some() {}
                        break 'levels;
                    }
                    next = tasks.join_next() => {
                        if next.is_none() {
                            break;
                        }
                    }
                }
            }

            let mut next = lock_or_recover(&next_frontier).clone();
            next.sort();
            next.dedup();
            frontier = next;
        }
    }

    let cancelled = token.is_cancelled();
    let final_results = lock_or_recover(&results).clone();
    let scan = LinkCheckScan {
        id: scan_id.clone(),
        url,
        max_depth,
        same_origin_only: options.same_origin_only,
        include_accessibility: include_a11y,
        started_at,
        completed_at: Some(chrono::Utc::now().to_rfc3339()),
        results: final_results.clone(),
    };
    let _ = state.storage.save_link_check_scan(&scan);
    prune_after_run(&state);
    if cancelled {
        let _ = app.emit(
            "linkcheck:cancelled",
            serde_json::json!({ "scanId": scan_id }),
        );
    }
    Ok(final_results)
}

#[tauri::command]
pub fn list_link_check_scans(state: State<'_, AppState>) -> Result<Vec<LinkCheckScanInfo>, String> {
    Ok(state.storage.list_link_check_scans())
}

#[tauri::command(rename_all = "camelCase")]
pub fn get_link_check_scan(
    state: State<'_, AppState>,
    scan_id: String,
) -> Result<LinkCheckScan, String> {
    state.storage.load_link_check_scan(&scan_id)
}

#[tauri::command(rename_all = "camelCase")]
pub fn delete_link_check_scan(state: State<'_, AppState>, scan_id: String) -> Result<(), String> {
    state.storage.delete_link_check_scan(&scan_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn retention_rejects_zero_and_absurd_values() {
        assert!(validate_retention_days(0).is_err());
        assert!(validate_retention_days(1).is_ok());
        assert!(validate_retention_days(90).is_ok());
        assert!(validate_retention_days(MAX_HISTORY_DAYS).is_ok());
        assert!(validate_retention_days(MAX_HISTORY_DAYS + 1).is_err());
    }

    #[test]
    fn test_extract_links_strips_fragments_and_dedups() {
        let html = r##"<a href="/a#x">1</a><a href="/a#y">2</a><a href="#top">3</a>
            <a href="mailto:x@y.z">4</a><a href="ftp://h/f">5</a><a href="b">6</a>"##;
        let links = extract_links_from_html(html, "https://e.com/dir/page");
        assert_eq!(links, vec!["https://e.com/a", "https://e.com/dir/b"]);
    }

    #[test]
    fn test_normalize_link() {
        let u = reqwest::Url::parse("https://e.com/p#frag").unwrap();
        assert_eq!(normalize_link(u).as_deref(), Some("https://e.com/p"));
        let u = reqwest::Url::parse("file:///etc/passwd").unwrap();
        assert_eq!(normalize_link(u), None);
    }

    #[test]
    fn test_try_visit_enforces_budget() {
        let visited = std::sync::Mutex::new(HashSet::from(["seed".to_string()]));
        let mut accepted = 0;
        for i in 0..(MAX_LINK_CHECKS + 100) {
            if try_visit(&visited, &format!("l{}", i)) {
                accepted += 1;
            }
        }
        assert_eq!(accepted, MAX_LINK_CHECKS);
        assert!(!try_visit(&visited, "seed"));
    }

    #[test]
    fn test_origin_matches() {
        let seed = Some(reqwest::Url::parse("https://e.com/").unwrap());
        assert!(origin_matches(&seed, "https://e.com/x"));
        assert!(!origin_matches(&seed, "https://other.com/x"));
        assert!(origin_matches(&None, "https://other.com/x"));
    }

    #[test]
    fn test_tag_scan() {
        let v = tag_scan("s1", serde_json::json!({ "url": "u" }));
        assert_eq!(v["scanId"], "s1");
        assert_eq!(v["url"], "u");
    }

    #[test]
    fn test_quick_run_config_deserializes() {
        let cfg: QuickRunConfig = serde_json::from_value(serde_json::json!({
            "mode": "batch", "batchSize": 0, "timeoutSecs": 0
        }))
        .unwrap();
        assert_eq!(cfg.batch_size, 0);
        assert!(cfg.headers.is_empty());
    }
}
