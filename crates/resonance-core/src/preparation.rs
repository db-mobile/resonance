use crate::cookies;
use crate::{
    model::*,
    variables::{VariableProcessor, js_string},
};
use base64::Engine;
use serde_json::{Map, Value, json};

#[derive(Debug)]
pub struct Prepared {
    pub request: Value,
    pub auth_headers: Map<String, Value>,
    pub auth_query: Map<String, Value>,
    pub stripped_credentials: bool,
}

pub fn effective_auth(template: &RequestTemplate) -> (Value, Value) {
    if template.auth.kind != AuthKind::Inherit {
        return (json!(template.auth), json!({"kind":"request"}));
    }
    for parent in &template.inherited_auth {
        if parent.auth_config.kind != AuthKind::Inherit {
            return (json!(parent.auth_config), json!(parent.source));
        }
    }
    (json!({"type":"none","config":{}}), Value::Null)
}

pub fn prepare(
    template: &RequestTemplate,
    context: &ExecutionContext,
    variables: &Variables,
    processor: &mut VariableProcessor,
    refreshed_auth: Option<&Value>,
) -> Result<Prepared, ExecutionError> {
    if let Some(error) = &template.capture_error {
        return Err(error.clone());
    }
    if !matches!(template.protocol.as_str(), "" | "http" | "graphql") {
        return Err(ExecutionError::new(
            "unsupportedProtocol",
            template.protocol.clone(),
        ));
    }
    let mut vars = variables.clone();
    if vars.get("baseUrl").is_none_or(|v| v.is_null() || v == "") {
        vars.insert("baseUrl".into(), template.base_url.clone().into());
    }
    let mut auth = refreshed_auth
        .cloned()
        .unwrap_or_else(|| effective_auth(template).0);
    if template.bearer_fallback
        && auth["type"] == "bearer"
        && auth["config"]["token"].as_str().unwrap_or("").is_empty()
        && vars
            .get("bearerToken")
            .is_some_and(|v| !v.is_null() && v != "" && v != false && v != 0)
    {
        auth["config"]["token"] = "{{bearerToken}}".into();
    }
    auth = processor.value(&auth, &vars);
    let config = &auth["config"];
    let get = |key: &str| config[key].as_str().unwrap_or("");
    let mut auth_headers = Map::new();
    let mut auth_query = Map::new();
    let mut transport = Map::new();
    match auth["type"].as_str().unwrap_or("") {
        "bearer" | "oauth2" if !get("token").is_empty() => {
            let prefix = if get("headerPrefix").is_empty() {
                "Bearer"
            } else {
                get("headerPrefix")
            };
            auth_headers.insert(
                "Authorization".into(),
                format!("{prefix} {}", get("token")).into(),
            );
        }
        "basic" if !get("username").is_empty() || !get("password").is_empty() => {
            auth_headers.insert(
                "Authorization".into(),
                format!(
                    "Basic {}",
                    base64::engine::general_purpose::STANDARD.encode(format!(
                        "{}:{}",
                        get("username"),
                        get("password")
                    ))
                )
                .into(),
            );
        }
        "api-key" if !get("keyName").is_empty() && !get("keyValue").is_empty() => {
            if get("location") == "header" {
                auth_headers.insert(get("keyName").into(), get("keyValue").into());
            } else if get("location") == "query" {
                auth_query.insert(get("keyName").into(), get("keyValue").into());
            }
        }
        "digest" | "ntlm" if !get("username").is_empty() || !get("password").is_empty() => {
            let is_ntlm = auth["type"] == "ntlm";
            let mut credentials = json!({"username":get("username"),"password":get("password")});
            if is_ntlm {
                credentials["domain"] = get("domain").into();
                credentials["workstation"] = get("workstation").into();
            }
            transport.insert(if is_ntlm { "ntlm" } else { "auth" }.into(), credentials);
        }
        "aws-v4" if !get("accessKeyId").is_empty() && !get("secretAccessKey").is_empty() => {
            transport.insert("awsAuth".into(),json!({"accessKeyId":get("accessKeyId"),"secretAccessKey":get("secretAccessKey"),"region":if get("region").is_empty() {"us-east-1"} else {get("region")},"service":get("service"),"sessionToken":config["sessionToken"]}));
        }
        _ => {}
    }
    let mut headers = template.default_headers.clone();
    headers.extend(template.headers.clone());
    headers.extend(auth_headers.clone());
    let headers = process_map(&headers, processor, &vars);
    let paths = process_map(&template.path_params, processor, &vars);
    let mut url_vars = vars.clone();
    url_vars.extend(paths.clone());
    let raw = if template.url.is_empty() {
        endpoint_url(template)
    } else {
        template.url.clone()
    };
    let url = scheme(&processor.text(&raw, &url_vars));
    let mut rows: Vec<_> = template
        .query_rows
        .iter()
        .filter(|p| p.enabled != Some(false) && !p.key.is_empty())
        .map(|p| (p.key.clone(), p.value.clone()))
        .collect();
    for (key, value) in &auth_query {
        if !rows.iter().any(|(k, v)| k == key && !v.is_empty()) {
            rows.retain(|(k, _)| k != key);
            rows.push((key.clone(), js_string(value)));
        }
    }
    let rows: Vec<_> = rows
        .into_iter()
        .map(|(k, v)| (processor.text(&k, &vars), processor.text(&v, &vars)))
        .filter(|(k, _)| !k.is_empty())
        .collect();
    let query = query_string(&rows);
    let base = template
        .mock_base_url
        .as_ref()
        .filter(|_| !template.path.is_empty())
        .map(|base| format!("{base}{}", mock_path(&template.path, &paths)))
        .unwrap_or_else(|| url.split('?').next().unwrap_or("").into());
    let url = if query.is_empty() {
        base
    } else {
        format!("{base}?{query}")
    };
    let method = if template.protocol == "graphql" {
        "POST"
    } else if template.method.is_empty() {
        "GET"
    } else {
        &template.method
    };
    let body = body(&template.body, method, processor, &vars)?;
    let settings = &context.settings;
    let timeout = settings.request_timeout.unwrap_or(30000);
    let timeout = (timeout != 0).then_some(timeout);
    let mut request = json!({"protocol":template.protocol,"method":method,"url":url,"rawUrl":raw,"headers":headers,"pathParams":paths,"queryParams":rows.into_iter().map(|(k,v)|(k,Value::String(v))).collect::<Map<_,_>>(),"body":body,
        "bodyType":if matches!(template.body.mode.as_str(),"text"|"formdata"|"urlencoded"|"binary") {Some(template.body.mode.clone())} else {None},
        "httpVersion":settings.http_version.as_deref().unwrap_or("auto"),"timeout":timeout,"verifySsl":settings.verify_ssl != Some(false),"followRedirects":settings.follow_redirects != Some(false)});
    request.as_object_mut().unwrap().extend(transport);
    Ok(Prepared {
        request,
        auth_headers,
        auth_query,
        stripped_credentials: false,
    })
}
fn process_map(
    map: &Map<String, Value>,
    processor: &mut VariableProcessor,
    variables: &Variables,
) -> Map<String, Value> {
    map.iter()
        .map(|(k, v)| {
            (
                processor.text(k, variables),
                Value::String(processor.text(
                    &if v.is_null() {
                        String::new()
                    } else {
                        js_string(v)
                    },
                    variables,
                )),
            )
        })
        .filter(|(k, _)| !k.is_empty())
        .collect()
}
fn endpoint_url(template: &RequestTemplate) -> String {
    let mut path = template.path.clone();
    let single = regex::Regex::new(r"\{([^{}]+)\}").unwrap();
    path = single
        .replace_all(&path, |caps: &regex::Captures<'_>| {
            let found = caps.get(0).unwrap();
            if template
                .path_parameter_names
                .iter()
                .any(|key| key == &caps[1])
                && !path[..found.start()].ends_with('{')
                && !path[found.end()..].starts_with('}')
            {
                format!("{{{{{}}}}}", &caps[1])
            } else {
                caps[0].to_string()
            }
        })
        .into_owned();
    if !path.contains("://") && !path.starts_with("{{") {
        format!("{{{{baseUrl}}}}{path}")
    } else {
        path
    }
}
fn scheme(url: &str) -> String {
    if url.is_empty() || url.contains("://") {
        url.into()
    } else {
        format!("https://{url}")
    }
}
pub fn query_string(rows: &[(String, String)]) -> String {
    rows.iter()
        .map(|(k, v)| format!("{}={}", encode(k), encode(v)))
        .collect::<Vec<_>>()
        .join("&")
}
fn encode(text: &str) -> String {
    if text.contains('%') {
        return text.into();
    }
    text.as_bytes()
        .iter()
        .map(|b| {
            if b.is_ascii_alphanumeric() || b"-_.!~*'()".contains(b) {
                (*b as char).to_string()
            } else {
                format!("%{b:02X}")
            }
        })
        .collect()
}
pub fn mock_path(template: &str, paths: &Map<String, Value>) -> String {
    let mut path = template.trim().to_string();
    if let Some((_, rest)) = path.split_once("://") {
        path = rest
            .find('/')
            .map(|i| rest[i..].to_string())
            .unwrap_or_default();
    } else if path.starts_with("{{")
        && let Some(i) = path.find("}}")
    {
        let rest = &path[i + 2..];
        if rest.is_empty() || rest.starts_with('/') || rest.starts_with('?') {
            path = rest.into();
        }
    }
    path = path.split(['?', '#']).next().unwrap_or("").into();
    for (key, value) in paths {
        path = path
            .replace(&format!("{{{{{key}}}}}"), &js_string(value))
            .replace(&format!("{{{key}}}"), &js_string(value));
    }
    if !path.starts_with('/') {
        path.insert(0, '/');
    }
    path
}
fn body(
    template: &BodyTemplate,
    method: &str,
    processor: &mut VariableProcessor,
    vars: &Variables,
) -> Result<Value, ExecutionError> {
    if let Some(error) = &template.capture_error {
        return Err(ExecutionError::new("invalidBody", error.clone()));
    }
    if let Some(gql) = &template.graphql {
        let mut payload = json!({"query":processor.text(gql.query.trim(),vars),"variables":{}});
        if !gql.variables.trim().is_empty() {
            payload["variables"] =
                serde_json::from_str(&processor.text(gql.variables.trim(), vars))
                    .map_err(|e| ExecutionError::new("invalidGraphqlVariables", e.to_string()))?;
        }
        if let Some(name) = &gql.operation_name
            && !name.is_empty()
        {
            payload["operationName"] = name.clone().into();
        }
        return Ok(payload);
    }
    match template.mode.as_str() {
        "formdata" | "urlencoded" => {
            let rows: Vec<_> = template.fields.iter().filter(|f| f["enabled"] != false).map(|f| {
                let mut row = json!({"key":processor.text(f["key"].as_str().unwrap_or(""),vars),
                    "value":if f["type"] == "file" {String::new()} else {processor.text(f["value"].as_str().unwrap_or(""),vars)},
                    "type":f["type"].as_str().unwrap_or("text")});
                if let Some(path) = f["filePath"].as_str().filter(|s|!s.is_empty()) {row["filePath"] = processor.text(path,vars).into();}
                if let Some(content_type) = f["contentType"].as_str().filter(|s|!s.is_empty()) {row["contentType"] = content_type.into();}
                row
            }).collect();
            Ok(if rows.is_empty() {
                Value::Null
            } else {
                Value::Array(rows)
            })
        }
        "binary" => {
            if template.file_path.is_empty() {
                return Err(ExecutionError::new("missingBinaryFile", Value::Null));
            }
            Ok(
                json!({"filePath":processor.text(&template.file_path,vars),"contentType":template.content_type}),
            )
        }
        _ if matches!(method.to_uppercase().as_str(), "GET" | "HEAD") => Ok(Value::Null),
        "text" => Ok(if template.content.is_empty() {
            Value::Null
        } else {
            processor.text(&template.content, vars).into()
        }),
        _ if template.content.trim().is_empty() => Ok(Value::Null),
        _ => serde_json::from_str(&processor.text(template.content.trim(), vars))
            .map_err(|e| ExecutionError::new("invalidBody", e.to_string())),
    }
}

