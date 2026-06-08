use std::collections::{HashMap, BTreeSet, HashSet};
use std::fs;
use std::sync::Arc;
use serde::Deserialize;
use tauri::{AppHandle, State};
use tokio::sync::Semaphore;

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
}

#[tauri::command(rename_all = "camelCase")]
pub async fn scrape_links(url: String) -> Result<Vec<String>, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::limited(5))
        .build()
        .map_err(|e| e.to_string())?;

    let html = client.get(&url).send().await
        .map_err(|e| format!("Failed to fetch URL: {}", e))?
        .text().await
        .map_err(|e| format!("Failed to read response: {}", e))?;

    let document = scraper::Html::parse_document(&html);
    let selector = scraper::Selector::parse("a[href]").map_err(|_| "Invalid selector".to_string())?;

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
pub async fn scrape_selectors(urls: Vec<String>, options: ScrapeSelectorsOptions) -> Result<Vec<ScrapedSelector>, String> {
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
        let permit = semaphore.clone().acquire_owned().await.map_err(|e| e.to_string())?;

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

    Ok(all_results.into_iter().map(|selector| {
        let type_name = if selector.starts_with('#') { "id".into() }
            else if selector.starts_with('.') { "class".into() }
            else if selector.contains("data-testid") { "data-testid".into() }
            else { "custom".into() };
        ScrapedSelector { selector, type_name }
    }).collect())
}

async fn scrape_single(client: reqwest::Client, url: String, options: ScrapeSelectorsOptions) -> Result<Vec<ScrapedSelector>, String> {
    let html = client.get(&url).send().await
        .map_err(|e| format!("Failed to fetch {}: {}", url, e))?
        .text().await
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

    Ok(results.into_iter().map(|s| ScrapedSelector {
        selector: s.clone(),
        type_name: if s.starts_with('#') { "id".into() }
            else if s.starts_with('.') { "class".into() }
            else if s.contains("data-testid") { "data-testid".into() }
            else { "custom".into() },
    }).collect())
}

#[tauri::command(rename_all = "camelCase")]
pub async fn quick_run(
    app: AppHandle,
    state: State<'_, AppState>,
    urls: Vec<String>,
    checks: Vec<SelectorCheck>,
    config: QuickRunConfig,
    origin_override: Option<String>,
    url_postfix: Option<String>,
) -> Result<(), String> {
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
        },
        origin_override: origin_override.filter(|o| !o.is_empty()),
        url_postfix: url_postfix.filter(|p| !p.is_empty()),
        created_at: chrono::Utc::now().to_rfc3339(),
        pinned: false,
    };

    let target_list = TargetList {
        id: String::new(),
        name: "Quick URLs".into(),
        urls,
        created_at: String::new(),
        updated_at: String::new(),
        pinned: false,
    };

    let check_template = CheckTemplate {
        id: String::new(),
        name: "Quick Checks".into(),
        checks,
        created_at: String::new(),
        updated_at: String::new(),
        pinned: false,
    };

    let run = state.checker.run(&app, &audit, &target_list, &check_template).await;

    state.storage.save_run(&run)?;

    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
