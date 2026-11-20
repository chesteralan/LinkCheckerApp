use crate::models::{
    A11yReport, A11yReportInfo, AppData, AuditRun, LinkCheckScan, LinkCheckScanInfo, RunFileInfo,
};
use std::path::PathBuf;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_format_datetime_rfc3339() {
        let result = format_datetime_for_filename("2026-06-07T09:19:56.123Z");
        assert_eq!(result, "2026-06-07_09-19-56");
    }

    #[test]
    fn test_format_datetime_naive() {
        let result = format_datetime_for_filename("2026-06-07T09:19:56Z");
        assert_eq!(result, "2026-06-07_09-19-56");
    }

    #[test]
    fn test_format_datetime_fallback() {
        let result = format_datetime_for_filename("2026-06-07T09:19:56.123Z");
        assert!(result.contains("06-07"));
    }

    #[test]
    fn test_format_datetime_invalid() {
        let result = format_datetime_for_filename("not-a-date");
        assert_eq!(result, "not-a-date");
    }
}

pub struct Storage {
    dir: PathBuf,
}

fn format_datetime_for_filename(s: &str) -> String {
    if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(s) {
        dt.format("%Y-%m-%d_%H-%M-%S").to_string()
    } else if let Ok(dt) = chrono::NaiveDateTime::parse_from_str(s, "%Y-%m-%dT%H:%M:%S%.fZ") {
        dt.format("%Y-%m-%d_%H-%M-%S").to_string()
    } else {
        s.replace([':', '.'], "-").replace('Z', "")
    }
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
        let ts = format_datetime_for_filename(&run.started_at);
        self.history_dir()
            .join(format!("run-{}-{}.json", ts, run.id))
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
        std::fs::create_dir_all(self.history_dir()).map_err(|e| e.to_string())?;
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

    pub fn load_recent_runs(&self, limit: usize) -> Vec<AuditRun> {
        let hd = self.history_dir();
        let mut runs: Vec<AuditRun> = Vec::new();
        if let Ok(entries) = std::fs::read_dir(&hd) {
            let mut paths: Vec<_> = entries.flatten().map(|e| e.path()).collect();
            paths.sort_by_key(|p| p.file_name().map(|n| n.to_os_string()).unwrap_or_default());
            for path in paths.iter().rev().take(limit) {
                if path.extension().and_then(|e| e.to_str()) == Some("json") {
                    if let Ok(content) = std::fs::read_to_string(path) {
                        if let Ok(mut run) = serde_json::from_str::<AuditRun>(&content) {
                            run.results.clear();
                            runs.push(run);
                        }
                    }
                }
            }
        }
        runs
    }

    pub fn list_run_files(&self) -> Vec<RunFileInfo> {
        let hd = self.history_dir();
        let mut infos: Vec<RunFileInfo> = Vec::new();
        if let Ok(entries) = std::fs::read_dir(&hd) {
            let mut entries: Vec<_> = entries
                .flatten()
                .filter(|e| {
                    let name = e.file_name().to_string_lossy().to_string();
                    name.starts_with("run-") && name.ends_with(".json")
                })
                .collect();
            entries.sort_by_key(|e| {
                std::fs::metadata(e.path())
                    .and_then(|m| m.created())
                    .unwrap_or(std::time::SystemTime::UNIX_EPOCH)
            });
            entries.reverse();
            for entry in entries {
                let name = entry.file_name().to_string_lossy().to_string();
                let stripped = name
                    .strip_prefix("run-")
                    .and_then(|s| s.strip_suffix(".json"));
                if let Some(body) = stripped {
                    if let Some(sep) = body.rfind('-') {
                        let id = body[sep + 1..].to_string();
                        let ms = std::fs::metadata(entry.path())
                            .and_then(|m| m.created())
                            .ok()
                            .and_then(|t| t.duration_since(std::time::SystemTime::UNIX_EPOCH).ok())
                            .map(|d| d.as_millis() as i64)
                            .unwrap_or(0);
                        let started_at =
                            if let Some(dt) = chrono::DateTime::from_timestamp_millis(ms) {
                                dt.to_rfc3339()
                            } else {
                                String::new()
                            };
                        infos.push(RunFileInfo {
                            id,
                            started_at,
                            timestamp_ms: ms,
                        });
                    }
                }
            }
        }
        infos
    }

    pub fn load_run(&self, run_id: &str) -> Result<AuditRun, String> {
        let path = self
            .run_filepath_by_id(run_id)
            .ok_or_else(|| "Run not found".to_string())?;
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

    pub fn prune_history(&self, max_days: u32) -> Result<(), String> {
        let cutoff = chrono::Utc::now() - chrono::Duration::days(max_days as i64);
        let hd = self.history_dir();
        if let Ok(entries) = std::fs::read_dir(&hd) {
            for entry in entries.flatten() {
                let path = entry.path();
                if let Ok(content) = std::fs::read_to_string(&path) {
                    if let Ok(run) = serde_json::from_str::<AuditRun>(&content) {
                        if let Ok(started) = chrono::DateTime::parse_from_rfc3339(&run.started_at) {
                            if started < cutoff {
                                std::fs::remove_file(&path).ok();
                            }
                        }
                    }
                }
            }
        }
        Ok(())
    }

    pub fn a11y_history_dir(&self) -> PathBuf {
        let d = self.dir.join("a11y-history");
        std::fs::create_dir_all(&d).ok();
        d
    }

    fn a11y_report_filepath(&self, report: &A11yReport) -> PathBuf {
        let ts = format_datetime_for_filename(&report.started_at);
        self.a11y_history_dir()
            .join(format!("a11y-{}-{}.json", ts, report.id))
    }

    fn a11y_report_filepath_by_id(&self, report_id: &str) -> Option<PathBuf> {
        let hd = self.a11y_history_dir();
        if let Ok(entries) = std::fs::read_dir(&hd) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                if name.ends_with(&format!("-{}.json", report_id)) {
                    return Some(entry.path());
                }
            }
        }
        None
    }

    pub fn save_a11y_report(&self, report: &A11yReport) -> Result<(), String> {
        std::fs::create_dir_all(self.a11y_history_dir()).map_err(|e| e.to_string())?;
        let path = self.a11y_report_filepath(report);
        let content = serde_json::to_string_pretty(report).map_err(|e| e.to_string())?;
        std::fs::write(&path, content).map_err(|e| e.to_string())
    }

    pub fn load_a11y_report(&self, report_id: &str) -> Result<A11yReport, String> {
        let path = self
            .a11y_report_filepath_by_id(report_id)
            .ok_or_else(|| "Report not found".to_string())?;
        let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
        serde_json::from_str(&content).map_err(|e| e.to_string())
    }

    pub fn list_a11y_reports(&self) -> Vec<A11yReportInfo> {
        let hd = self.a11y_history_dir();
        let mut infos: Vec<A11yReportInfo> = Vec::new();
        if let Ok(entries) = std::fs::read_dir(&hd) {
            let mut entries: Vec<_> = entries
                .flatten()
                .filter(|e| {
                    let name = e.file_name().to_string_lossy().to_string();
                    name.starts_with("a11y-") && name.ends_with(".json")
                })
                .collect();
            entries.sort_by_key(|e| {
                std::fs::metadata(e.path())
                    .and_then(|m| m.created())
                    .unwrap_or(std::time::SystemTime::UNIX_EPOCH)
            });
            entries.reverse();
            for entry in entries {
                let path = entry.path();
                let name = entry.file_name().to_string_lossy().to_string();
                let stripped = name
                    .strip_prefix("a11y-")
                    .and_then(|s| s.strip_suffix(".json"));
                if let Some(body) = stripped {
                    if let Some(sep) = body.rfind('-') {
                        let id = body[sep + 1..].to_string();
                        let audit_id = if let Ok(content) = std::fs::read_to_string(&path) {
                            serde_json::from_str::<A11yReport>(&content)
                                .map(|r| r.audit_id)
                                .unwrap_or_default()
                        } else {
                            String::new()
                        };
                        let ms = std::fs::metadata(&path)
                            .and_then(|m| m.created())
                            .ok()
                            .and_then(|t| t.duration_since(std::time::SystemTime::UNIX_EPOCH).ok())
                            .map(|d| d.as_millis() as i64)
                            .unwrap_or(0);
                        let started_at = if let Ok(content) = std::fs::read_to_string(&path) {
                            serde_json::from_str::<A11yReport>(&content)
                                .map(|r| r.started_at)
                                .unwrap_or_default()
                        } else {
                            String::new()
                        };
                        infos.push(A11yReportInfo {
                            id,
                            audit_id,
                            started_at,
                            timestamp_ms: ms,
                        });
                    }
                }
            }
        }
        infos
    }

    pub fn delete_a11y_report(&self, report_id: &str) -> Result<(), String> {
        if let Some(path) = self.a11y_report_filepath_by_id(report_id) {
            std::fs::remove_file(&path).map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    pub fn delete_a11y_audit_reports(&self, audit_id: &str) -> Result<(), String> {
        let hd = self.a11y_history_dir();
        if let Ok(entries) = std::fs::read_dir(&hd) {
            for entry in entries.flatten() {
                let path = entry.path();
                if let Ok(content) = std::fs::read_to_string(&path) {
                    if let Ok(report) = serde_json::from_str::<A11yReport>(&content) {
                        if report.audit_id == audit_id {
                            std::fs::remove_file(&path).ok();
                        }
                    }
                }
            }
        }
        Ok(())
    }

    pub fn link_checks_dir(&self) -> PathBuf {
        let d = self.dir.join("link-checks");
        std::fs::create_dir_all(&d).ok();
        d
    }

    fn link_check_filepath(&self, scan: &LinkCheckScan) -> PathBuf {
        let ts = format_datetime_for_filename(&scan.started_at);
        self.link_checks_dir()
            .join(format!("linkcheck-{}-{}.json", ts, scan.id))
    }

    fn link_check_filepath_by_id(&self, scan_id: &str) -> Option<PathBuf> {
        let hd = self.link_checks_dir();
        if let Ok(entries) = std::fs::read_dir(&hd) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                if name.ends_with(&format!("-{}.json", scan_id)) {
                    return Some(entry.path());
                }
            }
        }
        None
    }

    pub fn save_link_check_scan(&self, scan: &LinkCheckScan) -> Result<(), String> {
        std::fs::create_dir_all(self.link_checks_dir()).map_err(|e| e.to_string())?;
        let path = self.link_check_filepath(scan);
        let content = serde_json::to_string_pretty(scan).map_err(|e| e.to_string())?;
        std::fs::write(&path, content).map_err(|e| e.to_string())
    }

    pub fn load_link_check_scan(&self, scan_id: &str) -> Result<LinkCheckScan, String> {
        let path = self
            .link_check_filepath_by_id(scan_id)
            .ok_or_else(|| "Scan not found".to_string())?;
        let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
        serde_json::from_str(&content).map_err(|e| e.to_string())
    }

    pub fn list_link_check_scans(&self) -> Vec<LinkCheckScanInfo> {
        let hd = self.link_checks_dir();
        let mut infos: Vec<LinkCheckScanInfo> = Vec::new();
        if let Ok(entries) = std::fs::read_dir(&hd) {
            let mut entries: Vec<_> = entries
                .flatten()
                .filter(|e| {
                    let name = e.file_name().to_string_lossy().to_string();
                    name.starts_with("linkcheck-") && name.ends_with(".json")
                })
                .collect();
            entries.sort_by_key(|e| {
                std::fs::metadata(e.path())
                    .and_then(|m| m.created())
                    .unwrap_or(std::time::SystemTime::UNIX_EPOCH)
            });
            entries.reverse();
            for entry in entries {
                let path = entry.path();
                let name = entry.file_name().to_string_lossy().to_string();
                let stripped = name
                    .strip_prefix("linkcheck-")
                    .and_then(|s| s.strip_suffix(".json"));
                if let Some(body) = stripped {
                    if let Some(sep) = body.rfind('-') {
                        let id = body[sep + 1..].to_string();
                        let scan = std::fs::read_to_string(&path)
                            .ok()
                            .and_then(|c| serde_json::from_str::<LinkCheckScan>(&c).ok());
                        let ms = std::fs::metadata(&path)
                            .and_then(|m| m.created())
                            .ok()
                            .and_then(|t| t.duration_since(std::time::SystemTime::UNIX_EPOCH).ok())
                            .map(|d| d.as_millis() as i64)
                            .unwrap_or(0);
                        let (url, started_at, total, broken, a11y) = scan
                            .map(|s| {
                                let broken = s
                                    .results
                                    .iter()
                                    .filter(|r| {
                                        r.status.map(|x| x >= 400).unwrap_or(false)
                                            || r.error.is_some()
                                    })
                                    .count();
                                let a11y = s.results.iter().map(|r| r.a11y_issues.len()).sum();
                                (s.url, s.started_at, s.results.len(), broken, a11y)
                            })
                            .unwrap_or_default();
                        infos.push(LinkCheckScanInfo {
                            id,
                            url,
                            started_at,
                            timestamp_ms: ms,
                            total_links: total,
                            broken,
                            a11y_issues: a11y,
                        });
                    }
                }
            }
        }
        infos
    }

    pub fn delete_link_check_scan(&self, scan_id: &str) -> Result<(), String> {
        if let Some(path) = self.link_check_filepath_by_id(scan_id) {
            std::fs::remove_file(&path).map_err(|e| e.to_string())?;
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
