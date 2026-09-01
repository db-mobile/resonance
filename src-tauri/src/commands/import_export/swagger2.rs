//! Swagger 2.0 → OpenAPI 3.0 document conversion.
//!
//! The import pipeline (ref resolution, example generation, security mapping,
//! response shapes) is written against OpenAPI 3.0. Rather than maintaining a
//! parallel parser, a Swagger 2.0 document is converted wholesale into the 3.0
//! shape and fed through the existing pipeline. This also stores endpoint
//! responses in the `content/<media type>/schema` shape the mock server reads,
//! so mocks work for 2.0 imports without special cases.

use serde_json::{Map, Value};

const HTTP_METHODS: [&str; 7] = ["get", "post", "put", "patch", "delete", "head", "options"];

/// Convert a Swagger 2.0 document into OpenAPI 3.0.3 shape.
///
/// @param spec the parsed Swagger 2.0 document
/// @returns the equivalent OpenAPI 3.0 document
pub(crate) fn convert_to_openapi3(spec: Value) -> Result<Value, String> {
    let mut obj = match spec {
        Value::Object(obj) => obj,
        _ => return Err("Swagger document is not an object".to_string()),
    };

    let root_consumes = first_string(obj.get("consumes"));
    let root_produces = first_string(obj.get("produces"));

    let servers = build_servers(&obj);

    // Root parameter definitions are needed to resolve `#/parameters/...` refs
    // while partitioning operation parameters, before the global ref rewrite.
    let root_parameters = obj
        .get("parameters")
        .and_then(|p| p.as_object())
        .cloned()
        .unwrap_or_default();

    let mut components = Map::new();
    if let Some(definitions) = obj.remove("definitions") {
        components.insert("schemas".to_string(), definitions);
    }
    if let Some(parameters) = obj.remove("parameters") {
        components.insert("parameters".to_string(), parameters);
    }
    if let Some(responses) = obj.remove("responses") {
        components.insert("responses".to_string(), responses);
    }
    if let Some(security_defs) = obj.remove("securityDefinitions") {
        components.insert(
            "securitySchemes".to_string(),
            convert_security_definitions(security_defs),
        );
    }

    if let Some(paths) = obj.get_mut("paths").and_then(|p| p.as_object_mut()) {
        for path_item in paths.values_mut() {
            convert_path_item(
                path_item,
                &root_parameters,
                root_consumes.as_deref(),
                root_produces.as_deref(),
            );
        }
    }

    obj.remove("swagger");
    obj.remove("host");
    obj.remove("basePath");
    obj.remove("schemes");
    obj.remove("consumes");
    obj.remove("produces");
    obj.insert("openapi".to_string(), Value::String("3.0.3".to_string()));
    if let Some(servers) = servers {
        obj.insert("servers".to_string(), servers);
    }
    if !components.is_empty() {
        obj.insert("components".to_string(), Value::Object(components));
    }

    let mut converted = Value::Object(obj);
    rewrite_refs(&mut converted);
    Ok(converted)
}

/// `schemes`+`host`+`basePath` → `servers: [{url}]`; https preferred when the
/// spec offers it. A host-less (relative) spec yields no servers, matching the
/// parser's behavior for 3.0 documents without a `servers` array.
fn build_servers(obj: &Map<String, Value>) -> Option<Value> {
    let host = obj.get("host").and_then(|h| h.as_str())?;
    let base_path = obj
        .get("basePath")
        .and_then(|b| b.as_str())
        .unwrap_or("")
        .trim_end_matches('/')
        .to_string();
    let scheme = obj
        .get("schemes")
        .and_then(|s| s.as_array())
        .map(|arr| {
            if arr.iter().any(|v| v.as_str() == Some("https")) {
                "https"
            } else {
                arr.first().and_then(|v| v.as_str()).unwrap_or("https")
            }
        })
        .unwrap_or("https");

    Some(serde_json::json!([
        { "url": format!("{}://{}{}", scheme, host, base_path) }
    ]))
}

fn first_string(value: Option<&Value>) -> Option<String> {
    value
        .and_then(|v| v.as_array())
        .and_then(|arr| arr.first())
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
}

