//! Stable result types for desktop reports and headless consumers.
use crate::{
    api_request::ApiResponse,
    model::{ExecutionError, Visit},
    scripts::{LogEntry, TestResult, execution::ExecutionControl},
};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RequestStatus {
    Success,
    Error,
    Skipped,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TerminationReason {
    Completed,
    StoppedByUser,
    StoppedOnError,
    ExecutionError,
    ExecutionLimit,
    InvalidTarget,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistorySensitive {
    pub header_names: Vec<String>,
    pub query_names: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestResult {
    #[serde(flatten)]
    pub visit: Visit,
    pub name: String,
    pub method: String,
    pub path: String,
    pub status: RequestStatus,
    pub status_code: Option<u16>,
    pub response_time: i64,
    pub time: i64,
    pub error: Option<String>,
    pub variables_set: Map<String, Value>,
    pub logs: Vec<LogEntry>,
    pub test_results: Vec<TestResult>,
    pub sent: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub execution_error: Option<ExecutionError>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cancelled: Option<bool>,
    /// Prepared request data also exposed to user scripts; body values are arbitrary JSON.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub request_config: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub history_sensitive: Option<HistorySensitive>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub api_response: Option<ApiResponse>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub http_success: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cookies: Option<Vec<Value>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub script_error: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub execution: Option<ExecutionControl>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunResult {
    pub runner_id: Option<String>,
    pub runner_name: String,
    pub start_time: i64,
    pub end_time: i64,
    pub total_time: i64,
    pub total_requests: usize,
    pub planned_requests: usize,
    pub sent_requests: usize,
    pub iterations: usize,
    pub passed: usize,
    pub failed: usize,
    pub skipped: usize,
    pub requests: Vec<RequestResult>,
    pub variables_set: Map<String, Value>,
    pub termination_reason: TerminationReason,
    pub error: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub execution_error: Option<ExecutionError>,
}

impl RunResult {
    /// Headless callers can choose exit codes without parsing JSON or error text.
    pub fn succeeded(&self) -> bool {
        self.termination_reason == TerminationReason::Completed
            && self.failed == 0
            && self.error.is_none()
    }
}
