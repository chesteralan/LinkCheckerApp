use std::collections::BTreeSet;
use std::fs;
use serde::Deserialize;
use tauri::{AppHandle, State};

use crate::models::*;
use crate::AppState;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuickRunConfig {
    pub mode: String,
    pub batch_size: u32,
    pub timeout_secs: u64,
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

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScrapeSelectorsOptions {
    pub select_ids: bool,
    pub select_classes: bool,
    pub select_testids: bool,
    pub custom_selector: String,
}

#[tauri::command(rename_all = "camelCase")]
pub async fn scrape_selectors(url: String, options: ScrapeSelectorsOptions) -> Result<Vec<ScrapedSelector>, String> {
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
        },
        origin_override: origin_override.filter(|o| !o.is_empty()),
        url_postfix: url_postfix.filter(|p| !p.is_empty()),
        created_at: chrono::Utc::now().to_rfc3339(),
    };

    let target_list = TargetList {
        id: String::new(),
        name: "Quick URLs".into(),
        urls,
        created_at: String::new(),
        updated_at: String::new(),
    };

    let check_template = CheckTemplate {
        id: String::new(),
        name: "Quick Checks".into(),
        checks,
        created_at: String::new(),
        updated_at: String::new(),
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
