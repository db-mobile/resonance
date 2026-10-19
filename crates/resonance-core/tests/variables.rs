use resonance_core::{model::Variables, variables::VariableProcessor};
use serde_json::Value;

#[test]
fn unresolved_names_include_nested_keys_and_unknown_dynamics_once() {
    let value =
        serde_json::json!({"{{header}}":"{{missing}}", "body":["{{$unknown}}", "{{missing}}"]});
    assert_eq!(
        resonance_core::variables::unresolved_names(&value),
        vec!["header", "missing", "$unknown"]
    );
}
#[test]
fn shared_frontend_template_fixtures() {
    let fixtures: Vec<Value> = serde_json::from_str(include_str!(
        "../../../tests/fixtures/execution/variables.json"
    ))
    .unwrap();
    for case in fixtures {
        let variables: Variables = serde_json::from_value(case["variables"].clone()).unwrap();
        assert_eq!(
            VariableProcessor::default().text(case["input"].as_str().unwrap(), &variables),
            case["expected"]
        );
    }
}
#[test]
fn dynamic_values_are_cached_per_request_and_unknown_values_remain_unresolved() {
    let mut processor = VariableProcessor::default();
    let values = Variables::new();
    let first = processor.text("{{$uuid}}", &values);
    assert_eq!(first, processor.text("{{$uuid}}", &values));
    assert_ne!(
        first,
        VariableProcessor::default().text("{{$uuid}}", &values)
    );
    assert_eq!(processor.text("{{$randomInt:7:7}}", &values), "7");
}