/// Convert every operation under a path item, merging path-item-level
/// parameters into each operation (2.0 allows shared parameters at both levels).
fn convert_path_item(
    path_item: &mut Value,
    root_parameters: &Map<String, Value>,
    root_consumes: Option<&str>,
    root_produces: Option<&str>,
) {
    let Some(item_obj) = path_item.as_object_mut() else {
        return;
    };

    let shared_params = item_obj
        .remove("parameters")
        .and_then(|p| match p {
            Value::Array(arr) => Some(arr),
            _ => None,
        })
        .unwrap_or_default();

    for (method, operation) in item_obj.iter_mut() {
        if !HTTP_METHODS.contains(&method.as_str()) {
            continue;
        }
        convert_operation(
            operation,
            &shared_params,
            root_parameters,
            root_consumes,
            root_produces,
        );
    }
}

fn convert_operation(
    operation: &mut Value,
    shared_params: &[Value],
    root_parameters: &Map<String, Value>,
    root_consumes: Option<&str>,
    root_produces: Option<&str>,
) {
    let Some(op_obj) = operation.as_object_mut() else {
        return;
    };

    let consumes =
        first_string(op_obj.get("consumes")).or_else(|| root_consumes.map(|s| s.to_string()));
    let produces = first_string(op_obj.get("produces"))
        .or_else(|| root_produces.map(|s| s.to_string()))
        .unwrap_or_else(|| "application/json".to_string());
    op_obj.remove("consumes");
    op_obj.remove("produces");

    let own_params = op_obj
        .remove("parameters")
        .and_then(|p| match p {
            Value::Array(arr) => Some(arr),
            _ => None,
        })
        .unwrap_or_default();

    let mut kept_params: Vec<Value> = Vec::new();
    let mut body_param: Option<Value> = None;
    let mut form_params: Vec<Value> = Vec::new();

    for param in shared_params.iter().cloned().chain(own_params) {
        let resolved = resolve_root_parameter(param, root_parameters);
        match resolved.get("in").and_then(|l| l.as_str()) {
            Some("body") => body_param = Some(resolved),
            Some("formData") => form_params.push(resolved),
            _ => kept_params.push(wrap_parameter_schema(resolved)),
        }
    }

    if let Some(request_body) = build_request_body(body_param, &form_params, consumes.as_deref()) {
        op_obj.insert("requestBody".to_string(), request_body);
    }
    if !kept_params.is_empty() {
        op_obj.insert("parameters".to_string(), Value::Array(kept_params));
    }

    if let Some(responses) = op_obj.get_mut("responses") {
        convert_responses(responses, &produces);
    }
}

/// Resolve a `#/parameters/...` ref against the original root parameter map so
/// body/formData partitioning sees the real definition. Non-parameter refs and
/// inline params pass through untouched.
fn resolve_root_parameter(param: Value, root_parameters: &Map<String, Value>) -> Value {
    let Some(ref_path) = param.get("$ref").and_then(|r| r.as_str()) else {
        return param;
    };
    ref_path
        .strip_prefix("#/parameters/")
        .and_then(|name| root_parameters.get(name).cloned())
        .unwrap_or(param)
}

/// Swagger 2.0 flat parameter keywords the 3.0 shape nests under `schema`.
const SCHEMA_KEYWORDS: [&str; 15] = [
    "type",
    "format",
    "items",
    "enum",
    "default",
    "minimum",
    "maximum",
    "exclusiveMinimum",
    "exclusiveMaximum",
    "minLength",
    "maxLength",
    "pattern",
    "minItems",
    "maxItems",
    "multipleOf",
];

fn wrap_parameter_schema(param: Value) -> Value {
    let Some(mut obj) = param.as_object().cloned() else {
        return param;
    };
    if obj.contains_key("schema") || obj.contains_key("$ref") {
        return Value::Object(obj);
    }

    let mut schema = Map::new();
    for key in SCHEMA_KEYWORDS {
        if let Some(value) = obj.remove(key) {
            schema.insert(key.to_string(), value);
        }
    }
    obj.remove("collectionFormat");
    if !schema.is_empty() {
        obj.insert("schema".to_string(), Value::Object(schema));
    }
    Value::Object(obj)
}

