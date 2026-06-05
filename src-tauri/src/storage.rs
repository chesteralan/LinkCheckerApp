use std::path::PathBuf;
use crate::models::AppData;

pub struct Storage {
    dir: PathBuf,
}

impl Storage {
    pub fn new(app_dir: PathBuf) -> Self {
        Self { dir: app_dir }
    }

    fn data_path(&self) -> PathBuf {
        self.dir.join("data.json")
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
