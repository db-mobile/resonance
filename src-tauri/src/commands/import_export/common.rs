//! Helpers shared by the collection importers (Postman, Insomnia, HAR).

use super::Endpoint;
use serde_json::Value;
use std::collections::HashSet;

/// Result of parsing an importer's request body: either a regular request body
/// value, a GraphQL payload destined for the endpoint's `graphql_data`, or nothing.
pub(crate) enum ParsedBody {
    Empty,
    RequestBody(Value),
    GraphQL(Value),
}

/// Folder ids follow the frontend convention (`folder_<sanitized name>`,
/// see CollectionService.js). Distinct composite names can sanitize to the
/// same id ("A - B" vs "A / B"), so collisions get a numeric suffix.
pub(crate) fn unique_folder_id(name: &str, used: &mut HashSet<String>) -> String {
    let base = format!(
        "folder_{}",
        name.replace(|c: char| !c.is_alphanumeric(), "_")
    );
    let mut candidate = base.clone();
    let mut counter = 2;
    while !used.insert(candidate.clone()) {
        candidate = format!("{}_{}", base, counter);
        counter += 1;
    }
    candidate
}

/// Derive a base URL (scheme://host[:port]) from the first endpoint whose path
/// is an absolute URL.
///
/// @param endpoints the imported endpoints
/// @returns the derived base URL, when one can be found
pub(crate) fn derive_base_url(endpoints: &[Endpoint]) -> Option<String> {
    let first = endpoints.first()?;
    let path = &first.path;
    if !path.starts_with("http://") && !path.starts_with("https://") {
        return None;
    }
    let url = url::Url::parse(path).ok()?;
    let base = format!("{}://{}", url.scheme(), url.host_str().unwrap_or(""));
    match url.port() {
        Some(port) => Some(format!("{}:{}", base, port)),
        None => Some(base),
    }
}

/// Build the `{ example, description? }` object stored per parameter in the
/// endpoint's path/query/header maps.
///
/// @param value example value for the parameter
/// @param description optional human-readable description
/// @returns the parameter object as a JSON value
pub(crate) fn param_map_entry(value: &str, description: Option<&str>) -> Value {
    let mut obj = serde_json::Map::new();
    obj.insert("example".to_string(), Value::String(value.to_string()));
    if let Some(desc) = description {
        obj.insert("description".to_string(), Value::String(desc.to_string()));
    }
    Value::Object(obj)
}
