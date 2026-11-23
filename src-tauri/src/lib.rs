mod a11y;
mod a11y_browser;
mod a11y_runner;
mod checker;
mod commands;
mod models;
mod storage;

use std::sync::Mutex;
use tauri::Manager;

use a11y_runner::A11yRunner;
use checker::Checker;
use models::AppData;
use storage::Storage;

pub struct AppState {
    pub data: Mutex<AppData>,
    pub storage: Storage,
    pub checker: Checker,
    pub a11y_runner: A11yRunner,
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
            if let Err(e) = storage.migrate_old_history() {
                eprintln!("[storage] legacy history migration failed: {}", e);
            }
            let data = storage.load();
            // Automatic retention (0 = keep forever); covers run, a11y and
            // link-check history.
            if let Err(e) = storage.prune_history(data.max_history_days) {
                eprintln!("[storage] history retention failed: {}", e);
            }

            // Single source of truth for the version: tauri.conf.json reads it
            // from package.json; the title is derived from it here.
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_title(&format!(
                    "Link Checker v{}",
                    app.package_info().version
                ));
            }

            app.manage(AppState {
                data: Mutex::new(data),
                storage,
                checker: Checker::new(),
                a11y_runner: A11yRunner::new(),
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
            commands::files::save_text_file,
            commands::files::open_text_file,
            commands::files::get_storage_warnings,
            commands::runs::list_all_runs,
            commands::runs::list_run_files,
            commands::runs::list_audit_runs,
            commands::runs::get_run_results,
            commands::runs::scrape_links,
            commands::runs::scrape_selectors,
            commands::runs::quick_run,
            commands::runs::get_data_path,
            commands::files::reveal_data_folder,
            commands::runs::clear_history,
            commands::runs::prune_history,
            commands::runs::get_history_retention,
            commands::runs::set_history_retention,
            commands::runs::check_links,
            commands::runs::cancel_link_check,
            commands::runs::list_link_check_scans,
            commands::runs::get_link_check_scan,
            commands::runs::delete_link_check_scan,
            commands::a11y::list_a11y_audits,
            commands::a11y::create_a11y_audit,
            commands::a11y::update_a11y_audit,
            commands::a11y::delete_a11y_audit,
            commands::a11y::run_a11y_audit,
            commands::a11y::cancel_a11y_run,
            commands::a11y::list_a11y_reports,
            commands::a11y::get_a11y_report,
            commands::a11y::delete_a11y_report,
            commands::a11y::rerun_a11y_pages,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
