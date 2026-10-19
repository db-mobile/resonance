//! Golden outputs captured by running the pre-migration runner's 90-test suite.
use resonance_core::{model::*, preparation::prepare, variables::VariableProcessor};
use serde_json::Value;
#[test]
fn matches_captured_runner_request_preparation() {
    let fixtures: Vec<Value> = serde_json::from_str(include_str!(
        "../../../tests/fixtures/execution/request-preparation.json"
    ))
    .unwrap();
    assert!(fixtures.len() > 30);
    let uuid =
        regex::Regex::new(r"[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}")
            .unwrap();
    let mut failures = vec![];
    for fixture in fixtures {
        let request: RequestTemplate = serde_json::from_value(fixture["request"].clone()).unwrap();
        let context: ExecutionContext = serde_json::from_value(fixture["context"].clone()).unwrap();
        let variables: Variables = serde_json::from_value(fixture["variables"].clone()).unwrap();
        let result = prepare(
            &request,
            &context,
            &variables,
            &mut VariableProcessor::default(),
            fixture.get("refreshedAuth"),
        );
        match result {
            Ok(prepared) => {
                let mut actual = prepared.request;
                let mut expected = fixture["expected"].clone();
                // IPC omission and null both represent an absent optional transport field.
                for value in [&mut actual, &mut expected] {
                    value.as_object_mut().unwrap().retain(|_, v| !v.is_null());
                }
                if uuid.replace_all(&actual.to_string(), "<uuid>")
                    != uuid.replace_all(&expected.to_string(), "<uuid>")
                {
                    // Map order is irrelevant to the transport; query order is checked in the URL.
                    let actual: Value =
                        serde_json::from_str(&uuid.replace_all(&actual.to_string(), "<uuid>"))
                            .unwrap();
                    let expected: Value =
                        serde_json::from_str(&uuid.replace_all(&expected.to_string(), "<uuid>"))
                            .unwrap();
                    if actual != expected {
                        failures.push(format!(
                            "{}\nactual: {actual}\nexpected: {expected}",
                            fixture["name"]
                        ));
                    }
                }
            }
            Err(error) => failures.push(format!("{}: {:?}", fixture["name"], error)),
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n\n"));
}
