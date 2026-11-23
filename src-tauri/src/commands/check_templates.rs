use chrono::Utc;
use serde::Deserialize;
use std::collections::HashSet;
use tauri::State;
use uuid::Uuid;

use crate::models::{A11yCheckConfig, AppData, CheckTemplate, CheckType, SelectorCheck};
use crate::AppState;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckInput {
    /// Existing check ID. Kept as-is so run results stay matched to the check
    /// across template edits; a new ID is generated when absent or duplicated.
    #[serde(default)]
    pub id: Option<String>,
    pub selector: String,
    pub label: String,
    pub check_type: Option<CheckType>,
    pub expected_status: Option<u16>,
    pub pattern: Option<String>,
    pub attribute_name: Option<String>,
    pub attribute_value: Option<String>,
    pub a11y_config: Option<A11yCheckConfig>,
}

/// Build checks from input, preserving incoming IDs. Checks without an ID (or
/// with an empty or already-used one) get a fresh UUID.
pub(crate) fn build_checks(inputs: Vec<CheckInput>) -> Vec<SelectorCheck> {
    let mut seen: HashSet<String> = HashSet::new();
    inputs
        .into_iter()
        .map(|c| {
            let id = match c.id {
                Some(id) if !id.trim().is_empty() && !seen.contains(&id) => id,
                _ => Uuid::new_v4().to_string(),
            };
            seen.insert(id.clone());
            SelectorCheck {
                id,
                selector: c.selector,
                label: c.label,
                check_type: c.check_type.unwrap_or_default(),
                expected_status: c.expected_status,
                pattern: c.pattern,
                attribute_name: c.attribute_name,
                attribute_value: c.attribute_value,
                a11y_config: c.a11y_config,
            }
        })
        .collect()
}

pub(crate) fn new_check_template(
    name: String,
    checks: Vec<CheckInput>,
    pinned: bool,
    folder: Option<String>,
) -> CheckTemplate {
    let now = Utc::now().to_rfc3339();
    CheckTemplate {
        id: Uuid::new_v4().to_string(),
        name,
        checks: build_checks(checks),
        created_at: now.clone(),
        updated_at: now,
        pinned,
        folder,
    }
}

pub(crate) fn apply_check_template_update(
    data: &mut AppData,
    id: &str,
    name: Option<String>,
    checks: Option<Vec<CheckInput>>,
    pinned: Option<bool>,
    folder: Option<Option<String>>,
) -> Result<CheckTemplate, String> {
    let template = data
        .check_templates
        .iter_mut()
        .find(|t| t.id == id)
        .ok_or_else(|| "Check template not found".to_string())?;

    if let Some(name) = name {
        template.name = name;
    }
    if let Some(checks) = checks {
        template.checks = build_checks(checks);
    }
    if let Some(pinned) = pinned {
        template.pinned = pinned;
    }
    if let Some(folder) = crate::commands::clearable(folder) {
        template.folder = folder;
    }
    template.updated_at = Utc::now().to_rfc3339();
    Ok(template.clone())
}

/// Remove a check template. Refuses (and changes nothing) while any audit
/// still uses it, listing the dependent audits in the error.
pub(crate) fn remove_check_template(data: &mut AppData, id: &str) -> Result<(), String> {
    let dependents: Vec<&str> = data
        .audits
        .iter()
        .filter(|a| a.check_template_id == id)
        .map(|a| a.name.as_str())
        .collect();
    if !dependents.is_empty() {
        return Err(format!(
            "This check template is used by {} audit(s): {}. Delete or change those audits first.",
            dependents.len(),
            dependents.join(", ")
        ));
    }
    data.check_templates.retain(|t| t.id != id);
    Ok(())
}

#[tauri::command]
pub fn list_check_templates(state: State<'_, AppState>) -> Result<Vec<CheckTemplate>, String> {
    Ok(state.lock_data().check_templates.clone())
}

#[tauri::command]
pub fn create_check_template(
    state: State<'_, AppState>,
    name: String,
    checks: Vec<CheckInput>,
    pinned: bool,
    folder: Option<String>,
) -> Result<CheckTemplate, String> {
    let template = new_check_template(name, checks, pinned, folder);
    state.mutate_data(|data| {
        data.check_templates.push(template.clone());
        Ok(())
    })?;
    Ok(template)
}

