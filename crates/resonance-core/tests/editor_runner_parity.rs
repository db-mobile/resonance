use resonance_core::{
    model::*,
    preparation::{finalize, prepare, refresh},
    scripts::{ScriptExecutionData, script_execute_pre_request},
    variables::VariableProcessor,
};
use serde_json::{Value, json};
#[tokio::test]
async fn matches_both_original_gui_paths_including_script_mutations_cookies_and_certificates() {
    let fixtures: Vec<Value> = serde_json::from_str(include_str!(
        "../../../tests/fixtures/execution/editor-runner.json"
    ))
    .unwrap();
    for fixture in fixtures {
        let context: ExecutionContext = serde_json::from_value(fixture["context"].clone()).unwrap();
        let mut outcomes = vec![];
        for kind in ["editor", "runner"] {
            let request: RequestTemplate = serde_json::from_value(fixture[kind].clone()).unwrap();
            let mut processor = VariableProcessor::default();
            let mut prepared = prepare(
                &request,
                &context,
                &context.environment,
                &mut processor,
                None,
            )
            .unwrap();
            if !request.pre_request_script.is_empty() {
                let payload:ScriptExecutionData=serde_json::from_value(json!({"script":request.pre_request_script,"request":prepared.request,"environment":context.environment})).unwrap();
                let script = script_execute_pre_request(context.proxy.clone(), payload)
                    .await
                    .unwrap();
                assert!(script.success, "{:?}", script.errors);
                let rebuilt = prepare(
                    &request,
                    &context,
                    &context.environment,
                    &mut processor,
                    None,
                )
                .unwrap();
                prepared = refresh(
                    &prepared,
                    &script.modified_request.unwrap(),
                    rebuilt,
                    &mut processor,
                    &context.environment,
                    &request,
                );
            }
            finalize(&mut prepared, &context);
            let mut actual = prepared.request;
            let mut expected = fixture["expected"][kind].clone();
            for value in [&mut actual, &mut expected] {
                value.as_object_mut().unwrap().remove("rawUrl");
                value.as_object_mut().unwrap().retain(|_, v| !v.is_null());
                if let Some(cert) = value["clientCert"].as_object_mut() {
                    cert.retain(|_, v| !v.is_null());
                }
            }
            assert_eq!(actual, expected, "{} {kind}", fixture["name"]);
            outcomes.push(actual);
        }
        assert_eq!(outcomes[0], outcomes[1], "{}", fixture["name"]);
    }
}
