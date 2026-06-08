use chrono::Utc;
use serde::Deserialize;
use tauri::State;
use uuid::Uuid;

use crate::models::{CheckTemplate, CheckType, SelectorCheck};
use crate::AppState;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckInput {
    pub selector: String,
    pub label: String,
    pub check_type: Option<CheckType>,
    pub expected_status: Option<u16>,
    pub pattern: Option<String>,
    pub attribute_name: Option<String>,
    pub attribute_value: Option<String>,
}

#[tauri::command]
pub fn list_check_templates(state: State<'_, AppState>) -> Result<Vec<CheckTemplate>, String> {
    let data = state.data.lock().map_err(|e| e.to_string())?;
    Ok(data.check_templates.clone())
}

#[tauri::command]
pub fn create_check_template(
    state: State<'_, AppState>,
    name: String,
    checks: Vec<CheckInput>,
    pinned: bool,
) -> Result<CheckTemplate, String> {
    let now = Utc::now().to_rfc3339();
    let template = CheckTemplate {
        id: Uuid::new_v4().to_string(),
        name,
        checks: checks
            .into_iter()
            .map(|c| SelectorCheck {
                id: Uuid::new_v4().to_string(),
                selector: c.selector,
                label: c.label,
                check_type: c.check_type.unwrap_or_default(),
                expected_status: c.expected_status,
                pattern: c.pattern,
                attribute_name: c.attribute_name,
                attribute_value: c.attribute_value,
            })
            .collect(),
        created_at: now.clone(),
        updated_at: now.clone(),
        pinned,
    };

    let mut data = state.data.lock().map_err(|e| e.to_string())?;
    data.check_templates.push(template.clone());
    state.storage.save(&data)?;

    Ok(template)
}

#[tauri::command]
pub fn update_check_template(
    state: State<'_, AppState>,
    id: String,
    name: Option<String>,
    checks: Option<Vec<CheckInput>>,
    pinned: Option<bool>,
) -> Result<CheckTemplate, String> {
    let mut data = state.data.lock().map_err(|e| e.to_string())?;

    let template = data
        .check_templates
        .iter_mut()
        .find(|t| t.id == id)
        .ok_or_else(|| "Check template not found".to_string())?;

    if let Some(name) = name {
        template.name = name;
    }
    if let Some(checks) = checks {
        template.checks = checks
            .into_iter()
            .map(|c| SelectorCheck {
                id: Uuid::new_v4().to_string(),
                selector: c.selector,
                label: c.label,
                check_type: c.check_type.unwrap_or_default(),
                expected_status: c.expected_status,
                pattern: c.pattern,
                attribute_name: c.attribute_name,
                attribute_value: c.attribute_value,
            })
            .collect();
    }
    if let Some(pinned) = pinned {
        template.pinned = pinned;
    }
    template.updated_at = Utc::now().to_rfc3339();

    let result = template.clone();
    state.storage.save(&data)?;
    Ok(result)
}

#[tauri::command]
pub fn delete_check_template(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let mut data = state.data.lock().map_err(|e| e.to_string())?;
    data.check_templates.retain(|t| t.id != id);
    state.storage.save(&data)
}
