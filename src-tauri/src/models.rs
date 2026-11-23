use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TargetList {
    pub id: String,
    pub name: String,
    pub urls: Vec<String>,
    pub created_at: String,
    pub updated_at: String,
    #[serde(default)]
    pub pinned: bool,
    pub folder: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub enum CheckType {
    #[default]
    Selector,
    Status,
    Regex,
    Attribute,
    Accessibility,
    // The frontend uses `"javascript"`; older builds wrote `"javaScript"`.
    #[serde(rename = "javascript", alias = "javaScript")]
    JavaScript,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SelectorCheck {
    pub id: String,
    pub selector: String,
    pub label: String,
    #[serde(default)]
    pub check_type: CheckType,
    pub expected_status: Option<u16>,
    pub pattern: Option<String>,
    pub attribute_name: Option<String>,
    pub attribute_value: Option<String>,
    #[serde(default)]
    pub a11y_config: Option<A11yCheckConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct A11yCheckConfig {
    #[serde(default = "default_a11y_min_severity")]
    pub min_severity: String,
    #[serde(default)]
    pub categories: Vec<String>,
    #[serde(default)]
    pub standards: Vec<String>,
}

impl Default for A11yCheckConfig {
    fn default() -> Self {
        Self {
            min_severity: default_a11y_min_severity(),
            categories: Vec::new(),
            standards: Vec::new(),
        }
    }
}

fn default_a11y_min_severity() -> String {
    "minor".into()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckTemplate {
    pub id: String,
    pub name: String,
    pub checks: Vec<SelectorCheck>,
    pub created_at: String,
    pub updated_at: String,
    #[serde(default)]
    pub pinned: bool,
    pub folder: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AuditConfig {
    pub mode: String,
    pub batch_size: u32,
    pub timeout_secs: u64,
    #[serde(default)]
    pub headers: HashMap<String, String>,
    #[serde(default)]
    pub cookies: Vec<KeyValuePair>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KeyValuePair {
    pub key: String,
    pub value: String,
}

impl Default for AuditConfig {
    fn default() -> Self {
        Self {
            mode: "batch".into(),
            batch_size: 5,
            timeout_secs: 10,
            headers: HashMap::new(),
            cookies: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Audit {
    pub id: String,
    pub name: String,
    pub target_list_id: String,
    pub check_template_id: String,
    #[serde(default)]
    pub config: AuditConfig,
    pub origin_override: Option<String>,
    pub url_postfix: Option<String>,
    pub created_at: String,
    #[serde(default)]
    pub pinned: bool,
    pub folder: Option<String>,
    pub baseline_run_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct A11yIssue {
    pub issue_type: String,
    pub element: String,
    pub selector: String,
    pub message: String,
    #[serde(default)]
    pub severity: String,
    #[serde(default)]
    pub wcag: String,
    #[serde(default)]
    pub standards: Vec<String>,
    #[serde(default)]
    pub help_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SelectorResult {
    pub selector_check_id: String,
    pub selector: String,
    pub label: String,
    pub found: bool,
    pub count: usize,
    pub text_content: Option<String>,
    #[serde(default)]
    pub check_type: CheckType,
    #[serde(default)]
    pub a11y_issues: Vec<A11yIssue>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PageResult {
    pub url: String,
    pub page_title: Option<String>,
    pub status: Option<u16>,
    pub status_text: String,
    pub response_time_ms: Option<u64>,
    pub error: Option<String>,
    pub checks: Vec<SelectorResult>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RunSummary {
    pub total: usize,
    pub passed: usize,
    pub failed: usize,
    pub errored: usize,
    pub avg_response_time_ms: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct A11yAudit {
    pub id: String,
    pub name: String,
    pub target_list_id: String,
    #[serde(default = "default_a11y_engine")]
    pub engine: String,
    #[serde(default)]
    pub a11y_config: A11yCheckConfig,
    #[serde(default)]
    pub config: AuditConfig,
    pub origin_override: Option<String>,
    pub url_postfix: Option<String>,
    pub created_at: String,
    #[serde(default)]
    pub pinned: bool,
    pub folder: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct A11yPageResult {
    pub url: String,
    pub page_title: Option<String>,
    pub status: Option<u16>,
    pub status_text: String,
    pub response_time_ms: Option<u64>,
    pub error: Option<String>,
    pub issues: Vec<A11yIssue>,
    /// True when the engine capped the issue list (per-rule node limit or
    /// the per-page total), so `issues` is incomplete.
    #[serde(default)]
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct A11ySummary {
    pub total_pages: usize,
    pub pages_with_issues: usize,
    pub errored: usize,
    pub critical: usize,
    pub serious: usize,
    pub moderate: usize,
    pub minor: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct A11yReport {
    pub id: String,
    pub audit_id: String,
    pub started_at: String,
    pub completed_at: Option<String>,
    pub status: String,
    pub results: Vec<A11yPageResult>,
    #[serde(default)]
    pub summary: A11ySummary,
    #[serde(default)]
    pub standards: Vec<String>,
    /// Engine used for this report ("static" | "axe-core"). None on reports
    /// written before this field existed.
    #[serde(default)]
    pub engine: Option<String>,
    /// Minimum severity the report was scanned with (None on legacy reports).
    #[serde(default)]
    pub min_severity: Option<String>,
    /// Rule categories the report was scanned with (None on legacy reports;
    /// empty = all).
    #[serde(default)]
    pub categories: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct A11yReportInfo {
    pub id: String,
    pub audit_id: String,
    pub started_at: String,
    pub timestamp_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditRun {
    pub id: String,
    pub audit_id: String,
    pub started_at: String,
    pub completed_at: Option<String>,
    pub status: String,
    pub results: Vec<PageResult>,
    #[serde(default)]
    pub summary: RunSummary,
}

/// Current on-disk schema version of `data.json`. Bump when a change is not
/// backwards compatible so older builds refuse to overwrite newer data.
pub const DATA_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppData {
    /// Schema version. Files written before versioning was added have none and
    /// deserialize as 0.
    #[serde(default)]
    pub version: u32,
    #[serde(default)]
    pub target_lists: Vec<TargetList>,
    #[serde(default)]
    pub check_templates: Vec<CheckTemplate>,
    #[serde(default)]
    pub audits: Vec<Audit>,
    #[serde(default)]
    pub a11y_audits: Vec<A11yAudit>,
    /// History retention in days. `0` means "keep forever".
    #[serde(default = "default_max_history_days")]
    pub max_history_days: u32,
}

pub(crate) fn default_max_history_days() -> u32 {
    90
}

fn default_a11y_engine() -> String {
    "static".into()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScrapedSelector {
    pub selector: String,
    pub type_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunFileInfo {
    pub id: String,
    pub started_at: String,
    pub timestamp_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkCheckResult {
    pub url: String,
    pub source_url: String,
    pub status: Option<u16>,
    pub status_text: String,
    pub error: Option<String>,
    pub depth: u32,
    #[serde(default)]
    pub a11y_issues: Vec<A11yIssue>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkCheckScan {
    pub id: String,
    pub url: String,
    pub max_depth: u32,
    pub same_origin_only: bool,
    pub include_accessibility: bool,
    pub started_at: String,
    pub completed_at: Option<String>,
    pub results: Vec<LinkCheckResult>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkCheckScanInfo {
    pub id: String,
    pub url: String,
    pub started_at: String,
    pub timestamp_ms: i64,
    pub total_links: usize,
    pub broken: usize,
    pub a11y_issues: usize,
}

impl AppData {
    pub fn empty() -> Self {
        Self {
            version: DATA_SCHEMA_VERSION,
            target_lists: Vec::new(),
            check_templates: Vec::new(),
            audits: Vec::new(),
            a11y_audits: Vec::new(),
            max_history_days: default_max_history_days(),
        }
    }
}

impl Default for AppData {
    fn default() -> Self {
        Self::empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const ALL_CHECK_TYPES: [(CheckType, &str); 6] = [
        (CheckType::Selector, "selector"),
        (CheckType::Status, "status"),
        (CheckType::Regex, "regex"),
        (CheckType::Attribute, "attribute"),
        (CheckType::Accessibility, "accessibility"),
        (CheckType::JavaScript, "javascript"),
    ];

    #[test]
    fn check_type_wire_names_round_trip() {
        for (ct, wire) in ALL_CHECK_TYPES {
            let json = serde_json::to_string(&ct).unwrap();
            assert_eq!(json, format!("\"{}\"", wire));
            let back: CheckType = serde_json::from_str(&json).unwrap();
            assert_eq!(back, ct);
        }
    }

    #[test]
    fn check_type_accepts_legacy_javascript_name() {
        let ct: CheckType = serde_json::from_str("\"javaScript\"").unwrap();
        assert_eq!(ct, CheckType::JavaScript);
    }

    #[test]
    fn selector_check_with_javascript_type_round_trips() {
        let json = r#"{"id":"c1","selector":"return true","label":"JS","checkType":"javascript"}"#;
        let check: SelectorCheck = serde_json::from_str(json).unwrap();
        assert_eq!(check.check_type, CheckType::JavaScript);
        let out = serde_json::to_value(&check).unwrap();
        assert_eq!(out["checkType"], "javascript");
    }

    #[test]
    fn app_data_empty_object_uses_defaults() {
        let data: AppData = serde_json::from_str("{}").unwrap();
        assert!(data.target_lists.is_empty());
        assert!(data.check_templates.is_empty());
        assert!(data.audits.is_empty());
        assert!(data.a11y_audits.is_empty());
        assert_eq!(data.max_history_days, 90);
        assert_eq!(data.version, 0);
    }

    #[test]
    fn app_data_legacy_shape_without_optional_fields_loads() {
        // Shape written by older builds: no version, no a11y_audits, an audit
        // config missing headers/cookies, and an a11y audit missing engine and
        // a11y_config.
        let json = r#"{
            "target_lists": [{"id":"t1","name":"T","urls":["https://a.test"],"createdAt":"x","updatedAt":"x","folder":null}],
            "check_templates": [],
            "audits": [{"id":"a1","name":"A","targetListId":"t1","checkTemplateId":"c1",
                        "config":{"mode":"batch"},"originOverride":null,"urlPostfix":null,
                        "createdAt":"x","folder":null,"baselineRunId":null}],
            "a11y_audits": [{"id":"y1","name":"Y","targetListId":"t1",
                        "originOverride":null,"urlPostfix":null,"createdAt":"x","folder":null}]
        }"#;
        let data: AppData = serde_json::from_str(json).unwrap();
        assert_eq!(data.audits[0].config.batch_size, 5);
        assert_eq!(data.audits[0].config.timeout_secs, 10);
        assert_eq!(data.a11y_audits[0].engine, "static");
        assert_eq!(data.a11y_audits[0].a11y_config.min_severity, "minor");
        assert_eq!(data.a11y_audits[0].config.mode, "batch");
    }

    #[test]
    fn app_data_round_trips() {
        let mut data = AppData::empty();
        data.target_lists.push(TargetList {
            id: "t1".into(),
            name: "T".into(),
            urls: vec!["https://a.test".into()],
            created_at: "x".into(),
            updated_at: "x".into(),
            pinned: true,
            folder: Some("f".into()),
        });
        let json = serde_json::to_string(&data).unwrap();
        let back: AppData = serde_json::from_str(&json).unwrap();
        assert_eq!(back.version, DATA_SCHEMA_VERSION);
        assert_eq!(back.target_lists.len(), 1);
        assert!(back.target_lists[0].pinned);
    }

    #[test]
    fn reports_without_summary_load() {
        let json = r#"{"id":"r","auditId":"a","startedAt":"s","completedAt":null,"status":"completed","results":[]}"#;
        let report: A11yReport = serde_json::from_str(json).unwrap();
        assert_eq!(report.summary.total_pages, 0);
        let json = r#"{"id":"r","auditId":"a","startedAt":"s","completedAt":null,"status":"completed","results":[]}"#;
        let run: AuditRun = serde_json::from_str(json).unwrap();
        assert_eq!(run.summary.total, 0);
    }
}
