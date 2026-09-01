//! OpenAPI specification parsing: converts a spec `Value` into a `Collection`.

use super::{Collection, Endpoint, Folder, VariableEntry};
use serde_json::Value;
use std::collections::{HashMap, HashSet};

/// Collection variables the imported auth configs reference, so a credential the
/// spec only declares the shape of is filled once per collection rather than
/// once per request. Empty values on import; a `{{ref}}` also survives the
/// secret redaction that blanks literal credentials before they reach disk.
const BEARER_TOKEN_VARIABLE: &str = "bearerToken";
const USERNAME_VARIABLE: &str = "authUsername";
const PASSWORD_VARIABLE: &str = "authPassword";
const API_KEY_VARIABLE: &str = "apiKey";

/// Hard cap on `$ref` resolution depth. Cycle detection stops self-referential
/// schemas; this is a safety net for pathologically deep (but acyclic) specs.
const MAX_REF_DEPTH: usize = 64;

/// Hard cap on example-generation recursion depth.
const MAX_EXAMPLE_DEPTH: usize = 128;

/// Stub emitted in place of a `$ref` that is cyclic, unresolvable, or past the
/// depth cap, so no unresolved `$ref` ever survives into example generation.
fn empty_schema_stub() -> Value {
    Value::Object(serde_json::Map::new())
}

#[derive(Debug, Clone, Copy, PartialEq)]
enum SpecVersion {
    Swagger2,
    OpenApi30,
    OpenApi31,
}

/// Detect the spec generation from its version field. A document with both
/// fields (invalid) is judged by `openapi`; one with neither keeps the parser's
/// historically lenient treat-as-3.0 behavior.
fn detect_spec_version(spec: &Value) -> Result<SpecVersion, String> {
    if let Some(openapi) = spec.get("openapi") {
        let version = openapi.as_str().unwrap_or_default();
        if version.starts_with("3.0") {
            return Ok(SpecVersion::OpenApi30);
        }
        if version.starts_with("3.1") {
            return Ok(SpecVersion::OpenApi31);
        }
        return Err(format!(
            "Unsupported OpenAPI version '{}'. Supported: Swagger 2.0, OpenAPI 3.0.x and 3.1.x.",
            version
        ));
    }
    if let Some(swagger) = spec.get("swagger") {
        // Real-world YAML specs sometimes leave `swagger: 2.0` unquoted, which
        // parses as a number rather than a string.
        let is_v2 = swagger.as_str() == Some("2.0") || swagger.as_f64() == Some(2.0);
        if is_v2 {
            return Ok(SpecVersion::Swagger2);
        }
        return Err(format!(
            "Unsupported Swagger version '{}'. Supported: Swagger 2.0, OpenAPI 3.0.x and 3.1.x.",
            swagger
                .as_str()
                .map(|s| s.to_string())
                .unwrap_or_else(|| swagger.to_string())
        ));
    }
    Ok(SpecVersion::OpenApi30)
}

pub(crate) fn parse_openapi_spec(spec: Value) -> Result<Collection, String> {
    let version = detect_spec_version(&spec)?;
    let spec = match version {
        SpecVersion::Swagger2 => super::swagger2::convert_to_openapi3(spec)?,
        _ => spec,
    };

    let info = spec.get("info").ok_or("Missing 'info' in OpenAPI spec")?;
    let paths = spec.get("paths").ok_or(match version {
        SpecVersion::OpenApi31 => {
            "This OpenAPI 3.1 document defines no paths (webhooks-only documents are not supported)."
        }
        _ => "Missing 'paths' in OpenAPI spec",
    })?;

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
            auth_config: None,
        })
        .collect();

    // Sort folders by name for consistent ordering
    folders.sort_by(|a, b| a.name.cmp(&b.name));

    // Flatten all endpoints for the endpoints array
    let all_endpoints: Vec<Endpoint> = folders.iter().flat_map(|f| f.endpoints.clone()).collect();

    let collection_auth = extract_openapi_security(spec.get("security"), &spec);
    let variables = seed_variables(
        base_url.as_deref(),
        all_endpoints
            .iter()
            .filter_map(|e| e.security.as_ref())
            .chain(collection_auth.iter()),
    );

    Ok(Collection {
        id: uuid::Uuid::new_v4().to_string(),
        name,
        description,
        base_url,
        endpoints: all_endpoints,
        folders,
        variables,
        auth_config: collection_auth,
    })
}

