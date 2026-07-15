//! OpenAPI specification parsing: converts a spec `Value` into a `Collection`.

use super::{Collection, Endpoint, Folder};
use serde_json::Value;
use std::collections::HashMap;

pub(crate) fn parse_openapi_spec(spec: Value) -> Result<Collection, String> {
    let info = spec.get("info").ok_or("Missing 'info' in OpenAPI spec")?;
    let paths = spec.get("paths").ok_or("Missing 'paths' in OpenAPI spec")?;

    let name = info
        .get("title")
        .and_then(|v| v.as_str())
        .unwrap_or("Imported Collection")
        .to_string();

    let description = info
        .get("description")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    // Extract base URL from servers
    let base_url = spec
        .get("servers")
        .and_then(|s| s.as_array())
        .and_then(|arr| arr.first())
        .and_then(|s| s.get("url"))
        .and_then(|u| u.as_str())
        .map(|s| s.to_string());

    // Group endpoints by base path (first segment of the path)
    let mut grouped_endpoints: HashMap<String, Vec<Endpoint>> = HashMap::new();

    if let Some(paths_obj) = paths.as_object() {
        for (path, methods) in paths_obj {
            if let Some(methods_obj) = methods.as_object() {
                for (method, operation) in methods_obj {
                    if !["get", "post", "put", "patch", "delete", "head", "options"]
                        .contains(&method.as_str())
                    {
                        continue;
                    }

                    let endpoint = Endpoint {
                        id: uuid::Uuid::new_v4().to_string(),
                        name: operation
                            .get("summary")
                            .or_else(|| operation.get("operationId"))
                            .and_then(|v| v.as_str())
                            .unwrap_or(path)
                            .to_string(),
                        method: method.to_uppercase(),
                        path: path.clone(),
                        description: operation
                            .get("description")
                            .and_then(|v| v.as_str())
                            .map(|s| s.to_string()),
                        parameters: parse_parameters(operation.get("parameters"), &spec),
                        request_body: extract_openapi_request_body(
                            operation.get("requestBody"),
                            &spec,
                        ),
                        responses: extract_openapi_responses(operation.get("responses"), &spec),
                        security: extract_openapi_security(operation.get("security"), &spec),
                        scripts: None,
                        graphql_data: None,
                    };

                    // Extract base path (first segment) for folder grouping
                    let base_path = extract_base_path(path);
                    grouped_endpoints
                        .entry(base_path)
                        .or_default()
                        .push(endpoint);
                }
            }
        }
    }

    // Create folders from grouped endpoints
    let mut folders: Vec<Folder> = grouped_endpoints
        .into_iter()
        .map(|(base_path, endpoints)| Folder {
            id: format!(
                "folder_{}",
                base_path.replace(|c: char| !c.is_alphanumeric(), "_")
            ),
            name: base_path,
            endpoints,
        })
        .collect();

    // Sort folders by name for consistent ordering
    folders.sort_by(|a, b| a.name.cmp(&b.name));

    // Flatten all endpoints for the endpoints array
    let all_endpoints: Vec<Endpoint> = folders.iter().flat_map(|f| f.endpoints.clone()).collect();

    Ok(Collection {
        id: uuid::Uuid::new_v4().to_string(),
        name,
        description,
        base_url,
        endpoints: all_endpoints,
        folders,
        variables: None,
    })
}

/// Extract the base path (first segment) from a full path for folder grouping
fn extract_base_path(path: &str) -> String {
    let clean_path = path.trim_start_matches('/');
    let segments: Vec<&str> = clean_path.split('/').collect();
    segments.first().unwrap_or(&"root").to_string()
}

