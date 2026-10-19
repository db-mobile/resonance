use super::*;
use serde_json::json;

fn run(script: &str, pre: bool) -> ScriptResult {
    let data: ScriptExecutionData = serde_json::from_value(json!({
        "script": script, "request": {"url":"https://example.com","method":"GET","headers":{}},
        "environment":{"shared":"env"}, "collectionVariables":{"shared":"collection"},
        "localVariables":{"shared":false,"counter":0},
        "executionContext":{"runner":true,"requestId":"request-1"}
    }))
    .unwrap();
    run_script_sync(data, pre, ProxySettings::default(), None)
}

#[test]
fn native_workflow_control_and_typed_locals() {
    let result = run(
        r#"
        pm.test('id', function(){pm.expect(pm.info.requestId).to.equal('request-1');});
        pm.test('scope', function(){pm.expect(pm.variables.get('shared')).to.equal(false);});
        pm.variables.set('counter', pm.variables.get('counter') + 1);
        pm.variables.set('object', {items:[0,false,null]});
        pm.variables.set('nil', null);
        pm.variables.unset('shared');
        pm.execution.setNextRequest('first');
        postman.setNextRequest(null);
        pm.execution.setNextRequest('last');
    "#,
        true,
    );
    assert!(result.success, "{:?}", result.errors);
    let result = serde_json::to_value(result).unwrap();
    assert_eq!(
        result["execution"]["next"],
        json!({"kind":"request","target":"last"})
    );
    assert_eq!(result["modifiedLocalVariables"]["counter"], 1);
    assert_eq!(result["modifiedLocalVariables"]["nil"], Value::Null);
    assert_eq!(
        result["modifiedLocalVariables"]["object"],
        json!({"items":[0,false,null]})
    );
    assert_eq!(result["removedLocalVariables"], json!(["shared"]));
    assert!(
        result["testResults"]
            .as_array()
            .unwrap()
            .iter()
            .all(|r| r["passed"] == true)
    );
}

#[test]
fn skip_is_immediate_uncatchable_and_not_an_error() {
    let result = run(
        r#"
        pm.variables.set('before', true);
        pm.execution.setNextRequest('elsewhere');
        try { pm.execution.skipRequest(); } catch(e) { pm.variables.set('caught',true); }
        pm.variables.set('after', true);
    "#,
        true,
    );
    assert!(result.success, "{:?}", result.errors);
    let result = serde_json::to_value(result).unwrap();
    assert_eq!(
        result["execution"],
        json!({"next":{"kind":"unchanged"},"skipped":true})
    );
    assert_eq!(result["modifiedLocalVariables"], json!({"before":true}));
    assert!(result["errors"].as_array().unwrap().is_empty());
    assert!(result["testResults"].as_array().unwrap().is_empty());
}

#[test]
fn flow_validation_errors_discard_navigation() {
    for script in [
        "pm.execution.setNextRequest(1)",
        "pm.execution.skipRequest()",
        "pm.execution.setNextRequest('next'); throw new Error('bad')",
    ] {
        let result = run(script, false);
        assert!(!result.success);
        let result = serde_json::to_value(result).unwrap();
        assert_eq!(result["execution"]["next"], json!({"kind":"unchanged"}));
    }
}

#[test]
fn local_variables_reject_values_that_cannot_round_trip_as_json() {
    for value in [
        "undefined",
        "NaN",
        "Infinity",
        "1n",
        "function() {}",
        "Symbol('x')",
        "{nested: undefined}",
        "{nested: Infinity}",
    ] {
        let result = run(&format!("pm.variables.set('bad', {value});"), true);
        assert!(!result.success, "Accepted {value}");
        assert!(result.modified_local_variables.is_empty());
    }
    let cyclic = run(
        "var cycle = {}; cycle.self = cycle; pm.variables.set('bad', cycle);",
        true,
    );
    assert!(!cyclic.success);
    assert!(cyclic.modified_local_variables.is_empty());
}

#[test]
fn manual_navigation_is_a_noop_and_local_unset_reveals_lower_scopes() {
    let data: ScriptExecutionData = serde_json::from_value(json!({
        "script": "pm.execution.setNextRequest('missing'); pm.variables.unset('shared'); pm.test('fallback', function() { pm.expect(pm.variables.get('shared')).to.equal('environment'); });",
        "request": {"url":"https://example.com","method":"GET","headers":{}},
        "environment":{"shared":"environment"}, "localVariables":{"shared": false},
        "executionContext":{"runner":false,"requestId":"manual"}
    })).unwrap();
    let result = run_script_sync(data, true, ProxySettings::default(), None);
    assert!(result.success, "{:?}", result.errors);
    assert!(result.test_results.iter().all(|test| test.passed));
    assert!(matches!(result.execution.next, NextRequest::Unchanged));
    assert_eq!(result.removed_local_variables, vec!["shared"]);
}
