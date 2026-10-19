use axum::{Router, routing::any};
use resonance_core::{
    execution::{Cancellation, execute_request, execute_run},
    model::*,
    proxy::ProxySettings,
    scripts,
};
use serde_json::{Value, json};
use std::{sync::Arc, time::Duration};

async fn serve(router: Router) -> (String, tokio::task::JoinHandle<()>) {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let task = tokio::spawn(async move {
        axum::serve(listener, router).await.unwrap();
    });
    (url, task)
}

#[tokio::test]
async fn cancellation_interrupts_boa_worker_and_its_auxiliary_http() {
    // Await the worker itself: returning from the outer execution future is
    // insufficient evidence that a blocking Boa worker stopped.
    for network in [false, true] {
        let entered = Arc::new(tokio::sync::Notify::new());
        let notify = entered.clone();
        let (url, server) = serve(Router::new().fallback(any(move || {
            let notify = notify.clone();
            async move {
                notify.notify_one();
                std::future::pending::<String>().await
            }
        })))
        .await;
        let script = if network {
            format!("try {{ sendRequest('{url}') }} catch(e) {{}}; while(true) {{}}")
        } else {
            "while(true) {}".into()
        };
        let data =
            serde_json::from_value(json!({"script":script,"request":{},"environment":{}})).unwrap();
        let token = Cancellation::default();
        let cancel = token.clone();
        let worker = scripts::execute_cancellable(ProxySettings::default(), data, true, token);
        let cancel_work = async {
            if network {
                entered.notified().await;
            } else {
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
            cancel.cancel();
        };
        let (result, _) = tokio::time::timeout(Duration::from_secs(2), async {
            tokio::join!(worker, cancel_work)
        })
        .await
        .unwrap();
        assert!(!result.unwrap().success);
        server.abort();
    }
}

#[tokio::test]
async fn cancelling_each_execution_phase_suppresses_late_effects_and_completes_once() {
    for phase in ["pre", "network", "test", "prepare"] {
        let entered = Arc::new(tokio::sync::Notify::new());
        let notify = entered.clone();
        let (url, server) = serve(Router::new().fallback(any(move |uri: axum::http::Uri| {
            let notify = notify.clone();
            async move {
                if uri.path() == "/wait" {
                    notify.notify_one();
                    std::future::pending::<()>().await;
                }
                "ok"
            }
        })))
        .await;
        let script = format!(
            "pm.environment.set('late','no'); pm.collectionVariables.set('late','no'); cookies.clear(); sendRequest('{url}/wait');"
        );
        let mut request = json!({"url":format!("{url}/ok"),"collectionId":"c"});
        if phase == "network" {
            request["url"] = format!("{url}/wait").into();
        }
        if phase == "pre" {
            request["preRequestScript"] = script.clone().into();
        }
        if phase == "test" {
            request["testScript"] = script.into();
        }
        if phase == "prepare" {
            request["auth"] = json!({"type":"oauth2","config":{"token":"old","expiresAt":1,"grantType":"client_credentials","tokenUrl":format!("{url}/wait"),"clientId":"client"}});
        }
        let input: RequestInput = serde_json::from_value(
            json!({"executionId":phase,"request":request,"context":{"environmentId":"pinned"}}),
        )
        .unwrap();
        let token = Cancellation::default();
        let cancel = token.clone();
        let mut events = vec![];
        let execution = execute_request(input, token, |event| events.push(event));
        let (result, _) = tokio::time::timeout(Duration::from_secs(2), async {
            tokio::join!(execution, async {
                entered.notified().await;
                cancel.cancel();
            })
        })
        .await
        .unwrap();
        let result = serde_json::to_value(result).unwrap();
        assert_eq!(result["cancelled"], true, "{phase}: {result}");
        assert!(events.iter().all(|e| e.kind != "effect"), "{phase}");
        assert_eq!(events.iter().filter(|e| e.kind == "completed").count(), 1);
        server.abort();
    }
}

#[tokio::test]
async fn cancellation_during_delay_stops_scheduling_without_affecting_another_execution() {
    let input: RunInput = serde_json::from_value(json!({"executionId":"run","context":{},"runnerName":"run","options":{"delayMs":60000},"requests":[{"url":"example.test","preRequestScript":"pm.execution.skipRequest();"},{"url":"example.test"}]})).unwrap();
    let token = Cancellation::default();
    let cancel = token.clone();
    let completed_request = Arc::new(tokio::sync::Notify::new());
    let notify = completed_request.clone();
    let execution = execute_run(input, token, move |e| {
        if e.kind == "request-completed" {
            notify.notify_one();
        }
    });
    let (result, _) = tokio::time::timeout(Duration::from_secs(2), async {
        tokio::join!(execution, async {
            completed_request.notified().await;
            tokio::task::yield_now().await;
            cancel.cancel();
        })
    })
    .await
    .unwrap();
    let result = serde_json::to_value(result).unwrap();
    assert_eq!(result["terminationReason"], "stoppedByUser");
    assert_eq!(result["requests"].as_array().unwrap().len(), 1);
    let other: RequestInput = serde_json::from_value(json!({"executionId":"other","context":{},"request":{"url":"example.test","preRequestScript":"pm.execution.skipRequest();"}})).unwrap();
    let result = execute_request(other, Cancellation::default(), |_| {}).await;
    let result = serde_json::to_value(result).unwrap();
    let result = serde_json::to_value(result).unwrap();
    assert_eq!(result["status"], "skipped");
    assert_ne!(result["cancelled"], true);
}

#[tokio::test]
async fn inherited_oauth_renews_once_and_reuses_credentials_without_frontend_callbacks() {
    let tokens = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let counter = tokens.clone();
    let (url, server) = serve(Router::new().fallback(any(
        move |request: axum::extract::Request| {
            let counter = counter.clone();
            async move {
                if request.uri().path() == "/token" {
                    counter.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                    let body = axum::body::to_bytes(request.into_body(), 8192)
                        .await
                        .unwrap();
                    let body = String::from_utf8(body.to_vec()).unwrap();
                    assert!(body.contains("refresh_token=refresh-old"));
                    json!({"access_token":"fresh","refresh_token":"refresh-new","expires_in":3600})
                        .to_string()
                } else {
                    request.headers()["authorization"]
                        .to_str()
                        .unwrap()
                        .to_string()
                }
            }
        },
    )))
    .await;
    let auth = json!({"source":{"kind":"collection"},"authConfig":{"type":"oauth2","config":{"token":"expired","expiresAt":1,"grantType":"authorization_code","refreshToken":"refresh-old","clientId":"{{client}}","tokenUrl":format!("{url}/token")}}});
    let request = json!({"collectionId":"c","url":format!("{url}/api"),"auth":{"type":"inherit"},"inheritedAuth":[auth]});
    let input: RunInput = serde_json::from_value(json!({"executionId":"oauth","runnerName":"oauth","context":{"environment":{"client":"id"}},"requests":[request,request]})).unwrap();
    let mut effects: Vec<Value> = vec![];
    let result = execute_run(input, Cancellation::default(), |event| {
        if event.kind == "effect" {
            effects.push(event.data);
        }
    })
    .await;
    let result = serde_json::to_value(result).unwrap();
    let result = serde_json::to_value(result).unwrap();
    assert_eq!(result["passed"], 2, "{result}");
    assert_eq!(tokens.load(std::sync::atomic::Ordering::SeqCst), 1);
    assert!(
        result["requests"]
            .as_array()
            .unwrap()
            .iter()
            .all(|r| r["apiResponse"]["data"] == "Bearer fresh")
    );
    assert_eq!(effects.len(), 1);
    assert_eq!(effects[0]["source"]["kind"], "collection");
    assert_eq!(effects[0]["changes"]["refreshToken"], "refresh-new");
    assert!(effects[0]["changes"].get("clientId").is_none());
    server.abort();
}
