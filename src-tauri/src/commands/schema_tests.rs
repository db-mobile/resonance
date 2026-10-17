use super::*;
use serde_json::json;

fn assert_validation(schema: Value, valid: Value, invalid: Value, keyword: &str) {
    assert!(check_schema(&schema).valid, "schema: {schema}");
    assert!(
        validate_instance(&schema, &valid).valid,
        "valid instance: {valid}"
    );
    let result = validate_instance(&schema, &invalid);
    assert!(result.schema_valid, "{:?}", result.errors);
    assert!(
        !result.valid,
        "invalid instance: {invalid}, schema: {schema}"
    );
    assert!(
        result.errors.iter().any(|error| error.keyword == keyword),
        "{:?}",
        result.errors
    );
}

#[test]
fn previously_ignored_keywords_reject_invalid_responses() {
    assert_validation(
        json!({"oneOf":[{"type":"string"},{"type":"number"}]}),
        json!("yes"),
        json!(true),
        "oneOf",
    );
    assert_validation(
        json!({"const":"expected"}),
        json!("expected"),
        json!("wrong"),
        "const",
    );
    assert_validation(
        json!({"not":{"type":"number"}}),
        json!("yes"),
        json!(42),
        "not",
    );
}

#[test]
fn composition_and_conditionals() {
    assert_validation(
        json!({"allOf":[{"type":"number"},{"minimum":2}]}),
        json!(2),
        json!(1),
        "minimum",
    );
    assert_validation(
        json!({"anyOf":[{"type":"string"},{"type":"number"}]}),
        json!(2),
        json!(true),
        "anyOf",
    );
    assert_validation(
        json!({"oneOf":[{"type":"number"},{"type":"integer"}]}),
        json!(1.5),
        json!(2),
        "oneOf",
    );
    assert_validation(
        json!({"if":{"type":"number"},"then":{"minimum":2},"else":{"const":"ok"}}),
        json!(2),
        json!(1),
        "minimum",
    );
}

#[test]
fn objects_arrays_and_structural_equality() {
    assert_validation(
        json!({"type":"object","required":["a"],"properties":{"a":{"type":"integer"}},"additionalProperties":false}),
        json!({"a":1}),
        json!({"a":1,"b":2}),
        "additionalProperties",
    );
    assert_validation(
        json!({"type":"array","uniqueItems":true}),
        json!([1, 2]),
        json!([1, 1]),
        "uniqueItems",
    );
    assert_validation(
        json!({"type":"array","contains":{"const":2}}),
        json!([1, 2]),
        json!([1, 3]),
        "contains",
    );
    assert_validation(
        json!({"enum":[{"a":[1,2]}]}),
        json!({"a":[1,2]}),
        json!({"a":[2,1]}),
        "enum",
    );
    assert_validation(
        json!({"type":"number","multipleOf":2}),
        json!(4),
        json!(3),
        "multipleOf",
    );
}

#[test]
fn numeric_and_legacy_exclusive_bounds() {
    let upper = validate_instance(
        &json!({"type":"number","exclusiveMinimum":0,"exclusiveMaximum":10}),
        &json!(10),
    );
    assert!(!upper.valid);
    assert_eq!(upper.errors[0].keyword, "exclusiveMaximum");
    assert_validation(
        json!({"type":"number","exclusiveMinimum":0,"exclusiveMaximum":10}),
        json!(5),
        json!(0),
        "exclusiveMinimum",
    );
    assert_validation(
        json!({"type":"number","minimum":0,"exclusiveMinimum":true}),
        json!(1),
        json!(0),
        "exclusiveMinimum",
    );
    assert_validation(
        json!({"type":"number","maximum":10,"exclusiveMaximum":true}),
        json!(9),
        json!(10),
        "exclusiveMaximum",
    );
    assert_validation(
        json!({"type":"number","minimum":0,"exclusiveMinimum":false}),
        json!(0),
        json!(-1),
        "minimum",
    );
    assert!(validate_instance(&json!({"type":"number"}), &json!(5)).valid);
    assert!(!validate_instance(&json!({"type":"integer"}), &json!(1.5)).valid);
}

#[test]
fn openapi_nullable_does_not_remove_other_constraints_or_mutate_data() {
    let schema = json!({"properties":{"name":{"type":"string","nullable":true},"n":{"minimum":0,"exclusiveMinimum":true}}});
    let original = schema.clone();
    let data = json!({"name":null,"n":1});
    assert!(validate_instance(&schema, &data).valid);
    assert_eq!(schema, original);
    assert_eq!(data, json!({"name":null,"n":1}));
    assert!(
        !validate_instance(
            &json!({"type":"string","nullable":true,"enum":["x"]}),
            &Value::Null
        )
        .valid
    );
    // These look like schemas but are literal data and must stay untouched.
    let literal = json!({"type":"number","nullable":true,"exclusiveMinimum":true});
    assert!(validate_instance(&json!({"const":literal}), &literal).valid);
}

#[test]
fn boolean_and_empty_schemas() {
    assert!(check_schema(&json!(false)).valid);
    assert!(validate_instance(&json!(true), &Value::Null).valid);
    let result = validate_instance(&json!(false), &json!("anything"));
    assert!(!result.valid);
    assert!(result.schema_valid);
    assert!(validate_instance(&json!({}), &json!(false)).valid);
}

