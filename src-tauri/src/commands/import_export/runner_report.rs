//! Desktop report export. Saved summaries predate the core's required run metadata.
use resonance_core::report::{RunSummary, to_junit};
use serde_json::{Value, json};

pub(super) fn render(format: &str, summary: &Value) -> Result<String, String> {
    match format {
        "json" => serde_json::to_string_pretty(summary)
            .map(|text| format!("{text}\n"))
            .map_err(|error| error.to_string()),
        "junit" => Ok(to_junit(&junit_summary(summary)?)),
        _ => Err(format!("Unsupported report format: {format}")),
    }
}

fn junit_summary(summary: &Value) -> Result<RunSummary, String> {
    let requests = summary["requests"]
        .as_array()
        .ok_or("Report summary must contain a requests array")?
        .iter()
        .map(|request| {
            json!({
                "iteration": request["iteration"].as_u64().unwrap_or(1),
                "attempt": request["attempt"].as_u64().unwrap_or(0),
                "queuePosition": 0, "index": 0, "execution": null,
                "name": request["name"].as_str().unwrap_or_default(),
                "method": request["method"].as_str().unwrap_or_default(),
                "path": "", "collectionId": null, "endpointId": null,
                "status": request["status"], "statusCode": request["statusCode"],
                "time": request["time"], "error": request["error"],
                "tests": request.get("tests").cloned().unwrap_or_else(|| json!([]))
            })
        })
        .collect::<Vec<_>>();

    // Project only fields used by JUnit. Desktop-only termination reasons and old
    // summaries without queue metadata must not change or block report export.
    serde_json::from_value(json!({
        "runnerId": null,
        "runnerName": summary["runnerName"].as_str().unwrap_or_default(),
        "startedAt": summary["startedAt"].as_i64().unwrap_or(0), "finishedAt": 0,
        "totalTime": summary["totalTime"].as_i64().unwrap_or(0),
        "iterations": summary["iterations"].as_u64().unwrap_or(1),
        "plannedRequests": 0, "sentRequests": 0, "totalRequests": 0,
        "terminationReason": "completed", "error": summary["error"],
        "summary": {"passed": 0, "failed": 0, "skipped": 0},
        "truncated": false, "requests": requests
    }))
    .map_err(|error| format!("Invalid report summary: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{Value, json};

    fn summary() -> Value {
        serde_json::from_str(include_str!(
            "../../../../tests/fixtures/report/summary.json"
        ))
        .unwrap()
    }

    #[test]
    fn exports_shared_fixtures_byte_for_byte() {
        let summary = summary();
        assert_eq!(
            render("json", &summary).unwrap(),
            include_str!("../../../../tests/fixtures/report/summary.json")
        );
        assert_eq!(
            render("junit", &summary).unwrap(),
            include_str!("../../../../tests/fixtures/report/junit.xml")
        );
    }

    #[test]
    fn json_preserves_legacy_fields_order_and_nulls() {
        let input =
            "{\n  \"runnerName\": \"Old run\",\n  \"startedAt\": null,\n  \"requests\": []\n}\n";
        let summary = serde_json::from_str(input).unwrap();
        assert_eq!(render("json", &summary).unwrap(), input);
    }

    #[test]
    fn legacy_junit_defaults_missing_attempts_and_null_timestamps() {
        let summary = json!({"runnerName": "Old run", "startedAt": null, "totalTime": 0, "iterations": 1,
            "requests": [{"iteration": 1, "name": "Get", "method": "GET", "status": "error",
                "statusCode": 503, "time": null, "tests": []}]});
        let report = render("junit", &summary).unwrap();
        assert!(report.contains("<testsuite name=\"GET Get\" tests=\"1\" failures=\"1\""));
        assert!(report.contains("message=\"503\""));
        assert!(!report.contains("Attempt"));
        assert!(!report.contains("timestamp="));
    }

    #[test]
    fn junit_keeps_iterations_assertions_and_skipped_requests() {
        let mut summary = summary();
        summary["iterations"] = json!(2);
        summary["requests"][0]["iteration"] = json!(2);
        let report = render("junit", &summary).unwrap();
        assert!(report.contains("Iteration 2 › GET List · Attempt 1"));
        assert!(report.contains("message=\"returns &quot;id&quot;\""));
        assert!(report.contains("<skipped message=\"Skipped due to previous error\"/>"));
    }

    #[test]
    fn desktop_persistence_errors_are_exportable_without_a_core_termination_reason() {
        let mut summary = summary();
        summary["terminationReason"] = json!("persistenceError");
        summary["error"] = json!("Could not save history");
        let report = render("junit", &summary).unwrap();
        assert!(report.contains("name=\"Runner execution\""));
        assert!(report.contains("message=\"Could not save history\""));
        assert!(report.contains("message=\"dns error\""));
    }

    #[test]
    fn junit_does_not_duplicate_a_run_error_already_reported_by_a_request() {
        let mut summary = summary();
        summary["error"] = json!("dns error");
        assert!(
            !render("junit", &summary)
                .unwrap()
                .contains("name=\"Runner execution\"")
        );
    }

    #[test]
    fn junit_strips_control_characters_and_escapes_xml() {
        let mut summary = summary();
        summary["requests"][2]["error"] = json!("bad\u{1}<&\"'byte");
        assert!(
            render("junit", &summary)
                .unwrap()
                .contains("bad&lt;&amp;&quot;&apos;byte")
        );
    }

    #[test]
    fn rejects_unknown_formats_and_invalid_request_statuses() {
        assert!(render("csv", &summary()).is_err());
        let mut summary = summary();
        summary["requests"][0]["status"] = json!("invalid");
        assert!(render("junit", &summary).is_err());
    }
}
