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
}

impl Default for A11yCheckConfig {
    fn default() -> Self {
        Self {
            min_severity: default_a11y_min_severity(),
            categories: Vec::new(),
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
#[serde(rename_all = "camelCase")]
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

#[derive(Debug, Clone, Serialize, Deserialize)]
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
    pub engine: String,
    pub a11y_config: A11yCheckConfig,
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
    pub summary: A11ySummary,
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
    pub summary: RunSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppData {
    pub target_lists: Vec<TargetList>,
    pub check_templates: Vec<CheckTemplate>,
    pub audits: Vec<Audit>,
    #[serde(default)]
    pub a11y_audits: Vec<A11yAudit>,
    #[serde(default = "default_max_history_days")]
    pub max_history_days: u32,
}

fn default_max_history_days() -> u32 {
    90
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
            target_lists: Vec::new(),
            check_templates: Vec::new(),
            audits: Vec::new(),
            a11y_audits: Vec::new(),
            max_history_days: default_max_history_days(),
        }
    }
}
