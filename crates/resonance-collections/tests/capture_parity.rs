//! The desktop pinned `captureRunnerEntry` with 20 fixtures before this port
//! existed. The fixture `target` is the IPC shape the JavaScript consumed, so
//! the Rust port is checked one to one against the same expected templates,
//! without regenerating anything.
use resonance_collections::capture::{CaptureEntry, CaptureTarget, capture_runner_entry};
use resonance_collections::model::RunnerOverrides;
use resonance_core::model::RequestTemplate;
use serde_json::Value;

#[test]
fn template_capture_fixtures_match_the_js_port() {
    let fixtures: Vec<Value> = serde_json::from_str(include_str!(
        "../../../tests/fixtures/execution/template-capture.json"
    ))
    .unwrap();
    assert_eq!(fixtures.len(), 20);

    for fixture in fixtures {
        let name = fixture["name"].as_str().unwrap();
        let target: CaptureTarget = serde_json::from_value(fixture["target"].clone())
            .unwrap_or_else(|e| panic!("{name}: target: {e}"));
        let overrides: Option<RunnerOverrides> = fixture["entry"]
            .get("overrides")
            .filter(|o| !o.is_null())
            .map(|o| serde_json::from_value(o.clone()).unwrap());
        let entry = CaptureEntry {
            name: fixture["entry"]["name"].as_str().unwrap_or(""),
            overrides: overrides.as_ref(),
            post_response_script: fixture["entry"]["postResponseScript"].as_str(),
            bearer_fallback: true,
        };

        let actual = serde_json::to_value(capture_runner_entry(&entry, &target)).unwrap();
        let expected: RequestTemplate = serde_json::from_value(fixture["expected"].clone())
            .unwrap_or_else(|e| panic!("{name}: expected: {e}"));
        let expected = serde_json::to_value(expected).unwrap();

        assert_eq!(actual, expected, "{name}");
    }
}