/// `in: body` / `in: formData` parameters → a 3.0 `requestBody`.
fn build_request_body(
    body_param: Option<Value>,
    form_params: &[Value],
    consumes: Option<&str>,
) -> Option<Value> {
    if let Some(body) = body_param {
        let schema = body
            .get("schema")
            .cloned()
            .unwrap_or(Value::Object(Map::new()));
        let content_type = consumes.unwrap_or("application/json").to_string();
        let mut request_body = Map::new();
        if let Some(required) = body.get("required") {
            request_body.insert("required".to_string(), required.clone());
        }
        if let Some(description) = body.get("description") {
            request_body.insert("description".to_string(), description.clone());
        }
        request_body.insert(
            "content".to_string(),
            serde_json::json!({ content_type: { "schema": schema } }),
        );
        return Some(Value::Object(request_body));
    }

    if form_params.is_empty() {
        return None;
    }

    let has_file = form_params
        .iter()
        .any(|p| p.get("type").and_then(|t| t.as_str()) == Some("file"));
    let content_type = match consumes {
        Some(ct) if ct.starts_with("multipart/") || ct == "application/x-www-form-urlencoded" => {
            ct.to_string()
        }
        _ if has_file => "multipart/form-data".to_string(),
        _ => "application/x-www-form-urlencoded".to_string(),
    };

    let mut properties = Map::new();
    let mut required: Vec<Value> = Vec::new();
    for param in form_params {
        let Some(name) = param.get("name").and_then(|n| n.as_str()) else {
            continue;
        };
        if param.get("required").and_then(|r| r.as_bool()) == Some(true) {
            required.push(Value::String(name.to_string()));
        }
        let prop = if param.get("type").and_then(|t| t.as_str()) == Some("file") {
            serde_json::json!({ "type": "string", "format": "binary" })
        } else {
            match wrap_parameter_schema(param.clone()).get("schema") {
                Some(schema) => schema.clone(),
                None => serde_json::json!({ "type": "string" }),
            }
        };
        properties.insert(name.to_string(), prop);
    }

    let mut schema = Map::new();
    schema.insert("type".to_string(), Value::String("object".to_string()));
    schema.insert("properties".to_string(), Value::Object(properties));
    if !required.is_empty() {
        schema.insert("required".to_string(), Value::Array(required));
    }

    Some(serde_json::json!({
        "content": { content_type: { "schema": Value::Object(schema) } }
    }))
}

/// 2.0 response `schema` → `content.<produces>.schema`; the 2.0 `examples`
/// media-type map → per-media-type `example`.
fn convert_responses(responses: &mut Value, produces: &str) {
    let Some(responses_obj) = responses.as_object_mut() else {
        return;
    };
    for response in responses_obj.values_mut() {
        let Some(response_obj) = response.as_object_mut() else {
            continue;
        };

        let schema = response_obj.remove("schema");
        let examples = response_obj
            .remove("examples")
            .and_then(|e| match e {
                Value::Object(map) => Some(map),
                _ => None,
            })
            .unwrap_or_default();

        if schema.is_none() && examples.is_empty() {
            continue;
        }

        let mut content = Map::new();
        if let Some(schema) = schema {
            content.insert(
                produces.to_string(),
                serde_json::json!({ "schema": schema }),
            );
        }
        for (media_type, example) in examples {
            let entry = content
                .entry(media_type)
                .or_insert_with(|| Value::Object(Map::new()));
            if let Some(entry_obj) = entry.as_object_mut() {
                entry_obj.insert("example".to_string(), example);
            }
        }
        response_obj.insert("content".to_string(), Value::Object(content));
    }
}

/// `securityDefinitions` → `components.securitySchemes`.
fn convert_security_definitions(defs: Value) -> Value {
    let Some(defs_obj) = defs.as_object() else {
        return defs;
    };
    let mut converted = Map::new();
    for (name, scheme) in defs_obj {
        let scheme_type = scheme.get("type").and_then(|t| t.as_str()).unwrap_or("");
        let new_scheme = match scheme_type {
            "basic" => serde_json::json!({ "type": "http", "scheme": "basic" }),
            "oauth2" => convert_oauth2_scheme(scheme),
            _ => scheme.clone(),
        };
        converted.insert(name.clone(), new_scheme);
    }
    Value::Object(converted)
}

