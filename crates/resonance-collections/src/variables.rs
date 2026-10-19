//! Variable sources a headless run can read from files: the collection's
//! `variables.yaml` and an environment export from the desktop app.

use resonance_core::model::Variables;
use serde::Deserialize;
use serde_json::{Map, Value};

use crate::load::LoadError;
use crate::read::LoadedCollection;

/// The committed collection variables, as the desktop reads them: every row
/// with a non-empty key, later duplicates winning, secret rows blank.
pub fn collection_variables(loaded: &LoadedCollection) -> Variables {
    let mut variables = Variables::new();
    for row in &loaded.variables {
        if let Some(key) = row
            .get("key")
            .and_then(Value::as_str)
            .filter(|k| !k.is_empty())
        {
            variables.insert(
                key.to_string(),
                row.get("value").cloned().unwrap_or(Value::Null),
            );
        }
    }
    variables
}

/// Keys of the rows flagged secret; their values are never in the file.
pub fn secret_variable_keys(loaded: &LoadedCollection) -> Vec<String> {
    loaded
        .variables
        .iter()
        .filter(|row| row.get("secret").and_then(Value::as_bool) == Some(true))
        .filter_map(|row| row.get("key").and_then(Value::as_str))
        .filter(|key| !key.is_empty())
        .map(str::to_string)
        .collect()
}