/// Keep explicit script edits while rebuilding untouched derived fields.
pub fn refresh(
    before: &Prepared,
    modified: &Value,
    mut rebuilt: Prepared,
    processor: &mut VariableProcessor,
    vars: &Variables,
    template: &RequestTemplate,
) -> Prepared {
    let mut modified = modified.clone();
    for field in ["queryParams", "pathParams"] {
        if let Some(value) = modified.get_mut(field) {
            *value = normalize_params(value);
        }
    }
    for field in [
        "url",
        "method",
        "headers",
        "body",
        "queryParams",
        "pathParams",
    ] {
        if modified.get(field).is_some() && modified.get(field) != before.request.get(field) {
            rebuilt.request[field] = processor.value(&modified[field], vars);
        }
    }
    let query_changed = modified.get("queryParams").is_some()
        && modified["queryParams"] != before.request["queryParams"];
    let path_changed = modified.get("pathParams").is_some()
        && modified["pathParams"] != before.request["pathParams"];
    if query_changed || path_changed {
        let current = rebuilt.request["url"].as_str().unwrap_or("").to_string();
        let mut base = current.split('?').next().unwrap_or("").to_string();
        if path_changed && modified["url"] == before.request["url"] {
            let paths = rebuilt.request["pathParams"]
                .as_object()
                .cloned()
                .unwrap_or_default();
            base = if let Some(mock) = &template.mock_base_url {
                format!("{mock}{}", mock_path(&template.path, &paths))
            } else {
                let mut variables = vars.clone();
                variables.extend(paths);
                scheme(&processor.text(before.request["rawUrl"].as_str().unwrap_or(""), &variables))
                    .split('?')
                    .next()
                    .unwrap_or("")
                    .into()
            };
        }
        let query = if query_changed {
            query_string(
                &rebuilt.request["queryParams"]
                    .as_object()
                    .into_iter()
                    .flatten()
                    .filter(|(_, v)| !v.is_null())
                    .map(|(k, v)| {
                        (
                            k.clone(),
                            if v.is_object() || v.is_array() {
                                v.to_string()
                            } else {
                                js_string(v)
                            },
                        )
                    })
                    .collect::<Vec<_>>(),
            )
        } else {
            current.split_once('?').map(|(_, q)| q).unwrap_or("").into()
        };
        rebuilt.request["url"] = if query.is_empty() {
            base
        } else {
            format!("{base}?{query}")
        }
        .into();
    }
    for (headers, query) in [
        (&before.auth_headers, &before.auth_query),
        (&rebuilt.auth_headers, &rebuilt.auth_query),
    ] {
        rebuilt.stripped_credentials |= strip_cross_origin_auth(
            &mut rebuilt.request,
            before.request["url"].as_str().unwrap_or(""),
            headers,
            query,
        );
    }
    rebuilt
}

