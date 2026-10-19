//! The console reporter: one line per request as it completes, test
//! results beneath it, script output and redacted traffic under `-v`.
use resonance_core::model::{ExecutionError, ExecutionEvent};
use resonance_core::redaction::{redact_request, redact_response_headers};
use resonance_core::results::{HistorySensitive, RequestStatus, RunResult, TerminationReason};
use serde_json::Value;
use std::io::Write;
use std::path::Path;

pub const BODY_PREVIEW_LIMIT: usize = 64 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Verbosity {
    Quiet,
    Normal,
    Verbose,
}

struct Style {
    color: bool,
}

impl Style {
    fn paint(&self, code: &str, text: &str) -> String {
        if self.color {
            format!("\x1b[{code}m{text}\x1b[0m")
        } else {
            text.to_string()
        }
    }
    fn green(&self, text: &str) -> String {
        self.paint("32", text)
    }
    fn red(&self, text: &str) -> String {
        self.paint("31", text)
    }
    fn dim(&self, text: &str) -> String {
        self.paint("2", text)
    }
    fn bold(&self, text: &str) -> String {
        self.paint("1", text)
    }
}

pub struct ConsoleReporter<'a> {
    verbosity: Verbosity,
    style: Style,
    out: &'a mut dyn Write,
    err: &'a mut dyn Write,
    pending_logs: Vec<String>,
}

impl<'a> ConsoleReporter<'a> {
    pub fn new(
        verbosity: Verbosity,
        color: bool,
        out: &'a mut dyn Write,
        err: &'a mut dyn Write,
    ) -> Self {
        Self {
            verbosity,
            style: Style { color },
            out,
            err,
            pending_logs: Vec::new(),
        }
    }

    fn say(&mut self, line: &str) {
        let _ = writeln!(self.out, "{line}");
        let _ = self.out.flush();
    }

    pub fn on_event(&mut self, event: &ExecutionEvent) {
        match event.kind.as_str() {
            "run-started" => self.run_started(&event.data),
            "script" => self.script(&event.data),
            "warning" => self.warning(&event.data),
            "response" => self.response(&event.data),
            "request-completed" => self.request_completed(&event.data),
            _ => {}
        }
    }

    fn run_started(&mut self, data: &Value) {
        if self.verbosity == Verbosity::Quiet {
            return;
        }
        let total = data["total"].as_u64().unwrap_or(0);
        let iterations = data["iterations"].as_u64().unwrap_or(1);
        let plural = if total == 1 { "" } else { "s" };
        let line = if iterations > 1 {
            format!("Running {total} request{plural} ({iterations} iterations)")
        } else {
            format!("Running {total} request{plural}")
        };
        let line = self.style.bold(&line);
        self.say(&line);
    }

    fn script(&mut self, data: &Value) {
        if self.verbosity != Verbosity::Verbose {
            return;
        }
        let phase = data["phase"].as_str().unwrap_or("script");
        if let Some(logs) = data["result"]["logs"].as_array() {
            for log in logs {
                let level = log["level"].as_str().unwrap_or("log");
                let message = log["message"].as_str().unwrap_or("");
                self.pending_logs
                    .push(format!("    [{phase}] console.{level}: {message}"));
            }
        }
        if let Some(errors) = data["result"]["errors"].as_array() {
            for error in errors {
                self.pending_logs.push(format!(
                    "    [{phase}] error: {}",
                    error.as_str().unwrap_or("")
                ));
            }
        }
    }

    fn warning(&mut self, data: &Value) {
        let error: ExecutionError = serde_json::from_value(data.clone())
            .unwrap_or_else(|_| ExecutionError::new("warning", data.clone()));
        let _ = writeln!(self.err, "warning: {}", error.message());
    }

