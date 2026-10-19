//! Turning a saved request into the execution core's `RequestTemplate`.
//!
//! This is a line-by-line port of the desktop's `captureRunnerEntry`
//! (`src/modules/services/CoreExecutionService.js`). It works over the same
//! IPC-shaped intermediates the JavaScript consumes, built here from a
//! `LoadedCollection` by [`capture_target`], so the shared fixtures in
//! `tests/fixtures/execution/template-capture.json` check the port one to one.
//! Secrets are blank in files and stay blank; `{{var}}` references in auth
//! config resolve from the variables the caller injects.

use std::fs;
use std::path::Path;

use resonance_core::model::{
    AuthKind, AuthOrigin, AuthSource, AuthTemplate, BodyTemplate, DataFile, ExecutionContext,
    ExecutionError, GraphqlTemplate, Parameter, RequestTemplate, RunInput, RunOptions,
};
use serde::Deserialize;
use serde_json::{Map, Value, json};

use crate::address::folder_chain;
use crate::ipc::{
    EndpointData, find_request, folder_id, request_to_endpoint, request_to_endpoint_data,
};
use crate::load::LoadError;
use crate::model::{RunnerDoc, RunnerOverrides};
use crate::read::{LoadedCollection, RequestEntry, folder_display_name};
use crate::runners::resolve_data_file;

/// The collection fields capture reads.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct CaptureCollection {
    pub id: String,
    pub base_url: String,
    pub default_headers: Value,
}

/// The desktop's `target` object: everything `captureRunnerEntry` reads about
/// a saved request. `None` fields mark a request or collection that no longer
/// exists.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct CaptureTarget {
    pub collection: Option<CaptureCollection>,
    /// The IPC endpoint object (`request_to_endpoint`).
    pub endpoint: Option<Value>,
    /// The per-request state (`request_to_endpoint_data`).
    pub persisted: EndpointData,
    /// Closest folder first, the collection last.
    pub inherited_auth: Vec<AuthSource>,
    /// `{preRequestScript, testScript}`.
    pub scripts: Option<Value>,
    pub mock_base_url: Option<String>,
}

/// The desktop's `entry` object: what a runner queue says about one visit.
#[derive(Debug, Clone, Copy)]
pub struct CaptureEntry<'a> {
    pub name: &'a str,
    pub overrides: Option<&'a RunnerOverrides>,
    pub post_response_script: Option<&'a str>,
    /// Saved runners historically fall back to the `bearerToken` variable when
    /// bearer auth has no token; editor sends do not.
    pub bearer_fallback: bool,
}

fn truthy(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::Bool(b) => *b,
        Value::Number(n) => n.as_f64().is_some_and(|f| f != 0.0),
        Value::String(s) => !s.is_empty(),
        _ => true,
    }
}

/// JavaScript's `String(value)` for the values the fixtures carry.
fn js_string(value: &Value) -> String {
    match value {
        Value::String(s) => s.clone(),
        Value::Null => "null".into(),
        Value::Bool(b) => b.to_string(),
        Value::Number(n) => n.to_string(),
        other => serde_json::to_string(other).unwrap_or_default(),
    }
}

fn string_or(value: Option<&Value>, default: &str) -> String {
    value
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| default.to_string())
}

/// Port of `normalizeFormRows` (`src/modules/utils/formDataRows.js`).
fn normalize_form_rows(fields: Option<&Value>) -> Vec<Value> {
    match fields {
        Some(Value::Array(rows)) => rows
            .iter()
            .map(|row| {
                json!({
                    "key": string_or(row.get("key"), ""),
                    "value": string_or(row.get("value"), ""),
                    "type": if row.get("type").and_then(Value::as_str) == Some("file") { "file" } else { "text" },
                    "filePath": string_or(row.get("filePath"), ""),
                    "contentType": string_or(row.get("contentType"), ""),
                    "enabled": row.get("enabled") != Some(&Value::Bool(false)),
                })
            })
            .collect(),
        Some(Value::Object(fields)) => fields
            .iter()
            .map(|(key, value)| {
                json!({
                    "key": key,
                    "value": js_string(value),
                    "type": "text",
                    "filePath": "",
                    "contentType": "",
                    "enabled": true,
                })
            })
            .collect(),
        _ => Vec::new(),
    }
}