/// 2.0 oauth2 flow names → the 3.0 `flows` object.
fn convert_oauth2_scheme(scheme: &Value) -> Value {
    let flow_name = match scheme.get("flow").and_then(|f| f.as_str()) {
        Some("application") => "clientCredentials",
        Some("accessCode") => "authorizationCode",
        Some("password") => "password",
        _ => "implicit",
    };

    let mut flow = Map::new();
    for key in ["authorizationUrl", "tokenUrl"] {
        if let Some(value) = scheme.get(key) {
            flow.insert(key.to_string(), value.clone());
        }
    }
    flow.insert(
        "scopes".to_string(),
        scheme
            .get("scopes")
            .cloned()
            .unwrap_or_else(|| Value::Object(Map::new())),
    );

    serde_json::json!({
        "type": "oauth2",
        "flows": { flow_name: Value::Object(flow) }
    })
}

/// Rewrite 2.0 `$ref` prefixes to their `components` homes across the whole
/// document. A plain string-prefix walk with no resolution, so it is cycle-safe
/// by construction.
fn rewrite_refs(value: &mut Value) {
    match value {
        Value::Object(map) => {
            for (key, entry) in map.iter_mut() {
                if key == "$ref" {
                    if let Value::String(path) = entry {
                        if let Some(rest) = path.strip_prefix("#/definitions/") {
                            *path = format!("#/components/schemas/{}", rest);
                        } else if let Some(rest) = path.strip_prefix("#/parameters/") {
                            *path = format!("#/components/parameters/{}", rest);
                        } else if let Some(rest) = path.strip_prefix("#/responses/") {
                            *path = format!("#/components/responses/{}", rest);
                        }
                    }
                } else {
                    rewrite_refs(entry);
                }
            }
        }
        Value::Array(arr) => {
            for entry in arr.iter_mut() {
                rewrite_refs(entry);
            }
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn petstore() -> Value {
        json!({
            "swagger": "2.0",
            "info": { "title": "Petstore", "version": "1.0" },
            "host": "petstore.example.com",
            "basePath": "/v2",
            "schemes": ["http", "https"],
            "consumes": ["application/json"],
            "produces": ["application/json"],
            "securityDefinitions": {
                "BasicAuth": { "type": "basic" },
                "KeyAuth": { "type": "apiKey", "name": "X-Api-Key", "in": "header" },
                "OAuth": {
                    "type": "oauth2",
                    "flow": "accessCode",
                    "authorizationUrl": "https://auth.example.com/authorize",
                    "tokenUrl": "https://auth.example.com/token",
                    "scopes": { "read": "Read access" }
                }
            },
            "parameters": {
                "limitParam": { "name": "limit", "in": "query", "type": "integer", "default": 10 }
            },
            "paths": {
                "/pets": {
                    "parameters": [
                        { "name": "tenant", "in": "header", "type": "string" }
                    ],
                    "get": {
                        "summary": "List pets",
                        "parameters": [ { "$ref": "#/parameters/limitParam" } ],
                        "responses": {
                            "200": {
                                "description": "ok",
                                "schema": { "type": "array", "items": { "$ref": "#/definitions/Pet" } },
                                "examples": { "application/json": [{ "name": "rex" }] }
                            }
                        }
                    },
                    "post": {
                        "summary": "Create pet",
                        "parameters": [
                            { "name": "pet", "in": "body", "required": true,
                              "schema": { "$ref": "#/definitions/Pet" } }
                        ],
                        "responses": { "201": { "description": "created" } }
                    }
                },
                "/pets/upload": {
                    "post": {
                        "summary": "Upload photo",
                        "consumes": ["multipart/form-data"],
                        "parameters": [
                            { "name": "note", "in": "formData", "type": "string", "required": true },
                            { "name": "photo", "in": "formData", "type": "file" }
                        ],
                        "responses": { "200": { "description": "ok" } }
                    }
                }
            },
            "definitions": {
                "Pet": {
                    "type": "object",
                    "properties": {
                        "name": { "type": "string" },
                        "owner": { "$ref": "#/definitions/Owner" }
                    }
                },
                "Owner": {
                    "type": "object",
                    "properties": { "name": { "type": "string" } }
                }
            }
        })
    }

    fn converted() -> Value {
        convert_to_openapi3(petstore()).expect("conversion succeeds")
    }

    #[test]
    fn host_base_path_and_schemes_become_a_server() {
        let doc = converted();
        assert_eq!(
            doc.pointer("/servers/0/url").unwrap(),
            &json!("https://petstore.example.com/v2")
        );
        assert_eq!(doc.get("openapi").unwrap(), &json!("3.0.3"));
        assert!(doc.get("swagger").is_none());
        assert!(doc.get("host").is_none());
    }

    #[test]
    fn definitions_move_to_components_and_refs_are_rewritten() {
        let doc = converted();
        assert!(doc.pointer("/components/schemas/Pet").is_some());
        assert!(doc.get("definitions").is_none());
        assert_eq!(
            doc.pointer("/components/schemas/Pet/properties/owner/$ref")
                .unwrap(),
            &json!("#/components/schemas/Owner")
        );
    }

    #[test]
    fn body_parameter_becomes_request_body() {
        let doc = converted();
        let request_body = doc.pointer("/paths/~1pets/post/requestBody").unwrap();
        assert_eq!(request_body.get("required").unwrap(), &json!(true));
        assert_eq!(
            request_body
                .pointer("/content/application~1json/schema/$ref")
                .unwrap(),
            &json!("#/components/schemas/Pet")
        );
    }

    #[test]
    fn form_data_parameters_become_multipart_request_body() {
        let doc = converted();
        let schema = doc
            .pointer("/paths/~1pets~1upload/post/requestBody/content/multipart~1form-data/schema")
            .unwrap();
        assert_eq!(
            schema.pointer("/properties/photo/format").unwrap(),
            &json!("binary")
        );
        assert_eq!(schema.pointer("/required/0").unwrap(), &json!("note"));
    }

    #[test]
    fn path_level_and_ref_parameters_are_merged_and_wrapped() {
        let doc = converted();
        let params = doc
            .pointer("/paths/~1pets/get/parameters")
            .unwrap()
            .as_array()
            .unwrap();
        let tenant = params
            .iter()
            .find(|p| p.get("name") == Some(&json!("tenant")))
            .expect("path-level param merged");
        assert_eq!(tenant.pointer("/schema/type").unwrap(), &json!("string"));
        let limit = params
            .iter()
            .find(|p| p.get("name") == Some(&json!("limit")))
            .expect("root-ref param resolved");
        assert_eq!(limit.pointer("/schema/default").unwrap(), &json!(10));
    }

    #[test]
    fn response_schema_and_examples_move_into_content() {
        let doc = converted();
        let response = doc.pointer("/paths/~1pets/get/responses/200").unwrap();
        assert!(response.get("schema").is_none());
        assert_eq!(
            response
                .pointer("/content/application~1json/schema/items/$ref")
                .unwrap(),
            &json!("#/components/schemas/Pet")
        );
        assert_eq!(
            response
                .pointer("/content/application~1json/example/0/name")
                .unwrap(),
            &json!("rex")
        );
    }

    #[test]
    fn security_definitions_convert_to_security_schemes() {
        let doc = converted();
        assert_eq!(
            doc.pointer("/components/securitySchemes/BasicAuth")
                .unwrap(),
            &json!({ "type": "http", "scheme": "basic" })
        );
        assert_eq!(
            doc.pointer("/components/securitySchemes/KeyAuth/type")
                .unwrap(),
            &json!("apiKey")
        );
        let oauth = doc
            .pointer("/components/securitySchemes/OAuth/flows/authorizationCode")
            .unwrap();
        assert_eq!(
            oauth.get("tokenUrl").unwrap(),
            &json!("https://auth.example.com/token")
        );
        assert_eq!(
            oauth.pointer("/scopes/read").unwrap(),
            &json!("Read access")
        );
    }

    #[test]
    fn circular_definitions_survive_conversion() {
        let doc = convert_to_openapi3(json!({
            "swagger": "2.0",
            "info": { "title": "Cyclic" },
            "paths": {},
            "definitions": {
                "Node": {
                    "type": "object",
                    "properties": { "child": { "$ref": "#/definitions/Node" } }
                }
            }
        }))
        .unwrap();
        assert_eq!(
            doc.pointer("/components/schemas/Node/properties/child/$ref")
                .unwrap(),
            &json!("#/components/schemas/Node")
        );
    }
}
