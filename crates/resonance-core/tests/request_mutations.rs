//! Legacy RequestBuilderService cases, captured before deleting JS orchestration.
use resonance_core::{
    model::*,
    preparation::{Prepared, refresh},
    variables::VariableProcessor,
};
use serde_json::{Map, Value, json};

#[test]
fn script_mutation_and_credential_stripping_match_legacy_fixtures() {
    let fixtures: Vec<Value> = serde_json::from_str(include_str!(
        "../../../tests/fixtures/execution/request-mutations.json"
    ))
    .unwrap();
    let mut failures = vec![];
    for fixture in fixtures {
        let input = &fixture["input"];
        let mutation = fixture["method"] == "applyScriptParamMutations";
        let modified = input["requestConfig"].clone();
        let mut original = modified.clone();
        let mut template = RequestTemplate::default();
        if mutation {
            original
                .as_object_mut()
                .unwrap()
                .extend(input["snapshot"].as_object().unwrap().clone());
            original["rawUrl"] = input["rawUrl"].clone();
            // The legacy snapshot used a generated UUID. Per-request caching has
            // its own test; substitute that already captured value for comparison.
            if input["rawUrl"].as_str().unwrap().contains("{{$uuid}}") {
                let uuid = original["url"]
                    .as_str()
                    .unwrap()
                    .split("/v/")
                    .nth(1)
                    .unwrap()
                    .split('/')
                    .next()
                    .unwrap()
                    .to_string();
                original["rawUrl"] = input["rawUrl"]
                    .as_str()
                    .unwrap()
                    .replace("{{$uuid}}", &uuid)
                    .into();
            }
            template.mock_base_url = input["mockRewrite"]["baseUrl"].as_str().map(str::to_string);
            template.path = input["mockRewrite"]["pathTemplate"]
                .as_str()
                .unwrap_or("")
                .into();
        } else {
            original["url"] = input["originalUrl"].clone();
        }
        let headers: Map<String, Value> = input["authData"]["headers"]
            .as_object()
            .cloned()
            .unwrap_or_default();
        let query: Map<String, Value> = input["authData"]["queryParams"]
            .as_object()
            .cloned()
            .unwrap_or_default();
        let before = Prepared {
            request: original.clone(),
            auth_headers: headers.clone(),
            auth_query: query.clone(),
            stripped_credentials: false,
        };
        let rebuilt = Prepared {
            request: original,
            auth_headers: headers,
            auth_query: query,
            stripped_credentials: false,
        };
        let vars =
            serde_json::from_value(input.get("variables").cloned().unwrap_or(json!({}))).unwrap();
        let result = refresh(
            &before,
            &modified,
            rebuilt,
            &mut VariableProcessor::default(),
            &vars,
            &template,
        );
        let mut actual = result.request;
        actual.as_object_mut().unwrap().remove("rawUrl");
        let mut expected = fixture["request"].clone();
        if mutation {
            expected["url"] = fixture["result"].clone();
        }
        if actual != expected {
            failures.push(format!(
                "{}\nactual: {actual}\nexpected: {expected}",
                fixture["name"]
            ));
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n\n"));
}
