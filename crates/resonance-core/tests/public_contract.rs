use resonance_core::{
    execution::{Cancellation, execute_request, execute_run},
    model::{RequestInput, RequestStatus, RequestTemplate, RunInput, TerminationReason},
};
use serde_json::{Value, json};

#[tokio::test]
async fn headless_callers_can_classify_results_without_json_keys() {
    let input: RequestInput = serde_json::from_value(json!({
        "executionId":"skip", "context":{},
        "request":{"url":"https://example.test", "preRequestScript":"pm.execution.skipRequest()"}
    }))
    .unwrap();
    let result = execute_request(input, Cancellation::default(), |_| {}).await;
    assert_eq!(result.status, RequestStatus::Skipped);
    assert!(!result.sent);
    assert!(result.api_response.is_none());

    let input: RunInput = serde_json::from_value(json!({
        "executionId":"empty", "runnerName":"Empty", "context":{}, "requests":[]
    }))
    .unwrap();
    let result = execute_run(input, Cancellation::default(), |_| {}).await;
    assert_eq!(result.termination_reason, TerminationReason::ExecutionError);
    assert!(!result.succeeded());
    assert_eq!(result.execution_error.unwrap().code, "emptyQueue");
}

#[test]
fn desktop_capture_fixtures_satisfy_the_typed_core_input_contract() {
    for source in [
        include_str!("../../../tests/fixtures/execution/template-capture.json"),
        include_str!("../../../tests/fixtures/execution/manual-capture.json"),
    ] {
        let fixtures: Vec<Value> = serde_json::from_str(source).unwrap();
        for fixture in fixtures {
            serde_json::from_value::<RequestTemplate>(fixture["expected"].clone())
                .unwrap_or_else(|e| panic!("{}: {e}", fixture["name"]));
        }
    }
}