/// Extract and process OpenAPI requestBody into format expected by frontend
fn extract_openapi_request_body(request_body: Option<&Value>, spec: &Value) -> Option<Value> {
    let rb = request_body?;

    // Get schema from content.application/json.schema
    let schema = rb
        .pointer("/content/application/json/schema")
        .or_else(|| rb.pointer("/content/application~1json/schema")) // Handle escaped slash
        .cloned();

    // Check for example at various levels
    let example = rb
        .pointer("/content/application/json/example")
        .or_else(|| rb.pointer("/content/application~1json/example"))
        .cloned();

    if let Some(ex) = example {
        // If there's a direct example, use it
        let example_str = if ex.is_string() {
            ex.as_str().unwrap_or("").to_string()
        } else {
            serde_json::to_string_pretty(&ex).unwrap_or_default()
        };
        return Some(serde_json::json!({ "example": example_str }));
    }

    if let Some(schema) = schema {
        // Resolve $ref if present and generate example from schema
        let resolved = resolve_schema_ref(&schema, spec);
        let example_json = generate_example_from_schema(&resolved, spec);
        let example_str = serde_json::to_string_pretty(&example_json).unwrap_or_default();

        return Some(serde_json::json!({
            "schema": resolved,
            "example": example_str
        }));
    }

    // Check if required flag is set
    if rb
        .get("required")
        .and_then(|r| r.as_bool())
        .unwrap_or(false)
    {
        return Some(serde_json::json!({ "required": true }));
    }

    None
}

/// Extract and resolve OpenAPI responses with schema references
fn extract_openapi_responses(
    responses: Option<&Value>,
    spec: &Value,
) -> Option<HashMap<String, Value>> {
    let responses_obj = responses?.as_object()?;

    let mut result: HashMap<String, Value> = HashMap::new();

    for (status_code, response) in responses_obj {
        let mut resolved_response = response.clone();

        // Resolve schema $ref in content/application/json/schema
        if let Some(content) = response.get("content") {
            if let Some(json_content) = content.get("application/json") {
                if let Some(schema) = json_content.get("schema") {
                    let resolved_schema = resolve_schema_ref(schema, spec);

                    // Build the resolved response structure
                    let mut new_response = serde_json::Map::new();

                    // Copy description if present
                    if let Some(desc) = response.get("description") {
                        new_response.insert("description".to_string(), desc.clone());
                    }

                    // Build content with resolved schema
                    let mut new_content = serde_json::Map::new();
                    let mut new_json_content = serde_json::Map::new();
                    new_json_content.insert("schema".to_string(), resolved_schema);

                    // Copy example if present
                    if let Some(example) = json_content.get("example") {
                        new_json_content.insert("example".to_string(), example.clone());
                    }

                    new_content.insert(
                        "application/json".to_string(),
                        Value::Object(new_json_content),
                    );
                    new_response.insert("content".to_string(), Value::Object(new_content));

                    resolved_response = Value::Object(new_response);
                }
            }
        }

        // Also handle OpenAPI 2.x style schema directly on response
        if let Some(schema) = response.get("schema") {
            let resolved_schema = resolve_schema_ref(schema, spec);
            let mut new_response = response.as_object().cloned().unwrap_or_default();
            new_response.insert("schema".to_string(), resolved_schema);
            resolved_response = Value::Object(new_response);
        }

        result.insert(status_code.clone(), resolved_response);
    }

    Some(result)
}

/// Resolve $ref in OpenAPI schema recursively
fn resolve_schema_ref(schema: &Value, spec: &Value) -> Value {
    resolve_schema_ref_recursive(schema, spec, 0)
}

