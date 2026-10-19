//! Serializable boundary shared by desktop adapters and headless callers.
use crate::proxy::ProxySettings;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::HashMap;

pub type Variables = HashMap<String, Value>;
pub use crate::context::{
    AuthKind, AuthOrigin, AuthTemplate, Certificate, Cookie, ExecutionSettings,
};
pub use crate::results::{RequestResult, RequestStatus, RunResult, TerminationReason};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct RequestTemplate {
    pub collection_id: Option<String>,
    pub endpoint_id: Option<String>,
    pub name: String,
    pub method: String,
    pub protocol: String,
    pub url: String,
    pub path: String,
    pub base_url: String,
    pub headers: Map<String, Value>,
    pub default_headers: Map<String, Value>,
    pub path_params: Map<String, Value>,
    pub path_parameter_names: Vec<String>,
    pub query_rows: Vec<Parameter>,
    pub body: BodyTemplate,
    pub auth: AuthTemplate,
    /// Saved runners historically use bearerToken when bearer auth is empty.
    pub bearer_fallback: bool,
    /// Closest parent first, ending with collection authentication.
    pub inherited_auth: Vec<AuthSource>,
    pub pre_request_script: String,
    pub test_script: String,
    pub post_response_script: String,
    pub mock_base_url: Option<String>,
    /// A missing saved target is a per-visit failure, not an invalid run.
    pub capture_error: Option<ExecutionError>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Parameter {
    pub key: String,
    pub value: String,
    pub enabled: Option<bool>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct BodyTemplate {
    pub mode: String,
    pub content: String,
    pub fields: Vec<Value>,
    pub file_path: String,
    pub content_type: Option<String>,
    pub graphql: Option<GraphqlTemplate>,
    pub capture_error: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct GraphqlTemplate {
    pub query: String,
    pub variables: String,
    pub operation_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthSource {
    pub source: AuthOrigin,
    pub auth_config: AuthTemplate,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ExecutionContext {
    pub environment_id: Option<String>,
    pub environment_name: Option<String>,
    pub environment: Variables,
    pub collections: HashMap<String, Variables>,
    pub cookies: Vec<Cookie>,
    pub certificates: Vec<Certificate>,
    pub settings: ExecutionSettings,
    pub proxy: ProxySettings,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestInput {
    pub execution_id: String,
    pub request: RequestTemplate,
    pub context: ExecutionContext,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunInput {
    pub execution_id: String,
    pub runner_id: Option<String>,
    pub runner_name: String,
    /// Ordered entries deliberately preserve duplicates and their overrides.
    pub requests: Vec<RequestTemplate>,
    pub context: ExecutionContext,
    #[serde(default)]
    pub options: RunOptions,
    pub data_file: Option<DataFile>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct RunOptions {
    pub iterations: Option<Value>,
    pub delay_ms: Option<u64>,
    pub stop_on_error: bool,
    pub max_executions_per_iteration: Option<Value>,
    /// Fail a visit before sending when the prepared request still contains
    /// `{{...}}` references; the desktop never sets it.
    pub strict_variables: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DataFile {
    pub name: String,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionError {
    pub code: String,
    pub details: Value,
}
impl ExecutionError {
    pub fn new(code: &str, details: impl Into<Value>) -> Self {
        Self {
            code: code.into(),
            details: details.into(),
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Visit {
    pub index: usize,
    pub queue_position: usize,
    pub iteration: usize,
    pub attempt: usize,
    pub collection_id: Option<String>,
    pub endpoint_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionEvent {
    pub execution_id: String,
    pub sequence: u64,
    pub visit: Option<Visit>,
    pub kind: String,
    pub data: Value,
}
