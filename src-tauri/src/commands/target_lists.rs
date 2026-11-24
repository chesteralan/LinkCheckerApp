use chrono::Utc;
use tauri::State;
use uuid::Uuid;

use crate::models::{AppData, TargetList};
use crate::AppState;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_normalize_url_already_https() {
        assert_eq!(normalize_url("https://example.com"), "https://example.com");
    }

    #[test]
    fn test_normalize_url_already_http() {
        assert_eq!(normalize_url("http://example.com"), "http://example.com");
    }

    #[test]
    fn test_normalize_url_adds_https() {
        assert_eq!(normalize_url("example.com"), "https://example.com");
    }

    #[test]
    fn test_normalize_url_trimmed() {
        assert_eq!(normalize_url("  example.com  "), "https://example.com");
    }

    #[test]
    fn test_normalize_url_empty() {
        assert_eq!(normalize_url(""), "");
    }

    #[test]
    fn test_normalize_url_whitespace() {
        assert_eq!(normalize_url("   "), "");
    }

    use crate::models::{A11yAudit, A11yCheckConfig, Audit, AuditConfig};

    fn audit(id: &str, target_list_id: &str) -> Audit {
        Audit {
            id: id.into(),
            name: format!("Audit {}", id),
            target_list_id: target_list_id.into(),
            check_template_id: "c1".into(),
            config: AuditConfig::default(),
            origin_override: None,
            url_postfix: None,
            created_at: "x".into(),
            pinned: false,
            folder: None,
            baseline_run_id: None,
        }
    }

    #[test]
    fn create_normalizes_and_drops_empty_urls() {
        let l = new_target_list("L".into(), &["a.test".into(), "  ".into()], true, None);
        assert_eq!(l.urls, vec!["https://a.test"]);
        assert!(l.pinned);
        assert!(!l.id.is_empty());
    }

    #[test]
    fn update_normalizes_urls_and_clears_folder() {
        let mut data = AppData::empty();
        let mut l = new_target_list("L".into(), &[], false, Some("f".into()));
        l.id = "t1".into();
        data.target_lists.push(l);
        let updated = apply_target_list_update(
            &mut data,
            "t1",
            Some("New".into()),
            Some(vec!["b.test".into(), "".into()]),
            Some(true),
            Some(None),
        )
        .unwrap();
        assert_eq!(updated.name, "New");
        assert_eq!(updated.urls, vec!["https://b.test"]);
        assert!(updated.pinned);
        assert_eq!(updated.folder, None);
        assert_eq!(data.target_lists[0].name, "New");
    }

    #[test]
    fn update_missing_list_errors() {
        let mut data = AppData::empty();
        assert!(apply_target_list_update(&mut data, "nope", None, None, None, None).is_err());
    }

    #[test]
    fn delete_blocked_while_audits_reference_list() {
        let mut data = AppData::empty();
        let mut l = new_target_list("L".into(), &[], false, None);
        l.id = "t1".into();
        data.target_lists.push(l);
        data.audits.push(audit("a1", "t1"));
        data.a11y_audits.push(A11yAudit {
            id: "y1".into(),
            name: "Y".into(),
            target_list_id: "t1".into(),
            engine: "static".into(),
            a11y_config: A11yCheckConfig::default(),
            config: AuditConfig::default(),
            origin_override: None,
            url_postfix: None,
            created_at: "x".into(),
            pinned: false,
            folder: None,
        });
        let err = remove_target_list(&mut data, "t1").unwrap_err();
        assert!(err.contains("2 audit(s)"));
        assert_eq!(data.target_lists.len(), 1);

        data.audits.clear();
        data.a11y_audits.clear();
        remove_target_list(&mut data, "t1").unwrap();
        assert!(data.target_lists.is_empty());
    }
}

fn normalize_url(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return trimmed.to_string();
    }
    if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        trimmed.to_string()
    } else {
        format!("https://{}", trimmed)
    }
}

fn normalize_urls(urls: &[String]) -> Vec<String> {
    urls.iter()
        .map(|u| normalize_url(u))
        .filter(|u| !u.is_empty())
        .collect()
}

/// Names of audits (link and accessibility) that use the target list `id`.
pub(crate) fn target_list_dependents(data: &AppData, id: &str) -> Vec<String> {
    data.audits
        .iter()
        .filter(|a| a.target_list_id == id)
        .map(|a| a.name.clone())
        .chain(
            data.a11y_audits
                .iter()
                .filter(|a| a.target_list_id == id)
                .map(|a| format!("{} (accessibility)", a.name)),
        )
        .collect()
}

pub(crate) fn new_target_list(
    name: String,
    urls: &[String],
    pinned: bool,
    folder: Option<String>,
) -> TargetList {
    let now = Utc::now().to_rfc3339();
    TargetList {
        id: Uuid::new_v4().to_string(),
        name,
        urls: normalize_urls(urls),
        created_at: now.clone(),
        updated_at: now,
        pinned,
        folder,
    }
}

pub(crate) fn apply_target_list_update(
    data: &mut AppData,
    id: &str,
    name: Option<String>,
    urls: Option<Vec<String>>,
    pinned: Option<bool>,
    folder: Option<Option<String>>,
) -> Result<TargetList, String> {
    let list = data
        .target_lists
        .iter_mut()
        .find(|l| l.id == id)
        .ok_or_else(|| "Target list not found".to_string())?;

    if let Some(name) = name {
        list.name = name;
    }
    if let Some(urls) = urls {
        list.urls = normalize_urls(&urls);
    }
    if let Some(pinned) = pinned {
        list.pinned = pinned;
    }
    if let Some(folder) = crate::commands::clearable(folder) {
        list.folder = folder;
    }
    list.updated_at = Utc::now().to_rfc3339();
    Ok(list.clone())
}

/// Remove a target list. Refuses (and changes nothing) while any audit still
/// uses it, listing the dependent audits in the error.
pub(crate) fn remove_target_list(data: &mut AppData, id: &str) -> Result<(), String> {
    let dependents = target_list_dependents(data, id);
    if !dependents.is_empty() {
        return Err(format!(
            "This target list is used by {} audit(s): {}. Delete or change those audits first.",
            dependents.len(),
            dependents.join(", ")
        ));
    }
    data.target_lists.retain(|l| l.id != id);
    Ok(())
}

#[tauri::command]
pub fn list_target_lists(state: State<'_, AppState>) -> Result<Vec<TargetList>, String> {
    Ok(state.lock_data().target_lists.clone())
}

#[tauri::command]
pub fn create_target_list(
    state: State<'_, AppState>,
    name: String,
    urls: Vec<String>,
    pinned: bool,
    folder: Option<String>,
) -> Result<TargetList, String> {
    let list = new_target_list(name, &urls, pinned, folder);
    state.mutate_data(|data| {
        data.target_lists.push(list.clone());
        Ok(())
    })?;
    Ok(list)
}

#[tauri::command]
pub fn update_target_list(
    state: State<'_, AppState>,
    id: String,
    name: Option<String>,
    urls: Option<Vec<String>>,
    pinned: Option<bool>,
    folder: Option<Option<String>>,
) -> Result<TargetList, String> {
    state.mutate_data(|data| apply_target_list_update(data, &id, name, urls, pinned, folder))
}

#[tauri::command]
pub fn delete_target_list(state: State<'_, AppState>, id: String) -> Result<(), String> {
    state.mutate_data(|data| remove_target_list(data, &id))
}
