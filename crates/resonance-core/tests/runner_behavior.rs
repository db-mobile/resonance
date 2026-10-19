use resonance_core::{
    execution::{Cancellation, execute_run},
    model::RunInput,
};
use serde_json::{Value, json};
#[tokio::test]
async fn preserves_runner_behavior_with_real_scripts_and_http() {
    use axum::{Router, extract::Request, http::StatusCode, response::IntoResponse, routing::any};
    async fn echo(request: Request) -> impl IntoResponse {
        let status = if request.uri().path() == "/404" {
            StatusCode::NOT_FOUND
        } else {
            StatusCode::OK
        };
        (
            status,
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
    let fixtures: Vec<Value> = serde_json::from_str(include_str!(
        "../../../tests/fixtures/execution/runner.json"
    ))
    .unwrap();
    for fixture in fixtures {
        let mut context = fixture
            .get("context")
            .cloned()
            .unwrap_or(json!({"environment":{}}));
        context["environment"]["server"] = format!("http://{addr}").into();
        let input:RunInput=serde_json::from_value(json!({"executionId":"fixtures","runnerId":null,"runnerName":fixture["name"],"requests":fixture["requests"],"context":context,"options":fixture.get("options").cloned().unwrap_or(json!({})),"dataFile":fixture["dataFile"]})).unwrap();
        let mut events = vec![];
        let result = execute_run(input, Cancellation::default(), |event| events.push(event)).await;
        let result = serde_json::to_value(result).unwrap();
        let result = serde_json::to_value(result).unwrap();
        for (key, expected) in fixture["expected"].as_object().unwrap() {
            assert_eq!(
                &result[key], expected,
                "{}: {key}\n{result}",
                fixture["name"]
            );
        }
        assert_eq!(events.iter().filter(|e| e.kind == "completed").count(), 1);
        for (index, request) in result["requests"].as_array().unwrap().iter().enumerate() {
            assert_eq!(request["index"], index);
        }
    }
    server.abort();
}
