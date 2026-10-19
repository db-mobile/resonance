use resonance_core::{model::*, preparation::prepare, variables::VariableProcessor};
use serde_json::json;
#[test]
fn raw_templates_preserve_duplicate_queries_auth_and_graphql() {
    let request: RequestTemplate = serde_json::from_value(json!({
        "method":"POST", "protocol":"graphql", "url":"{{host}}/{{id}}",
        "pathParams":{"id":"{{number}}"}, "queryRows":[{"key":"q","value":"a b"},{"key":"q","value":"%20"}],
        "defaultHeaders":{"Accept":"application/json"}, "headers":{"X-Value":"{{number}}"},
        "body":{"graphql":{"query":"query { user(id: {{number}}) { id } }","variables":"{\"id\":{{number}}}"}},
        "auth":{"type":"inherit"}, "inheritedAuth":[{"source":{"kind":"collection"},"authConfig":{"type":"bearer","config":{"token":"{{token}}"}}}]
    })).unwrap();
    let vars =
        serde_json::from_value(json!({"host":"api.test","number":7,"token":"secret"})).unwrap();
    let prepared = prepare(
        &request,
        &ExecutionContext::default(),
        &vars,
        &mut VariableProcessor::default(),
        None,
    )
    .unwrap();
    assert_eq!(prepared.request["url"], "https://api.test/7?q=a%20b&q=%20");
    assert_eq!(
        prepared.request["headers"]["Authorization"],
        "Bearer secret"
    );
    assert_eq!(prepared.request["body"]["variables"]["id"], 7);
}
#[test]
fn empty_and_invalid_json_bodies_are_distinct() {
    let mut request: RequestTemplate =
        serde_json::from_value(json!({"method":"POST","url":"api.test"})).unwrap();
    assert!(
        prepare(
            &request,
            &ExecutionContext::default(),
            &Variables::new(),
            &mut VariableProcessor::default(),
            None
        )
        .unwrap()
        .request["body"]
            .is_null()
    );
    request.body.content = "{".into();
    assert_eq!(
        prepare(
            &request,
            &ExecutionContext::default(),
            &Variables::new(),
            &mut VariableProcessor::default(),
            None
        )
        .unwrap_err()
        .code,
        "invalidBody"
    );
}

#[test]
fn empty_bearer_auth_keeps_editor_and_saved_runner_defaults() {
    let mut template: RequestTemplate = serde_json::from_value(
        json!({"url":"api.test","auth":{"type":"bearer","config":{"token":""}}}),
    )
    .unwrap();
    let variables = serde_json::from_value(json!({"bearerToken":"fallback"})).unwrap();
    let request = prepare(
        &template,
        &ExecutionContext::default(),
        &variables,
        &mut VariableProcessor::default(),
        None,
    )
    .unwrap();
    assert!(request.request["headers"].get("Authorization").is_none());
    template.bearer_fallback = true;
    let request = prepare(
        &template,
        &ExecutionContext::default(),
        &variables,
        &mut VariableProcessor::default(),
        None,
    )
    .unwrap();
    assert_eq!(
        request.request["headers"]["Authorization"],
        "Bearer fallback"
    );
}

#[test]
fn scripts_cannot_override_transport_settings_and_cross_origin_auth_is_stripped() {
    use resonance_core::preparation::refresh;
    let template: RequestTemplate = serde_json::from_value(json!({"url":"https://api.test/start","auth":{"type":"api-key","config":{"keyName":"secret","keyValue":"token","location":"query"}}})).unwrap();
    let context = ExecutionContext::default();
    let vars = Variables::new();
    let mut processor = VariableProcessor::default();
    let before = prepare(&template, &context, &vars, &mut processor, None).unwrap();
    let mut modified = before.request.clone();
    modified["url"] = "https://other.test/?secret=token".into();
    modified["verifySsl"] = false.into();
    modified["bodyType"] = "binary".into();
    modified["clientCert"] = json!({"certPath":"private.pem"});
    modified["timeout"] = 1.into();
    let rebuilt = prepare(&template, &context, &vars, &mut processor, None).unwrap();
    let result = refresh(
        &before,
        &modified,
        rebuilt,
        &mut processor,
        &vars,
        &template,
    );
    for field in ["verifySsl", "bodyType", "clientCert", "timeout"] {
        assert_eq!(result.request[field], before.request[field], "{field}");
    }
    assert!(result.request["queryParams"].get("secret").is_none());
    assert!(!result.request["url"].as_str().unwrap().contains("token"));
}