/// Recursively resolve all $ref in OpenAPI schema with depth limit to prevent infinite loops
fn resolve_schema_ref_recursive(schema: &Value, spec: &Value, depth: usize) -> Value {
    // Prevent infinite recursion
    if depth > 20 {
        return schema.clone();
    }

    // Handle direct $ref
    if let Some(ref_path) = schema.get("$ref").and_then(|r| r.as_str()) {
        if ref_path.starts_with("#/") {
            let json_pointer = format!("/{}", ref_path.trim_start_matches("#/"));
            if let Some(resolved) = spec.pointer(&json_pointer) {
                // Recursively resolve the resolved schema
                return resolve_schema_ref_recursive(resolved, spec, depth + 1);
            }
        }
        return schema.clone();
    }

    // Handle object with properties
    if let Some(obj) = schema.as_object() {
        let mut new_obj = serde_json::Map::new();

        for (key, value) in obj {
            if key == "properties" {
                if let Some(props) = value.as_object() {
                    let mut new_props = serde_json::Map::new();
                    for (prop_key, prop_value) in props {
                        new_props.insert(
                            prop_key.clone(),
                            resolve_schema_ref_recursive(prop_value, spec, depth + 1),
                        );
                    }
                    new_obj.insert(key.clone(), Value::Object(new_props));
                } else {
                    new_obj.insert(key.clone(), value.clone());
                }
            } else if key == "items" {
                // Handle array items
                new_obj.insert(
                    key.clone(),
                    resolve_schema_ref_recursive(value, spec, depth + 1),
                );
            } else if key == "allOf" || key == "oneOf" || key == "anyOf" {
                // Handle composition keywords
                if let Some(arr) = value.as_array() {
                    let resolved_arr: Vec<Value> = arr
                        .iter()
                        .map(|item| resolve_schema_ref_recursive(item, spec, depth + 1))
                        .collect();
                    new_obj.insert(key.clone(), Value::Array(resolved_arr));
                } else {
                    new_obj.insert(key.clone(), value.clone());
                }
            } else {
                new_obj.insert(key.clone(), value.clone());
            }
        }

        return Value::Object(new_obj);
    }

    schema.clone()
}

/// Generate example JSON from OpenAPI schema
fn generate_example_from_schema(schema: &Value, spec: &Value) -> Value {
    // Handle $ref
    if schema.get("$ref").is_some() {
        let resolved = resolve_schema_ref(schema, spec);
        return generate_example_from_schema(&resolved, spec);
    }

    let schema_type = schema
        .get("type")
        .and_then(|t| t.as_str())
        .unwrap_or("object");

    match schema_type {
        "object" => {
            let mut obj = serde_json::Map::new();
            if let Some(properties) = schema.get("properties").and_then(|p| p.as_object()) {
                for (key, prop_schema) in properties {
                    // Check for example in property
                    if let Some(example) = prop_schema.get("example") {
                        obj.insert(key.clone(), example.clone());
                    } else {
                        obj.insert(key.clone(), generate_example_from_schema(prop_schema, spec));
                    }
                }
            }
            Value::Object(obj)
        }
        "array" => {
            if let Some(items) = schema.get("items") {
                Value::Array(vec![generate_example_from_schema(items, spec)])
            } else {
                Value::Array(vec![])
            }
        }
        "string" => {
            if let Some(example) = schema.get("example") {
                example.clone()
            } else {
                Value::String("string".to_string())
            }
        }
        "integer" => {
            if let Some(example) = schema.get("example") {
                example.clone()
            } else {
                Value::Number(serde_json::Number::from(0))
            }
        }
        "number" => {
            if let Some(example) = schema.get("example") {
                example.clone()
            } else {
                serde_json::json!(0.0)
            }
        }
        "boolean" => {
            if let Some(example) = schema.get("example") {
                example.clone()
            } else {
                Value::Bool(false)
            }
        }
        _ => Value::Null,
    }
}