fn normalize_params(value: &Value) -> Value {
    value
        .as_object()
        .into_iter()
        .flatten()
        .filter(|(_, value)| !value.is_null())
        .map(|(key, value)| {
            (
                key.clone(),
                Value::String(if value.is_object() || value.is_array() {
                    value.to_string()
                } else {
                    js_string(value)
                }),
            )
        })
        .collect()
}

/// Remove generated credentials when a script changes origin, preserving explicit
/// replacement values and the legacy URLSearchParams ordering of retained keys.
pub fn strip_cross_origin_auth(
    request: &mut Value,
    original_url: &str,
    auth_headers: &Map<String, Value>,
    auth_query: &Map<String, Value>,
) -> bool {
    let original = url::Url::parse(original_url);
    let current = url::Url::parse(request["url"].as_str().unwrap_or(""));
    if let (Ok(original), Ok(current)) = (&original, &current)
        && original.origin() == current.origin()
    {
        return false;
    }
    let mut stripped = false;
    for (field, credentials, case_insensitive) in [
        ("headers", auth_headers, true),
        ("queryParams", auth_query, false),
    ] {
        if let Some(values) = request.get_mut(field).and_then(Value::as_object_mut) {
            values.retain(|key, value| {
                let remove = credentials.iter().any(|(name, secret)| {
                    (if case_insensitive {
                        name.eq_ignore_ascii_case(key)
                    } else {
                        name == key
                    }) && secret == value
                });
                stripped |= remove;
                !remove
            });
        }
    }
    for field in ["auth", "awsAuth", "ntlm"] {
        stripped |= request
            .as_object_mut()
            .unwrap()
            .remove(field)
            .is_some_and(|v| !v.is_null());
    }
    if let Ok(mut url) = current {
        let mut pairs: Vec<(String, String)> = url.query_pairs().into_owned().collect();
        let mut changed = false;
        for (key, secret) in auth_query {
            let secret = js_string(secret);
            if pairs.iter().any(|(k, v)| k == key && *v == secret) {
                let remaining: Vec<_> = pairs
                    .iter()
                    .filter(|(k, v)| k == key && *v != secret)
                    .cloned()
                    .collect();
                pairs.retain(|(k, _)| k != key);
                pairs.extend(remaining);
                changed = true;
            }
        }
        if changed {
            url.set_query(None);
            if !pairs.is_empty() {
                url.query_pairs_mut().extend_pairs(pairs);
            }
            request["url"] = url.to_string().into();
            stripped = true;
        }
    }
    stripped
}

