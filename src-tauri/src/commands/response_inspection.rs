//! Offline JSONPath (RFC 9535) / XPath 1.0 over complete response snapshots.
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

#[path = "response_inspection_budget.rs"]
mod budget;
#[path = "response_inspection_xml.rs"]
mod xml;

const MAX_SOURCE_BYTES: usize = 5 * 1024 * 1024;
const MAX_EXPRESSION_CHARS: usize = 4096;
const MAX_MATCHES: usize = 1000;
const MAX_OUTPUT_BYTES: usize = 1024 * 1024;

type Namespaces = BTreeMap<String, String>;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct InspectionRequest {
    format: String,
    body: String,
    expression: String,
    #[serde(default)]
    namespaces: Namespaces,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InspectionResult {
    text: String,
    language: &'static str,
    kind: &'static str,
    total_count: usize,
    displayed_count: usize,
    truncated: bool,
    namespaces: Namespaces,
}

#[derive(Debug, Serialize)]
pub struct InspectionError {
    code: &'static str,
    message: String,
}

impl InspectionError {
    fn new(code: &'static str, message: impl ToString) -> Self {
        Self {
            code,
            message: message.to_string(),
        }
    }
    fn limit() -> Self {
        Self::new(
            "limit",
            "Query exceeds inspection limits. Refine the query or reduce the response.",
        )
    }
}

fn inspect(request: InspectionRequest) -> Result<InspectionResult, InspectionError> {
    if request.body.len() > MAX_SOURCE_BYTES
        || request.expression.chars().count() > MAX_EXPRESSION_CHARS
    {
        return Err(InspectionError::limit());
    }
    if request.expression.trim().is_empty() {
        return Err(InspectionError::new("query", "Enter an expression"));
    }
    budget::unquoted(&request.expression, request.format == "json")?;
    match request.format.as_str() {
        "json" => inspect_json(&request),
        "xml" => xml::inspect_xml(&request),
        _ => Err(InspectionError::new(
            "parse",
            "Only JSON and XML responses can be inspected",
        )),
    }
}

fn inspect_json(request: &InspectionRequest) -> Result<InspectionResult, InspectionError> {
    let body: Value = serde_json::from_str(&request.body)
        .map_err(|error| InspectionError::new("parse", error))?;
    let path = serde_json_path::JsonPath::parse(&request.expression)
        .map_err(|error| InspectionError::new("query", error))?;
    let mut nodes = 0;
    let mut max_depth = 0;
    let mut pending = vec![(&body, 1)];
    while let Some((node, depth)) = pending.pop() {
        nodes += 1;
        max_depth = max_depth.max(depth);
        match node {
            Value::Array(values) => pending.extend(values.iter().map(|v| (v, depth + 1))),
            Value::Object(values) => pending.extend(values.values().map(|v| (v, depth + 1))),
            _ => {}
        }
    }
    budget::check(&path.to_string(), nodes, max_depth, true)?;
    let matches = path.query(&body).all();
    let total_count = matches.len();
    let mut pieces = Vec::new();
    let mut bytes = 4; // array brackets and newlines
    for value in matches.into_iter().take(MAX_MATCHES) {
        let pretty = serde_json::to_string_pretty(value)
            .map_err(|error| InspectionError::new("parse", error))?;
        let piece = pretty
            .lines()
            .map(|line| format!("  {line}"))
            .collect::<Vec<_>>()
            .join("\n");
        if piece.len() + 4 > MAX_OUTPUT_BYTES {
            return Err(InspectionError::limit());
        }
        let additional = piece.len() + if pieces.is_empty() { 0 } else { 2 };
        if bytes + additional > MAX_OUTPUT_BYTES {
            break;
        }
        bytes += additional;
        pieces.push(piece);
    }
    let displayed_count = pieces.len();
    Ok(InspectionResult {
        text: if pieces.is_empty() {
            "[]".into()
        } else {
            format!("[\n{}\n]", pieces.join(",\n"))
        },
        language: "json",
        kind: "nodes",
        total_count,
        displayed_count,
        truncated: displayed_count < total_count,
        namespaces: Namespaces::new(),
    })
}

#[tauri::command]
pub async fn response_inspect(
    request: InspectionRequest,
) -> Result<InspectionResult, InspectionError> {
    tauri::async_runtime::spawn_blocking(move || inspect(request))
        .await
        .map_err(|error| InspectionError::new("query", error))?
}

#[cfg(test)]
#[path = "response_inspection_tests.rs"]
mod tests;
