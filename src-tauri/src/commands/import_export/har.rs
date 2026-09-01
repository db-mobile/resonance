//! HAR (HTTP Archive) parsing: converts a browser/proxy capture into a `Collection`.
//!
//! A HAR from a live session is noisy: static assets, polling repeats,
//! transport headers. The importer filters conservatively (documents and API
//! calls survive, obvious assets don't), dedupes exact repeats, and reports
//! both counts so nothing disappears silently.

use super::common::{param_map_entry, unique_folder_id};
use super::{Collection, Endpoint, Folder};
use serde_json::Value;
use std::collections::{HashMap, HashSet};

#[derive(Debug)]
pub(crate) struct HarImport {
    pub collection: Collection,
    pub skipped_assets: usize,
    pub deduped: usize,
}

/// Chrome/Firefox annotate entries with the DevTools resource type; anything in
/// this set is never an API call worth importing.
const SKIPPED_RESOURCE_TYPES: [&str; 11] = [
    "image",
    "font",
    "stylesheet",
    "script",
    "media",
    "manifest",
    "ping",
    "csp_report",
    "preflight",
    "prefetch",
    "texttrack",
];

const SKIPPED_MIME_PREFIXES: [&str; 4] = ["image/", "font/", "audio/", "video/"];
const SKIPPED_MIME_TYPES: [&str; 3] = ["text/css", "application/javascript", "text/javascript"];

const SKIPPED_EXTENSIONS: [&str; 16] = [
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".ico", ".css", ".js", ".mjs", ".map",
    ".woff", ".woff2", ".ttf", ".otf", ".eot",
];

/// Transport headers recomputed at send time; importing them breaks replays.
const SKIPPED_HEADERS: [&str; 4] = ["content-length", "host", "connection", "accept-encoding"];

const MAX_NAME_LENGTH: usize = 80;

pub(crate) fn parse_har(har: Value, source_name: &str) -> Result<HarImport, String> {
    let entries = har
        .pointer("/log/entries")
        .and_then(|e| e.as_array())
        .ok_or("Not a HAR file (missing log.entries)")?;

    let name = if source_name.trim().is_empty() {
        "HAR Import".to_string()
    } else {
        source_name.to_string()
    };

    let mut endpoints: Vec<Endpoint> = Vec::new();
    let mut endpoint_hosts: Vec<String> = Vec::new();
    let mut seen_requests: HashSet<String> = HashSet::new();
    let mut name_counts: HashMap<String, usize> = HashMap::new();
    let mut skipped_assets = 0usize;
    let mut deduped = 0usize;

    for entry in entries {
        let Some(request) = entry.get("request") else {
            skipped_assets += 1;
            continue;
        };
        if is_asset_entry(entry) {
            skipped_assets += 1;
            continue;
        }

        let raw_url = request.get("url").and_then(|u| u.as_str()).unwrap_or("");
        let Ok(parsed_url) = url::Url::parse(raw_url) else {
            skipped_assets += 1;
            continue;
        };

        let method = request
            .get("method")
            .and_then(|m| m.as_str())
            .unwrap_or("GET")
            .to_uppercase();
        let body_text = request
            .pointer("/postData/text")
            .and_then(|t| t.as_str())
            .unwrap_or("");

        let dedupe_key = format!("{} {} {}", method, raw_url, body_text);
        if !seen_requests.insert(dedupe_key) {
            deduped += 1;
            continue;
        }

        let endpoint = build_endpoint(request, &method, raw_url, &parsed_url, &mut name_counts);
        endpoint_hosts.push(parsed_url.host_str().unwrap_or("").to_string());
        endpoints.push(endpoint);
    }

    if endpoints.is_empty() {
        return Err(format!(
            "No importable requests found in HAR ({} asset entries skipped)",
            skipped_assets
        ));
    }

    let folders = build_host_folders(&endpoints, &endpoint_hosts);

    Ok(HarImport {
        collection: Collection {
            id: uuid::Uuid::new_v4().to_string(),
            name,
            description: None,
            base_url: None,
            endpoints,
            folders,
            variables: None,
            auth_config: None,
        },
        skipped_assets,
        deduped,
    })
}

