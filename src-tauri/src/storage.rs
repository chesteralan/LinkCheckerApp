use std::path::PathBuf;
use crate::models::{AppData, AuditRun};

pub struct Storage {
    dir: PathBuf,
}

impl Storage {
    pub fn new(app_dir: PathBuf) -> Self {
        Self { dir: app_dir }
    }

    pub fn data_path(&self) -> PathBuf {
        self.dir.join("data.json")
    }

    pub fn history_path(&self) -> PathBuf {
        self.dir.join("history.json")
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

    pub fn load_history(&self) -> Vec<AuditRun> {
        let path = self.history_path();
        if path.exists() {
            let content = std::fs::read_to_string(&path).unwrap_or_default();
            serde_json::from_str(&content).unwrap_or_default()
        } else {
            self.migrate_runs_from_data()
        }
    }

    pub fn save_history(&self, runs: &[AuditRun]) -> Result<(), String> {
        std::fs::create_dir_all(&self.dir).map_err(|e| e.to_string())?;
        let content = serde_json::to_string_pretty(runs).map_err(|e| e.to_string())?;
        std::fs::write(self.history_path(), content).map_err(|e| e.to_string())
    }

    pub fn clear_history(&self) -> Result<(), String> {
        self.save_history(&[])
    }

    fn migrate_runs_from_data(&self) -> Vec<AuditRun> {
        let data_path = self.data_path();
        if !data_path.exists() {
            return Vec::new();
        }
        let content = std::fs::read_to_string(&data_path).unwrap_or_default();
        #[derive(serde::Deserialize)]
        struct OldAppData {
            runs: Option<Vec<AuditRun>>,
        }
        if let Ok(old) = serde_json::from_str::<OldAppData>(&content) {
            if let Some(runs) = old.runs {
                if !runs.is_empty() {
                    self.save_history(&runs).ok();
                    return runs;
                }
            }
        }
        Vec::new()
    }
}
