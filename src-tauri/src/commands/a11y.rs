use chrono::Utc;
use serde::Deserialize;
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

use crate::a11y_runner::{build_report, emit_error, sanitize_audit_config};
use crate::models::{A11yAudit, A11yCheckConfig, A11yReport, A11yReportInfo, AuditConfig};
use crate::AppState;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct A11yAuditInput {
    pub name: String,
    pub target_list_id: String,
    pub engine: Option<String>,
    pub a11y_config: Option<A11yCheckConfig>,
    pub config: AuditConfig,
    pub origin_override: Option<String>,
    pub url_postfix: Option<String>,
    pub pinned: Option<bool>,
    pub folder: Option<String>,
}

#[tauri::command]
pub fn list_a11y_audits(state: State<'_, AppState>) -> Result<Vec<A11yAudit>, String> {
    Ok(state.lock_data().a11y_audits.clone())
}

#[tauri::command(rename_all = "camelCase")]
pub fn create_a11y_audit(
    state: State<'_, AppState>,
    input: A11yAuditInput,
) -> Result<A11yAudit, String> {
    let mut config = input.config;
    sanitize_audit_config(&mut config);
    let audit = A11yAudit {
        id: Uuid::new_v4().to_string(),
        name: input.name,
        target_list_id: input.target_list_id,
        engine: input.engine.unwrap_or_else(|| "static".into()),
        a11y_config: input.a11y_config.unwrap_or_default(),
        config,
        origin_override: input.origin_override.filter(|o| !o.is_empty()),
        url_postfix: input.url_postfix.filter(|p| !p.is_empty()),
        created_at: Utc::now().to_rfc3339(),
        pinned: input.pinned.unwrap_or(false),
        folder: input.folder,
    };

    state.mutate_data(|data| {
        data.a11y_audits.push(audit.clone());
        Ok(())
    })?;

    Ok(audit)
}