fn row_enabled(row: &Value) -> bool {
    row.get("enabled") != Some(&Value::Bool(false))
}

fn row_key(row: &Value) -> Option<&Value> {
    row.get("key").filter(|key| truthy(key))
}

fn parameter(row: &Value) -> Parameter {
    Parameter {
        key: row.get("key").map(js_string).unwrap_or_default(),
        value: row.get("value").map(js_string).unwrap_or_default(),
        enabled: row.get("enabled").and_then(Value::as_bool),
    }
}

fn auth_template(value: &Value) -> AuthTemplate {
    serde_json::from_value(value.clone()).unwrap_or_default()
}

fn inherit_auth() -> AuthTemplate {
    AuthTemplate {
        kind: AuthKind::Inherit,
        config: Map::new(),
    }
}

/// A template that fails at visit time because its saved target is gone.
pub fn missing_request_template(name: &str, code: &str) -> RequestTemplate {
    RequestTemplate {
        name: name.to_string(),
        capture_error: Some(ExecutionError::new(code, Value::Null)),
        ..Default::default()
    }
}

/// Port of `captureRunnerEntry`.
///
/// @param entry - The queue entry
/// @param target - What the desktop knows about the saved request
/// @returns The template the execution core runs
pub fn capture_runner_entry(entry: &CaptureEntry<'_>, target: &CaptureTarget) -> RequestTemplate {
    let (Some(collection), Some(endpoint)) = (&target.collection, &target.endpoint) else {
        let code = if target.collection.is_none() {
            "missingCollection"
        } else {
            "missingRequest"
        };
        return missing_request_template(entry.name, code);
    };
    let persisted = &target.persisted;
    let empty_overrides = RunnerOverrides::default();
    let overrides = entry.overrides.unwrap_or(&empty_overrides);
    let parameters = endpoint.get("parameters");
    let path_examples = parameters
        .and_then(|p| p.get("path"))
        .and_then(Value::as_object);
    let query_examples = parameters
        .and_then(|p| p.get("query"))
        .and_then(Value::as_object);

    let path_rows: &[Value] = match &overrides.path_params {
        Some(rows) if !rows.is_empty() => rows,
        _ => &persisted.path_params,
    };
    let mut path_params = Map::new();
    for row in path_rows {
        if let (Some(key), Some(value)) = (row_key(row), row.get("value").filter(|v| truthy(v))) {
            path_params.insert(js_string(key), value.clone());
        }
    }
    if path_rows.is_empty()
        && let Some(examples) = path_examples
    {
        for (key, param) in examples {
            if let Some(example) = param.get("example").filter(|e| truthy(e)) {
                path_params.insert(key.clone(), Value::String(js_string(example)));
            }
        }
    }

    let mut headers = endpoint
        .get("headers")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    let header_rows: &[Value] = match &overrides.headers {
        Some(rows) => rows,
        None => &persisted.headers,
    };
    for row in header_rows {
        if row_enabled(row)
            && let Some(key) = row_key(row)
        {
            let value = row.get("value").filter(|v| !v.is_null()).cloned();
            headers.insert(
                js_string(key),
                value.unwrap_or_else(|| Value::String(String::new())),
            );
        }
    }

    let query_source: &[Value] = match &overrides.query_params {
        Some(rows) => rows,
        None => &persisted.query_params,
    };
    let mut query_rows: Vec<Parameter> = query_source
        .iter()
        .filter(|row| row_enabled(row) && row_key(row).is_some())
        .map(parameter)
        .collect();
    if query_rows.is_empty()
        && let Some(examples) = query_examples
    {
        query_rows = examples
            .iter()
            .filter_map(|(key, param)| {
                param
                    .get("example")
                    .filter(|e| truthy(e))
                    .map(|example| Parameter {
                        key: key.clone(),
                        value: js_string(example),
                        enabled: None,
                    })
            })
            .collect();
    }

    let empty_form = json!({});
    let form = persisted.form_body_data.as_ref().unwrap_or(&empty_form);
    let form_mode = form.get("mode").and_then(Value::as_str).unwrap_or("");
    let has_override = overrides.body.is_some();
    let nonempty_override = overrides
        .body
        .as_deref()
        .is_some_and(|b| !b.trim().is_empty());
    let mut content: Value = if nonempty_override {
        Value::String(overrides.body.clone().unwrap_or_default())
    } else if has_override {
        Value::String(String::new())
    } else if form_mode == "text" {
        Value::String(string_or(form.get("content"), ""))
    } else {
        persisted
            .modified_body
            .clone()
            .map(Value::String)
            .unwrap_or(Value::Null)
    };
    if !truthy(&content)
        && !has_override
        && let Some(request_body) = endpoint.get("requestBody").filter(|b| truthy(b))
    {
        let example = request_body.get("example").filter(|e| truthy(e));
        content = match example {
            Some(example) if example != "null" => example.clone(),
            _ => match request_body.get("schema").filter(|s| truthy(s)) {
                Some(schema) => schema
                    .get("example")
                    .filter(|e| truthy(e))
                    .cloned()
                    .unwrap_or_else(|| json!({})),
                None => Value::String(String::new()),
            },
        };
    }
    let content = match content {
        Value::String(s) => s,
        other if truthy(&other) => serde_json::to_string(&other).unwrap_or_default(),
        _ => String::new(),
    };
    let special = !nonempty_override && matches!(form_mode, "formdata" | "urlencoded" | "binary");
    let mode = if special || form_mode == "text" {
        form_mode.to_string()
    } else {
        "json".to_string()
    };

    let protocol = string_or(endpoint.get("protocol"), "");
    let graphql = if !nonempty_override && protocol == "graphql" {
        persisted
            .graphql_data
            .as_ref()
            .and_then(|data| serde_json::from_value::<GraphqlTemplate>(data.clone()).ok())
    } else {
        None
    };

    let auth = persisted
        .auth_config
        .as_ref()
        .filter(|a| truthy(a))
        .or_else(|| endpoint.get("security").filter(|s| truthy(s)))
        .map(auth_template)
        .unwrap_or_else(inherit_auth);

    let scripts = target.scripts.as_ref();
    RequestTemplate {
        collection_id: Some(collection.id.clone()),
        endpoint_id: Some(string_or(endpoint.get("id"), "")),
        name: entry.name.to_string(),
        path: string_or(endpoint.get("path"), ""),
        method: endpoint
            .get("method")
            .filter(|m| truthy(m))
            .map(js_string)
            .unwrap_or_else(|| "GET".into()),
        protocol: if protocol.is_empty() {
            "http".into()
        } else {
            protocol
        },
        url: persisted.url.clone().unwrap_or_default(),
        base_url: collection.base_url.clone(),
        default_headers: collection
            .default_headers
            .as_object()
            .cloned()
            .unwrap_or_default(),
        path_params,
        path_parameter_names: path_examples
            .map(|examples| examples.keys().cloned().collect())
            .unwrap_or_default(),
        headers,
        query_rows,
        bearer_fallback: entry.bearer_fallback,
        auth,
        inherited_auth: target.inherited_auth.clone(),
        body: BodyTemplate {
            mode,
            content,
            fields: normalize_form_rows(form.get("fields")),
            file_path: string_or(form.get("filePath"), ""),
            content_type: form
                .get("contentType")
                .and_then(Value::as_str)
                .filter(|c| !c.is_empty())
                .map(str::to_string),
            graphql,
            capture_error: None,
        },
        pre_request_script: string_or(scripts.and_then(|s| s.get("preRequestScript")), ""),
        test_script: string_or(scripts.and_then(|s| s.get("testScript")), ""),
        post_response_script: entry.post_response_script.unwrap_or("").to_string(),
        mock_base_url: target.mock_base_url.clone(),
        capture_error: None,
    }
}

