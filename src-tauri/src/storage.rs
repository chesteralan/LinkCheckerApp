use std::path::PathBuf;
use crate::models::{AppData, AuditRun, RunFileInfo};

pub struct Storage {
    dir: PathBuf,
}

fn datetime_to_timestamp(s: &str) -> i64 {
    chrono::DateTime::parse_from_rfc3339(s)
        .map(|dt| dt.timestamp_millis())
        .unwrap_or(0)
}

impl Storage {
    pub fn new(app_dir: PathBuf) -> Self {
        Self { dir: app_dir }
    }

    pub fn app_dir(&self) -> &PathBuf {
        &self.dir
    }

    pub fn data_path(&self) -> PathBuf {
        self.dir.join("data.json")
    }

    pub fn history_dir(&self) -> PathBuf {
        let d = self.dir.join("history");
        std::fs::create_dir_all(&d).ok();
        d
    }

    fn run_filepath(&self, run: &AuditRun) -> PathBuf {
        let ts = datetime_to_timestamp(&run.started_at);
        self.history_dir().join(format!("run-{}-{}.json", ts, run.id))
    }

    fn run_filepath_by_id(&self, run_id: &str) -> Option<PathBuf> {
        let hd = self.history_dir();
        if let Ok(entries) = std::fs::read_dir(&hd) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                if name.ends_with(&format!("-{}.json", run_id)) {
                    return Some(entry.path());
                }
            }
        }
        None
    }

    pub fn save_run(&self, run: &AuditRun) -> Result<(), String> {
        std::fs::create_dir_all(&self.history_dir()).map_err(|e| e.to_string())?;
        let path = self.run_filepath(run);
        let content = serde_json::to_string_pretty(run).map_err(|e| e.to_string())?;
        std::fs::write(&path, content).map_err(|e| e.to_string())
    }

    pub fn load_all_runs(&self) -> Vec<AuditRun> {
        let hd = self.history_dir();
        let mut runs: Vec<AuditRun> = Vec::new();
        if let Ok(entries) = std::fs::read_dir(&hd) {
            let mut paths: Vec<_> = entries.flatten().map(|e| e.path()).collect();
            paths.sort_by_key(|p| p.file_name().map(|n| n.to_os_string()).unwrap_or_default());
            for path in &paths {
                if path.extension().and_then(|e| e.to_str()) == Some("json") {
                    if let Ok(content) = std::fs::read_to_string(path) {
                        if let Ok(run) = serde_json::from_str::<AuditRun>(&content) {
                            runs.push(run);
                        }
                    }
                }
            }
        }
        runs.reverse();
        runs
    }

    pub fn list_run_files(&self) -> Vec<RunFileInfo> {
        let hd = self.history_dir();
        let mut infos: Vec<RunFileInfo> = Vec::new();
        if let Ok(entries) = std::fs::read_dir(&hd) {
            let mut names: Vec<String> = entries
                .flatten()
                .filter_map(|e| {
                    let name = e.file_name().to_string_lossy().to_string();
                    if name.starts_with("run-") && name.ends_with(".json") {
                        Some(name)
                    } else {
                        None
                    }
                })
                .collect();
            names.sort();
            names.reverse();
            for name in names {
                let stripped = name.strip_prefix("run-").and_then(|s| s.strip_suffix(".json"));
                if let Some(body) = stripped {
                    if let Some(sep) = body.rfind('-') {
                        let id = body[sep + 1..].to_string();
                        let ts_part = body[..sep].to_string();
                        let started_at = if ts_part.chars().all(|c| c.is_ascii_digit()) {
                            let ms: i64 = ts_part.parse().unwrap_or(0);
                            if let Some(dt) = chrono::DateTime::from_timestamp_millis(ms) {
                                dt.to_rfc3339()
                            } else {
                                continue;
                            }
                        } else {
                            ts_part.replace('-', ":")
                        };
                        infos.push(RunFileInfo { id, started_at });
                    }
                }
            }
        }
        infos
    }

    pub fn load_run(&self, run_id: &str) -> Result<AuditRun, String> {
        let path = self.run_filepath_by_id(run_id).ok_or_else(|| "Run not found".to_string())?;
        let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
        serde_json::from_str(&content).map_err(|e| e.to_string())
    }

    pub fn delete_run(&self, run_id: &str) -> Result<(), String> {
        if let Some(path) = self.run_filepath_by_id(run_id) {
            std::fs::remove_file(&path).map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    pub fn clear_all_runs(&self) -> Result<(), String> {
        let hd = self.history_dir();
        if let Ok(entries) = std::fs::read_dir(&hd) {
            for entry in entries.flatten() {
                std::fs::remove_file(entry.path()).ok();
            }
        }
        Ok(())
    }

    pub fn delete_audit_runs(&self, audit_id: &str) -> Result<(), String> {
        let hd = self.history_dir();
        if let Ok(entries) = std::fs::read_dir(&hd) {
            for entry in entries.flatten() {
                let path = entry.path();
                if let Ok(content) = std::fs::read_to_string(&path) {
                    if let Ok(run) = serde_json::from_str::<AuditRun>(&content) {
                        if run.audit_id == audit_id {
                            std::fs::remove_file(&path).ok();
                        }
                    }
                }
            }
        }
        Ok(())
    }

    pub fn migrate_old_history(&self) -> Result<(), String> {
        let old_path = self.dir.join("history.json");
        if !old_path.exists() {
            return Ok(());
        }
        let content = std::fs::read_to_string(&old_path).unwrap_or_default();
        if let Ok(runs) = serde_json::from_str::<Vec<AuditRun>>(&content) {
            for run in &runs {
                self.save_run(run)?;
            }
        }
        std::fs::remove_file(&old_path).ok();
        Ok(())
    }

    pub fn load(&self) -> AppData {
        let path = self.data_path();
        if path.exists() {
            let content = std::fs::read_to_string(&path).unwrap_or_default();
            serde_json::from_str(&content).unwrap_or_else(|_| AppData::empty())
        } else {
            AppData::empty()
        }
    }

    pub fn save(&self, data: &AppData) -> Result<(), String> {
        std::fs::create_dir_all(&self.dir).map_err(|e| e.to_string())?;
        let content = serde_json::to_string_pretty(data).map_err(|e| e.to_string())?;
        std::fs::write(self.data_path(), content).map_err(|e| e.to_string())
    }
}
