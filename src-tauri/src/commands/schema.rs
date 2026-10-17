//! Local response/schema validation. References never read the network or filesystem.

use jsonschema::{Draft, Validator};
use serde::Serialize;
use serde_json::Value;

#[derive(Debug, Serialize)]
pub struct SchemaError {
    path: String,
    message: String,
    keyword: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SchemaResult {
    valid: bool,
    schema_valid: bool,
    errors: Vec<SchemaError>,
}

impl SchemaResult {
    fn invalid_schema(message: String) -> Self {
        Self {
            valid: false,
            schema_valid: false,
            errors: vec![SchemaError {
                path: "/".into(),
                message,
                keyword: "schema".into(),
            }],
        }
    }
}

fn schema_draft(schema: &Value) -> Result<Draft, String> {
    let Some(dialect) = schema.get("$schema") else {
        return Ok(Draft::Draft202012);
    };
    let dialect = dialect.as_str().ok_or("$schema must be a URI string")?;
    match dialect.trim_end_matches('#').trim_end_matches('/') {
        "http://json-schema.org/draft-04/schema" | "https://json-schema.org/draft-04/schema" => {
            Ok(Draft::Draft4)
        }
        "http://json-schema.org/draft-06/schema" | "https://json-schema.org/draft-06/schema" => {
            Ok(Draft::Draft6)
        }
        "http://json-schema.org/draft-07/schema" | "https://json-schema.org/draft-07/schema" => {
            Ok(Draft::Draft7)
        }
        "https://json-schema.org/draft/2019-09/schema"
        | "http://json-schema.org/draft/2019-09/schema" => Ok(Draft::Draft201909),
        "https://json-schema.org/draft/2020-12/schema"
        | "http://json-schema.org/draft/2020-12/schema"
        | "https://spec.openapis.org/oas/3.1/dialect/base" => Ok(Draft::Draft202012),
        _ => Err(format!("Unsupported JSON Schema dialect: {dialect}")),
    }
}

/// Normalize a single schema node, never annotation or instance data.
fn normalize_openapi(schema: &mut Value, inherited_draft: Draft) -> Result<(), String> {
    let draft = if schema.get("$schema").is_some() {
        schema_draft(schema)?
    } else {
        inherited_draft
    };
    let Some(object) = schema.as_object_mut() else {
        return Ok(());
    };

    // Canonicalize declared aliases so meta-validation needs no remote dialect.
    if object.contains_key("$schema") {
        let uri = match draft {
            Draft::Draft4 => "http://json-schema.org/draft-04/schema#",
            Draft::Draft6 => "http://json-schema.org/draft-06/schema#",
            Draft::Draft7 => "http://json-schema.org/draft-07/schema#",
            Draft::Draft201909 => "https://json-schema.org/draft/2019-09/schema",
            _ => "https://json-schema.org/draft/2020-12/schema",
        };
        object.insert("$schema".into(), Value::from(uri));
    }
    if object.get("nullable") == Some(&Value::Bool(true)) {
        match object.get_mut("type") {
            Some(kind @ Value::String(_)) => {
                if kind != "null" {
                    *kind = Value::Array(vec![kind.clone(), Value::from("null")]);
                }
            }
            Some(Value::Array(kinds)) if !kinds.iter().any(|kind| kind == "null") => {
                kinds.push(Value::from("null"));
            }
            _ => {}
        }
    }
    if draft != Draft::Draft4 {
        for (exclusive, inclusive) in [
            ("exclusiveMinimum", "minimum"),
            ("exclusiveMaximum", "maximum"),
        ] {
            if let Some(enabled) = object.get(exclusive).and_then(Value::as_bool) {
                object.remove(exclusive);
                if enabled {
                    let bound = object
                        .get(inclusive)
                        .filter(|value| value.is_number())
                        .ok_or_else(|| {
                            format!("Boolean {exclusive} requires a numeric {inclusive}")
                        })?
                        .clone();
                    object.insert(exclusive.into(), bound);
                    object.remove(inclusive);
                }
            }
        }
    }

    Ok(())
}

fn compile_schema(schema: &Value) -> Result<Validator, String> {
    let draft = schema_draft(schema)?;
    let mut normalized = schema.clone();
    normalize_openapi(&mut normalized, draft)?;
    normalize_referenced_schemas(&mut normalized, draft)?;
    jsonschema::options()
        .with_draft(draft)
        .should_validate_formats(true)
        .with_format("url", |value| url::Url::parse(value).is_ok())
        .build(&normalized)
        .map_err(|error| error.to_string())
}

/// Explicit references can turn otherwise ignored values into schema targets.
/// Let the library resolve pointers, anchors and local $id scopes; never fetch.
fn normalize_referenced_schemas(schema: &mut Value, draft: Draft) -> Result<(), String> {
    use std::collections::{HashMap, HashSet};

    fn index_values(value: &Value, path: String, index: &mut HashMap<*const Value, String>) {
        index.insert(std::ptr::from_ref(value), path.clone());
        match value {
            Value::Object(entries) => {
                for (key, child) in entries {
                    let key = key.replace('~', "~0").replace('/', "~1");
                    index_values(child, format!("{path}/{key}"), index);
                }
            }
            Value::Array(entries) => {
                for (i, child) in entries.iter().enumerate() {
                    index_values(child, format!("{path}/{i}"), index);
                }
            }
            _ => {}
        }
    }

    let paths = {
        const BASE: &str = "https://resonance.invalid/schema";
        let mut index = HashMap::new();
        index_values(schema, String::new(), &mut index);
        let registry = jsonschema::Registry::new()
            .add(BASE, draft.create_resource_ref(schema))
            .and_then(|builder| builder.prepare())
            .map_err(|error| error.to_string())?;
        let resolver = registry.resolver(jsonschema::uri::from_str(BASE).unwrap());
        let resolver = resolver
            .in_subresource(draft.create_resource_ref(schema))
            .map_err(|error| error.to_string())?;
        let mut pending = vec![(&*schema, resolver, draft)];
        let mut visited = HashSet::new();
        let mut paths = Vec::new();
        while let Some((node, resolver, draft)) = pending.pop() {
            if !visited.insert(std::ptr::from_ref(node)) {
                continue;
            }
            let path = index
                .get(&std::ptr::from_ref(node))
                .ok_or("References must resolve within the supplied schema")?;
            paths.push((path.clone(), draft));
            for child in draft.subresources_of(node) {
                let child_path = index
                    .get(&std::ptr::from_ref(child))
                    .ok_or("Schema child is outside the supplied document")?;
                let keyword = child_path[path.len() + 1..].split('/').next().unwrap();
                if !draft.is_known_keyword(keyword)
                    || (draft >= Draft::Draft201909
                        && matches!(keyword, "definitions" | "dependencies"))
                    || (draft == Draft::Draft202012 && keyword == "additionalItems")
                {
                    continue;
                }
                let child_draft = if child.get("$schema").is_some() {
                    schema_draft(child)?
                } else {
                    draft
                };
                let child_resolver = resolver
                    .in_subresource(child_draft.create_resource_ref(child))
                    .map_err(|error| error.to_string())?;
                pending.push((child, child_resolver, child_draft));
            }
            for keyword in ["$ref", "$dynamicRef", "$recursiveRef"] {
                if draft.is_known_keyword(keyword)
                    && let Some(reference) = node.get(keyword).and_then(Value::as_str)
                {
                    pending.push(
                        resolver
                            .lookup(reference)
                            .map_err(|error| error.to_string())?
                            .into_inner(),
                    );
                }
            }
        }
        paths
    };
    for (path, draft) in paths {
        let node = schema.pointer_mut(&path).ok_or_else(|| {
            format!("Schema target no longer exists after OpenAPI normalization: {path}")
        })?;
        normalize_openapi(node, draft)?;
    }
    Ok(())
}

fn check_schema(schema: &Value) -> SchemaResult {
    match compile_schema(schema) {
        Ok(_) => SchemaResult {
            valid: true,
            schema_valid: true,
            errors: vec![],
        },
        Err(message) => SchemaResult::invalid_schema(message),
    }
}

fn validate_instance(schema: &Value, instance: &Value) -> SchemaResult {
    let validator = match compile_schema(schema) {
        Ok(validator) => validator,
        Err(message) => return SchemaResult::invalid_schema(message),
    };
    let errors: Vec<_> = validator
        .iter_errors(instance)
        .map(|error| {
            let path = error.instance_path().to_string();
            let schema_path = error.schema_path().to_string();
            SchemaError {
                path: if path.is_empty() { "/".into() } else { path },
                message: error.to_string(),
                keyword: schema_path
                    .rsplit('/')
                    .next()
                    .filter(|keyword| !keyword.is_empty())
                    .unwrap_or("false")
                    .into(),
            }
        })
        .collect();
    SchemaResult {
        valid: errors.is_empty(),
        schema_valid: true,
        errors,
    }
}

#[tauri::command]
pub async fn schema_check(schema: Value) -> Result<SchemaResult, String> {
    tauri::async_runtime::spawn_blocking(move || check_schema(&schema))
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn schema_validate(schema: Value, instance: Value) -> Result<SchemaResult, String> {
    tauri::async_runtime::spawn_blocking(move || validate_instance(&schema, &instance))
        .await
        .map_err(|error| error.to_string())
}

#[cfg(test)]
#[path = "schema_tests.rs"]
mod tests;