pub fn finalize(prepared: &mut Prepared, context: &ExecutionContext) {
    let request = &mut prepared.request;
    let url = request["url"].as_str().unwrap_or("").to_string();
    if context.settings.cookie_jar_enabled != Some(false)
        && let Some(cookie) = cookies::header(&context.cookies, &url)
        && request["headers"]
            .as_object()
            .is_some_and(|h| !h.contains_key("Cookie") && !h.contains_key("cookie"))
    {
        request["headers"]["Cookie"] = cookie.into();
    }
    if let Ok(url) = url::Url::parse(&url)
        && let Some(host) = url.host_str()
    {
        let host_port = url
            .port()
            .map(|p| format!("{host}:{p}"))
            .unwrap_or_else(|| host.into());
        let eligible = |c: &&Certificate| {
            c.enabled != Some(false)
                && ((c.cert_path.as_ref().is_some_and(|s| !s.is_empty())
                    && c.key_path.as_ref().is_some_and(|s| !s.is_empty()))
                    || c.ca_path.as_ref().is_some_and(|s| !s.is_empty()))
        };
        let cert = context
            .certificates
            .iter()
            .filter(eligible)
            .find(|c| c.host.trim().eq_ignore_ascii_case(&host_port))
            .or_else(|| {
                context
                    .certificates
                    .iter()
                    .filter(eligible)
                    .find(|c| c.host.trim().eq_ignore_ascii_case(host))
            });
        if let Some(cert) = cert {
            request["clientCert"] =
                json!({"certPath":cert.cert_path,"keyPath":cert.key_path,"caPath":cert.ca_path});
        }
    }
}
