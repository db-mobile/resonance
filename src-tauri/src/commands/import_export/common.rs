//! Helpers shared by the collection importers (Postman, Insomnia, HAR).

use super::{Endpoint, Folder};
use resonance_collections::model::ExampleDoc;
use serde_json::{Map, Value};
use std::collections::HashSet;

/// Response headers never kept on an imported example: transport details and
/// session cookies.
pub(crate) const EXAMPLE_SKIPPED_HEADERS: [&str; 6] = [
    "content-length",
    "transfer-encoding",
    "connection",
    "keep-alive",
    "date",
    "set-cookie",
];

/// Builds the `{key, value}` header rows of an example, lowercased and
/// without the transport headers.
pub(crate) fn example_headers<'a>(pairs: impl Iterator<Item = (&'a str, &'a str)>) -> Vec<Value> {
    pairs
        .map(|(key, value)| (key.trim().to_ascii_lowercase(), value))
        .filter(|(key, _)| !key.is_empty() && !EXAMPLE_SKIPPED_HEADERS.contains(&key.as_str()))
        .map(|(key, value)| serde_json::json!({ "key": key, "value": value }))
        .collect()
}

/// The value of one header row, by case-insensitive name.
pub(crate) fn example_header_value(headers: &[Value], name: &str) -> Option<String> {
    headers.iter().find_map(|row| {
        let key = row.get("key")?.as_str()?;
        key.eq_ignore_ascii_case(name)
            .then(|| {
                row.get("value")
                    .and_then(|v| v.as_str())
                    .map(str::to_string)
            })
            .flatten()
    })
}

/// True when the example body fits the size the request file accepts.
pub(crate) fn example_within_limit(example: &ExampleDoc) -> bool {
    example
        .body
        .as_ref()
        .is_none_or(|body| body.len() <= crate::commands::collections::MAX_EXAMPLE_BODY_BYTES)
}

/// Assembles an imported example; `None` when the status is not an HTTP one.
pub(crate) fn imported_example(
    status: Option<u64>,
    status_text: Option<&str>,
    name: Option<&str>,
    headers: Vec<Value>,
    content_type: Option<String>,
    body: Option<&str>,
    base64: bool,
) -> Option<ExampleDoc> {
    let status = status.and_then(|code| u16::try_from(code).ok())?;
    if !(100..=599).contains(&status) {
        return None;
    }
    let status_text = status_text
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(str::to_string);
    let name = name
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| {
            format!("{} {}", status, status_text.as_deref().unwrap_or(""))
                .trim()
                .to_string()
        });
    let body = body.filter(|body| !body.is_empty()).map(str::to_string);
    let example = ExampleDoc {
        id: uuid::Uuid::new_v4().to_string(),
        name,
        status,
        status_text,
        headers,
        content_type,
        body_encoding: (base64 && body.is_some()).then(|| "base64".to_string()),
        body,
        saved_at: None,
        extra: Map::new(),
    };
    example_within_limit(&example).then_some(example)
}

/// Accumulates imported endpoints. Each one goes into the flat list and, when
/// it sits under a folder chain, into that chain's composite-named folder
/// ("Parent / Child") as well — the storage model expects the duplication.
#[derive(Default)]
pub(crate) struct CollectionBuilder {
    endpoints: Vec<Endpoint>,
    folders: Vec<Folder>,
    used_folder_ids: HashSet<String>,
}

impl CollectionBuilder {
    /// `folder_auth` is recorded only when this call creates the folder.
    pub(crate) fn place(
        &mut self,
        endpoint: Endpoint,
        name_chain: &[String],
        folder_auth: Option<&Value>,
    ) {
        if name_chain.is_empty() {
            self.endpoints.push(endpoint);
            return;
        }
        let composite_name = name_chain.join(" / ");
        self.endpoints.push(endpoint.clone());
        if let Some(folder) = self.folders.iter_mut().find(|f| f.name == composite_name) {
            folder.endpoints.push(endpoint);
        } else {
            self.folders.push(Folder {
                id: unique_folder_id(&composite_name, &mut self.used_folder_ids),
                name: composite_name,
                endpoints: vec![endpoint],
                auth_config: folder_auth.cloned(),
            });
        }
    }

    /// The flat endpoint list and the folders, sorted by name.
    pub(crate) fn finish(mut self) -> (Vec<Endpoint>, Vec<Folder>) {
        self.folders.sort_by(|a, b| a.name.cmp(&b.name));
        (self.endpoints, self.folders)
    }
}

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

/// The endpoint's `{ path?, query?, header? }` parameter groups, keeping only
/// the non-empty ones; `None` when there are no parameters at all.
pub(crate) fn grouped_params(
    path: serde_json::Map<String, Value>,
    query: serde_json::Map<String, Value>,
    header: serde_json::Map<String, Value>,
) -> Option<Value> {
    let groups: serde_json::Map<String, Value> =
        [("path", path), ("query", query), ("header", header)]
            .into_iter()
            .filter(|(_, params)| !params.is_empty())
            .map(|(location, params)| (location.to_string(), Value::Object(params)))
            .collect();
    (!groups.is_empty()).then_some(Value::Object(groups))
}