#[tauri::command]
pub fn update_check_template(
    state: State<'_, AppState>,
    id: String,
    name: Option<String>,
    checks: Option<Vec<CheckInput>>,
    pinned: Option<bool>,
    folder: Option<Option<String>>,
) -> Result<CheckTemplate, String> {
    state.mutate_data(|data| apply_check_template_update(data, &id, name, checks, pinned, folder))
}

#[tauri::command]
pub fn delete_check_template(state: State<'_, AppState>, id: String) -> Result<(), String> {
    state.mutate_data(|data| remove_check_template(data, &id))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{Audit, AuditConfig};

    fn input(json: &str) -> CheckInput {
        serde_json::from_str(json).unwrap()
    }

    #[test]
    fn check_input_accepts_javascript_type_from_frontend() {
        let c = input(r#"{"selector":"return 1","label":"JS","checkType":"javascript"}"#);
        assert_eq!(c.check_type, Some(CheckType::JavaScript));
    }

    #[test]
    fn build_checks_preserves_ids_and_fills_missing() {
        let checks = build_checks(vec![
            input(r#"{"id":"keep-1","selector":"h1","label":"a"}"#),
            input(r#"{"selector":"h2","label":"b"}"#),
            input(r#"{"id":"","selector":"h3","label":"c"}"#),
            input(r#"{"id":"keep-1","selector":"h4","label":"dup"}"#),
        ]);
        assert_eq!(checks[0].id, "keep-1");
        assert!(!checks[1].id.is_empty());
        assert!(!checks[2].id.is_empty());
        assert_ne!(checks[3].id, "keep-1");
        let ids: HashSet<_> = checks.iter().map(|c| c.id.clone()).collect();
        assert_eq!(ids.len(), 4);
        assert_eq!(checks[1].check_type, CheckType::Selector);
    }

    #[test]
    fn update_keeps_check_ids_across_saves() {
        let mut data = AppData::empty();
        let t = new_check_template(
            "T".into(),
            vec![input(r#"{"selector":"h1","label":"a"}"#)],
            false,
            None,
        );
        let tid = t.id.clone();
        let cid = t.checks[0].id.clone();
        data.check_templates.push(t);

        let updated = apply_check_template_update(
            &mut data,
            &tid,
            Some("T2".into()),
            Some(vec![
                input(&format!(
                    r#"{{"id":"{}","selector":"h1.x","label":"a"}}"#,
                    cid
                )),
                input(r#"{"selector":"h2","label":"new"}"#),
            ]),
            Some(true),
            Some(Some("f".into())),
        )
        .unwrap();
        assert_eq!(updated.name, "T2");
        assert_eq!(updated.checks[0].id, cid);
        assert_eq!(updated.checks[0].selector, "h1.x");
        assert_ne!(updated.checks[1].id, cid);
        assert!(updated.pinned);
        assert_eq!(updated.folder.as_deref(), Some("f"));
        assert_eq!(data.check_templates[0].checks.len(), 2);
    }

    #[test]
    fn update_without_checks_leaves_checks_untouched() {
        let mut data = AppData::empty();
        let t = new_check_template(
            "T".into(),
            vec![input(r#"{"selector":"h1","label":"a"}"#)],
            false,
            None,
        );
        let tid = t.id.clone();
        let cid = t.checks[0].id.clone();
        data.check_templates.push(t);
        apply_check_template_update(&mut data, &tid, None, None, None, None).unwrap();
        assert_eq!(data.check_templates[0].checks[0].id, cid);
        assert!(apply_check_template_update(&mut data, "missing", None, None, None, None).is_err());
    }

    #[test]
    fn delete_blocked_while_audits_reference_template() {
        let mut data = AppData::empty();
        let t = new_check_template("T".into(), vec![], false, None);
        let tid = t.id.clone();
        data.check_templates.push(t);
        data.audits.push(Audit {
            id: "a1".into(),
            name: "Uses it".into(),
            target_list_id: "t".into(),
            check_template_id: tid.clone(),
            config: AuditConfig::default(),
            origin_override: None,
            url_postfix: None,
            created_at: "x".into(),
            pinned: false,
            folder: None,
            baseline_run_id: None,
        });
        let err = remove_check_template(&mut data, &tid).unwrap_err();
        assert!(err.contains("Uses it"));
        assert_eq!(data.check_templates.len(), 1);
        data.audits.clear();
        remove_check_template(&mut data, &tid).unwrap();
        assert!(data.check_templates.is_empty());
    }
}