    fn response(&mut self, data: &Value) {
        if self.verbosity != Verbosity::Verbose {
            return;
        }
        let sensitive: Option<HistorySensitive> =
            serde_json::from_value(data["historySensitive"].clone()).ok();
        let request = redact_request(&data["requestConfig"], sensitive.as_ref());
        let mut lines = vec![format!(
            "    > {} {}",
            request["method"].as_str().unwrap_or(""),
            request["url"].as_str().unwrap_or("")
        )];
        if let Some(headers) = request["headers"].as_object() {
            for (name, value) in headers {
                lines.push(format!(
                    "    > {name}: {}",
                    value.as_str().unwrap_or(&value.to_string())
                ));
            }
        }
        if !request["body"].is_null() {
            lines.push(format!("    > {}", preview(&request["body"])));
        }
        let response = &data["response"];
        lines.push(format!(
            "    < {} {}",
            response["status"].as_u64().unwrap_or(0),
            response["statusText"].as_str().unwrap_or("")
        ));
        let headers: std::collections::HashMap<String, String> =
            serde_json::from_value(response["headers"].clone()).unwrap_or_default();
        let mut names: Vec<_> = redact_response_headers(&headers).into_iter().collect();
        names.sort();
        for (name, value) in names {
            lines.push(format!("    < {name}: {value}"));
        }
        if response["isBinary"].as_bool() == Some(true) {
            lines.push(format!(
                "    < <binary {} bytes>",
                response["size"].as_u64().unwrap_or(0)
            ));
        } else if !response["data"].is_null() {
            lines.push(format!("    < {}", preview(&response["data"])));
        }
        self.pending_logs.extend(lines);
    }

    fn request_completed(&mut self, data: &Value) {
        let result = &data["result"];
        let status = result["status"].as_str().unwrap_or("");
        let method = result["method"].as_str().unwrap_or("");
        let path = result["path"].as_str().unwrap_or("");
        let name = result["name"].as_str().unwrap_or("");
        let label = if path.is_empty() {
            name.to_string()
        } else {
            path.to_string()
        };
        let time = result["time"].as_i64().unwrap_or(0);
        let tests: Vec<&Value> = result["testResults"]
            .as_array()
            .map(|t| t.iter().collect())
            .unwrap_or_default();
        let failed_tests = tests.iter().filter(|t| t["passed"] != true).count();
        let error_message = result["executionError"]
            .as_object()
            .and_then(|_| {
                serde_json::from_value::<ExecutionError>(result["executionError"].clone()).ok()
            })
            .map(|e| e.message())
            .or_else(|| result["error"].as_str().map(str::to_string));

        let line = match status {
            "success" => {
                if self.verbosity == Verbosity::Quiet {
                    None
                } else {
                    let code = result["statusCode"]
                        .as_u64()
                        .map(|c| c.to_string())
                        .unwrap_or_default();
                    Some(format!(
                        "{} {method} {label} {code} {time}ms",
                        self.style.green("✓")
                    ))
                }
            }
            "skipped" => {
                if self.verbosity == Verbosity::Quiet {
                    None
                } else {
                    Some(format!("{} {method} {label} skipped", self.style.dim("–")))
                }
            }
            _ => {
                let detail = if failed_tests > 0 {
                    let code = result["statusCode"]
                        .as_u64()
                        .map(|c| format!("{c} "))
                        .unwrap_or_default();
                    format!(
                        "{code}{time}ms ({failed_tests} test{} failed)",
                        if failed_tests == 1 { "" } else { "s" }
                    )
                } else {
                    format!(
                        "— {}",
                        error_message.clone().unwrap_or_else(|| "failed".into())
                    )
                };
                Some(format!("{} {method} {label} {detail}", self.style.red("✗")))
            }
        };
        if let Some(line) = line {
            self.say(&line);
        }
        for test in tests {
            let passed = test["passed"] == true;
            if passed && self.verbosity == Verbosity::Quiet {
                continue;
            }
            let mark = if passed {
                self.style.green("✓")
            } else {
                self.style.red("✗")
            };
            let line = format!("  {mark} {}", test["message"].as_str().unwrap_or(""));
            self.say(&line);
        }
        let logs = std::mem::take(&mut self.pending_logs);
        for log in logs {
            self.say(&log);
        }
    }

