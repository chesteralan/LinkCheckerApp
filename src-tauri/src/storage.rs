use crate::models::{
    A11yReport, A11yReportInfo, AppData, AuditRun, LinkCheckScan, LinkCheckScanInfo, RunFileInfo,
    RunSummary, DATA_SCHEMA_VERSION,
};
use chrono::{DateTime, NaiveDateTime, Utc};
use serde::de::IgnoredAny;
use serde::Deserialize;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;

/// Prefixes of the per-item history files in each history directory.
const RUN_PREFIX: &str = "run-";
const A11Y_PREFIX: &str = "a11y-";
const LINKCHECK_PREFIX: &str = "linkcheck-";
/// Marker in the name of temporary files written by [`write_atomic`].
const TMP_MARKER: &str = ".tmp-";

static TMP_COUNTER: AtomicU64 = AtomicU64::new(0);

/// Write `contents` to `path` atomically: the data goes to a temporary file in
/// the same directory, is flushed to disk with `sync_all`, and is then renamed
/// over `path`. A crash at any point leaves either the old file or the new
/// one, never a truncated file.
pub fn write_atomic(path: &Path, contents: &[u8]) -> Result<(), String> {
    let dir = path
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let file_name = path
        .file_name()
        .ok_or_else(|| format!("Invalid file path: {}", path.display()))?
        .to_string_lossy();
    let tmp = dir.join(format!(
        ".{}{}{}-{}",
        file_name,
        TMP_MARKER,
        std::process::id(),
        TMP_COUNTER.fetch_add(1, Ordering::Relaxed)
    ));

    let result = (|| -> std::io::Result<()> {
        let mut f = std::fs::File::create(&tmp)?;
        f.write_all(contents)?;
        f.sync_all()?;
        drop(f);
        std::fs::rename(&tmp, path)?;
        // Persist the rename itself (best effort; not supported on Windows).
        #[cfg(unix)]
        if let Ok(d) = std::fs::File::open(dir) {
            let _ = d.sync_all();
        }
        Ok(())
    })();

    if let Err(e) = result {
        let _ = std::fs::remove_file(&tmp);
        return Err(format!("Failed to write {}: {}", path.display(), e));
    }
    Ok(())
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

/// Length of the `YYYY-MM-DD_HH-MM-SS` timestamp written into history file names.
const FILENAME_TS_LEN: usize = 19;

/// Parsed `<prefix><timestamp>-<id>.json` history file name.
#[derive(Debug, PartialEq)]
struct HistoryName {
    id: String,
    /// `None` when the timestamp part is not in the standard format (only
    /// possible for files whose `startedAt` was not a valid date).
    timestamp: Option<DateTime<Utc>>,
}

fn parse_history_name(name: &str, prefix: &str) -> Option<HistoryName> {
    let body = name.strip_prefix(prefix)?.strip_suffix(".json")?;
    if body.len() > FILENAME_TS_LEN + 1
        && body.is_char_boundary(FILENAME_TS_LEN)
        && body.as_bytes()[FILENAME_TS_LEN] == b'-'
    {
        if let Ok(ndt) =
            NaiveDateTime::parse_from_str(&body[..FILENAME_TS_LEN], "%Y-%m-%d_%H-%M-%S")
        {
            return Some(HistoryName {
                id: body[FILENAME_TS_LEN + 1..].to_string(),
                timestamp: Some(ndt.and_utc()),
            });
        }
    }
    // Non-standard timestamp: the id is unknown from the name alone.
    let sep = body.rfind('-')?;
    Some(HistoryName {
        id: body[sep + 1..].to_string(),
        timestamp: None,
    })
}

fn file_mtime(path: &Path) -> Option<DateTime<Utc>> {
    std::fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .map(DateTime::<Utc>::from)
}

fn parse_rfc3339_utc(s: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(s)
        .ok()
        .map(|d| d.with_timezone(&Utc))
}

/// Common header fields of every history file. Deserializing into this skips
/// the (potentially large) `results` arrays without allocating them.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct HistoryHeader {
    #[serde(default)]
    id: String,
    #[serde(default)]
    audit_id: String,
    #[serde(default)]
    started_at: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AuditRunHeader {
    id: String,
    audit_id: String,
    started_at: String,
    #[serde(default)]
    completed_at: Option<String>,
    #[serde(default)]
    status: String,
    #[serde(default)]
    summary: RunSummary,
}

impl From<AuditRunHeader> for AuditRun {
    fn from(h: AuditRunHeader) -> Self {
        AuditRun {
            id: h.id,
            audit_id: h.audit_id,
            started_at: h.started_at,
            completed_at: h.completed_at,
            status: h.status,
            results: Vec::new(),
            summary: h.summary,
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LinkCheckResultLite {
    #[serde(default)]
    status: Option<u16>,
    #[serde(default)]
    error: Option<String>,
    #[serde(default)]
    a11y_issues: Vec<IgnoredAny>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LinkCheckScanLite {
    #[serde(default)]
    url: String,
    #[serde(default)]
    started_at: String,
    #[serde(default)]
    results: Vec<LinkCheckResultLite>,
}

fn read_json<T: for<'de> Deserialize<'de>>(path: &Path) -> Option<T> {
    let content = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&content).ok()
}

/// A history file found on disk, with its parsed name.
struct HistoryEntry {
    path: PathBuf,
    name: HistoryName,
    /// Sort key: the filename timestamp, else the file's modification time.
    sort_ts: DateTime<Utc>,
}

pub struct Storage {
    dir: PathBuf,
    /// Problems found while loading, shown to the user by the frontend.
    warnings: Mutex<Vec<String>>,
    /// Set when `data.json` could not be loaded *and* could not be backed up.
    /// Saving is refused in that state so the unreadable file is never
    /// overwritten.
    save_blocked: AtomicBool,
}

impl Storage {
    pub fn new(app_dir: PathBuf) -> Self {
        Self {
            dir: app_dir,
            warnings: Mutex::new(Vec::new()),
            save_blocked: AtomicBool::new(false),
        }
    }

    pub fn app_dir(&self) -> &PathBuf {
        &self.dir
    }

    pub fn data_path(&self) -> PathBuf {
        self.dir.join("data.json")
    }

    fn data_backup_path(&self) -> PathBuf {
        self.dir.join("data.json.bak")
    }

    /// Warnings collected while loading storage (e.g. a corrupt `data.json`
    /// that was moved aside). Empty when everything loaded cleanly.
    pub fn warnings(&self) -> Vec<String> {
        self.warnings
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
    }

    fn warn(&self, msg: String) {
        eprintln!("[storage] {}", msg);
        log::warn!("{}", msg);
        self.warnings
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .push(msg);
    }

    pub fn history_dir(&self) -> PathBuf {
        let d = self.dir.join("history");
        std::fs::create_dir_all(&d).ok();
        d
    }

    pub fn a11y_history_dir(&self) -> PathBuf {
        let d = self.dir.join("a11y-history");
        std::fs::create_dir_all(&d).ok();
        d
    }

    pub fn link_checks_dir(&self) -> PathBuf {
        let d = self.dir.join("link-checks");
        std::fs::create_dir_all(&d).ok();
        d
    }

    /// History files in `dir` with the given prefix, newest first.
    fn history_entries(&self, dir: &Path, prefix: &str) -> Vec<HistoryEntry> {
        let mut out: Vec<HistoryEntry> = Vec::new();
        if let Ok(entries) = std::fs::read_dir(dir) {
            for entry in entries.flatten() {
                let file_name = entry.file_name().to_string_lossy().to_string();
                if let Some(name) = parse_history_name(&file_name, prefix) {
                    let path = entry.path();
                    let sort_ts = name
                        .timestamp
                        .or_else(|| file_mtime(&path))
                        .unwrap_or(DateTime::<Utc>::UNIX_EPOCH);
                    out.push(HistoryEntry {
                        path,
                        name,
                        sort_ts,
                    });
                }
            }
        }
        out.sort_by(|a, b| {
            b.sort_ts
                .cmp(&a.sort_ts)
                .then_with(|| b.path.file_name().cmp(&a.path.file_name()))
        });
        out
    }

    fn filepath_by_id(dir: &Path, id: &str) -> Option<PathBuf> {
        if id.is_empty() {
            return None;
        }
        let suffix = format!("-{}.json", id);
        std::fs::read_dir(dir).ok()?.flatten().find_map(|entry| {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.ends_with(&suffix) && !name.starts_with('.') {
                Some(entry.path())
            } else {
                None
            }
        })
    }

    // ----- Audit runs -------------------------------------------------------

    fn run_filepath(&self, run: &AuditRun) -> PathBuf {
        let ts = format_datetime_for_filename(&run.started_at);
        self.history_dir()
            .join(format!("{}{}-{}.json", RUN_PREFIX, ts, run.id))
    }

    pub fn save_run(&self, run: &AuditRun) -> Result<(), String> {
        let path = self.run_filepath(run);
        // Partial checkpoints are rewritten often during a run, so keep them
        // compact; the final record is pretty-printed for readability (A-37).
        let content = if run.status == "running" {
            serde_json::to_string(run)
        } else {
            serde_json::to_string_pretty(run)
        }
        .map_err(|e| e.to_string())?;
        write_atomic(&path, content.as_bytes())
    }

    /// Every run with full results, newest first.
    pub fn load_all_runs(&self) -> Vec<AuditRun> {
        self.history_entries(&self.history_dir(), RUN_PREFIX)
            .into_iter()
            .filter_map(|e| read_json::<AuditRun>(&e.path))
            .collect()
    }

    /// The `limit` most recent runs across all audits, without results.
    pub fn load_recent_runs(&self, limit: usize) -> Vec<AuditRun> {
        self.history_entries(&self.history_dir(), RUN_PREFIX)
            .into_iter()
            .filter_map(|e| read_json::<AuditRunHeader>(&e.path))
            .take(limit)
            .map(AuditRun::from)
            .collect()
    }

    /// Runs of a single audit, newest first, without results. The audit filter
    /// is applied before `limit`, so an audit's history is never truncated by
    /// runs of other audits.
    pub fn load_audit_runs(&self, audit_id: &str, limit: Option<usize>) -> Vec<AuditRun> {
        self.history_entries(&self.history_dir(), RUN_PREFIX)
            .into_iter()
            .filter_map(|e| read_json::<AuditRunHeader>(&e.path))
            .filter(|h| h.audit_id == audit_id)
            .take(limit.unwrap_or(usize::MAX))
            .map(AuditRun::from)
            .collect()
    }

    pub fn list_run_files(&self) -> Vec<RunFileInfo> {
        self.history_entries(&self.history_dir(), RUN_PREFIX)
            .into_iter()
            .map(|e| {
                let (id, started) = match e.name.timestamp {
                    Some(ts) => (e.name.id, Some(ts)),
                    None => match read_json::<HistoryHeader>(&e.path) {
                        Some(h) if !h.id.is_empty() => {
                            let ts = parse_rfc3339_utc(&h.started_at).or(Some(e.sort_ts));
                            (h.id, ts)
                        }
                        _ => (e.name.id, Some(e.sort_ts)),
                    },
                };
                let started = started.unwrap_or(e.sort_ts);
                RunFileInfo {
                    id,
                    started_at: started.to_rfc3339(),
                    timestamp_ms: started.timestamp_millis(),
                }
            })
            .collect()
    }

    pub fn load_run(&self, run_id: &str) -> Result<AuditRun, String> {
        let path = Self::filepath_by_id(&self.history_dir(), run_id)
            .ok_or_else(|| "Run not found".to_string())?;
        let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
        serde_json::from_str(&content).map_err(|e| e.to_string())
    }

    pub fn delete_run(&self, run_id: &str) -> Result<(), String> {
        if let Some(path) = Self::filepath_by_id(&self.history_dir(), run_id) {
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
        for e in self.history_entries(&self.history_dir(), RUN_PREFIX) {
            if let Some(h) = read_json::<HistoryHeader>(&e.path) {
                if h.audit_id == audit_id {
                    std::fs::remove_file(&e.path).ok();
                }
            }
        }
        Ok(())
    }

    // ----- Retention --------------------------------------------------------

    /// Delete history files (audit runs, accessibility reports and link-check
    /// scans) older than `max_days`. `max_days == 0` means "keep forever" and
    /// deletes nothing. The date comes from the file name; files with a
    /// non-standard name fall back to their `startedAt` field, then to the
    /// file's modification time. Returns the number of files removed.
    ///
    /// Also removes temporary files left behind by an interrupted
    /// [`write_atomic`].
    pub fn prune_history(&self, max_days: u32) -> Result<usize, String> {
        let mut removed = 0;
        for dir in [
            self.dir.clone(),
            self.history_dir(),
            self.a11y_history_dir(),
            self.link_checks_dir(),
        ] {
            removed += Self::remove_stale_temp_files(&dir);
        }
        if max_days == 0 {
            return Ok(removed);
        }
        let cutoff = Utc::now() - chrono::Duration::days(max_days as i64);
        for (dir, prefix) in [
            (self.history_dir(), RUN_PREFIX),
            (self.a11y_history_dir(), A11Y_PREFIX),
            (self.link_checks_dir(), LINKCHECK_PREFIX),
        ] {
            for e in self.history_entries(&dir, prefix) {
                let ts = e.name.timestamp.or_else(|| {
                    read_json::<HistoryHeader>(&e.path)
                        .and_then(|h| parse_rfc3339_utc(&h.started_at))
                        .or_else(|| file_mtime(&e.path))
                });
                if matches!(ts, Some(ts) if ts < cutoff) && std::fs::remove_file(&e.path).is_ok() {
                    removed += 1;
                }
            }
        }
        Ok(removed)
    }

    /// Remove `write_atomic` temp files older than one hour (a write in
    /// progress is never that old).
    fn remove_stale_temp_files(dir: &Path) -> usize {
        let cutoff = Utc::now() - chrono::Duration::hours(1);
        let mut removed = 0;
        if let Ok(entries) = std::fs::read_dir(dir) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                if name.starts_with('.') && name.contains(TMP_MARKER) {
                    let path = entry.path();
                    if matches!(file_mtime(&path), Some(t) if t < cutoff)
                        && std::fs::remove_file(&path).is_ok()
                    {
                        removed += 1;
                    }
                }
            }
        }
        removed
    }

    // ----- Accessibility reports -------------------------------------------

    fn a11y_report_filepath(&self, report: &A11yReport) -> PathBuf {
        let ts = format_datetime_for_filename(&report.started_at);
        self.a11y_history_dir()
            .join(format!("{}{}-{}.json", A11Y_PREFIX, ts, report.id))
    }

    pub fn save_a11y_report(&self, report: &A11yReport) -> Result<(), String> {
        let path = self.a11y_report_filepath(report);
        let content = serde_json::to_string_pretty(report).map_err(|e| e.to_string())?;
        write_atomic(&path, content.as_bytes())
    }

    pub fn load_a11y_report(&self, report_id: &str) -> Result<A11yReport, String> {
        let path = Self::filepath_by_id(&self.a11y_history_dir(), report_id)
            .ok_or_else(|| "Report not found".to_string())?;
        let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
        serde_json::from_str(&content).map_err(|e| e.to_string())
    }

    /// Report headers, newest first (by the timestamp in the file name). Each
    /// file is parsed once, into a header that skips the results.
    pub fn list_a11y_reports(&self) -> Vec<A11yReportInfo> {
        self.history_entries(&self.a11y_history_dir(), A11Y_PREFIX)
            .into_iter()
            .map(|e| {
                let header = read_json::<HistoryHeader>(&e.path);
                let (id, audit_id, started_at) = match header {
                    Some(h) => (
                        if h.id.is_empty() { e.name.id } else { h.id },
                        h.audit_id,
                        h.started_at,
                    ),
                    None => (e.name.id, String::new(), String::new()),
                };
                A11yReportInfo {
                    id,
                    audit_id,
                    started_at,
                    timestamp_ms: e.sort_ts.timestamp_millis(),
                }
            })
            .collect()
    }

    pub fn delete_a11y_report(&self, report_id: &str) -> Result<(), String> {
        if let Some(path) = Self::filepath_by_id(&self.a11y_history_dir(), report_id) {
            std::fs::remove_file(&path).map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    pub fn delete_a11y_audit_reports(&self, audit_id: &str) -> Result<(), String> {
        for e in self.history_entries(&self.a11y_history_dir(), A11Y_PREFIX) {
            if let Some(h) = read_json::<HistoryHeader>(&e.path) {
                if h.audit_id == audit_id {
                    std::fs::remove_file(&e.path).ok();
                }
            }
        }
        Ok(())
    }

    // ----- Link-check scans -------------------------------------------------

    fn link_check_filepath(&self, scan: &LinkCheckScan) -> PathBuf {
        let ts = format_datetime_for_filename(&scan.started_at);
        self.link_checks_dir()
            .join(format!("{}{}-{}.json", LINKCHECK_PREFIX, ts, scan.id))
    }

    pub fn save_link_check_scan(&self, scan: &LinkCheckScan) -> Result<(), String> {
        let path = self.link_check_filepath(scan);
        let content = serde_json::to_string_pretty(scan).map_err(|e| e.to_string())?;
        write_atomic(&path, content.as_bytes())
    }

    pub fn load_link_check_scan(&self, scan_id: &str) -> Result<LinkCheckScan, String> {
        let path = Self::filepath_by_id(&self.link_checks_dir(), scan_id)
            .ok_or_else(|| "Scan not found".to_string())?;
        let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
        serde_json::from_str(&content).map_err(|e| e.to_string())
    }

    pub fn list_link_check_scans(&self) -> Vec<LinkCheckScanInfo> {
        self.history_entries(&self.link_checks_dir(), LINKCHECK_PREFIX)
            .into_iter()
            .map(|e| {
                let scan = read_json::<LinkCheckScanLite>(&e.path);
                let id = match (&e.name.timestamp, read_json::<HistoryHeader>(&e.path)) {
                    (None, Some(h)) if !h.id.is_empty() => h.id,
                    _ => e.name.id,
                };
                let (url, started_at, total, broken, a11y) = scan
                    .map(|s| {
                        let broken = s
                            .results
                            .iter()
                            .filter(|r| {
                                r.status.map(|x| x >= 400).unwrap_or(false) || r.error.is_some()
                            })
                            .count();
                        let a11y = s.results.iter().map(|r| r.a11y_issues.len()).sum();
                        (s.url, s.started_at, s.results.len(), broken, a11y)
                    })
                    .unwrap_or_default();
                LinkCheckScanInfo {
                    id,
                    url,
                    started_at,
                    timestamp_ms: e.sort_ts.timestamp_millis(),
                    total_links: total,
                    broken,
                    a11y_issues: a11y,
                }
            })
            .collect()
    }

    pub fn delete_link_check_scan(&self, scan_id: &str) -> Result<(), String> {
        if let Some(path) = Self::filepath_by_id(&self.link_checks_dir(), scan_id) {
            std::fs::remove_file(&path).map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    // ----- Legacy migration -------------------------------------------------

    pub fn migrate_old_history(&self) -> Result<(), String> {
        let old_path = self.dir.join("history.json");
        if !old_path.exists() {
            return Ok(());
        }
        let content = std::fs::read_to_string(&old_path).map_err(|e| e.to_string())?;
        match serde_json::from_str::<Vec<AuditRun>>(&content) {
            Ok(runs) => {
                for run in &runs {
                    self.save_run(run)?;
                }
                std::fs::remove_file(&old_path).ok();
            }
            Err(e) => {
                // Never delete data we could not read; move it aside instead.
                let backup = self.corrupt_backup_path("history.json");
                let moved = std::fs::rename(&old_path, &backup).is_ok();
                self.warn(format!(
                    "Legacy history.json could not be migrated ({}).{}",
                    e,
                    if moved {
                        format!(" It was kept as {}.", backup.display())
                    } else {
                        String::new()
                    }
                ));
            }
        }
        Ok(())
    }

    // ----- data.json --------------------------------------------------------

    fn corrupt_backup_path(&self, file_name: &str) -> PathBuf {
        let ts = Utc::now().timestamp();
        let mut path = self.dir.join(format!("{}.corrupt-{}", file_name, ts));
        let mut n = 1;
        while path.exists() {
            path = self.dir.join(format!("{}.corrupt-{}-{}", file_name, ts, n));
            n += 1;
        }
        path
    }

    /// Load `data.json`.
    ///
    /// A missing file yields empty data. A file that cannot be read or parsed
    /// is never silently discarded: it is renamed to
    /// `data.json.corrupt-<unix ts>`, a warning is recorded (see
    /// [`Storage::warnings`]), and the last good copy (`data.json.bak`) is
    /// restored when it parses. If the bad file cannot be moved aside, saving
    /// is disabled for the session so it is not overwritten.
    pub fn load(&self) -> AppData {
        let path = self.data_path();
        if !path.exists() {
            return AppData::empty();
        }
        let parsed = std::fs::read_to_string(&path)
            .map_err(|e| format!("could not be read: {}", e))
            .and_then(|content| {
                serde_json::from_str::<AppData>(&content)
                    .map_err(|e| format!("could not be parsed: {}", e))
            });
        match parsed {
            Ok(data) => self.check_version(data),
            Err(reason) => self.recover_from_bad_data_file(&path, &reason),
        }
    }

    fn check_version(&self, mut data: AppData) -> AppData {
        if data.version > DATA_SCHEMA_VERSION {
            self.save_blocked.store(true, Ordering::SeqCst);
            self.warn(format!(
                "data.json was written by a newer version of the app (schema {} > {}). \
                 Changes will not be saved, to avoid losing data. Please update the app.",
                data.version, DATA_SCHEMA_VERSION
            ));
        } else {
            data.version = DATA_SCHEMA_VERSION;
        }
        data
    }

    fn recover_from_bad_data_file(&self, path: &Path, reason: &str) -> AppData {
        let backup = self.corrupt_backup_path("data.json");
        match std::fs::rename(path, &backup) {
            Ok(()) => self.warn(format!(
                "Your saved data (data.json) {}. The file was moved to {} so nothing is lost.",
                reason,
                backup.display()
            )),
            Err(e) => {
                self.save_blocked.store(true, Ordering::SeqCst);
                self.warn(format!(
                    "Your saved data (data.json) {}, and it could not be backed up ({}). \
                     Saving is disabled for this session so the file is not overwritten.",
                    reason, e
                ));
                return AppData::empty();
            }
        }

        if let Some(data) = read_json::<AppData>(&self.data_backup_path()) {
            self.warn(format!(
                "Restored data from the last backup ({}). Changes made just before the \
                 problem may be missing.",
                self.data_backup_path().display()
            ));
            return self.check_version(data);
        }
        self.warn("No usable backup was found; starting with empty data.".to_string());
        AppData::empty()
    }

    pub fn save(&self, data: &AppData) -> Result<(), String> {
        if self.save_blocked.load(Ordering::SeqCst) {
            return Err(
                "Saving is disabled because data.json could not be loaded safely. \
                 See the storage warning for details."
                    .to_string(),
            );
        }
        let content = serde_json::to_string_pretty(data).map_err(|e| e.to_string())?;
        let path = self.data_path();
        // Keep a copy of the last good save. data.json is only ever written
        // atomically, so the copy is a complete file.
        if path.exists() {
            let _ = std::fs::copy(&path, self.data_backup_path());
        }
        write_atomic(&path, content.as_bytes())
    }
}

#[cfg(test)]
pub(crate) mod test_util {
    use std::path::PathBuf;

    /// A unique temporary directory removed on drop.
    pub struct TempDir(pub PathBuf);

    impl TempDir {
        pub fn new() -> Self {
            let p = std::env::temp_dir().join(format!("lca-test-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir_all(&p).unwrap();
            Self(p)
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::test_util::TempDir;
    use super::*;
    use crate::models::TargetList;

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

    #[test]
    fn parse_history_name_extracts_full_uuid_and_timestamp() {
        let n = parse_history_name(
            "run-2026-06-07_09-19-56-0a1b2c3d-1111-2222-3333-444455556666.json",
            RUN_PREFIX,
        )
        .unwrap();
        assert_eq!(n.id, "0a1b2c3d-1111-2222-3333-444455556666");
        assert_eq!(
            n.timestamp.unwrap().to_rfc3339(),
            "2026-06-07T09:19:56+00:00"
        );
        assert!(parse_history_name("other.json", RUN_PREFIX).is_none());
        assert!(parse_history_name(".run-x.json.tmp-1-2", RUN_PREFIX).is_none());
    }

    fn sample_data() -> AppData {
        let mut d = AppData::empty();
        d.target_lists.push(TargetList {
            id: "t1".into(),
            name: "List".into(),
            urls: vec!["https://a.test".into()],
            created_at: "x".into(),
            updated_at: "x".into(),
            pinned: false,
            folder: None,
        });
        d
    }

    // Built from JSON so the helpers keep compiling when fields are added.
    fn run(id: &str, audit_id: &str, started_at: &str) -> AuditRun {
        serde_json::from_value(serde_json::json!({
            "id": id, "auditId": audit_id, "startedAt": started_at,
            "completedAt": null, "status": "completed", "results": []
        }))
        .unwrap()
    }

    fn report(id: &str, audit_id: &str, started_at: &str) -> A11yReport {
        serde_json::from_value(serde_json::json!({
            "id": id, "auditId": audit_id, "startedAt": started_at,
            "completedAt": null, "status": "completed", "results": []
        }))
        .unwrap()
    }

    #[test]
    fn write_atomic_replaces_content_and_leaves_no_temp_files() {
        let t = TempDir::new();
        let p = t.0.join("f.json");
        write_atomic(&p, b"one").unwrap();
        write_atomic(&p, b"two").unwrap();
        assert_eq!(std::fs::read_to_string(&p).unwrap(), "two");
        let names: Vec<_> = std::fs::read_dir(&t.0)
            .unwrap()
            .flatten()
            .map(|e| e.file_name())
            .collect();
        assert_eq!(names.len(), 1);
    }

    #[test]
    fn save_and_load_round_trip() {
        let t = TempDir::new();
        let s = Storage::new(t.0.clone());
        s.save(&sample_data()).unwrap();
        let loaded = s.load();
        assert_eq!(loaded.target_lists.len(), 1);
        assert!(s.warnings().is_empty());
    }

    #[test]
    fn corrupt_data_file_is_backed_up_and_reported() {
        let t = TempDir::new();
        std::fs::write(t.0.join("data.json"), "{ not json").unwrap();
        let s = Storage::new(t.0.clone());
        let data = s.load();
        assert!(data.target_lists.is_empty());
        assert!(!t.0.join("data.json").exists());
        let backups: Vec<_> = std::fs::read_dir(&t.0)
            .unwrap()
            .flatten()
            .filter(|e| {
                e.file_name()
                    .to_string_lossy()
                    .starts_with("data.json.corrupt-")
            })
            .collect();
        assert_eq!(backups.len(), 1);
        assert_eq!(
            std::fs::read_to_string(backups[0].path()).unwrap(),
            "{ not json"
        );
        assert!(!s.warnings().is_empty());
        // Saving afterwards is allowed and does not touch the backup.
        s.save(&data).unwrap();
        assert!(backups[0].path().exists());
    }

    #[test]
    fn corrupt_data_file_restores_from_bak() {
        let t = TempDir::new();
        let s = Storage::new(t.0.clone());
        s.save(&sample_data()).unwrap();
        s.save(&sample_data()).unwrap(); // creates data.json.bak
        assert!(t.0.join("data.json.bak").exists());
        std::fs::write(t.0.join("data.json"), "").unwrap(); // truncated
        let s = Storage::new(t.0.clone());
        let data = s.load();
        assert_eq!(data.target_lists.len(), 1);
        assert_eq!(s.warnings().len(), 2);
    }

    #[test]
    fn newer_schema_blocks_saves() {
        let t = TempDir::new();
        std::fs::write(
            t.0.join("data.json"),
            format!("{{\"version\": {}}}", DATA_SCHEMA_VERSION + 1),
        )
        .unwrap();
        let s = Storage::new(t.0.clone());
        let data = s.load();
        assert!(s.save(&data).is_err());
        assert!(!s.warnings().is_empty());
    }

    #[test]
    fn legacy_data_without_version_is_upgraded() {
        let t = TempDir::new();
        std::fs::write(
            t.0.join("data.json"),
            r#"{"target_lists":[],"check_templates":[],"audits":[]}"#,
        )
        .unwrap();
        let s = Storage::new(t.0.clone());
        let data = s.load();
        assert_eq!(data.version, DATA_SCHEMA_VERSION);
        assert!(s.warnings().is_empty());
    }

    #[test]
    fn audit_runs_are_filtered_before_limit() {
        let t = TempDir::new();
        let s = Storage::new(t.0.clone());
        s.save_run(&run("old-a", "A", "2026-01-01T00:00:00Z"))
            .unwrap();
        for i in 0..5 {
            s.save_run(&run(
                &format!("b{}", i),
                "B",
                &format!("2026-02-0{}T00:00:00Z", i + 1),
            ))
            .unwrap();
        }
        assert_eq!(s.load_recent_runs(3).len(), 3);
        let a = s.load_audit_runs("A", Some(3));
        assert_eq!(a.len(), 1);
        assert_eq!(a[0].id, "old-a");
        let b = s.load_audit_runs("B", None);
        assert_eq!(b.len(), 5);
        assert_eq!(b[0].id, "b4"); // newest first
    }

    #[test]
    fn list_run_files_uses_filename_timestamp_and_full_id() {
        let t = TempDir::new();
        let s = Storage::new(t.0.clone());
        let id = "0a1b2c3d-1111-2222-3333-444455556666";
        s.save_run(&run(id, "A", "2026-03-04T05:06:07Z")).unwrap();
        s.save_run(&run("x", "A", "2026-03-05T05:06:07Z")).unwrap();
        let files = s.list_run_files();
        assert_eq!(files.len(), 2);
        assert_eq!(files[0].id, "x");
        assert_eq!(files[1].id, id);
        assert_eq!(files[1].started_at, "2026-03-04T05:06:07+00:00");
        assert!(s.load_run(id).is_ok());
    }

    #[test]
    fn list_a11y_reports_sorted_newest_first() {
        let t = TempDir::new();
        let s = Storage::new(t.0.clone());
        s.save_a11y_report(&report("r1", "A", "2026-01-01T00:00:00Z"))
            .unwrap();
        s.save_a11y_report(&report("r2", "B", "2026-01-02T00:00:00Z"))
            .unwrap();
        let list = s.list_a11y_reports();
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].id, "r2");
        assert_eq!(list[0].audit_id, "B");
        assert_eq!(list[1].started_at, "2026-01-01T00:00:00Z");
    }

    #[test]
    fn prune_covers_all_history_dirs_and_zero_keeps_forever() {
        let t = TempDir::new();
        let s = Storage::new(t.0.clone());
        s.save_run(&run("old", "A", "2000-01-01T00:00:00Z"))
            .unwrap();
        let recent = Utc::now().to_rfc3339();
        s.save_run(&run("new", "A", &recent)).unwrap();
        s.save_a11y_report(&report("old-r", "A", "2000-01-01T00:00:00Z"))
            .unwrap();
        let scan: LinkCheckScan = serde_json::from_value(serde_json::json!({
            "id": "old-l", "url": "https://a.test", "maxDepth": 1,
            "sameOriginOnly": true, "includeAccessibility": false,
            "startedAt": "2000-01-01T00:00:00Z", "completedAt": null, "results": []
        }))
        .unwrap();
        s.save_link_check_scan(&scan).unwrap();

        assert_eq!(s.prune_history(0).unwrap(), 0);
        assert_eq!(s.load_recent_runs(10).len(), 2);

        assert_eq!(s.prune_history(30).unwrap(), 3);
        let runs = s.load_recent_runs(10);
        assert_eq!(runs.len(), 1);
        assert_eq!(runs[0].id, "new");
        assert!(s.list_a11y_reports().is_empty());
        assert!(s.list_link_check_scans().is_empty());
    }

    #[test]
    fn migrate_keeps_unparseable_legacy_history() {
        let t = TempDir::new();
        std::fs::write(t.0.join("history.json"), "garbage").unwrap();
        let s = Storage::new(t.0.clone());
        s.migrate_old_history().unwrap();
        assert!(!t.0.join("history.json").exists());
        assert!(std::fs::read_dir(&t.0).unwrap().flatten().any(|e| e
            .file_name()
            .to_string_lossy()
            .starts_with("history.json.corrupt-")));
    }
}
