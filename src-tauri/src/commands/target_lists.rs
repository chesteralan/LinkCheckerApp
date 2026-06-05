use chrono::Utc;
use tauri::State;
use uuid::Uuid;

use crate::models::TargetList;
use crate::AppState;

#[tauri::command]
pub fn list_target_lists(state: State<'_, AppState>) -> Result<Vec<TargetList>, String> {
    let data = state.data.lock().map_err(|e| e.to_string())?;
    Ok(data.target_lists.clone())
}

#[tauri::command]
pub fn create_target_list(
    state: State<'_, AppState>,
    name: String,
    urls: Vec<String>,
) -> Result<TargetList, String> {
    let now = Utc::now().to_rfc3339();
    let list = TargetList {
        id: Uuid::new_v4().to_string(),
        name,
        urls,
        created_at: now.clone(),
        updated_at: now,
    };

    let mut data = state.data.lock().map_err(|e| e.to_string())?;
    data.target_lists.push(list.clone());
    state.storage.save(&data)?;

    Ok(list)
}

#[tauri::command]
pub fn update_target_list(
    state: State<'_, AppState>,
    id: String,
    name: Option<String>,
    urls: Option<Vec<String>>,
) -> Result<TargetList, String> {
    let mut data = state.data.lock().map_err(|e| e.to_string())?;

    let list = data
        .target_lists
        .iter_mut()
        .find(|l| l.id == id)
        .ok_or_else(|| "Target list not found".to_string())?;

    if let Some(name) = name {
        list.name = name;
    }
    if let Some(urls) = urls {
        list.urls = urls;
    }
    list.updated_at = Utc::now().to_rfc3339();

    let result = list.clone();
    state.storage.save(&data)?;
    Ok(result)
}

#[tauri::command]
pub fn delete_target_list(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let mut data = state.data.lock().map_err(|e| e.to_string())?;
    data.target_lists.retain(|l| l.id != id);
    state.storage.save(&data)
}
