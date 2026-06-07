mod checker;
mod commands;
mod models;
mod storage;

use std::sync::Mutex;
use tauri::Manager;

use checker::Checker;
use models::{AppData, AuditRun};
use storage::Storage;

pub struct AppState {
    pub data: Mutex<AppData>,
    pub history: Mutex<Vec<AuditRun>>,
    pub storage: Storage,
    pub checker: Checker,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            if cfg!(debug_assertions) {
            app.handle().plugin(
                tauri_plugin_log::Builder::default()
                    .level(log::LevelFilter::Info)
                    .build(),
            )?;
        }

        app.handle().plugin(tauri_plugin_dialog::init())?;
        app.handle().plugin(tauri_plugin_opener::init())?;

            let app_dir = app
                .path()
                .app_data_dir()
                .expect("failed to get app data dir");

            std::fs::create_dir_all(&app_dir).ok();

            let storage = Storage::new(app_dir);
            let data = storage.load();
            let history = storage.load_history();

            app.manage(AppState {
                data: Mutex::new(data),
                history: Mutex::new(history),
                storage,
                checker: Checker::new(),
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::target_lists::list_target_lists,
            commands::target_lists::create_target_list,
            commands::target_lists::update_target_list,
            commands::target_lists::delete_target_list,
            commands::check_templates::list_check_templates,
            commands::check_templates::create_check_template,
            commands::check_templates::update_check_template,
            commands::check_templates::delete_check_template,
            commands::audits::list_audits,
            commands::audits::create_audit,
            commands::audits::update_audit,
            commands::audits::delete_audit,
            commands::runs::run_audit,
            commands::runs::cancel_run,
            commands::runs::write_file,
            commands::runs::read_file,
            commands::runs::list_all_runs,
            commands::runs::list_audit_runs,
            commands::runs::get_run_results,
            commands::runs::scrape_links,
            commands::runs::scrape_selectors,
            commands::runs::quick_run,
            commands::runs::get_data_path,
            commands::runs::clear_history,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
