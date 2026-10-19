use resonance_core::{
    execution::{Cancellation, execute_request, execute_run},
    model::*,
};
use serde_json::json;
#[tokio::test]
async fn pre_script_skip_emits_pinned_deltas_but_no_network_or_local_persistence() {
    let input:RequestInput=serde_json::from_value(json!({"executionId":"one","context":{"environmentId":"env-a"},"request":{"url":"http://127.0.0.1:1","preRequestScript":"pm.environment.set('token','x'); pm.variables.set('local',7); pm.execution.skipRequest();"}})).unwrap();
    let mut events = vec![];
    let result = execute_request(input, Cancellation::default(), |event| events.push(event)).await;
    let result = serde_json::to_value(result).unwrap();
    let result = serde_json::to_value(result).unwrap();
    assert_eq!(result["status"], "skipped");
    assert_eq!(result["sent"], false);
    let effects: Vec<_> = events.iter().filter(|e| e.kind == "effect").collect();
    assert_eq!(effects.len(), 1);
    assert_eq!(effects[0].data["environmentId"], "env-a");
    assert_eq!(effects[0].data["environment"]["token"], "x");
    assert!(effects[0].data.get("local").is_none());
    assert_eq!(events.iter().filter(|e| e.kind == "completed").count(), 1);
    for (i, event) in events.iter().enumerate() {
        assert_eq!(event.sequence, i as u64 + 1);
    }
}
#[tokio::test]
async fn run_uses_same_executor_preserves_duplicates_and_cancels_delay() {
    let input:RunInput=serde_json::from_value(json!({"executionId":"run","runnerName":"Run","runnerId":null,"dataFile":null,"context":{},"options":{"delayMs":10000},"requests":[{"name":"A","endpointId":"a","url":"http://127.0.0.1:1","preRequestScript":"pm.execution.skipRequest();"},{"name":"A","endpointId":"a","url":"http://127.0.0.1:1","preRequestScript":"pm.execution.skipRequest();"}]})).unwrap();
    let token = Cancellation::default();
    let cancel = token.clone();
    let mut events = vec![];
    let result = tokio::time::timeout(
        std::time::Duration::from_secs(2),
        execute_run(input, token, |event| {
            if event.kind == "request-completed" {
                cancel.cancel();
            }
            events.push(event);
        }),
    )
    .await
    .unwrap();
    let result = serde_json::to_value(result).unwrap();
    assert_eq!(result["terminationReason"], "stoppedByUser");
    assert_eq!(result["requests"].as_array().unwrap().len(), 1);
    assert_eq!(events.iter().filter(|e| e.kind == "completed").count(), 1);
}
#[tokio::test]
async fn network_and_post_script_share_execution_local_state() {
    use axum::{Router, extract::Request, response::IntoResponse, routing::any};
    async fn echo(request: Request) -> impl IntoResponse {
        (
            [("set-cookie", "sid=abc; Path=/")],
            request.uri().to_string(),
        )
    }
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let server = tokio::spawn(async move {
        axum::serve(listener, Router::new().fallback(any(echo)))
            .await
            .unwrap()
    });
    let input:RunInput=serde_json::from_value(json!({"executionId":"run","runnerName":"Run","runnerId":null,"dataFile":null,"context":{},"requests":[
        {"endpointId":"a","url":format!("http://{addr}/{{{{token}}}}"),"preRequestScript":"pm.variables.set('token',7);","testScript":"pm.test('echo',function(){pm.expect(pm.response.text()).to.equal('/7')});pm.environment.set('next','value');"},
        {"endpointId":"b","url":format!("http://{addr}/{{{{next}}}}"),"testScript":"pm.test('cookie',function(){pm.expect(pm.request.headers.get('Cookie')).to.equal('sid=abc')});"}
    ]})).unwrap();
    let result = execute_run(input, Cancellation::default(), |_| {}).await;
    let result = serde_json::to_value(result).unwrap();
    let result = serde_json::to_value(result).unwrap();
    assert_eq!(result["passed"], 2, "{result}");
    assert_eq!(result["requests"][1]["apiResponse"]["data"], "/value");
    server.abort();
}