    /// The closing summary, after the reports are written.
    pub fn finish(&mut self, result: &RunResult, reports: &[(&str, &Path)]) {
        let counts = format!(
            "Passed {}  Failed {}  Skipped {}",
            result.passed, result.failed, result.skipped
        );
        let counts = if result.failed > 0 {
            self.style.red(&counts)
        } else {
            self.style.green(&counts)
        };
        let seconds = result.total_time as f64 / 1000.0;
        let line = format!(
            "{counts}  ({} request{}, {} iteration{}, {seconds:.2} s)",
            result.total_requests,
            if result.total_requests == 1 { "" } else { "s" },
            result.iterations,
            if result.iterations == 1 { "" } else { "s" }
        );
        self.say(&line);
        if result.termination_reason != TerminationReason::Completed {
            let reason = serde_json::to_value(result.termination_reason)
                .ok()
                .and_then(|v| v.as_str().map(str::to_string))
                .unwrap_or_default();
            let line = format!("Termination: {reason}");
            self.say(&line);
        }
        let message = result
            .execution_error
            .as_ref()
            .map(|e| e.message())
            .or_else(|| result.error.clone());
        if let Some(message) = message {
            let line = format!("Error: {}", self.style.red(&message));
            self.say(&line);
        }
        for (kind, path) in reports {
            let line = format!("Report: {kind} → {}", path.display());
            self.say(&line);
        }
    }
}

/// Whether anything in a result counts as a failure for the exit code.
pub fn has_failures(result: &RunResult) -> bool {
    result.failed > 0
        || result
            .requests
            .iter()
            .any(|r| r.status == RequestStatus::Error)
}