#[allow(clippy::too_many_arguments)]
#[tauri::command(rename_all = "camelCase")]
pub fn update_a11y_audit(
    state: State<'_, AppState>,
    id: String,
    name: Option<String>,
    target_list_id: Option<String>,
    engine: Option<String>,
    a11y_config: Option<A11yCheckConfig>,
    config: Option<AuditConfig>,
    origin_override: Option<String>,
    url_postfix: Option<String>,
    pinned: Option<bool>,
    folder: Option<Option<String>>,
) -> Result<A11yAudit, String> {
    state.mutate_data(|data| {
        let audit = data
            .a11y_audits
            .iter_mut()
            .find(|a| a.id == id)
            .ok_or_else(|| "Accessibility audit not found".to_string())?;

        if let Some(name) = name {
            audit.name = name;
        }
        if let Some(tl) = target_list_id {
            audit.target_list_id = tl;
        }
        if let Some(engine) = engine {
            audit.engine = engine;
        }
        if let Some(cfg) = a11y_config {
            audit.a11y_config = cfg;
        }
        if let Some(mut config) = config {
            sanitize_audit_config(&mut config);
            audit.config = config;
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

        Ok(audit.clone())
    })
}

#[tauri::command]
pub fn delete_a11y_audit(state: State<'_, AppState>, id: String) -> Result<(), String> {
    state.mutate_data(|data| {
        data.a11y_audits.retain(|a| a.id != id);
        Ok(())
    })?;
    state.storage.delete_a11y_audit_reports(&id)
}

/// Run an accessibility audit. Exactly one terminal event is emitted on every
/// exit path once the command is accepted: `a11y:complete` (completed),
/// `a11y:cancelled` followed by `a11y:complete` (cancelled), or `a11y:error`.
/// All events carry the job's `reportId`.
#[tauri::command(rename_all = "camelCase")]
pub async fn run_a11y_audit(
    app: AppHandle,
    state: State<'_, AppState>,
    audit_id: String,
) -> Result<(), String> {
    let lookup = (|| {
        let data = state.lock_data();
        let audit = data
            .a11y_audits
            .iter()
            .find(|a| a.id == audit_id)
            .ok_or_else(|| "Accessibility audit not found".to_string())?
            .clone();
        let target_list = data
            .target_lists
            .iter()
            .find(|tl| tl.id == audit.target_list_id)
            .ok_or_else(|| "Target list not found".to_string())?
            .clone();
        Ok::<_, String>((audit, target_list))
    })();
    let (audit, target_list) = match lookup {
        Ok(v) => v,
        Err(e) => {
            emit_error(&app, None, &e);
            return Err(e);
        }
    };

    let report_id = Uuid::new_v4().to_string();
    let guard = match state.a11y_runner.begin(&report_id) {
        Ok(g) => g,
        Err(e) => {
            emit_error(&app, None, &e);
            return Err(e);
        }
    };
    let token = guard.token();

    let outcome = if audit.engine == "axe-core" {
        crate::a11y_browser::run_axe_audit(&app, &audit, &target_list, &report_id, token).await
    } else {
        Ok(
            crate::a11y_runner::run_static_audit(&app, &audit, &target_list, &report_id, token)
                .await,
        )
    };

    let report = match outcome {
        Ok(report) => report,
        Err(e) => {
            // Keep a record of the failed run, then report the error.
            let now = Utc::now().to_rfc3339();
            let failed = build_report(
                &report_id,
                &audit,
                now.clone(),
                Some(now),
                "error",
                Vec::new(),
            );
            let _ = state.storage.save_a11y_report(&failed);
            drop(guard);
            emit_error(&app, Some(&report_id), &e);
            return Err(e);
        }
    };

    // Persist the final report before announcing it, and only then release
    // the job slot so no other job can race this save.
    let saved = state.storage.save_a11y_report(&report);
    drop(guard);
    if let Err(e) = saved {
        let msg = format!("Failed to save accessibility report: {}", e);
        emit_error(&app, Some(&report_id), &msg);
        return Err(msg);
    }

    crate::commands::runs::prune_after_run(&state);

    if report.status == "cancelled" {
        let _ = app.emit("a11y:cancelled", &report);
    }
    let _ = app.emit("a11y:complete", &report);
    Ok(())
}

/// Cancel the active accessibility run or re-run, if any.
#[tauri::command]
pub fn cancel_a11y_run(state: State<'_, AppState>) -> Result<(), String> {
    state.a11y_runner.cancel();
    Ok(())
}

#[tauri::command]
pub fn list_a11y_reports(state: State<'_, AppState>) -> Result<Vec<A11yReportInfo>, String> {
    Ok(state.storage.list_a11y_reports())
}

#[tauri::command]
pub fn get_a11y_report(
    state: State<'_, AppState>,
    report_id: String,
) -> Result<A11yReport, String> {
    state.storage.load_a11y_report(&report_id)
}

#[tauri::command]
pub fn delete_a11y_report(state: State<'_, AppState>, report_id: String) -> Result<(), String> {
    state.storage.delete_a11y_report(&report_id)
}

/// Re-scan pages that errored in a report (or an explicit URL subset) and
/// merge the fresh results back into the stored report. The scan uses the
/// engine, standards, severity and categories stored on the report (falling
/// back to the audit's current settings only for legacy reports that predate
/// those fields), so merged results are consistent with the rest of the report.
#[tauri::command(rename_all = "camelCase")]
pub async fn rerun_a11y_pages(
    app: AppHandle,
    state: State<'_, AppState>,
    report_id: String,
    urls: Option<Vec<String>>,
) -> Result<A11yReport, String> {
    let (audit, report) = {
        let data = state.lock_data();
        let report = state.storage.load_a11y_report(&report_id)?;
        let audit = data
            .a11y_audits
            .iter()
            .find(|a| a.id == report.audit_id)
            .ok_or_else(|| "Accessibility audit not found".to_string())?
            .clone();
        (audit, report)
    };

    if report.status == "running" && state.a11y_runner.is_running() {
        return Err(
            "This report is still running; wait for it to finish before re-running pages".into(),
        );
    }

    let targets: Vec<String> = match urls {
        Some(u) if !u.is_empty() => u,
        _ => report
            .results
            .iter()
            .filter(|r| r.error.is_some())
            .map(|r| r.url.clone())
            .collect(),
    };
    if targets.is_empty() {
        return Ok(report);
    }

    let guard = state.a11y_runner.begin(&report_id)?;
    let token = guard.token();
    let scan_audit = rerun_audit(&audit, &report);

    // Re-load under the job guard so we merge into the latest saved copy.
    let mut report = state.storage.load_a11y_report(&report_id).unwrap_or(report);

    let new_results = if scan_audit.engine == "axe-core" {
        crate::a11y_browser::scan_urls_axe(&app, &scan_audit, &report_id, targets, token).await?
    } else {
        crate::a11y_runner::scan_urls_static(&app, &scan_audit, &report_id, targets, token).await
    };

    merge_rerun_results(&mut report.results, new_results);
    report.summary = crate::a11y_runner::compute_a11y_summary(&report.results);
    // Backfill settings on legacy reports so later re-runs stay consistent.
    report.standards = scan_audit.a11y_config.standards.clone();
    report.engine = Some(scan_audit.engine.clone());
    report.min_severity = Some(scan_audit.a11y_config.min_severity.clone());
    report.categories = Some(scan_audit.a11y_config.categories.clone());
    report.completed_at = Some(Utc::now().to_rfc3339());

    state.storage.save_a11y_report(&report)?;
    drop(guard);
    Ok(report)
}

/// Infer the engine of a legacy report (no `engine` field) from its issues'
/// help URLs: axe links to Deque University, the static engine to W3C.
fn infer_report_engine(report: &A11yReport) -> Option<&'static str> {
    report
        .results
        .iter()
        .flat_map(|r| r.issues.iter())
        .find_map(|i| {
            let url = i.help_url.as_deref()?;
            if url.contains("dequeuniversity.com") {
                Some("axe-core")
            } else if url.contains("w3.org/WAI") {
                Some("static")
            } else {
                None
            }
        })
}