/// Parse OpenAPI parameters array into grouped object: { path: {...}, query: {...}, header: {...} }
/// Resolves $ref references to components/parameters
fn parse_parameters(params: Option<&Value>, spec: &Value) -> Option<Value> {
    let arr = params.and_then(|p| p.as_array())?;

    let mut path_params: serde_json::Map<String, Value> = serde_json::Map::new();
    let mut query_params: serde_json::Map<String, Value> = serde_json::Map::new();
    let mut header_params: serde_json::Map<String, Value> = serde_json::Map::new();

    for param in arr {
        // Resolve $ref if present (e.g., "$ref": "#/components/parameters/acceptLanguage")
        let resolved_param = if let Some(ref_path) = param.get("$ref").and_then(|r| r.as_str()) {
            if ref_path.starts_with("#/") {
                let json_pointer = format!("/{}", ref_path.trim_start_matches("#/"));
                spec.pointer(&json_pointer).unwrap_or(param)
            } else {
                param
            }
        } else {
            param
        };

        let name = resolved_param
            .get("name")
            .and_then(|n| n.as_str())
            .unwrap_or_default();
        let location = resolved_param
            .get("in")
            .and_then(|l| l.as_str())
            .unwrap_or_default();

        if name.is_empty() {
            continue;
        }

        // Build parameter object with example value
        let mut param_obj = serde_json::Map::new();

        // Extract example from schema or use default
        let example = resolved_param
            .get("schema")
            .and_then(|s| s.get("example"))
            .or_else(|| resolved_param.get("example"))
            .cloned()
            .unwrap_or_else(|| {
                // Generate default based on schema type
                if let Some(schema_type) = resolved_param
                    .get("schema")
                    .and_then(|s| s.get("type"))
                    .and_then(|t| t.as_str())
                {
                    match schema_type {
                        "integer" | "number" => Value::String("0".to_string()),
                        "boolean" => Value::String("true".to_string()),
                        _ => Value::String(String::new()),
                    }
                } else {
                    Value::String(String::new())
                }
            });

        // Convert example to string if needed
        let example_str = match &example {
            Value::String(s) => s.clone(),
            Value::Number(n) => n.to_string(),
            Value::Bool(b) => b.to_string(),
            _ => example.to_string(),
        };

        param_obj.insert("example".to_string(), Value::String(example_str));

        if let Some(desc) = resolved_param.get("description").and_then(|d| d.as_str()) {
            param_obj.insert("description".to_string(), Value::String(desc.to_string()));
        }

        if let Some(required) = resolved_param.get("required").and_then(|r| r.as_bool()) {
            param_obj.insert("required".to_string(), Value::Bool(required));
        }

        if let Some(schema) = resolved_param.get("schema") {
            param_obj.insert("schema".to_string(), schema.clone());
        }

        match location {
            "path" => {
                path_params.insert(name.to_string(), Value::Object(param_obj));
            }
            "query" => {
                query_params.insert(name.to_string(), Value::Object(param_obj));
            }
            "header" => {
                header_params.insert(name.to_string(), Value::Object(param_obj));
            }
            _ => {}
        }
    }

    // Only return if we have any parameters
    if path_params.is_empty() && query_params.is_empty() && header_params.is_empty() {
        return None;
    }

    let mut result = serde_json::Map::new();
    if !path_params.is_empty() {
        result.insert("path".to_string(), Value::Object(path_params));
    }
    if !query_params.is_empty() {
        result.insert("query".to_string(), Value::Object(query_params));
    }
    if !header_params.is_empty() {
        result.insert("header".to_string(), Value::Object(header_params));
    }

    Some(Value::Object(result))
}

/// Extract security configuration from OpenAPI operation
/// Converts OpenAPI security requirements to { type, config } format expected by frontend
fn extract_openapi_security(security: Option<&Value>, spec: &Value) -> Option<Value> {
    let security_arr = security?.as_array()?;

    // Get the first security requirement
    let first_req = security_arr.first()?.as_object()?;
    let (scheme_name, _scopes) = first_req.iter().next()?;

    // Look up the security scheme in components/securitySchemes
    let scheme = spec
        .pointer(&format!("/components/securitySchemes/{}", scheme_name))?
        .as_object()?;

    let scheme_type = scheme.get("type").and_then(|t| t.as_str())?;

    match scheme_type {
        "http" => {
            let http_scheme = scheme
                .get("scheme")
                .and_then(|s| s.as_str())
                .unwrap_or("bearer");
            match http_scheme {
                "bearer" => Some(serde_json::json!({
                    "type": "bearer",
                    "config": {
                        "token": ""
                    }
                })),
                "basic" => Some(serde_json::json!({
                    "type": "basic",
                    "config": {
                        "username": "",
                        "password": ""
                    }
                })),
                "digest" => Some(serde_json::json!({
                    "type": "digest",
                    "config": {
                        "username": "",
                        "password": ""
                    }
                })),
                _ => None,
            }
        }
        "apiKey" => {
            let key_name = scheme
                .get("name")
                .and_then(|n| n.as_str())
                .unwrap_or("api_key");
            let location = scheme
                .get("in")
                .and_then(|i| i.as_str())
                .unwrap_or("header");

            Some(serde_json::json!({
                "type": "api-key",
                "config": {
                    "keyName": key_name,
                    "keyValue": "",
                    "location": location
                }
            }))
        }
        _ => None,
    }
}