fn preview(value: &Value) -> String {
    let text = match value {
        Value::String(s) => s.clone(),
        other => serde_json::to_string(other).unwrap_or_default(),
    };
    if text.len() > BODY_PREVIEW_LIMIT {
        let cut = text
            .char_indices()
            .map(|(i, _)| i)
            .take_while(|i| *i <= BODY_PREVIEW_LIMIT)
            .last()
            .unwrap_or(0);
        format!("{}… ({} bytes)", &text[..cut], text.len())
    } else {
        text
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn reporter_output(verbosity: Verbosity, events: Vec<Value>) -> (String, String) {
        let mut out = Vec::new();
        let mut err = Vec::new();
        {
            let mut reporter = ConsoleReporter::new(verbosity, false, &mut out, &mut err);
            for (sequence, data) in events.into_iter().enumerate() {
                let kind = data["kind"].as_str().unwrap().to_string();
                reporter.on_event(&ExecutionEvent {
                    execution_id: "x".into(),
                    sequence: sequence as u64 + 1,
                    visit: None,
                    kind,
                    data: data["data"].clone(),
                });
            }
        }
        (
            String::from_utf8(out).unwrap(),
            String::from_utf8(err).unwrap(),
        )
    }

    #[test]
    fn success_failure_and_skip_lines() {
        let (out, _) = reporter_output(
            Verbosity::Normal,
            vec![
                json!({"kind": "run-started", "data": {"total": 3, "iterations": 1}}),
                json!({"kind": "request-completed", "data": {"index": 0, "result": {"status": "success", "method": "GET", "path": "/pets", "statusCode": 200, "time": 12, "testResults": [{"passed": true, "message": "is 200"}]}}}),
                json!({"kind": "request-completed", "data": {"index": 1, "result": {"status": "error", "method": "POST", "path": "/pets", "statusCode": 500, "time": 8, "testResults": [{"passed": false, "message": "created"}, {"passed": false, "message": "has id"}]}}}),
                json!({"kind": "request-completed", "data": {"index": 2, "result": {"status": "error", "method": "GET", "path": "/x", "time": 1, "testResults": [], "error": "connection refused"}}}),
                json!({"kind": "request-completed", "data": {"index": 3, "result": {"status": "skipped", "method": "GET", "path": "/y", "testResults": []}}}),
            ],
        );
        assert!(out.contains("Running 3 requests\n"));
        assert!(out.contains("✓ GET /pets 200 12ms\n  ✓ is 200\n"), "{out}");
        assert!(
            out.contains("✗ POST /pets 500 8ms (2 tests failed)\n  ✗ created\n  ✗ has id\n"),
            "{out}"
        );
        assert!(out.contains("✗ GET /x — connection refused\n"), "{out}");
        assert!(out.contains("– GET /y skipped\n"), "{out}");
        assert!(!out.contains("\x1b["));
    }

    #[test]
    fn quiet_prints_only_failures_and_warnings_go_to_stderr() {
        let (out, err) = reporter_output(
            Verbosity::Quiet,
            vec![
                json!({"kind": "run-started", "data": {"total": 1, "iterations": 1}}),
                json!({"kind": "warning", "data": {"code": "credentialsRemoved", "details": null}}),
                json!({"kind": "request-completed", "data": {"index": 0, "result": {"status": "success", "method": "GET", "path": "/a", "statusCode": 200, "time": 1, "testResults": [{"passed": true, "message": "ok"}]}}}),
                json!({"kind": "request-completed", "data": {"index": 1, "result": {"status": "error", "method": "GET", "path": "/b", "time": 1, "testResults": [], "executionError": {"code": "preRequestFailed", "details": ["boom"]}}}}),
            ],
        );
        assert!(!out.contains("Running"));
        assert!(!out.contains("/a"));
        assert!(
            out.contains("✗ GET /b — Pre-request script failed: boom\n"),
            "{out}"
        );
        assert_eq!(
            err,
            "warning: Authentication was removed because the script changed the request origin.\n"
        );
    }

    #[test]
    fn verbose_redacts_headers_and_shows_script_logs() {
        let (out, _) = reporter_output(
            Verbosity::Verbose,
            vec![
                json!({"kind": "script", "data": {"phase": "pre", "result": {"logs": [{"level": "log", "message": "hello", "timestamp": 1}], "errors": []}}}),
                json!({"kind": "response", "data": {
                    "requestConfig": {"method": "GET", "url": "https://api.test/a?api_key=secret", "headers": {"Authorization": "Bearer t", "Accept": "*/*"}},
                    "historySensitive": {"headerNames": [], "queryNames": ["api_key"]},
                    "response": {"status": 200, "statusText": "OK", "headers": {"set-cookie": "sid=1", "content-type": "text/plain"}, "data": "pong", "isBinary": false}
                }}),
                json!({"kind": "request-completed", "data": {"index": 0, "result": {"status": "success", "method": "GET", "path": "/a", "statusCode": 200, "time": 3, "testResults": []}}}),
            ],
        );
        assert!(out.contains("[pre] console.log: hello"), "{out}");
        assert!(out.contains("> Authorization: [redacted]"), "{out}");
        assert!(out.contains("> Accept: */*"), "{out}");
        assert!(out.contains("api_key=%5Bredacted%5D"), "{out}");
        assert!(out.contains("< set-cookie: [redacted]"), "{out}");
        assert!(out.contains("< pong"), "{out}");
        assert!(!out.contains("Bearer t"));
    }

    #[test]
    fn colour_is_applied_only_when_enabled() {
        let mut out = Vec::new();
        let mut err = Vec::new();
        {
            let mut reporter = ConsoleReporter::new(Verbosity::Normal, true, &mut out, &mut err);
            reporter.on_event(&ExecutionEvent {
                execution_id: "x".into(),
                sequence: 1,
                visit: None,
                kind: "request-completed".into(),
                data: json!({"index": 0, "result": {"status": "success", "method": "GET", "path": "/a", "statusCode": 200, "time": 1, "testResults": []}}),
            });
        }
        assert!(
            String::from_utf8(out)
                .unwrap()
                .starts_with("\x1b[32m✓\x1b[0m GET /a")
        );
    }

    #[test]
    fn long_bodies_are_truncated() {
        let big = "x".repeat(BODY_PREVIEW_LIMIT + 10);
        let shown = preview(&Value::String(big));
        assert!(shown.ends_with("… (65546 bytes)"));
    }
}