/// Builds the `target` for a request from a loaded collection, the way the
/// desktop repositories would: IPC endpoint and per-request state, scripts
/// from the request file, inherited auth closest folder first, no mock server.
pub fn capture_target(loaded: &LoadedCollection, entry: &RequestEntry) -> CaptureTarget {
    let chain = folder_chain(loaded, &entry.doc.id);
    let folder_path: Vec<String> = chain.iter().map(|f| folder_display_name(f)).collect();
    let owner = chain.last().map(|f| folder_id(f));
    let persisted = request_to_endpoint_data(&entry.doc);
    let mut inherited_auth: Vec<AuthSource> = chain
        .iter()
        .rev()
        .map(|folder| AuthSource {
            source: AuthOrigin::Folder {
                folder_id: folder_id(folder),
            },
            auth_config: folder
                .meta
                .as_ref()
                .and_then(|m| m.auth.as_ref())
                .map(auth_template)
                .unwrap_or_else(inherit_auth),
        })
        .collect();
    inherited_auth.push(AuthSource {
        source: AuthOrigin::Collection,
        auth_config: loaded
            .meta
            .auth
            .as_ref()
            .map(auth_template)
            .unwrap_or_default(),
    });
    CaptureTarget {
        collection: Some(CaptureCollection {
            id: loaded.meta.id.clone(),
            base_url: loaded.meta.base_url.clone(),
            default_headers: loaded
                .meta
                .default_headers
                .clone()
                .unwrap_or_else(|| json!({})),
        }),
        endpoint: Some(request_to_endpoint(
            &entry.doc,
            owner.as_deref(),
            &folder_path,
        )),
        scripts: persisted.scripts.clone(),
        persisted,
        inherited_auth,
        mock_base_url: None,
    }
}

