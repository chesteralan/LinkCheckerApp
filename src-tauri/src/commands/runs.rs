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

    state.checker.run(&app, &audit, &target_list, &check_template).await;

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

    let mut data = state.data.lock().map_err(|e| e.to_string())?;
    data.runs.push(run);
    state.storage.save(&data)?;

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
pub fn list_all_runs(state: State<'_, AppState>) -> Result<Vec<AuditRun>, String> {
    let data = state.data.lock().map_err(|e| e.to_string())?;
    Ok(data.runs.clone())
}

#[tauri::command(rename_all = "camelCase")]
pub fn list_audit_runs(state: State<'_, AppState>, audit_id: String) -> Result<Vec<AuditRun>, String> {
    let data = state.data.lock().map_err(|e| e.to_string())?;
    Ok(data.runs.iter().filter(|r| r.audit_id == audit_id).cloned().collect())
}

#[tauri::command(rename_all = "camelCase")]
pub fn get_run_results(state: State<'_, AppState>, run_id: String) -> Result<AuditRun, String> {
    let data = state.data.lock().map_err(|e| e.to_string())?;
    data.runs
        .iter()
        .find(|r| r.id == run_id)
        .cloned()
        .ok_or_else(|| "Run not found".to_string())
}