/// Audit settings to re-scan with: the report's stored engine/rules, with the
/// audit's current network settings (timeout, headers, cookies).
fn rerun_audit(audit: &A11yAudit, report: &A11yReport) -> A11yAudit {
    let mut scan = audit.clone();
    if let Some(engine) = report
        .engine
        .clone()
        .or_else(|| infer_report_engine(report).map(String::from))
    {
        scan.engine = engine;
    }
    scan.a11y_config.standards = report.standards.clone();
    if let Some(ms) = &report.min_severity {
        scan.a11y_config.min_severity = ms.clone();
    }
    if let Some(cats) = &report.categories {
        scan.a11y_config.categories = cats.clone();
    }
    scan
}

fn merge_rerun_results(
    results: &mut Vec<crate::models::A11yPageResult>,
    new: Vec<crate::models::A11yPageResult>,
) {
    for r in new {
        if let Some(existing) = results.iter_mut().find(|e| e.url == r.url) {
            *existing = r;
        } else {
            results.push(r);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::A11yPageResult;

    fn page(url: &str, error: Option<&str>) -> A11yPageResult {
        A11yPageResult {
            url: url.into(),
            page_title: None,
            status: None,
            status_text: if error.is_some() {
                "error".into()
            } else {
                "OK".into()
            },
            response_time_ms: None,
            error: error.map(|e| e.into()),
            issues: Vec::new(),
            truncated: false,
        }
    }

    fn audit() -> A11yAudit {
        A11yAudit {
            id: "aud".into(),
            name: "n".into(),
            target_list_id: "tl".into(),
            engine: "static".into(),
            a11y_config: A11yCheckConfig {
                min_severity: "minor".into(),
                categories: vec![],
                standards: vec!["wcag22".into()],
            },
            config: AuditConfig::default(),
            origin_override: None,
            url_postfix: None,
            created_at: "now".into(),
            pinned: false,
            folder: None,
        }
    }

    #[test]
    fn rerun_uses_report_settings_not_audit() {
        let audit = audit();
        let mut report_audit = audit.clone();
        report_audit.engine = "axe-core".into();
        report_audit.a11y_config.standards = vec!["section508".into()];
        report_audit.a11y_config.min_severity = "serious".into();
        report_audit.a11y_config.categories = vec!["forms".into()];
        let report = build_report("r", &report_audit, "s".into(), None, "completed", vec![]);

        let scan = rerun_audit(&audit, &report);
        assert_eq!(scan.engine, "axe-core");
        assert_eq!(scan.a11y_config.standards, vec!["section508".to_string()]);
        assert_eq!(scan.a11y_config.min_severity, "serious");
        assert_eq!(scan.a11y_config.categories, vec!["forms".to_string()]);
    }

    #[test]
    fn rerun_legacy_report_infers_engine_and_keeps_standards() {
        let audit = audit();
        let mut report = build_report("r", &audit, "s".into(), None, "completed", vec![]);
        report.engine = None;
        report.min_severity = None;
        report.categories = None;
        report.standards = vec![];
        let mut p = page("https://a.com", None);
        p.issues.push(crate::models::A11yIssue {
            issue_type: "image-alt".into(),
            element: "img".into(),
            selector: "img".into(),
            message: "m".into(),
            severity: "critical".into(),
            wcag: "1.1.1".into(),
            standards: vec![],
            help_url: Some("https://dequeuniversity.com/rules/axe/4.10/image-alt".into()),
        });
        report.results.push(p);

        let scan = rerun_audit(&audit, &report);
        assert_eq!(scan.engine, "axe-core");
        // report.standards (empty = all) wins over the audit's current wcag22
        assert!(scan.a11y_config.standards.is_empty());
        assert_eq!(scan.a11y_config.min_severity, "minor");
    }

    #[test]
    fn legacy_report_json_still_deserializes() {
        let json = r#"{"id":"r","auditId":"a","startedAt":"s","completedAt":null,"status":"completed",
            "results":[{"url":"u","pageTitle":null,"status":200,"statusText":"OK","responseTimeMs":1,"error":null,"issues":[]}],
            "summary":{"totalPages":1,"pagesWithIssues":0,"errored":0,"critical":0,"serious":0,"moderate":0,"minor":0}}"#;
        let r: A11yReport = serde_json::from_str(json).unwrap();
        assert!(r.engine.is_none());
        assert!(!r.results[0].truncated);
    }

    #[test]
    fn merge_replaces_by_url() {
        let mut results = vec![
            page("https://a.com", Some("timeout")),
            page("https://b.com", None),
        ];
        merge_rerun_results(&mut results, vec![page("https://a.com", None)]);
        assert_eq!(results.len(), 2);
        assert!(results[0].error.is_none());
        assert!(results[1].error.is_none());
    }

    #[test]
    fn merge_appends_unknown_urls() {
        let mut results = vec![page("https://a.com", Some("x"))];
        merge_rerun_results(&mut results, vec![page("https://c.com", None)]);
        assert_eq!(results.len(), 2);
    }
}