/// Collection variables an imported spec needs: `baseUrl` plus one entry per
/// credential placeholder the imported auth configs actually reference.
///
/// @param base_url - The spec's first server URL, when it has one
/// @param auth_configs - Every auth config the import produced
/// @returns The variables to seed, or None when there are none
fn seed_variables<'a>(
    base_url: Option<&str>,
    auth_configs: impl Iterator<Item = &'a Value>,
) -> Option<Vec<VariableEntry>> {
    let mut variables: Vec<VariableEntry> = Vec::new();

    if let Some(base_url) = base_url.filter(|url| !url.is_empty()) {
        variables.push(VariableEntry {
            key: "baseUrl".to_string(),
            value: base_url.to_string(),
        });
    }

    let referenced: HashSet<&str> = auth_configs
        .filter_map(|auth| auth.get("config"))
        .filter_map(|config| config.as_object())
        .flat_map(|config| config.values())
        .filter_map(|value| value.as_str())
        .flat_map(|value| {
            [
                BEARER_TOKEN_VARIABLE,
                USERNAME_VARIABLE,
                PASSWORD_VARIABLE,
                API_KEY_VARIABLE,
            ]
            .into_iter()
            .filter(move |name| value == format!("{{{{{}}}}}", name))
        })
        .collect();

    for name in [
        BEARER_TOKEN_VARIABLE,
        USERNAME_VARIABLE,
        PASSWORD_VARIABLE,
        API_KEY_VARIABLE,
    ] {
        if referenced.contains(name) {
            variables.push(VariableEntry {
                key: name.to_string(),
                value: String::new(),
            });
        }
    }

    Some(variables).filter(|v| !v.is_empty())
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

    // Check for example at various levels: a direct media-type `example`, or
    // the first entry of the media-type `examples` map ({ name: { value } }).
    let example = rb
        .pointer("/content/application/json/example")
        .or_else(|| rb.pointer("/content/application~1json/example"))
        .cloned()
        .or_else(|| {
            rb.pointer("/content/application~1json/examples")
                .and_then(|ex| ex.as_object())
                .and_then(|map| map.values().next())
                .and_then(|first| first.get("value").cloned())
        });

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
    let mut active = HashSet::new();
    resolve_schema_ref_recursive(schema, spec, 0, &mut active)
}