/// The template for one saved request.
///
/// @param loaded - The collection
/// @param entry - The request
/// @param overrides - A runner entry's edits, if any
/// @param post_response_script - A runner entry's script, if any
/// @param bearer_fallback - Whether the legacy bearerToken fallback applies
/// @returns The template the execution core runs
pub fn request_template(
    loaded: &LoadedCollection,
    entry: &RequestEntry,
    overrides: Option<&RunnerOverrides>,
    post_response_script: Option<&str>,
    bearer_fallback: bool,
) -> RequestTemplate {
    let target = capture_target(loaded, entry);
    capture_runner_entry(
        &CaptureEntry {
            name: &entry.doc.name,
            overrides,
            post_response_script,
            bearer_fallback,
        },
        &target,
    )
}

fn read_data_file(
    loaded: &LoadedCollection,
    path: &str,
    name: &str,
) -> Result<DataFile, LoadError> {
    let error = |reason: String| LoadError::DataFile {
        path: path.to_string(),
        reason,
    };
    let dir = loaded
        .root
        .source
        .as_deref()
        .ok_or_else(|| error("the collection has no directory".into()))?;
    let resolved = resolve_data_file(dir, path).map_err(error)?;
    let content = fs::read_to_string(&resolved).map_err(|e| error(e.to_string()))?;
    let name = if name.is_empty() {
        Path::new(path)
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default()
    } else {
        name.to_string()
    };
    Ok(DataFile { name, content })
}

/// The run input for a saved runner file, the way the desktop builds it:
/// every queue entry becomes a template (a missing request fails at visit
/// time rather than aborting the run) and the data file is read relative to
/// the collection directory.
pub fn run_input(
    loaded: &LoadedCollection,
    runner: &RunnerDoc,
    context: ExecutionContext,
    execution_id: String,
) -> Result<RunInput, LoadError> {
    let requests = runner
        .requests
        .iter()
        .map(|request| {
            let entry = loaded
                .requests()
                .into_iter()
                .find(|entry| entry.doc.id == request.request_id);
            match entry {
                Some(entry) => {
                    let mut template = request_template(
                        loaded,
                        entry,
                        Some(&request.overrides),
                        request.post_response_script.as_deref(),
                        true,
                    );
                    if !request.name.is_empty() {
                        template.name = request.name.clone();
                    }
                    template
                }
                None => missing_request_template(&request.name, "missingRequest"),
            }
        })
        .collect();
    let data_file = match &runner.options.data_file {
        Some(file) => Some(read_data_file(loaded, &file.path, &file.name)?),
        None => None,
    };
    Ok(RunInput {
        execution_id,
        runner_id: Some(runner.id.clone()),
        runner_name: runner.name.clone(),
        requests,
        context,
        options: RunOptions {
            iterations: runner.options.iterations.map(Value::from),
            delay_ms: Some(runner.options.delay_ms),
            stop_on_error: runner.options.stop_on_error,
            max_executions_per_iteration: runner
                .options
                .max_executions_per_iteration
                .map(Value::from),
            strict_variables: false,
        },
        data_file,
    })
}

/// The run input for an explicit list of requests, as an editor send would
/// prepare each of them: no overrides, no bearer fallback, no data file.
pub fn plain_run_input(
    loaded: &LoadedCollection,
    entries: &[&RequestEntry],
    options: RunOptions,
    context: ExecutionContext,
    execution_id: String,
) -> RunInput {
    RunInput {
        execution_id,
        runner_id: None,
        runner_name: loaded.meta.name.clone(),
        requests: entries
            .iter()
            .map(|entry| request_template(loaded, entry, None, None, false))
            .collect(),
        context,
        options,
        data_file: None,
    }
}

