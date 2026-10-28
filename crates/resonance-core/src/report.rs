//! Run summaries and their JSON / JUnit XML reports, with no bodies, headers
//! or logs. The CLI and desktop share these formatters, with output pinned
//! by the shared fixtures under `tests/fixtures/report`.
use crate::results::{RequestResult, RequestStatus, RunResult, TerminationReason};
use crate::scripts::execution::ExecutionControl;
use serde::{Deserialize, Serialize};

pub const MAX_SUMMARY_REQUESTS: usize = 2000;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TestSummary {
    pub name: String,
    pub passed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestSummary {
    pub iteration: usize,
    pub attempt: usize,
    pub queue_position: usize,
    pub index: usize,
    pub execution: Option<ExecutionControl>,
    pub name: String,
    pub method: String,
    pub path: String,
    pub collection_id: Option<String>,
    pub endpoint_id: Option<String>,
    pub status: RequestStatus,
    pub status_code: Option<u16>,
    pub time: Option<i64>,
    pub error: Option<String>,
    pub tests: Vec<TestSummary>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Counts {
    pub passed: usize,
    pub failed: usize,
    pub skipped: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunSummary {
    pub runner_id: Option<String>,
    pub runner_name: String,
    pub started_at: i64,
    pub finished_at: i64,
    pub total_time: i64,
    pub iterations: usize,
    pub planned_requests: usize,
    pub sent_requests: usize,
    pub total_requests: usize,
    pub termination_reason: TerminationReason,
    pub error: Option<String>,
    pub summary: Counts,
    pub truncated: bool,
    pub requests: Vec<RequestSummary>,
}

fn non_empty(text: Option<&String>) -> Option<String> {
    text.filter(|t| !t.is_empty()).cloned()
}

fn request_summary(request: &RequestResult) -> RequestSummary {
    RequestSummary {
        iteration: request.visit.iteration.max(1),
        attempt: request.visit.attempt,
        queue_position: request.visit.queue_position,
        index: request.visit.index,
        execution: request.execution.clone(),
        name: request.name.clone(),
        method: request.method.clone(),
        path: request.path.clone(),
        collection_id: non_empty(request.visit.collection_id.as_ref()),
        endpoint_id: non_empty(request.visit.endpoint_id.as_ref()),
        status: request.status,
        status_code: request.status_code,
        time: Some(request.time),
        error: request
            .execution_error
            .as_ref()
            .map(|e| e.message())
            .or_else(|| non_empty(request.error.as_ref())),
        tests: request
            .test_results
            .iter()
            .map(|test| TestSummary {
                name: test.message.clone(),
                passed: test.passed,
            })
            .collect(),
    }
}

/// Condenses a run result into what a report carries. Error codes are
/// turned into their messages first, as the desktop does before summarising.
pub fn summarize(result: &RunResult) -> RunSummary {
    let requests: Vec<RequestSummary> = result.requests.iter().map(request_summary).collect();
    RunSummary {
        runner_id: result.runner_id.clone(),
        runner_name: result.runner_name.clone(),
        started_at: result.start_time,
        finished_at: result.end_time,
        total_time: result.total_time,
        iterations: result.iterations.max(1),
        planned_requests: result.planned_requests,
        sent_requests: result.sent_requests,
        total_requests: result.total_requests,
        termination_reason: result.termination_reason,
        error: result
            .execution_error
            .as_ref()
            .map(|e| e.message())
            .or_else(|| non_empty(result.error.as_ref())),
        summary: Counts {
            passed: result.passed,
            failed: result.failed,
            skipped: result.skipped,
        },
        truncated: requests.len() > MAX_SUMMARY_REQUESTS,
        requests: requests.into_iter().take(MAX_SUMMARY_REQUESTS).collect(),
    }
}

/// The summary as pretty JSON with a trailing newline.
pub fn to_json(summary: &RunSummary) -> String {
    format!(
        "{}\n",
        serde_json::to_string_pretty(summary).unwrap_or_default()
    )
}

fn xml(value: &str) -> String {
    value
        .chars()
        .filter(|c| !matches!(*c, '\u{0}'..='\u{8}' | '\u{b}' | '\u{c}' | '\u{e}'..='\u{1f}'))
        .flat_map(|c| match c {
            '&' => "&amp;".chars().collect::<Vec<_>>(),
            '<' => "&lt;".chars().collect(),
            '>' => "&gt;".chars().collect(),
            '"' => "&quot;".chars().collect(),
            '\'' => "&apos;".chars().collect(),
            other => vec![other],
        })
        .collect()
}

fn seconds(ms: f64) -> String {
    format!("{:.3}", ms / 1000.0)
}

struct TestCase {
    name: String,
    failure: Option<String>,
    skipped: Option<String>,
}

fn test_cases_for(request: &RequestSummary) -> Vec<TestCase> {
    if request.status == RequestStatus::Skipped {
        return vec![TestCase {
            name: "Request".into(),
            failure: None,
            skipped: Some(request.error.clone().unwrap_or_default()),
        }];
    }
    let mut cases: Vec<TestCase> = request
        .tests
        .iter()
        .map(|test| TestCase {
            name: test.name.clone(),
            failure: (!test.passed).then(|| test.name.clone()),
            skipped: None,
        })
        .collect();
    let failed_test = request.tests.iter().any(|test| !test.passed);
    if cases.is_empty() {
        let failure = if request.status == RequestStatus::Success {
            None
        } else {
            Some(request.error.clone().unwrap_or_else(|| {
                request
                    .status_code
                    .map(|code| code.to_string())
                    .unwrap_or_default()
            }))
        };
        cases.push(TestCase {
            name: "Response status".into(),
            failure,
            skipped: None,
        });
    } else if request.status != RequestStatus::Success && !failed_test {
        cases.push(TestCase {
            name: "Request".into(),
            failure: Some(request.error.clone().unwrap_or_default()),
            skipped: None,
        });
    }
    cases
}

/// The summary as JUnit XML: one suite per visited request, one case per
/// assertion.
pub fn to_junit(summary: &RunSummary) -> String {
    let mut requests: Vec<RequestSummary> = summary.requests.clone();
    if let Some(error) = &summary.error
        && !requests
            .iter()
            .any(|r| r.status == RequestStatus::Error && r.error.as_deref() == Some(error))
    {
        requests.push(RequestSummary {
            iteration: 1,
            attempt: 0,
            queue_position: 0,
            index: 0,
            execution: None,
            name: "Runner execution".into(),
            method: String::new(),
            path: String::new(),
            collection_id: None,
            endpoint_id: None,
            status: RequestStatus::Error,
            status_code: None,
            time: None,
            error: Some(error.clone()),
            tests: Vec::new(),
        });
    }

    let mut suites = Vec::new();
    let (mut total_tests, mut total_failures, mut total_skipped) = (0, 0, 0);
    for request in &requests {
        let cases = test_cases_for(request);
        let failures = cases.iter().filter(|c| c.failure.is_some()).count();
        let skipped = cases.iter().filter(|c| c.skipped.is_some()).count();
        total_tests += cases.len();
        total_failures += failures;
        total_skipped += skipped;

        let attempt = if request.attempt > 0 {
            format!(" · Attempt {}", request.attempt)
        } else {
            String::new()
        };
        let label = format!("{} {}{}", request.method, request.name, attempt)
            .trim()
            .to_string();
        let name = if summary.iterations > 1 {
            format!("Iteration {} › {}", request.iteration, label)
        } else {
            label.clone()
        };
        let time = request.time.unwrap_or(0) as f64;
        let case_time = seconds(if cases.is_empty() {
            0.0
        } else {
            time / cases.len() as f64
        });
        let body = cases
            .iter()
            .map(|case| {
                let open = format!(
                    "    <testcase name=\"{}\" classname=\"{}\" time=\"{}\"",
                    xml(&case.name),
                    xml(&format!("{}.{}", summary.runner_name, label)),
                    case_time
                );
                if let Some(failure) = &case.failure {
                    format!(
                        "{open}>\n      <failure type=\"AssertionFailure\" message=\"{}\"/>\n    </testcase>",
                        xml(failure)
                    )
                } else if let Some(skipped) = &case.skipped {
                    format!(
                        "{open}>\n      <skipped message=\"{}\"/>\n    </testcase>",
                        xml(skipped)
                    )
                } else {
                    format!("{open}/>")
                }
            })
            .collect::<Vec<_>>()
            .join("\n");
        suites.push(format!(
            "  <testsuite name=\"{}\" tests=\"{}\" failures=\"{}\" errors=\"0\" skipped=\"{}\" time=\"{}\">\n{}\n  </testsuite>",
            xml(&name),
            cases.len(),
            failures,
            skipped,
            seconds(time),
            body
        ));
    }

    let timestamp = if summary.started_at != 0 {
        chrono::DateTime::from_timestamp_millis(summary.started_at)
            .map(|t| {
                format!(
                    " timestamp=\"{}\"",
                    t.to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
                )
            })
            .unwrap_or_default()
    } else {
        String::new()
    };
    let mut lines = vec![
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>".to_string(),
        format!(
            "<testsuites name=\"{}\" tests=\"{}\" failures=\"{}\" errors=\"0\" skipped=\"{}\" time=\"{}\"{}>",
            xml(&summary.runner_name),
            total_tests,
            total_failures,
            total_skipped,
            seconds(summary.total_time as f64),
            timestamp
        ),
    ];
    lines.extend(suites);
    lines.push("</testsuites>".into());
    lines.push(String::new());
    lines.join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::ExecutionError;
    use serde_json::json;

    fn run() -> RunResult {
        serde_json::from_value(json!({
            "runnerId": "r1", "runnerName": "Smoke <&>", "startTime": 1789466700000i64, "endTime": 1789466701000i64,
            "totalTime": 1000, "totalRequests": 4, "plannedRequests": 4, "sentRequests": 3, "iterations": 1,
            "passed": 1, "failed": 2, "skipped": 1, "variablesSet": {}, "terminationReason": "completed", "error": null,
            "requests": [
                {"index": 0, "queuePosition": 0, "iteration": 1, "attempt": 1, "name": "List", "method": "GET", "path": "/a",
                 "status": "success", "statusCode": 200, "responseTime": 100, "time": 100, "error": null, "variablesSet": {},
                 "logs": [], "testResults": [{"passed": true, "message": "is 200"}], "sent": true},
                {"index": 1, "queuePosition": 1, "iteration": 1, "attempt": 1, "name": "Create", "method": "POST", "path": "/b",
                 "status": "error", "statusCode": 201, "responseTime": 50, "time": 50, "error": "testsFailed", "variablesSet": {},
                 "logs": [], "testResults": [{"passed": false, "message": "returns \"id\""}], "sent": true,
                 "executionError": {"code": "testsFailed", "details": {}}},
                {"index": 2, "queuePosition": 2, "iteration": 1, "attempt": 1, "name": "Boom", "method": "GET", "path": "/c",
                 "status": "error", "statusCode": null, "responseTime": 5, "time": 5, "error": "dns error", "variablesSet": {},
                 "logs": [], "testResults": [], "sent": true},
                {"index": 3, "queuePosition": 3, "iteration": 1, "attempt": 1, "name": "Later", "method": "GET", "path": "/d",
                 "status": "skipped", "statusCode": null, "responseTime": 0, "time": 0, "error": "Skipped due to previous error",
                 "variablesSet": {}, "logs": [], "testResults": [], "sent": false}
            ]
        }))
        .unwrap()
    }

    #[test]
    fn summaries_carry_messages_not_codes_and_never_bodies() {
        let summary = summarize(&run());
        assert_eq!(
            summary.requests[1].error.as_deref(),
            Some("Test script failed")
        );
        assert_eq!(summary.requests[2].error.as_deref(), Some("dns error"));
        assert_eq!(
            summary.summary,
            Counts {
                passed: 1,
                failed: 2,
                skipped: 1
            }
        );
        assert!(!to_json(&summary).contains("logs"));
    }

    #[test]
    fn junit_adds_a_runner_execution_case_for_run_level_errors() {
        let mut result = run();
        result.execution_error = Some(ExecutionError::new("executionLimit", json!({"limit": 4})));
        result.termination_reason = TerminationReason::ExecutionLimit;
        let report = to_junit(&summarize(&result));
        assert!(report.contains("name=\"Runner execution\""));
        assert!(report.contains("message=\"Execution limit reached.\""));
        assert!(report.contains("message=\"dns error\""));
    }

    #[test]
    fn junit_prefixes_iteration_when_several_and_keeps_the_attempt_suffix() {
        let mut result = run();
        result.iterations = 2;
        result.requests.truncate(1);
        result.requests[0].visit.iteration = 2;
        let report = to_junit(&summarize(&result));
        assert!(
            report.contains("<testsuite name=\"Iteration 2 › GET List · Attempt 1\""),
            "{report}"
        );
    }

    #[test]
    fn junit_strips_control_characters() {
        let mut result = run();
        result.requests.truncate(3);
        result.requests[2].error = Some("bad\u{1}byte".into());
        let report = to_junit(&summarize(&result));
        assert!(report.contains("message=\"badbyte\""), "{report}");
    }

    #[test]
    fn very_large_runs_are_capped_and_flagged() {
        let mut result = run();
        let first = serde_json::to_value(&result.requests[0]).unwrap();
        result.requests = (0..MAX_SUMMARY_REQUESTS + 5)
            .map(|_| serde_json::from_value(first.clone()).unwrap())
            .collect();
        let summary = summarize(&result);
        assert_eq!(summary.requests.len(), MAX_SUMMARY_REQUESTS);
        assert!(summary.truncated);
    }
}
