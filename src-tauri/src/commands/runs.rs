use std::fs;
use tauri::{AppHandle, State};

use crate::models::AuditRun;
use crate::AppState;

#[tauri::command]
pub async fn run_audit(
    app: AppHandle,
    state: State<'_, AppState>,
    audit_id: String,
) -> Result<(), String> {
    let (audit, target_list, check_template) = {
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

#[tauri::command]
pub fn list_audit_runs(state: State<'_, AppState>, audit_id: String) -> Result<Vec<AuditRun>, String> {
    let data = state.data.lock().map_err(|e| e.to_string())?;
    Ok(data.runs.iter().filter(|r| r.audit_id == audit_id).cloned().collect())
}

#[tauri::command]
pub fn get_run_results(state: State<'_, AppState>, run_id: String) -> Result<AuditRun, String> {
    let data = state.data.lock().map_err(|e| e.to_string())?;
    data.runs
        .iter()
        .find(|r| r.id == run_id)
        .cloned()
        .ok_or_else(|| "Run not found".to_string())
}