pub async fn run_audit(
    app: AppHandle,
    state: State<'_, AppState>,
    audit_id: String,
    origin_override: Option<String>,
    url_postfix: Option<String>,
) -> Result<(), String> {
    let (mut audit, target_list, check_template) = {
        let data = state.data.lock().map_err(|e| e.to_string())?;

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

        (audit, target_list, check_template)
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

    let run = state.checker.run(&app, &audit, &target_list, &check_template).await;

    state.storage.save_run(&run)?;

    Ok(())
}

#[tauri::command]
pub fn cancel_run(state: State<'_, AppState>) -> Result<(), String> {
    state.checker.cancel();
    Ok(())
}

#[tauri::command]
pub fn write_file(path: String, content: String) -> Result<(), String> {
    fs::write(&path, &content).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn read_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_run_files(state: State<'_, AppState>) -> Result<Vec<RunFileInfo>, String> {
    Ok(state.storage.list_run_files())
}

#[tauri::command]
pub fn list_all_runs(state: State<'_, AppState>) -> Result<Vec<AuditRun>, String> {
    let runs = state.storage.load_all_runs();
    Ok(runs)
}

#[tauri::command(rename_all = "camelCase")]
pub fn list_audit_runs(state: State<'_, AppState>, audit_id: String) -> Result<Vec<AuditRun>, String> {
    let runs = state.storage.load_all_runs();
    Ok(runs.into_iter().filter(|r| r.audit_id == audit_id).collect())
}

#[tauri::command]
pub fn get_data_path(state: State<'_, AppState>) -> Result<String, String> {
    let path = state.storage.app_dir();
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn open_data_folder(state: State<'_, AppState>) -> Result<(), String> {
    let path = state.storage.app_dir();
    let path_str = path.to_string_lossy();
    std::process::Command::new("open")
        .arg(path_str.as_ref())
        .spawn()
        .map_err(|e| format!("Failed to open folder: {}", e))?;
    Ok(())
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
    let data = state.data.lock().map_err(|e| e.to_string())?;
    let max_days = data.max_history_days;
    drop(data);
    state.storage.prune_history(max_days)?;
    Ok(())
}

#[tauri::command]
pub fn set_history_retention(state: State<'_, AppState>, days: u32) -> Result<(), String> {
    let mut data = state.data.lock().map_err(|e| e.to_string())?;
    data.max_history_days = days;
    state.storage.save(&data)?;
    Ok(())
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
}

fn default_max_depth() -> u32 { 1 }
fn default_check_timeout() -> u64 { 10 }
fn default_same_origin_only() -> bool { true }

#[tauri::command(rename_all = "camelCase")]
pub async fn check_links(url: String, options: CheckLinksOptions) -> Result<Vec<LinkCheckResult>, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(options.timeout_secs))
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
        .map_err(|e| e.to_string())?;

    let parsed = reqwest::Url::parse(&url).map_err(|_| "Invalid URL".to_string())?;
    let origin = if options.same_origin_only { Some(parsed.origin()) } else { None };
    let max_depth = options.max_depth;
    let semaphore = Arc::new(Semaphore::new(10));
    let results = Arc::new(std::sync::Mutex::new(Vec::new()));
    let visited = Arc::new(std::sync::Mutex::new(HashSet::new()));

    // Phase 1: fetch the seed page
    let seed_result = fetch_and_check(&client, &url).await;
    results.lock().unwrap().push(seed_result);

    if max_depth == 0 {
        return Ok(results.lock().unwrap().clone());
    }

    // Phase 2: extract links from seed and check them
    let links = extract_links(&client, &url).await.unwrap_or_default();
    let mut handles = Vec::new();

    for link in &links {
        let should_recurse = origin.as_ref().map_or(true, |o| {
            reqwest::Url::parse(link).map(|u| u.origin() == *o).unwrap_or(false)
        });
        if !should_recurse {
            continue;
        }
        {
            let mut v = visited.lock().unwrap();
            if !v.insert(link.clone()) {
                continue;
            }
        }

        let client = client.clone();
        let results = results.clone();
        let sem = semaphore.clone();
        let visited = visited.clone();
        let origin = origin.clone();
        let link = link.clone();
        let source = url.clone();

        let permit = sem.acquire_owned().await.map_err(|e| e.to_string())?;
        handles.push(tokio::spawn(async move {
            let _permit = permit;
            let result = check_single_link(&client, &link).await;
            results.lock().unwrap().push(LinkCheckResult {
                url: link.clone(),
                source_url: source,
                status: result.status,
                status_text: result.status_text,
                error: result.error,
                depth: 1,
            });

            if max_depth <= 1 || result.status.map(|s| s >= 400).unwrap_or(true) {
                return;
            }

            let sub_links = match extract_links(&client, &link).await {
                Ok(l) => l,
                Err(_) => return,
            };
            for sub in sub_links {
                let sub_match = origin.as_ref().map_or(true, |o| {
                    reqwest::Url::parse(&sub).map(|u| u.origin() == *o).unwrap_or(false)
                });
                if !sub_match { continue; }
                {
                    let mut v = visited.lock().unwrap();
                    if !v.insert(sub.clone()) { continue; }
                }
                let sub_result = check_single_link(&client, &sub).await;
                results.lock().unwrap().push(LinkCheckResult {
                    url: sub,
                    source_url: link.clone(),
                    status: sub_result.status,
                    status_text: sub_result.status_text,
                    error: sub_result.error,
                    depth: 2,
                });
            }
        }));
    }

    for h in handles {
        let _ = h.await;
    }

    let final_results = results.lock().unwrap().clone();
    Ok(final_results)
}

async fn fetch_and_check(client: &reqwest::Client, url: &str) -> LinkCheckResult {
    match client.get(url).send().await {
        Ok(resp) => LinkCheckResult {
            url: url.to_string(),
            source_url: url.to_string(),
            status: Some(resp.status().as_u16()),
            status_text: resp.status().canonical_reason().unwrap_or("unknown").to_string(),
            error: None,
            depth: 0,
        },
        Err(e) => LinkCheckResult {
            url: url.to_string(),
            source_url: url.to_string(),
            status: None,
            status_text: "error".into(),
            error: Some(e.to_string()),
            depth: 0,
        },
    }
}

async fn check_single_link(client: &reqwest::Client, url: &str) -> LinkCheckResult {
    match client.head(url).send().await {
        Ok(resp) => LinkCheckResult {
            url: url.to_string(),
            source_url: String::new(),
            status: Some(resp.status().as_u16()),
            status_text: resp.status().canonical_reason().unwrap_or("unknown").to_string(),
            error: None,
            depth: 1,
        },
        Err(e) => LinkCheckResult {
            url: url.to_string(),
            source_url: String::new(),
            status: None,
            status_text: "error".into(),
            error: Some(e.to_string()),
            depth: 1,
        },
    }
}

async fn extract_links(client: &reqwest::Client, url: &str) -> Result<Vec<String>, String> {
    let html = client.get(url).send().await
        .map_err(|e| format!("{}", e))?
        .text().await
        .map_err(|e| format!("{}", e))?;

    let document = scraper::Html::parse_document(&html);
    let selector = scraper::Selector::parse("a[href]").unwrap();
    let mut links = Vec::new();

    for el in document.select(&selector) {
        if let Some(href) = el.value().attr("href") {
            let href = href.trim();
            if href.is_empty() || href.starts_with('#') || href.starts_with("javascript:") || href.starts_with("mailto:") {
                continue;
            }
            if let Ok(base) = reqwest::Url::parse(url) {
                if let Ok(resolved) = base.join(href) {
                    let s = resolved.as_str().to_string();
                    if s.starts_with("http") {
                        links.push(s);
                    }
                }
            }
        }
    }

    links.sort();
    links.dedup();
    Ok(links)
}
