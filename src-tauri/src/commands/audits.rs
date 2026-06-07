use chrono::Utc;
use serde::Deserialize;
use tauri::State;
use uuid::Uuid;

use crate::models::{Audit, AuditConfig};
use crate::AppState;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditConfigInput {
    pub mode: String,
    pub batch_size: u32,
    pub timeout_secs: u64,
}

#[tauri::command]
pub fn list_audits(state: State<'_, AppState>) -> Result<Vec<Audit>, String> {
    let data = state.data.lock().map_err(|e| e.to_string())?;
    Ok(data.audits.clone())
}

#[tauri::command(rename_all = "camelCase")]
pub fn create_audit(
    state: State<'_, AppState>,
    name: String,
    target_list_id: String,
    check_template_id: String,
    config: AuditConfigInput,
    origin_override: Option<String>,
    url_postfix: Option<String>,
) -> Result<Audit, String> {
    let audit = Audit {
        id: Uuid::new_v4().to_string(),
        name,
        target_list_id,
        check_template_id,
        config: AuditConfig {
            mode: config.mode,
            batch_size: config.batch_size,
            timeout_secs: config.timeout_secs,
        },
        origin_override: origin_override.filter(|o| !o.is_empty()),
        url_postfix: url_postfix.filter(|p| !p.is_empty()),
        created_at: Utc::now().to_rfc3339(),
    };

    let mut data = state.data.lock().map_err(|e| e.to_string())?;
    data.audits.push(audit.clone());
    state.storage.save(&data)?;

    Ok(audit)
}

#[tauri::command(rename_all = "camelCase")]
pub fn update_audit(
    state: State<'_, AppState>,
    id: String,
    name: Option<String>,
    config: Option<AuditConfigInput>,
    origin_override: Option<String>,
    url_postfix: Option<String>,
) -> Result<Audit, String> {
    let mut data = state.data.lock().map_err(|e| e.to_string())?;

    let audit = data
        .audits
        .iter_mut()
        .find(|a| a.id == id)
        .ok_or_else(|| "Audit not found".to_string())?;

    if let Some(name) = name {
        audit.name = name;
    }
    if let Some(config) = config {
        audit.config = AuditConfig {
            mode: config.mode,
            batch_size: config.batch_size,
            timeout_secs: config.timeout_secs,
        };
    }
    if let Some(oo) = origin_override {
        audit.origin_override = if oo.is_empty() { None } else { Some(oo) };
    }
    if let Some(up) = url_postfix {
        audit.url_postfix = if up.is_empty() { None } else { Some(up) };
    }

    let result = audit.clone();
    state.storage.save(&data)?;
    Ok(result)
}

#[tauri::command]
pub fn delete_audit(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let mut data = state.data.lock().map_err(|e| e.to_string())?;
    data.audits.retain(|a| a.id != id);
    state.storage.save(&data)?;

    state.storage.delete_audit_runs(&id)
}
