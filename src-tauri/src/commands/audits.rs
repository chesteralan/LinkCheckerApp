use chrono::Utc;
use serde::Deserialize;
use std::collections::HashMap;
use tauri::State;
use uuid::Uuid;

use crate::models::{AppData, Audit, AuditConfig};
use crate::AppState;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditConfigInput {
    pub mode: String,
    pub batch_size: u32,
    pub timeout_secs: u64,
    #[serde(default)]
    pub headers: HashMap<String, String>,
    #[serde(default)]
    pub cookies: Vec<crate::models::KeyValuePair>,
}

impl From<AuditConfigInput> for AuditConfig {
    /// Batch size and timeout are clamped to at least 1: a value of 0 would
    /// otherwise stall the run.
    fn from(c: AuditConfigInput) -> Self {
        AuditConfig {
            mode: c.mode,
            batch_size: c.batch_size.max(1),
            timeout_secs: c.timeout_secs.max(1),
            headers: c.headers,
            cookies: c.cookies,
        }
    }
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn new_audit(
    name: String,
    target_list_id: String,
    check_template_id: String,
    config: AuditConfigInput,
    origin_override: Option<String>,
    url_postfix: Option<String>,
    pinned: bool,
    folder: Option<String>,
    baseline_run_id: Option<String>,
) -> Audit {
    Audit {
        id: Uuid::new_v4().to_string(),
        name,
        target_list_id,
        check_template_id,
        config: config.into(),
        origin_override: origin_override.filter(|o| !o.is_empty()),
        url_postfix: url_postfix.filter(|p| !p.is_empty()),
        created_at: Utc::now().to_rfc3339(),
        pinned,
        folder,
        baseline_run_id,
    }
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn apply_audit_update(
    data: &mut AppData,
    id: &str,
    name: Option<String>,
    config: Option<AuditConfigInput>,
    origin_override: Option<String>,
    url_postfix: Option<String>,
    pinned: Option<bool>,
    folder: Option<Option<String>>,
    baseline_run_id: Option<Option<String>>,
) -> Result<Audit, String> {
    let audit = data
        .audits
        .iter_mut()
        .find(|a| a.id == id)
        .ok_or_else(|| "Audit not found".to_string())?;

    if let Some(name) = name {
        audit.name = name;
    }
    if let Some(config) = config {
        audit.config = config.into();
    }
    if let Some(oo) = origin_override {
        audit.origin_override = if oo.is_empty() { None } else { Some(oo) };
    }
    if let Some(up) = url_postfix {
        audit.url_postfix = if up.is_empty() { None } else { Some(up) };
    }
    if let Some(pinned) = pinned {
        audit.pinned = pinned;
    }
    if let Some(folder) = crate::commands::clearable(folder) {
        audit.folder = folder;
    }
    if let Some(baseline_run_id) = crate::commands::clearable(baseline_run_id) {
        audit.baseline_run_id = baseline_run_id;
    }
    Ok(audit.clone())
}

#[tauri::command]
pub fn list_audits(state: State<'_, AppState>) -> Result<Vec<Audit>, String> {
    Ok(state.lock_data().audits.clone())
}

#[allow(clippy::too_many_arguments)]
#[tauri::command(rename_all = "camelCase")]
pub fn create_audit(
    state: State<'_, AppState>,
    name: String,
    target_list_id: String,
    check_template_id: String,
    config: AuditConfigInput,
    origin_override: Option<String>,
    url_postfix: Option<String>,
    pinned: bool,
    folder: Option<String>,
    baseline_run_id: Option<String>,
) -> Result<Audit, String> {
    let audit = new_audit(
        name,
        target_list_id,
        check_template_id,
        config,
        origin_override,
        url_postfix,
        pinned,
        folder,
        baseline_run_id,
    );
    state.mutate_data(|data| {
        data.audits.push(audit.clone());
        Ok(())
    })?;
    Ok(audit)
}

#[allow(clippy::too_many_arguments)]
#[tauri::command(rename_all = "camelCase")]
pub fn update_audit(
    state: State<'_, AppState>,
    id: String,
    name: Option<String>,
    config: Option<AuditConfigInput>,
    origin_override: Option<String>,
    url_postfix: Option<String>,
    pinned: Option<bool>,
    folder: Option<Option<String>>,
    baseline_run_id: Option<Option<String>>,
) -> Result<Audit, String> {
    state.mutate_data(|data| {
        apply_audit_update(
            data,
            &id,
            name,
            config,
            origin_override,
            url_postfix,
            pinned,
            folder,
            baseline_run_id,
        )
    })
}

#[tauri::command]
pub fn delete_audit(state: State<'_, AppState>, id: String) -> Result<(), String> {
    state.mutate_data(|data| {
        data.audits.retain(|a| a.id != id);
        Ok(())
    })?;
    state.storage.delete_audit_runs(&id)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cfg(batch_size: u32, timeout_secs: u64) -> AuditConfigInput {
        AuditConfigInput {
            mode: "batch".into(),
            batch_size,
            timeout_secs,
            headers: HashMap::new(),
            cookies: Vec::new(),
        }
    }

    fn sample(data: &mut AppData) -> String {
        let a = new_audit(
            "A".into(),
            "t1".into(),
            "c1".into(),
            cfg(5, 10),
            Some(String::new()),
            Some("?x=1".into()),
            false,
            None,
            None,
        );
        let id = a.id.clone();
        data.audits.push(a);
        id
    }

    #[test]
    fn create_drops_empty_overrides() {
        let mut data = AppData::empty();
        sample(&mut data);
        let a = &data.audits[0];
        assert_eq!(a.origin_override, None);
        assert_eq!(a.url_postfix.as_deref(), Some("?x=1"));
        assert_eq!(a.config.batch_size, 5);
    }

    #[test]
    fn zero_batch_size_and_timeout_are_clamped() {
        let c: AuditConfig = cfg(0, 0).into();
        assert_eq!(c.batch_size, 1);
        assert_eq!(c.timeout_secs, 1);
    }

    #[test]
    fn update_applies_and_clears_fields() {
        let mut data = AppData::empty();
        let id = sample(&mut data);
        let updated = apply_audit_update(
            &mut data,
            &id,
            Some("B".into()),
            Some(cfg(3, 20)),
            Some("https://staging.test".into()),
            Some(String::new()),
            Some(true),
            Some(Some("folder".into())),
            Some(Some("run-1".into())),
        )
        .unwrap();
        assert_eq!(updated.name, "B");
        assert_eq!(updated.config.batch_size, 3);
        assert_eq!(updated.config.timeout_secs, 20);
        assert_eq!(
            updated.origin_override.as_deref(),
            Some("https://staging.test")
        );
        assert_eq!(updated.url_postfix, None);
        assert!(updated.pinned);
        assert_eq!(updated.folder.as_deref(), Some("folder"));
        assert_eq!(updated.baseline_run_id.as_deref(), Some("run-1"));

        let cleared = apply_audit_update(
            &mut data,
            &id,
            None,
            None,
            None,
            None,
            None,
            Some(None),
            Some(None),
        )
        .unwrap();
        assert_eq!(cleared.folder, None);
        assert_eq!(cleared.baseline_run_id, None);
        assert_eq!(cleared.name, "B");
    }

    #[test]
    fn update_missing_audit_errors() {
        let mut data = AppData::empty();
        assert!(
            apply_audit_update(&mut data, "nope", None, None, None, None, None, None, None)
                .is_err()
        );
    }
}