/// An entry is an asset when the capture's resource type, the response MIME
/// type, or the URL extension says so. Documents, XHR/fetch, and anything
/// uncategorized survive.
fn is_asset_entry(entry: &Value) -> bool {
    if let Some(resource_type) = entry
        .get("_resourceType")
        .and_then(|t| t.as_str())
        .map(|t| t.to_ascii_lowercase())
    {
        if SKIPPED_RESOURCE_TYPES.contains(&resource_type.as_str()) {
            return true;
        }
    }

    if let Some(mime) = entry
        .pointer("/response/content/mimeType")
        .and_then(|m| m.as_str())
        .map(|m| m.to_ascii_lowercase())
    {
        if SKIPPED_MIME_PREFIXES.iter().any(|p| mime.starts_with(p))
            || SKIPPED_MIME_TYPES.iter().any(|t| mime.starts_with(t))
        {
            return true;
        }
    }

    if let Some(url_str) = entry.pointer("/request/url").and_then(|u| u.as_str()) {
        if let Ok(parsed) = url::Url::parse(url_str) {
            let path = parsed.path().to_ascii_lowercase();
            if SKIPPED_EXTENSIONS.iter().any(|ext| path.ends_with(ext)) {
                return true;
            }
        }
    }

    false
}

fn build_endpoint(
    request: &Value,
    method: &str,
    raw_url: &str,
    parsed_url: &url::Url,
    name_counts: &mut HashMap<String, usize>,
) -> Endpoint {
    let mut display_path = parsed_url.path().to_string();
    if display_path.len() > MAX_NAME_LENGTH {
        display_path.truncate(MAX_NAME_LENGTH);
    }
    let base_name = format!("{} {}", method, display_path);
    let count = name_counts.entry(base_name.clone()).or_insert(0);
    *count += 1;
    let name = if *count == 1 {
        base_name
    } else {
        format!("{} ({})", base_name, count)
    };

    Endpoint {
        id: uuid::Uuid::new_v4().to_string(),
        name,
        method: method.to_string(),
        path: raw_url.to_string(),
        description: None,
        parameters: extract_parameters(request),
        request_body: extract_body(request.get("postData")),
        responses: None,
        security: None,
        scripts: None,
        graphql_data: None,
    }
}

fn extract_parameters(request: &Value) -> Option<Value> {
    let mut query_params = serde_json::Map::new();
    let mut header_params = serde_json::Map::new();

    if let Some(query) = request.get("queryString").and_then(|q| q.as_array()) {
        for param in query {
            let Some(name) = param.get("name").and_then(|n| n.as_str()) else {
                continue;
            };
            if name.is_empty() {
                continue;
            }
            let value = param.get("value").and_then(|v| v.as_str()).unwrap_or("");
            query_params.insert(name.to_string(), param_map_entry(value, None));
        }
    }

    if let Some(headers) = request.get("headers").and_then(|h| h.as_array()) {
        for header in headers {
            let Some(name) = header.get("name").and_then(|n| n.as_str()) else {
                continue;
            };
            if name.is_empty() || name.starts_with(':') {
                continue;
            }
            if SKIPPED_HEADERS.contains(&name.to_ascii_lowercase().as_str()) {
                continue;
            }
            let value = header.get("value").and_then(|v| v.as_str()).unwrap_or("");
            header_params.insert(name.to_string(), param_map_entry(value, None));
        }
    }

    // HAR carries cookies both as a Cookie header and a parsed cookies[] list.
    // When only the list survives (some proxies strip the header), synthesize
    // one; the app's environment-scoped cookie jar is deliberately not touched.
    let has_cookie_header = header_params
        .keys()
        .any(|k| k.eq_ignore_ascii_case("cookie"));
    if !has_cookie_header {
        if let Some(cookies) = request.get("cookies").and_then(|c| c.as_array()) {
            let pairs: Vec<String> = cookies
                .iter()
                .filter_map(|c| {
                    let name = c.get("name").and_then(|n| n.as_str())?;
                    let value = c.get("value").and_then(|v| v.as_str()).unwrap_or("");
                    Some(format!("{}={}", name, value))
                })
                .collect();
            if !pairs.is_empty() {
                header_params.insert(
                    "Cookie".to_string(),
                    param_map_entry(&pairs.join("; "), None),
                );
            }
        }
    }

    if query_params.is_empty() && header_params.is_empty() {
        return None;
    }

    let mut result = serde_json::Map::new();
    if !query_params.is_empty() {
        result.insert("query".to_string(), Value::Object(query_params));
    }
    if !header_params.is_empty() {
        result.insert("header".to_string(), Value::Object(header_params));
    }
    Some(Value::Object(result))
}

