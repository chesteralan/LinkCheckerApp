use chrono::Utc;
use serde::Deserialize;
use tauri::{AppHandle, State};
use uuid::Uuid;

use crate::models::{A11yAudit, A11yCheckConfig, A11yReport, A11yReportInfo, AuditConfig};
use crate::AppState;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct A11yAuditInput {
    pub name: String,
    pub target_list_id: String,
    pub engine: Option<String>,
    pub a11y_config: Option<A11yCheckConfig>,
    pub config: AuditConfig,
    pub origin_override: Option<String>,
    pub url_postfix: Option<String>,
    pub pinned: Option<bool>,
    pub folder: Option<String>,
}

#[tauri::command]
pub fn list_a11y_audits(state: State<'_, AppState>) -> Result<Vec<A11yAudit>, String> {
    let data = state.data.lock().map_err(|e| e.to_string())?;
    Ok(data.a11y_audits.clone())
}

#[tauri::command(rename_all = "camelCase")]
pub fn create_a11y_audit(
    state: State<'_, AppState>,
    input: A11yAuditInput,
) -> Result<A11yAudit, String> {
    let audit = A11yAudit {
        id: Uuid::new_v4().to_string(),
        name: input.name,
        target_list_id: input.target_list_id,
        engine: input.engine.unwrap_or_else(|| "static".into()),
        a11y_config: input.a11y_config.unwrap_or_default(),
        config: input.config,
        origin_override: input.origin_override.filter(|o| !o.is_empty()),
        url_postfix: input.url_postfix.filter(|p| !p.is_empty()),
        created_at: Utc::now().to_rfc3339(),
        pinned: input.pinned.unwrap_or(false),
        folder: input.folder,
    };

    let mut data = state.data.lock().map_err(|e| e.to_string())?;
    data.a11y_audits.push(audit.clone());
    state.storage.save(&data)?;

    Ok(audit)
}

#[tauri::command(rename_all = "camelCase")]
pub fn update_a11y_audit(
    state: State<'_, AppState>,
    id: String,
    name: Option<String>,
    target_list_id: Option<String>,
    engine: Option<String>,
    a11y_config: Option<A11yCheckConfig>,
    config: Option<AuditConfig>,
    origin_override: Option<String>,
    url_postfix: Option<String>,
    pinned: Option<bool>,
    folder: Option<Option<String>>,
) -> Result<A11yAudit, String> {
    let mut data = state.data.lock().map_err(|e| e.to_string())?;

    let audit = data
        .a11y_audits
        .iter_mut()
        .find(|a| a.id == id)
        .ok_or_else(|| "Accessibility audit not found".to_string())?;

    if let Some(name) = name {
        audit.name = name;
    }
    if let Some(tl) = target_list_id {
        audit.target_list_id = tl;
    }
    if let Some(engine) = engine {
        audit.engine = engine;
    }
    if let Some(cfg) = a11y_config {
        audit.a11y_config = cfg;
    }
    if let Some(config) = config {
        audit.config = config;
    }
    if let Some(oo) = origin_override {
        audit.origin_override = if oo.is_empty() { None } else { Some(oo) };
    }
    if let Some(up) = url_postfix {
        audit.url_postfix = if up.is_empty() { None } else { Some(up) };
    }
    if let Some(pinned) = pinned {
        audit.pinned = pinned;
    }
    if let Some(folder) = folder {
        audit.folder = folder;
    }

    let result = audit.clone();
    state.storage.save(&data)?;
    Ok(result)
}

#[tauri::command]
pub fn delete_a11y_audit(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let mut data = state.data.lock().map_err(|e| e.to_string())?;
    data.a11y_audits.retain(|a| a.id != id);
    state.storage.save(&data)?;
    state.storage.delete_a11y_audit_reports(&id)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn run_a11y_audit(
    app: AppHandle,
    state: State<'_, AppState>,
    audit_id: String,
) -> Result<(), String> {
    let (audit, target_list) = {
        let data = state.data.lock().map_err(|e| e.to_string())?;
        let audit = data
            .a11y_audits
            .iter()
            .find(|a| a.id == audit_id)
            .ok_or_else(|| "Accessibility audit not found".to_string())?
            .clone();
        let target_list = data
            .target_lists
            .iter()
            .find(|tl| tl.id == audit.target_list_id)
            .ok_or_else(|| "Target list not found".to_string())?
            .clone();
        (audit, target_list)
    };

    let report: A11yReport = state.a11y_runner.run(&app, &audit, &target_list).await;

    state.storage.save_a11y_report(&report)?;

    Ok(())
}

#[tauri::command]
pub fn cancel_a11y_run(state: State<'_, AppState>) -> Result<(), String> {
    state.a11y_runner.cancel();
    Ok(())
}

#[tauri::command]
pub fn list_a11y_reports(state: State<'_, AppState>) -> Result<Vec<A11yReportInfo>, String> {
    Ok(state.storage.list_a11y_reports())
}

#[tauri::command]
pub fn get_a11y_report(
    state: State<'_, AppState>,
    report_id: String,
) -> Result<A11yReport, String> {
    state.storage.load_a11y_report(&report_id)
}

#[tauri::command]
pub fn delete_a11y_report(state: State<'_, AppState>, report_id: String) -> Result<(), String> {
    state.storage.delete_a11y_report(&report_id)
}