/// Finds a runner by file stem, name or id.
pub fn find_runner<'a>(
    loaded: &'a LoadedCollection,
    selector: &str,
) -> Result<&'a RunnerDoc, LoadError> {
    let stem = |entry: &crate::runners::RunnerEntry| {
        entry
            .source
            .as_deref()
            .and_then(Path::file_stem)
            .map(|s| s.to_string_lossy().to_string())
    };
    let wanted = selector
        .trim()
        .trim_end_matches(".yaml")
        .trim_end_matches(".yml");
    loaded
        .runners
        .iter()
        .find(|entry| stem(entry).as_deref() == Some(wanted))
        .or_else(|| loaded.runners.iter().find(|entry| entry.doc.id == wanted))
        .or_else(|| loaded.runners.iter().find(|entry| entry.doc.name == wanted))
        .or_else(|| {
            loaded
                .runners
                .iter()
                .find(|entry| entry.doc.name.eq_ignore_ascii_case(wanted))
        })
        .map(|entry| &entry.doc)
        .ok_or_else(|| LoadError::RunnerNotFound(selector.to_string()))
}

#[allow(dead_code)]
fn _assert_find_request_reused(loaded: &LoadedCollection) {
    let _ = find_request(loaded, "");
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::load::load_collection;
    use crate::model::{RunnerDataFile, RunnerOptions, RunnerRequest};
    use crate::runners::RunnerEntry;
    use std::fs;
    use tempfile::TempDir;

    fn write(dir: &Path, name: &str, contents: &str) {
        let path = dir.join(name);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, contents).unwrap();
    }

    fn collection() -> TempDir {
        let temp = TempDir::new().unwrap();
        write(
            temp.path(),
            "collection.yaml",
            "resonanceFormat: 2\nid: c1\nname: Petstore\nbaseUrl: https://api.test\ndefaultHeaders:\n  Accept: application/json\nauth:\n  type: basic\n  config:\n    username: admin\n    password: ''\n",
        );
        write(
            temp.path(),
            "health.yaml",
            "resonanceFormat: 2\nid: r_health\nname: Health\nmethod: GET\npath: /health\n",
        );
        write(
            temp.path(),
            "pets/_folder.yaml",
            "resonanceFormat: 2\nid: folder_pets\nname: Pets\nauth:\n  type: bearer\n  config:\n    token: '{{token}}'\n",
        );
        write(
            temp.path(),
            "pets/admin/purge.yaml",
            "resonanceFormat: 2\nid: r_purge\nname: Purge\nmethod: DELETE\npath: /pets\nparams:\n  headers:\n  - key: X-Admin\n    value: 'yes'\nbody:\n  mode: json\n  content: '{\"all\": true}'\nscripts:\n  preRequest: console.log('pre')\n  test: pm.test('ok', function () {})\n",
        );
        temp
    }

    #[test]
    fn capture_target_inherited_auth_is_closest_folder_first_then_collection() {
        let temp = collection();
        let loaded = load_collection(temp.path()).unwrap();
        let entry = crate::address::find_request(&loaded, "r_purge").unwrap();

        let target = capture_target(&loaded, entry);

        let sources: Vec<_> = target
            .inherited_auth
            .iter()
            .map(|a| serde_json::to_value(&a.source).unwrap())
            .collect();
        assert_eq!(
            sources,
            vec![
                json!({"kind": "folder", "folderId": "folder_admin"}),
                json!({"kind": "folder", "folderId": "folder_pets"}),
                json!({"kind": "collection"})
            ]
        );
        assert_eq!(target.inherited_auth[0].auth_config.kind, AuthKind::Inherit);
        assert_eq!(target.inherited_auth[1].auth_config.kind, AuthKind::Bearer);
        assert_eq!(
            target.inherited_auth[1].auth_config.config["token"],
            "{{token}}"
        );
        assert_eq!(target.inherited_auth[2].auth_config.kind, AuthKind::Basic);
        assert_eq!(target.inherited_auth[2].auth_config.config["password"], "");
        assert_eq!(
            target.endpoint.as_ref().unwrap()["folderId"],
            "folder_admin"
        );
        assert_eq!(
            target.scripts.as_ref().unwrap()["preRequestScript"],
            "console.log('pre')"
        );
        assert!(target.mock_base_url.is_none());
    }

    #[test]
    fn capture_target_defaults_collection_auth_to_none() {
        let temp = TempDir::new().unwrap();
        write(
            temp.path(),
            "collection.yaml",
            "resonanceFormat: 2\nid: c1\nname: P\n",
        );
        write(
            temp.path(),
            "ping.yaml",
            "resonanceFormat: 2\nid: r1\nname: Ping\nmethod: GET\npath: /ping\n",
        );
        let loaded = load_collection(temp.path()).unwrap();
        let entry = crate::address::find_request(&loaded, "r1").unwrap();

        let target = capture_target(&loaded, entry);

        assert_eq!(target.inherited_auth.len(), 1);
        assert_eq!(target.inherited_auth[0].auth_config.kind, AuthKind::None);
        assert_eq!(
            target.collection.as_ref().unwrap().default_headers,
            json!({})
        );
    }

    #[test]
    fn request_template_for_plain_request_has_no_bearer_fallback_and_no_mock_url() {
        let temp = collection();
        let loaded = load_collection(temp.path()).unwrap();
        let entry = crate::address::find_request(&loaded, "r_purge").unwrap();

        let template = request_template(&loaded, entry, None, None, false);

        assert_eq!(template.collection_id.as_deref(), Some("c1"));
        assert_eq!(template.endpoint_id.as_deref(), Some("r_purge"));
        assert_eq!(template.method, "DELETE");
        assert_eq!(template.path, "/pets");
        assert_eq!(template.base_url, "https://api.test");
        assert_eq!(template.default_headers["Accept"], "application/json");
        assert_eq!(template.headers["X-Admin"], "yes");
        assert_eq!(template.body.mode, "json");
        assert_eq!(template.body.content, "{\"all\": true}");
        assert_eq!(template.pre_request_script, "console.log('pre')");
        assert!(template.test_script.starts_with("pm.test"));
        assert_eq!(template.auth.kind, AuthKind::Inherit);
        assert!(!template.bearer_fallback);
        assert!(template.mock_base_url.is_none());
        assert!(template.capture_error.is_none());
    }

    fn runner(requests: Vec<RunnerRequest>, options: RunnerOptions) -> RunnerDoc {
        let mut doc = RunnerDoc::new("runner_1".into(), "Smoke".into());
        doc.requests = requests;
        doc.options = options;
        doc
    }

    fn request(id: &str, name: &str) -> RunnerRequest {
        RunnerRequest {
            collection_id: None,
            request_id: id.into(),
            name: name.into(),
            method: None,
            path: None,
            overrides: RunnerOverrides::default(),
            post_response_script: None,
            extra: Map::new(),
        }
    }

    #[test]
    fn run_input_marks_missing_requests_with_capture_error_and_keeps_order() {
        let temp = collection();
        let loaded = load_collection(temp.path()).unwrap();
        let mut second = request("r_health", "Health again");
        second.post_response_script = Some("next()".into());
        second.overrides.headers = Some(vec![json!({"key": "X-Run", "value": "1"})]);
        let doc = runner(
            vec![request("r_health", ""), request("r_gone", "Gone"), second],
            RunnerOptions::default(),
        );

        let input = run_input(&loaded, &doc, ExecutionContext::default(), "x".into()).unwrap();

        assert_eq!(input.runner_id.as_deref(), Some("runner_1"));
        assert_eq!(input.runner_name, "Smoke");
        let names: Vec<_> = input.requests.iter().map(|r| r.name.clone()).collect();
        assert_eq!(names, vec!["Health", "Gone", "Health again"]);
        assert!(input.requests[0].bearer_fallback);
        assert_eq!(
            input.requests[1].capture_error.as_ref().unwrap().code,
            "missingRequest"
        );
        assert_eq!(input.requests[2].headers["X-Run"], "1");
        assert_eq!(input.requests[2].post_response_script, "next()");
        assert!(input.options.stop_on_error);
        assert_eq!(input.options.delay_ms, Some(0));
        assert!(input.data_file.is_none());
    }

    #[test]
    fn run_input_reads_relative_data_file_from_collection_dir() {
        let temp = collection();
        write(temp.path(), "data/users.csv", "\u{feff}id\n1\n2\n");
        let loaded = load_collection(temp.path()).unwrap();
        let doc = runner(
            vec![request("r_health", "")],
            RunnerOptions {
                stop_on_error: false,
                delay_ms: 250,
                iterations: Some(3),
                max_executions_per_iteration: Some(100),
                data_file: Some(RunnerDataFile {
                    path: "data/users.csv".into(),
                    name: String::new(),
                }),
                extra: Map::new(),
            },
        );

        let input = run_input(&loaded, &doc, ExecutionContext::default(), "x".into()).unwrap();

        let data_file = input.data_file.unwrap();
        assert_eq!(data_file.name, "users.csv");
        assert_eq!(data_file.content, "\u{feff}id\n1\n2\n");
        assert!(!input.options.stop_on_error);
        assert_eq!(input.options.delay_ms, Some(250));
        assert_eq!(input.options.iterations, Some(json!(3)));
        assert_eq!(input.options.max_executions_per_iteration, Some(json!(100)));
    }

    #[test]
    fn run_input_rejects_data_file_outside_collection() {
        let temp = collection();
        write(&temp.path().join(".."), "escape.csv", "id\n");
        let loaded = load_collection(temp.path()).unwrap();
        let doc = runner(
            vec![request("r_health", "")],
            RunnerOptions {
                data_file: Some(RunnerDataFile {
                    path: "../escape.csv".into(),
                    name: "escape.csv".into(),
                }),
                ..RunnerOptions::default()
            },
        );

        let error = run_input(&loaded, &doc, ExecutionContext::default(), "x".into()).unwrap_err();
        assert!(matches!(error, LoadError::DataFile { .. }));
        assert!(
            error.to_string().contains("inside the collection"),
            "{error}"
        );
    }

    #[test]
    fn plain_run_input_uses_the_collection_name_and_no_overrides() {
        let temp = collection();
        let loaded = load_collection(temp.path()).unwrap();
        let entries: Vec<&RequestEntry> = loaded.requests();

        let input = plain_run_input(
            &loaded,
            &entries,
            RunOptions::default(),
            ExecutionContext::default(),
            "x".into(),
        );

        assert!(input.runner_id.is_none());
        assert_eq!(input.runner_name, "Petstore");
        assert_eq!(input.requests.len(), 2);
        assert!(input.requests.iter().all(|r| !r.bearer_fallback));
        assert!(input.data_file.is_none());
    }

    #[test]
    fn find_runner_by_stem_id_and_name() {
        let temp = collection();
        write(
            temp.path(),
            "runners/nightly-smoke.yaml",
            "resonanceFormat: 2\nid: runner_a\nname: Nightly Smoke\nrequests:\n- requestId: r_health\n",
        );
        let loaded = load_collection(temp.path()).unwrap();
        assert_eq!(loaded.runners.len(), 1);
        assert!(
            loaded
                .runners
                .iter()
                .all(|e: &RunnerEntry| e.source.is_some())
        );
        for selector in [
            "nightly-smoke",
            "nightly-smoke.yaml",
            "runner_a",
            "Nightly Smoke",
            "nightly smoke",
        ] {
            assert_eq!(
                find_runner(&loaded, selector).unwrap().id,
                "runner_a",
                "{selector}"
            );
        }
        assert!(matches!(
            find_runner(&loaded, "other").unwrap_err(),
            LoadError::RunnerNotFound(_)
        ));
    }

    #[test]
    fn normalize_form_rows_matches_the_desktop_helper() {
        let rows = normalize_form_rows(Some(&json!([
            {"key": "a", "value": "1", "type": "file", "filePath": "/x", "enabled": false},
            {"key": 5, "value": null}
        ])));
        assert_eq!(
            rows[0],
            json!({"key": "a", "value": "1", "type": "file", "filePath": "/x", "contentType": "", "enabled": false})
        );
        assert_eq!(
            rows[1],
            json!({"key": "", "value": "", "type": "text", "filePath": "", "contentType": "", "enabled": true})
        );
        let from_object = normalize_form_rows(Some(&json!({"a": 1, "b": true})));
        assert_eq!(from_object[0]["value"], "1");
        assert_eq!(from_object[1]["value"], "true");
        assert!(normalize_form_rows(Some(&json!("nope"))).is_empty());
        assert!(normalize_form_rows(None).is_empty());
    }
}
