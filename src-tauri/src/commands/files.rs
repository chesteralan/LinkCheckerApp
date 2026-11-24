//! File and app-folder commands.
//!
//! The webview never passes a file system path to these commands. Export and
//! import go through a native dialog opened here on the Rust side, and the
//! file is read or written only at the path the user picked. This replaces the
//! old `write_file` / `read_file` commands, which accepted any path.

use std::path::PathBuf;

use tauri::{AppHandle, State, WebviewWindow};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

use crate::storage::write_atomic;
use crate::AppState;

/// Largest file `open_text_file` will read (imports are URL lists).
const MAX_IMPORT_BYTES: u64 = 20 * 1024 * 1024;

fn filter_exts(extensions: &Option<Vec<String>>) -> Vec<String> {
    extensions
        .as_deref()
        .unwrap_or_default()
        .iter()
        .map(|e| e.trim().trim_start_matches('.').to_string())
        .filter(|e| !e.is_empty())
        .collect()
}

/// Show a native "Save" dialog and write `content` to the chosen file.
///
/// Returns the chosen path, or `null` when the user cancelled.
#[tauri::command(rename_all = "camelCase")]
pub async fn save_text_file(
    app: AppHandle,
    window: WebviewWindow,
    default_name: String,
    content: String,
    filter_name: Option<String>,
    extensions: Option<Vec<String>>,
) -> Result<Option<String>, String> {
    let exts = filter_exts(&extensions);
    let picked = tauri::async_runtime::spawn_blocking(move || {
        let mut builder = app
            .dialog()
            .file()
            .set_parent(&window)
            .set_file_name(default_name);
        if !exts.is_empty() {
            let refs: Vec<&str> = exts.iter().map(String::as_str).collect();
            builder = builder.add_filter(filter_name.unwrap_or_else(|| "Files".into()), &refs);
        }
        builder.blocking_save_file()
    })
    .await
    .map_err(|e| e.to_string())?;

    let Some(file) = picked else {
        return Ok(None);
    };
    let path: PathBuf = file.into_path().map_err(|e| e.to_string())?;
    write_atomic(&path, content.as_bytes())?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

/// Show a native "Open" dialog and return the chosen text file's content.
///
/// Returns `null` when the user cancelled. Invalid UTF-8 is replaced with
/// U+FFFD rather than failing.
#[tauri::command(rename_all = "camelCase")]
pub async fn open_text_file(
    app: AppHandle,
    window: WebviewWindow,
    filter_name: Option<String>,
    extensions: Option<Vec<String>>,
) -> Result<Option<String>, String> {
    let exts = filter_exts(&extensions);
    let picked = tauri::async_runtime::spawn_blocking(move || {
        let mut builder = app.dialog().file().set_parent(&window);
        if !exts.is_empty() {
            let refs: Vec<&str> = exts.iter().map(String::as_str).collect();
            builder = builder.add_filter(filter_name.unwrap_or_else(|| "Files".into()), &refs);
        }
        builder.blocking_pick_file()
    })
    .await
    .map_err(|e| e.to_string())?;

    let Some(file) = picked else {
        return Ok(None);
    };
    let path: PathBuf = file.into_path().map_err(|e| e.to_string())?;
    let len = std::fs::metadata(&path).map_err(|e| e.to_string())?.len();
    if len > MAX_IMPORT_BYTES {
        return Err(format!(
            "File is too large to import ({} MB, limit {} MB)",
            len / (1024 * 1024),
            MAX_IMPORT_BYTES / (1024 * 1024)
        ));
    }
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    Ok(Some(String::from_utf8_lossy(&bytes).into_owned()))
}

/// Open the app data folder in the platform's file manager (Finder,
/// Explorer, or the default Linux file manager).
#[tauri::command]
pub fn reveal_data_folder(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let path = state.storage.app_dir().clone();
    std::fs::create_dir_all(&path).ok();
    app.opener()
        .open_path(path.to_string_lossy(), None::<&str>)
        .map_err(|e| format!("Failed to open folder: {}", e))
}

/// Problems found while loading saved data at startup (for example a corrupt
/// `data.json` that was moved aside). Empty when everything loaded cleanly.
#[tauri::command]
pub fn get_storage_warnings(state: State<'_, AppState>) -> Vec<String> {
    state.storage.warnings()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn filter_exts_normalizes() {
        let exts = filter_exts(&Some(vec![".csv".into(), " txt ".into(), "".into()]));
        assert_eq!(exts, vec!["csv", "txt"]);
        assert!(filter_exts(&None).is_empty());
    }
}
