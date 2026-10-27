use resonance_core::{
    execution::{Cancellation, execute_request, execute_run},
    model::*,
};
use serde_json::json;

#[tokio::test]
async fn get_and_delete_bodies_reach_the_server_in_single_requests_and_runs() {
    use axum::{Json, Router, extract::Request, routing::any};
    async fn echo(request: Request) -> Json<serde_json::Value> {
        let method = request.method().to_string();
        let content_type = request
            .headers()
            .get("content-type")
            .map(|v| v.to_str().unwrap().to_owned());
        let bytes = axum::body::to_bytes(request.into_body(), 1024)
            .await
            .unwrap();
        Json(
            json!({"method":method,"contentType":content_type,"body":String::from_utf8(bytes.to_vec()).unwrap()}),
        )
    }
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}/echo", listener.local_addr().unwrap());
    let server = tokio::spawn(async move {
        axum::serve(listener, Router::new().fallback(any(echo)))
            .await
            .unwrap();
    });
    for method in ["GET", "DELETE"] {
        for (mode, content, expected, content_type) in [
            (
                "json",
                r#"{"id":{{id}}}"#,
                r#"{"id":7}"#,
                "application/json",
            ),
            ("json", "[{{id}}]", "[7]", "application/json"),
            ("json", "false", "false", "application/json"),
            ("json", "0", "0", "application/json"),
            ("text", " Grüße {{id}}\n", " Grüße 7\n", "text/plain"),
        ] {
            let template = json!({"protocol":"http","method":method,"url":url,
                "body":{"mode":mode,"content":content}});
            let input = serde_json::from_value(json!({"executionId":"single",
                "context":{"environment":{"id":7}},"request":template}))
            .unwrap();
            let single = execute_request(input, Cancellation::default(), |_| {}).await;
            let input = serde_json::from_value(json!({"executionId":"run","runnerName":"Bodies",
                "context":{"environment":{"id":7}},"requests":[template]}))
            .unwrap();
            let run = execute_run(input, Cancellation::default(), |_| {}).await;
            for result in [&single, &run.requests[0]] {
                assert!(result.sent, "{method} {mode}: {result:?}");
                let response = result.api_response.as_ref().unwrap();
                assert_eq!(response.status, Some(200), "{result:?}");
                assert_eq!(
                    response.data,
                    Some(json!({"method":method,"contentType":content_type,"body":expected}))
                );
            }
        }
    }
    server.abort();
}

#[tokio::test]
async fn invalid_get_json_is_rejected_before_sending() {
    let input = serde_json::from_value(json!({"executionId":"invalid","context":{},
        "request":{"method":"GET","url":"http://127.0.0.1:1",
            "body":{"mode":"json","content":"{"}}}))
    .unwrap();
    let result = execute_request(input, Cancellation::default(), |_| {}).await;
    assert!(!result.sent);
    assert_eq!(result.execution_error.unwrap().code, "invalidBody");
}

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

#[tokio::test]
async fn strict_variables_fails_the_visit_before_sending_but_lenient_runs_do_not() {
    for strict in [true, false] {
        let input: RunInput = serde_json::from_value(json!({
            "executionId":"strict","runnerName":"Run","runnerId":null,"dataFile":null,"context":{},
            "options":{"strictVariables":strict},
            "requests":[{"name":"A","url":"http://127.0.0.1:1/{{missing}}"}]
        }))
        .unwrap();
        let mut warnings = vec![];
        let result = execute_run(input, Cancellation::default(), |event| {
            if event.kind == "warning" {
                warnings.push(event.data);
            }
        })
        .await;
        let request = &result.requests[0];
        if strict {
            assert!(!request.sent, "{result:?}");
            assert_eq!(
                request.execution_error.as_ref().unwrap().code,
                "unresolvedVariables"
            );
            assert_eq!(
                request.execution_error.as_ref().unwrap().details,
                json!(["missing"])
            );
        } else {
            assert!(request.sent);
            assert!(
                warnings.is_empty(),
                "runner visits never warn: {warnings:?}"
            );
            assert!(
                request
                    .execution_error
                    .as_ref()
                    .is_none_or(|e| e.code != "unresolvedVariables"),
                "{result:?}"
            );
        }
    }
}

#[tokio::test]
async fn strict_variables_sees_values_set_by_earlier_scripts() {
    let input: RunInput = serde_json::from_value(json!({
        "executionId":"strict-chain","runnerName":"Run","runnerId":null,"dataFile":null,"context":{"environmentId":"e"},
        "options":{"strictVariables":true,"stopOnError":false},
        "requests":[
            {"name":"Seed","url":"http://127.0.0.1:1/seed","preRequestScript":"pm.environment.set('next','value'); pm.execution.skipRequest();"},
            {"name":"Use","url":"http://127.0.0.1:1/{{next}}"}
        ]
    }))
    .unwrap();
    let result = execute_run(input, Cancellation::default(), |_| {}).await;
    assert_eq!(
        result.requests[0].status,
        resonance_core::model::RequestStatus::Skipped
    );
    let used = &result.requests[1];
    assert!(used.sent, "{result:?}");
    assert!(
        used.execution_error
            .as_ref()
            .is_none_or(|e| e.code != "unresolvedVariables")
    );
}

#[tokio::test]
async fn runner_scripts_read_the_request_tags() {
    let input: RunInput = serde_json::from_value(json!({
        "executionId":"tags","runnerName":"Run","runnerId":null,"dataFile":null,"context":{"environmentId":"e"},
        "options":{"stopOnError":false},
        "requests":[
            {"name":"Tagged","url":"http://127.0.0.1:1/a","tags":["smoke","Pets"],"preRequestScript":"pm.environment.set('tagged', JSON.stringify(request.tags)); pm.execution.skipRequest();"},
            {"name":"Plain","url":"http://127.0.0.1:1/b","preRequestScript":"pm.environment.set('plain', JSON.stringify(request.tags)); pm.execution.skipRequest();"}
        ]
    }))
    .unwrap();
    let mut effects = vec![];
    execute_run(input, Cancellation::default(), |event| {
        if event.kind == "effect" {
            effects.push(event.data);
        }
    })
    .await;
    assert_eq!(
        effects[0]["environment"]["tagged"],
        json!("[\"smoke\",\"Pets\"]")
    );
    assert_eq!(effects[1]["environment"]["plain"], json!("[]"));
}
