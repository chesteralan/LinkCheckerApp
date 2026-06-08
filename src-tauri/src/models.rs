use serde::{Deserialize, Serialize};

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
    #[serde(default, skip_serializing_if = "std::collections::HashMap::is_empty")]
    pub headers: std::collections::HashMap<String, String>,
}

impl Default for AuditConfig {
    fn default() -> Self {
        Self {
            mode: "batch".into(),
            batch_size: 5,
            timeout_secs: 10,
            headers: std::collections::HashMap::new(),
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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
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
}

impl AppData {
    pub fn empty() -> Self {
        Self {
            target_lists: Vec::new(),
            check_templates: Vec::new(),
            audits: Vec::new(),
            max_history_days: default_max_history_days(),
        }
    }
}