#[derive(Debug, Deserialize)]
struct EnvironmentExport {
    #[serde(default)]
    environments: Vec<ExportedEnvironment>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExportedEnvironment {
    #[serde(default)]
    name: String,
    #[serde(default)]
    variables: Map<String, Value>,
    #[serde(default)]
    secret_keys: Vec<String>,
}

/// One environment picked out of an export.
#[derive(Debug, Clone, PartialEq)]
pub struct EnvironmentSelection {
    pub name: String,
    pub variables: Variables,
    /// Names whose values are blank in the export and must be supplied otherwise.
    pub secret_keys: Vec<String>,
}

/// Picks an environment from the desktop app's JSON export.
///
/// Accepts the "export all" shape (`{version, environments: […]}`) and the
/// single-environment shape (`{name, variables, …}`). Without a name, the
/// file must hold exactly one environment.
///
/// @param json - The export file contents
/// @param name - The environment to pick, matched exactly then ignoring case
/// @returns The selected environment
pub fn environment_from_export(
    json: &str,
    name: Option<&str>,
) -> Result<EnvironmentSelection, LoadError> {
    let value: Value =
        serde_json::from_str(json).map_err(|e| LoadError::Environment(e.to_string()))?;
    let environments = if value.get("environments").is_some() {
        serde_json::from_value::<EnvironmentExport>(value)
            .map_err(|e| LoadError::Environment(e.to_string()))?
            .environments
    } else if value.get("variables").is_some() || value.get("name").is_some() {
        vec![
            serde_json::from_value::<ExportedEnvironment>(value)
                .map_err(|e| LoadError::Environment(e.to_string()))?,
        ]
    } else {
        return Err(LoadError::Environment(
            "expected an environment export with an `environments` list or a single `variables` object".into(),
        ));
    };
    if environments.is_empty() {
        return Err(LoadError::Environment(
            "the file holds no environments".into(),
        ));
    }
    let names = || {
        environments
            .iter()
            .map(|e| e.name.clone())
            .collect::<Vec<_>>()
            .join(", ")
    };
    let chosen = match name {
        None if environments.len() == 1 => &environments[0],
        None => {
            return Err(LoadError::Environment(format!(
                "the file holds {} environments; pass --env <name>: {}",
                environments.len(),
                names()
            )));
        }
        Some(wanted) => environments
            .iter()
            .find(|e| e.name == wanted)
            .or_else(|| {
                environments
                    .iter()
                    .find(|e| e.name.eq_ignore_ascii_case(wanted))
            })
            .ok_or_else(|| {
                LoadError::Environment(format!(
                    "no environment named {wanted}; available: {}",
                    names()
                ))
            })?,
    };
    Ok(EnvironmentSelection {
        name: chosen.name.clone(),
        variables: chosen.variables.clone().into_iter().collect(),
        secret_keys: chosen.secret_keys.clone(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::CollectionDoc;
    use crate::read::FolderNode;
    use serde_json::json;

    fn loaded_with(variables: Vec<Value>) -> LoadedCollection {
        LoadedCollection {
            meta: CollectionDoc {
                format: 2,
                id: "c1".into(),
                name: "P".into(),
                base_url: String::new(),
                description: None,
                default_headers: None,
                auth: None,
                open_api_spec: None,
                extra: Map::new(),
            },
            open_api_spec: None,
            variables,
            root: FolderNode::default(),
            runners: Vec::new(),
            reassigned_runner_ids: Vec::new(),
        }
    }

    #[test]
    fn collection_variables_last_duplicate_wins_and_secret_rows_are_blank() {
        let loaded = loaded_with(vec![
            json!({"key": "baseUrl", "value": "https://a"}),
            json!({"key": "baseUrl", "value": "https://b"}),
            json!({"key": "token", "value": "", "secret": true}),
            json!({"key": "", "value": "ignored"}),
            json!({"value": "no key"}),
        ]);
        let variables = collection_variables(&loaded);
        assert_eq!(variables.len(), 2);
        assert_eq!(variables["baseUrl"], "https://b");
        assert_eq!(variables["token"], "");
    }

    #[test]
    fn secret_variable_keys_lists_flagged_rows() {
        let loaded = loaded_with(vec![
            json!({"key": "token", "value": "", "secret": true}),
            json!({"key": "plain", "value": "x", "secret": false}),
            json!({"key": "other", "value": "y"}),
        ]);
        assert_eq!(secret_variable_keys(&loaded), vec!["token"]);
    }

    const EXPORT: &str = r##"{"version":"1.0","environments":[
        {"name":"Staging","variables":{"baseUrl":"https://staging","token":""},"secretKeys":["token"],"color":null},
        {"name":"Prod","variables":{"baseUrl":"https://prod"},"secretKeys":[],"color":"#fff"}
    ]}"##;

    #[test]
    fn environment_from_export_requires_name_when_several() {
        let error = environment_from_export(EXPORT, None).unwrap_err();
        assert!(
            error
                .to_string()
                .contains("pass --env <name>: Staging, Prod"),
            "{error}"
        );
    }

    #[test]
    fn environment_from_export_matches_case_insensitively() {
        let selected = environment_from_export(EXPORT, Some("staging")).unwrap();
        assert_eq!(selected.name, "Staging");
        assert_eq!(selected.variables["baseUrl"], "https://staging");
        assert_eq!(selected.secret_keys, vec!["token"]);
        let error = environment_from_export(EXPORT, Some("qa")).unwrap_err();
        assert!(
            error.to_string().contains("available: Staging, Prod"),
            "{error}"
        );
    }

    #[test]
    fn environment_from_export_single_environment_without_name() {
        let json = r#"{"version":"1.0","environments":[{"name":"Only","variables":{"a":"1"}}]}"#;
        let selected = environment_from_export(json, None).unwrap();
        assert_eq!(selected.name, "Only");
        assert_eq!(selected.variables["a"], "1");
        assert!(selected.secret_keys.is_empty());
    }

    #[test]
    fn environment_from_export_accepts_single_environment_shape() {
        let json = r#"{"name":"Solo","variables":{"a":"1"},"secretKeys":["a"]}"#;
        let selected = environment_from_export(json, None).unwrap();
        assert_eq!(selected.name, "Solo");
        assert_eq!(selected.secret_keys, vec!["a"]);
    }

    #[test]
    fn environment_from_export_rejects_malformed_input() {
        assert!(matches!(
            environment_from_export("{not json", None).unwrap_err(),
            LoadError::Environment(_)
        ));
        let error = environment_from_export(r#"{"foo": 1}"#, None).unwrap_err();
        assert!(
            error.to_string().contains("expected an environment export"),
            "{error}"
        );
        let error = environment_from_export(r#"{"environments": []}"#, None).unwrap_err();
        assert!(error.to_string().contains("no environments"), "{error}");
    }
}