#[tokio::test]
async fn command_results_use_the_frontend_contract() {
    let checked = schema_check(json!(false)).await.unwrap();
    assert!(checked.valid);
    let validated = schema_validate(json!({"const":1}), json!(2)).await.unwrap();
    let output = serde_json::to_value(validated).unwrap();
    assert_eq!(output["schemaValid"], true);
    assert_eq!(output["valid"], false);
    assert_eq!(output["errors"][0]["keyword"], "const");
}

#[test]
fn local_and_recursive_references() {
    for schema in [
        json!({"definitions":{"maybe":{"type":"string","nullable":true}},"$ref":"#/definitions/maybe"}),
        json!({"$schema":"http://json-schema.org/draft-07/schema#","$defs":{"maybe":{"type":"string","nullable":true}},"$ref":"#/$defs/maybe"}),
        json!({"custom":{"type":"string","nullable":true},"$ref":"#/custom"}),
    ] {
        assert!(
            validate_instance(&schema, &Value::Null).valid,
            "{:?}",
            validate_instance(&schema, &Value::Null)
        );
    }
    assert_validation(
        json!({"$defs":{"number":{"type":"number"}},"properties":{"value":{"$ref":"#/$defs/number"}}}),
        json!({"value":1}),
        json!({"value":"x"}),
        "type",
    );
    let schema =
        json!({"type":"object","properties":{"value":{"type":"integer"},"child":{"$ref":"#"}}});
    assert!(validate_instance(&schema, &json!({"value":1,"child":{"value":2}})).valid);
    assert!(!validate_instance(&schema, &json!({"child":{"value":"wrong"}})).valid);
}

#[test]
fn supported_dialects_and_modern_keywords() {
    for dialect in [
        "http://json-schema.org/draft-04/schema#",
        "http://json-schema.org/draft-06/schema#",
        "http://json-schema.org/draft-07/schema#",
        "https://json-schema.org/draft/2019-09/schema",
        "https://json-schema.org/draft/2020-12/schema",
        "https://spec.openapis.org/oas/3.1/dialect/base",
    ] {
        assert_validation(
            json!({"$schema":dialect,"type":"number"}),
            json!(1),
            json!("no"),
            "type",
        );
    }
    assert_validation(
        json!({"$schema":"http://json-schema.org/draft-04/schema#","minimum":0,"exclusiveMinimum":true}),
        json!(1),
        json!(0),
        "exclusiveMinimum",
    );
    assert_validation(
        json!({"prefixItems":[{"type":"integer"}],"items":false}),
        json!([1]),
        json!([1, 2]),
        "items",
    );
    assert_validation(
        json!({"allOf":[{"properties":{"a":{"type":"number"}}}],"unevaluatedProperties":false}),
        json!({"a":1}),
        json!({"b":1}),
        "unevaluatedProperties",
    );
}

#[test]
fn malformed_schemas_and_unresolved_references_are_errors() {
    let bundled_meta = json!({"$ref":"https://json-schema.org/draft/2020-12/schema"});
    assert!(!check_schema(&bundled_meta).schema_valid);
    assert!(!validate_instance(&bundled_meta, &json!({})).schema_valid);
    for schema in [
        Value::Null,
        json!(42),
        json!([]),
        json!({"type":"nonsense"}),
        json!({"required":"a"}),
        json!({"pattern":"["}),
        json!({"$schema":"https://unknown.example/schema"}),
        json!({"$ref":"#/$defs/missing"}),
        json!({"$ref":"https://example.invalid/schema"}),
        json!({"$ref":"file:///etc/passwd"}),
    ] {
        let checked = check_schema(&schema);
        assert!(
            !checked.valid && !checked.schema_valid,
            "must reject schema {schema}"
        );
        let result = validate_instance(&schema, &json!({}));
        assert!(!result.valid && !result.schema_valid);
        assert!(!result.errors.is_empty());
    }
}

#[test]
fn normalization_preserves_inactive_dialect_keywords() {
    let schema = json!({
        "$schema":"http://json-schema.org/draft-07/schema#",
        "type":"number",
        "prefixItems":[{"exclusiveMinimum":true}]
    });
    assert!(check_schema(&schema).valid, "{:?}", check_schema(&schema));
    assert!(validate_instance(&schema, &json!(1)).valid);
    let schema = json!({
        "$schema":"http://json-schema.org/draft-04/schema#",
        "dependentSchemas":{"x":{"$schema":"https://unknown.example/schema"}},
        "if":{"exclusiveMinimum":true}
    });
    let mut normalized = schema.clone();
    normalize_openapi(&mut normalized, Draft::Draft4).unwrap();
    assert_eq!(normalized, schema);
}

#[test]
fn formats_and_error_paths() {
    assert_validation(
        json!({"format":"ipv4"}),
        json!("127.0.0.1"),
        json!("999.0.0.1"),
        "format",
    );
    assert_validation(
        json!({"format":"email"}),
        json!("a@example.com"),
        json!("invalid"),
        "format",
    );
    assert_validation(
        json!({"format":"url"}),
        json!("https://example.com"),
        json!("not a URL"),
        "format",
    );
    let result = validate_instance(
        &json!({"properties":{"a":{"type":"integer"}}}),
        &json!({"a":"wrong"}),
    );
    assert_eq!(result.errors[0].path, "/a");
}