fn extract_body(post_data: Option<&Value>) -> Option<Value> {
    let post_data = post_data?;
    let mime = post_data
        .get("mimeType")
        .and_then(|m| m.as_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let text = post_data.get("text").and_then(|t| t.as_str()).unwrap_or("");
    let params = post_data.get("params").and_then(|p| p.as_array());

    if mime.starts_with("application/x-www-form-urlencoded") {
        if let Some(fields) = param_fields(params, false) {
            return Some(serde_json::json!({ "type": "urlencoded", "fields": fields }));
        }
    }
    if mime.starts_with("multipart/form-data") {
        if let Some(fields) = param_fields(params, true) {
            return Some(serde_json::json!({ "type": "formdata", "fields": fields }));
        }
        return None;
    }

    if text.is_empty() {
        return None;
    }
    Some(serde_json::json!({ "example": text }))
}

/// HAR postData params → a fields map, optionally skipping file parts.
fn param_fields(params: Option<&Vec<Value>>, skip_files: bool) -> Option<Value> {
    let params = params?;
    let mut fields = serde_json::Map::new();
    for param in params {
        if skip_files && param.get("fileName").is_some() {
            continue;
        }
        let Some(name) = param.get("name").and_then(|n| n.as_str()) else {
            continue;
        };
        let value = param.get("value").and_then(|v| v.as_str()).unwrap_or("");
        fields.insert(name.to_string(), Value::String(value.to_string()));
    }
    if fields.is_empty() {
        None
    } else {
        Some(Value::Object(fields))
    }
}

/// One folder per host when the capture spans several; single-host imports
/// stay flat.
fn build_host_folders(endpoints: &[Endpoint], hosts: &[String]) -> Vec<Folder> {
    let distinct: HashSet<&String> = hosts.iter().collect();
    if distinct.len() < 2 {
        return Vec::new();
    }

    let mut used_folder_ids = HashSet::new();
    let mut folders: Vec<Folder> = Vec::new();
    for (endpoint, host) in endpoints.iter().zip(hosts) {
        if let Some(folder) = folders.iter_mut().find(|f| &f.name == host) {
            folder.endpoints.push(endpoint.clone());
        } else {
            folders.push(Folder {
                id: unique_folder_id(host, &mut used_folder_ids),
                name: host.clone(),
                endpoints: vec![endpoint.clone()],
                auth_config: None,
            });
        }
    }
    folders
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn fixture() -> Value {
        json!({
            "log": {
                "version": "1.2",
                "entries": [
                    {
                        "_resourceType": "xhr",
                        "request": {
                            "method": "post",
                            "url": "https://api.example.com/v1/users",
                            "headers": [
                                { "name": ":authority", "value": "api.example.com" },
                                { "name": "Content-Length", "value": "42" },
                                { "name": "Authorization", "value": "Bearer abc" },
                                { "name": "Content-Type", "value": "application/json" }
                            ],
                            "queryString": [],
                            "postData": {
                                "mimeType": "application/json",
                                "text": "{\"name\":\"rex\"}"
                            }
                        },
                        "response": { "content": { "mimeType": "application/json" } }
                    },
                    {
                        "request": {
                            "method": "GET",
                            "url": "https://api.example.com/v1/users?page=2",
                            "headers": [],
                            "queryString": [ { "name": "page", "value": "2" } ],
                            "cookies": [ { "name": "session", "value": "s1" } ]
                        },
                        "response": { "content": { "mimeType": "application/json" } }
                    },
                    {
                        "request": {
                            "method": "GET",
                            "url": "https://api.example.com/v1/users?page=2",
                            "headers": [],
                            "queryString": [ { "name": "page", "value": "2" } ]
                        },
                        "response": { "content": { "mimeType": "application/json" } }
                    },
                    {
                        "request": {
                            "method": "GET",
                            "url": "https://cdn.example.com/logo.png",
                            "headers": []
                        },
                        "response": { "content": { "mimeType": "image/png" } }
                    },
                    {
                        "_resourceType": "stylesheet",
                        "request": {
                            "method": "GET",
                            "url": "https://cdn.example.com/style",
                            "headers": []
                        },
                        "response": {}
                    },
                    {
                        "request": {
                            "method": "GET",
                            "url": "not a url",
                            "headers": []
                        },
                        "response": {}
                    },
                    {
                        "request": {
                            "method": "POST",
                            "url": "https://auth.example.com/token",
                            "headers": [],
                            "postData": {
                                "mimeType": "application/x-www-form-urlencoded",
                                "params": [
                                    { "name": "grant_type", "value": "client_credentials" }
                                ]
                            }
                        },
                        "response": { "content": { "mimeType": "application/json" } }
                    }
                ]
            }
        })
    }

    fn import() -> HarImport {
        parse_har(fixture(), "session").expect("har parses")
    }

    #[test]
    fn assets_invalid_urls_and_dupes_are_filtered_and_counted() {
        let result = import();
        assert_eq!(result.collection.endpoints.len(), 3);
        assert_eq!(result.skipped_assets, 3);
        assert_eq!(result.deduped, 1);
        assert_eq!(result.collection.name, "session");
    }

    #[test]
    fn transport_and_pseudo_headers_are_stripped() {
        let result = import();
        let post = result
            .collection
            .endpoints
            .iter()
            .find(|e| e.method == "POST" && e.path.contains("/v1/users"))
            .unwrap();
        let headers = post
            .parameters
            .as_ref()
            .unwrap()
            .pointer("/header")
            .unwrap()
            .as_object()
            .unwrap();
        assert!(headers.contains_key("Authorization"));
        assert!(headers.contains_key("Content-Type"));
        assert!(!headers.contains_key(":authority"));
        assert!(!headers.contains_key("Content-Length"));

        assert_eq!(
            post.request_body.as_ref().unwrap()["example"],
            "{\"name\":\"rex\"}"
        );
    }

    #[test]
    fn cookies_without_a_header_are_synthesized() {
        let result = import();
        let get = result
            .collection
            .endpoints
            .iter()
            .find(|e| e.method == "GET")
            .unwrap();
        let params = get.parameters.as_ref().unwrap();
        assert_eq!(
            params.pointer("/header/Cookie/example").unwrap(),
            &json!("session=s1")
        );
        assert_eq!(params.pointer("/query/page/example").unwrap(), &json!("2"));
    }

    #[test]
    fn urlencoded_bodies_become_field_maps() {
        let result = import();
        let token = result
            .collection
            .endpoints
            .iter()
            .find(|e| e.path.contains("/token"))
            .unwrap();
        let body = token.request_body.as_ref().unwrap();
        assert_eq!(body["type"], "urlencoded");
        assert_eq!(body["fields"]["grant_type"], "client_credentials");
    }

    #[test]
    fn multiple_hosts_get_folders_single_host_stays_flat() {
        let result = import();
        let names: Vec<&str> = result
            .collection
            .folders
            .iter()
            .map(|f| f.name.as_str())
            .collect();
        assert_eq!(names, vec!["api.example.com", "auth.example.com"]);

        let single_host = json!({
            "log": { "entries": [
                {
                    "request": { "method": "GET", "url": "https://one.example.com/a", "headers": [] },
                    "response": {}
                }
            ]}
        });
        let flat = parse_har(single_host, "one").unwrap();
        assert!(flat.collection.folders.is_empty());
    }

    #[test]
    fn duplicate_names_get_numeric_suffixes() {
        let har = json!({
            "log": { "entries": [
                {
                    "request": { "method": "GET", "url": "https://a.example.com/x?p=1", "headers": [] },
                    "response": {}
                },
                {
                    "request": { "method": "GET", "url": "https://a.example.com/x?p=2", "headers": [] },
                    "response": {}
                }
            ]}
        });
        let result = parse_har(har, "dupes").unwrap();
        let names: Vec<&str> = result
            .collection
            .endpoints
            .iter()
            .map(|e| e.name.as_str())
            .collect();
        assert_eq!(names, vec!["GET /x", "GET /x (2)"]);
    }

    #[test]
    fn an_all_asset_har_errors_instead_of_writing_an_empty_collection() {
        let har = json!({
            "log": { "entries": [
                {
                    "request": { "method": "GET", "url": "https://cdn.example.com/a.css", "headers": [] },
                    "response": {}
                }
            ]}
        });
        let err = parse_har(har, "assets").unwrap_err();
        assert!(err.contains("1 asset entries skipped"));
    }

    #[test]
    fn a_non_har_document_errors() {
        assert!(parse_har(json!({ "foo": 1 }), "x").is_err());
    }
}