/// Recursively resolve all `$ref` in an OpenAPI schema.
///
/// `active` holds the `$ref` paths currently being resolved on this branch. A
/// `$ref` already in that set is a cycle (e.g. a self-referential `Node`
/// schema) and resolves to an empty-object stub instead of recursing forever;
/// the entry is removed on the way back up so the same schema reused in a
/// sibling (non-cyclic) position still resolves normally. Unresolvable refs and
/// anything past `MAX_REF_DEPTH` also stub out, so the returned value never
/// contains an unresolved `$ref`.
fn resolve_schema_ref_recursive(
    schema: &Value,
    spec: &Value,
    depth: usize,
    active: &mut HashSet<String>,
) -> Value {
    if depth > MAX_REF_DEPTH {
        return empty_schema_stub();
    }

    // Handle direct $ref
    if let Some(ref_path) = schema.get("$ref").and_then(|r| r.as_str()) {
        if ref_path.starts_with("#/") {
            if active.contains(ref_path) {
                return empty_schema_stub();
            }
            let json_pointer = format!("/{}", ref_path.trim_start_matches("#/"));
            if let Some(resolved) = spec.pointer(&json_pointer) {
                active.insert(ref_path.to_string());
                let out = resolve_schema_ref_recursive(resolved, spec, depth + 1, active);
                active.remove(ref_path);
                return out;
            }
        }
        return empty_schema_stub();
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
                            resolve_schema_ref_recursive(prop_value, spec, depth + 1, active),
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
                    resolve_schema_ref_recursive(value, spec, depth + 1, active),
                );
            } else if key == "allOf" || key == "oneOf" || key == "anyOf" {
                // Handle composition keywords
                if let Some(arr) = value.as_array() {
                    let resolved_arr: Vec<Value> = arr
                        .iter()
                        .map(|item| resolve_schema_ref_recursive(item, spec, depth + 1, active))
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

/// The effective type of a schema, tolerating the OpenAPI 3.1 type-array form
/// (`["string","null"]` yields `string`). Falls back to structural inference:
/// `properties` implies object, `items` implies array.
///
/// @param schema the (resolved) schema to inspect
/// @returns the primary type name, or None when nothing indicates one
pub(crate) fn primary_type(schema: &Value) -> Option<&str> {
    match schema.get("type") {
        Some(Value::String(s)) => Some(s.as_str()),
        Some(Value::Array(arr)) => arr
            .iter()
            .filter_map(|v| v.as_str())
            .find(|t| *t != "null")
            .or_else(|| arr.iter().filter_map(|v| v.as_str()).next()),
        _ => {
            if schema.get("properties").is_some() {
                Some("object")
            } else if schema.get("items").is_some() {
                Some("array")
            } else {
                None
            }
        }
    }
}

/// A schema's own example value: `example`, else the 3.1 `const`, else the
/// first entry of a 3.1 `examples` ARRAY (the 3.0 media-type `examples` map is
/// an object and deliberately does not match).
///
/// @param schema the (resolved) schema to inspect
/// @returns the example value, when the schema carries one
pub(crate) fn schema_example(schema: &Value) -> Option<Value> {
    if let Some(example) = schema.get("example") {
        return Some(example.clone());
    }
    if let Some(constant) = schema.get("const") {
        return Some(constant.clone());
    }
    if let Some(Value::Array(examples)) = schema.get("examples") {
        return examples.first().cloned();
    }
    None
}

/// Generate example JSON from OpenAPI schema
fn generate_example_from_schema(schema: &Value, spec: &Value) -> Value {
    generate_example_with_depth(schema, spec, 0)
}

/// Depth-guarded backing for [`generate_example_from_schema`]. Bounds recursion
/// so a deep (but finite) resolved schema cannot overflow the stack; refs are
/// already cycle-safe by the time they reach here.
fn generate_example_with_depth(schema: &Value, spec: &Value, depth: usize) -> Value {
    if depth > MAX_EXAMPLE_DEPTH {
        return Value::Null;
    }

    // Handle $ref
    if schema.get("$ref").is_some() {
        let resolved = resolve_schema_ref(schema, spec);
        return generate_example_with_depth(&resolved, spec, depth + 1);
    }

    if let Some(example) = schema_example(schema) {
        return example;
    }

    match primary_type(schema).unwrap_or("object") {
        "object" => {
            let mut obj = serde_json::Map::new();
            if let Some(properties) = schema.get("properties").and_then(|p| p.as_object()) {
                for (key, prop_schema) in properties {
                    obj.insert(
                        key.clone(),
                        generate_example_with_depth(prop_schema, spec, depth + 1),
                    );
                }
            }
            Value::Object(obj)
        }
        "array" => {
            if let Some(items) = schema.get("items") {
                Value::Array(vec![generate_example_with_depth(items, spec, depth + 1)])
            } else {
                Value::Array(vec![])
            }
        }
        "string" => Value::String("string".to_string()),
        "integer" => Value::Number(serde_json::Number::from(0)),
        "number" => serde_json::json!(0.0),
        "boolean" => Value::Bool(false),
        "null" => Value::Null,
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
            .and_then(schema_example)
            .or_else(|| resolved_param.get("example").cloned())
            .unwrap_or_else(|| {
                // Generate default based on schema type
                match resolved_param.get("schema").and_then(primary_type) {
                    Some("integer") | Some("number") => Value::String("0".to_string()),
                    Some("boolean") => Value::String("true".to_string()),
                    _ => Value::String(String::new()),
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
                        "token": format!("{{{{{}}}}}", BEARER_TOKEN_VARIABLE)
                    }
                })),
                "basic" => Some(serde_json::json!({
                    "type": "basic",
                    "config": {
                        "username": format!("{{{{{}}}}}", USERNAME_VARIABLE),
                        "password": format!("{{{{{}}}}}", PASSWORD_VARIABLE)
                    }
                })),
                "digest" => Some(serde_json::json!({
                    "type": "digest",
                    "config": {
                        "username": format!("{{{{{}}}}}", USERNAME_VARIABLE),
                        "password": format!("{{{{{}}}}}", PASSWORD_VARIABLE)
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
                    "keyValue": format!("{{{{{}}}}}", API_KEY_VARIABLE),
                    "location": location
                }
            }))
        }
        "oauth2" => {
            let flows = scheme.get("flows").and_then(|f| f.as_object())?;
            // Prefer the flows the app can actually drive; fall back to
            // whatever the spec declares (e.g. implicit-only specs).
            let (flow_name, flow) = [
                "clientCredentials",
                "authorizationCode",
                "password",
                "implicit",
            ]
            .into_iter()
            .find_map(|name| flows.get(name).map(|flow| (name, flow)))
            .or_else(|| {
                flows
                    .iter()
                    .next()
                    .map(|(name, flow)| (name.as_str(), flow))
            })?;

            let grant_type = match flow_name {
                "clientCredentials" => "client_credentials",
                "password" => "password",
                // The app has no implicit grant; manual token entry is the
                // closest workable configuration.
                "implicit" => "manual",
                _ => "authorization_code",
            };

            let mut config = serde_json::Map::new();
            config.insert(
                "grantType".to_string(),
                Value::String(grant_type.to_string()),
            );
            for key in ["tokenUrl", "authorizationUrl"] {
                if let Some(url) = flow.get(key).and_then(|u| u.as_str()) {
                    config.insert(key.to_string(), Value::String(url.to_string()));
                }
            }
            if let Some(scopes) = flow.get("scopes").and_then(|s| s.as_object()) {
                if !scopes.is_empty() {
                    config.insert(
                        "scope".to_string(),
                        Value::String(scopes.keys().cloned().collect::<Vec<_>>().join(" ")),
                    );
                }
            }

            Some(serde_json::json!({
                "type": "oauth2",
                "config": Value::Object(config)
            }))
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn self_referential_spec() -> Value {
        json!({
            "components": {
                "schemas": {
                    "Node": {
                        "type": "object",
                        "properties": {
                            "value": { "type": "string" },
                            "child": { "$ref": "#/components/schemas/Node" }
                        }
                    }
                }
            }
        })
    }

    fn operation_security_spec() -> Value {
        json!({
            "info": { "title": "Secured API" },
            "servers": [{ "url": "https://api.example.com" }],
            "components": {
                "securitySchemes": {
                    "BearerAuth": { "type": "http", "scheme": "bearer" }
                }
            },
            "paths": {
                "/company-users": {
                    "get": {
                        "summary": "Retrieves list of company users.",
                        "security": [{ "BearerAuth": [] }],
                        "responses": { "200": { "description": "ok" } }
                    }
                },
                "/access-tokens": {
                    "post": {
                        "summary": "Creates an access token.",
                        "responses": { "201": { "description": "created" } }
                    }
                }
            }
        })
    }

    #[test]
    fn an_operations_security_requirement_lands_on_the_endpoint() {
        let collection = parse_openapi_spec(operation_security_spec()).unwrap();

        let secured = collection
            .endpoints
            .iter()
            .find(|e| e.path == "/company-users")
            .unwrap();
        assert_eq!(
            secured.security,
            Some(json!({ "type": "bearer", "config": { "token": "{{bearerToken}}" } }))
        );

        let open = collection
            .endpoints
            .iter()
            .find(|e| e.path == "/access-tokens")
            .unwrap();
        assert!(open.security.is_none());
    }

    #[test]
    fn credential_placeholders_are_seeded_as_collection_variables() {
        let collection = parse_openapi_spec(operation_security_spec()).unwrap();
        let variables = collection.variables.unwrap();

        let entry = |key: &str| {
            variables
                .iter()
                .find(|v| v.key == key)
                .map(|v| v.value.clone())
        };

        assert_eq!(entry("baseUrl").as_deref(), Some("https://api.example.com"));
        assert_eq!(entry("bearerToken").as_deref(), Some(""));
        assert!(entry("apiKey").is_none());
        assert!(entry("authUsername").is_none());
    }

    #[test]
    fn a_spec_with_no_security_seeds_only_the_base_url() {
        let spec = json!({
            "info": { "title": "Open API" },
            "servers": [{ "url": "https://api.example.com" }],
            "paths": {
                "/ping": { "get": { "responses": { "200": { "description": "ok" } } } }
            }
        });

        let collection = parse_openapi_spec(spec).unwrap();
        let variables = collection.variables.unwrap();

        assert_eq!(variables.len(), 1);
        assert_eq!(variables[0].key, "baseUrl");
    }

    #[test]
    fn resolve_self_referential_ref_terminates_with_stub() {
        let spec = self_referential_spec();
        let resolved = resolve_schema_ref(&json!({ "$ref": "#/components/schemas/Node" }), &spec);

        let child = resolved.pointer("/properties/child").unwrap();
        assert_eq!(child, &json!({}));
        assert!(child.get("$ref").is_none());
        assert_eq!(
            resolved.pointer("/properties/value/type").unwrap(),
            &json!("string")
        );
    }

    #[test]
    fn generate_example_for_self_referential_schema_terminates() {
        let spec = self_referential_spec();
        let resolved = resolve_schema_ref(&json!({ "$ref": "#/components/schemas/Node" }), &spec);
        let example = generate_example_from_schema(&resolved, &spec);

        assert_eq!(example, json!({ "value": "string", "child": {} }));
    }

    #[test]
    fn extract_request_body_with_recursive_schema_does_not_crash() {
        let spec = self_referential_spec();
        let request_body = json!({
            "content": {
                "application/json": {
                    "schema": { "$ref": "#/components/schemas/Node" }
                }
            }
        });

        let result = extract_openapi_request_body(Some(&request_body), &spec);
        assert!(result.is_some());
        let example_str = result
            .unwrap()
            .get("example")
            .unwrap()
            .as_str()
            .unwrap()
            .to_string();
        assert!(serde_json::from_str::<Value>(&example_str).is_ok());
    }

    #[test]
    fn many_recursive_properties_do_not_explode() {
        let spec = json!({
            "components": {
                "schemas": {
                    "Node": {
                        "type": "object",
                        "properties": {
                            "a": { "$ref": "#/components/schemas/Node" },
                            "b": { "$ref": "#/components/schemas/Node" },
                            "c": { "$ref": "#/components/schemas/Node" },
                            "d": { "$ref": "#/components/schemas/Node" },
                            "e": { "$ref": "#/components/schemas/Node" }
                        }
                    }
                }
            }
        });

        let resolved = resolve_schema_ref(&json!({ "$ref": "#/components/schemas/Node" }), &spec);
        let props = resolved
            .pointer("/properties")
            .unwrap()
            .as_object()
            .unwrap();
        assert_eq!(props.len(), 5);
        for key in ["a", "b", "c", "d", "e"] {
            assert_eq!(props.get(key).unwrap(), &json!({}));
        }
    }

    #[test]
    fn non_cyclic_reuse_of_a_schema_is_still_resolved() {
        let spec = json!({
            "components": {
                "schemas": {
                    "Address": {
                        "type": "object",
                        "properties": { "street": { "type": "string" } }
                    },
                    "Person": {
                        "type": "object",
                        "properties": {
                            "home": { "$ref": "#/components/schemas/Address" },
                            "work": { "$ref": "#/components/schemas/Address" }
                        }
                    }
                }
            }
        });

        let resolved = resolve_schema_ref(&json!({ "$ref": "#/components/schemas/Person" }), &spec);
        for slot in ["home", "work"] {
            let street_type = resolved
                .pointer(&format!("/properties/{}/properties/street/type", slot))
                .unwrap();
            assert_eq!(street_type, &json!("string"));
        }
    }

    #[test]
    fn unresolvable_ref_becomes_empty_stub() {
        let spec = json!({ "components": { "schemas": {} } });
        let resolved =
            resolve_schema_ref(&json!({ "$ref": "#/components/schemas/Missing" }), &spec);

        assert_eq!(resolved, json!({}));
        assert!(resolved.get("$ref").is_none());
    }

    #[test]
    fn plain_schema_still_generates_expected_example() {
        let spec = json!({});
        let schema = json!({
            "type": "object",
            "properties": {
                "name": { "type": "string" },
                "age": { "type": "integer" },
                "tags": { "type": "array", "items": { "type": "string" } }
            }
        });

        let example = generate_example_from_schema(&schema, &spec);
        assert_eq!(
            example,
            json!({ "name": "string", "age": 0, "tags": ["string"] })
        );
    }

    #[test]
    fn version_detection_covers_all_generations() {
        let ok = |doc: Value| detect_spec_version(&doc).unwrap();
        assert!(matches!(
            ok(json!({ "swagger": "2.0" })),
            SpecVersion::Swagger2
        ));
        assert!(matches!(
            ok(json!({ "swagger": 2.0 })),
            SpecVersion::Swagger2
        ));
        assert!(matches!(
            ok(json!({ "openapi": "3.0.3" })),
            SpecVersion::OpenApi30
        ));
        assert!(matches!(
            ok(json!({ "openapi": "3.1.0" })),
            SpecVersion::OpenApi31
        ));
        assert!(matches!(ok(json!({})), SpecVersion::OpenApi30));

        assert!(detect_spec_version(&json!({ "swagger": "1.2" }))
            .unwrap_err()
            .contains("1.2"));
        assert!(detect_spec_version(&json!({ "openapi": "4.0.0" }))
            .unwrap_err()
            .contains("4.0.0"));
    }

    #[test]
    fn a_swagger2_document_parses_end_to_end_in_openapi3_shape() {
        let spec = json!({
            "swagger": "2.0",
            "info": { "title": "Legacy API" },
            "host": "api.example.com",
            "basePath": "/v1",
            "schemes": ["https"],
            "produces": ["application/json"],
            "paths": {
                "/things": {
                    "get": {
                        "summary": "List things",
                        "responses": {
                            "200": {
                                "description": "ok",
                                "schema": { "$ref": "#/definitions/Thing" }
                            }
                        }
                    }
                }
            },
            "definitions": {
                "Thing": {
                    "type": "object",
                    "properties": { "id": { "type": "integer" } }
                }
            }
        });

        let collection = parse_openapi_spec(spec).unwrap();
        assert_eq!(
            collection.base_url.as_deref(),
            Some("https://api.example.com/v1")
        );

        let endpoint = collection
            .endpoints
            .iter()
            .find(|e| e.path == "/things")
            .unwrap();
        let responses = endpoint.responses.as_ref().unwrap();
        let ok_response = responses.get("200").unwrap();
        assert_eq!(
            ok_response.pointer("/content/application~1json/schema/properties/id/type"),
            Some(&json!("integer"))
        );
        assert!(ok_response.get("schema").is_none());
    }

    #[test]
    fn openapi31_type_arrays_const_and_examples_generate_examples() {
        let spec = json!({});
        let schema = json!({
            "type": "object",
            "properties": {
                "name": { "type": ["string", "null"] },
                "kind": { "const": "widget" },
                "size": { "type": ["integer", "null"], "examples": [42] },
                "gone": { "type": ["null"] }
            }
        });

        let example = generate_example_from_schema(&schema, &spec);
        assert_eq!(
            example,
            json!({ "name": "string", "kind": "widget", "size": 42, "gone": null })
        );
    }

    #[test]
    fn a_webhooks_only_31_document_errors_specifically() {
        let spec = json!({
            "openapi": "3.1.0",
            "info": { "title": "Hooks" },
            "webhooks": { "newThing": {} }
        });

        let err = parse_openapi_spec(spec).unwrap_err();
        assert!(err.contains("webhooks-only"));
    }

    #[test]
    fn oauth2_security_scheme_maps_to_app_config() {
        let spec = json!({
            "info": { "title": "OAuth API" },
            "components": {
                "securitySchemes": {
                    "OAuth": {
                        "type": "oauth2",
                        "flows": {
                            "clientCredentials": {
                                "tokenUrl": "https://auth.example.com/token",
                                "scopes": { "read": "r", "write": "w" }
                            }
                        }
                    }
                }
            },
            "paths": {
                "/secure": {
                    "get": {
                        "security": [{ "OAuth": ["read"] }],
                        "responses": { "200": { "description": "ok" } }
                    }
                }
            }
        });

        let collection = parse_openapi_spec(spec).unwrap();
        let endpoint = collection.endpoints.first().unwrap();
        let security = endpoint.security.as_ref().unwrap();
        assert_eq!(security["type"], "oauth2");
        assert_eq!(security["config"]["grantType"], "client_credentials");
        assert_eq!(
            security["config"]["tokenUrl"],
            "https://auth.example.com/token"
        );
        assert_eq!(security["config"]["scope"], "read write");
    }
}
