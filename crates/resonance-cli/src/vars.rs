//! Variables injected from outside the collection: `--var`, the
//! `RESONANCE_VAR_` environment and an environment export file.
use resonance_collections::variables::environment_from_export;
use resonance_core::model::Variables;
use serde_json::Value;
use std::ffi::OsString;
use std::path::Path;

use crate::error::CliError;

pub const ENV_PREFIX: &str = "RESONANCE_VAR_";

/// `KEY=VALUE`, split at the first `=`.
pub fn parse_assignment(text: &str) -> Result<(String, String), CliError> {
    match text.split_once('=') {
        Some((key, value)) if !key.trim().is_empty() => {
            Ok((key.trim().to_string(), value.to_string()))
        }
        _ => Err(CliError::Usage(format!(
            "--var expects KEY=VALUE, got {text:?}"
        ))),
    }
}

/// Variables from `RESONANCE_VAR_<KEY>` entries; the key keeps its case.
pub fn prefixed_env(env: impl Iterator<Item = (String, String)>) -> Variables {
    env.filter_map(|(name, value)| {
        name.strip_prefix(ENV_PREFIX)
            .filter(|key| !key.is_empty())
            .map(|key| (key.to_string(), Value::String(value)))
    })
    .collect()
}

/// The process environment as strings, skipping any entry whose name or value
/// is not UTF-8. `std::env::vars` panics on those, and a CI runner can carry
/// one that has nothing to do with Resonance.
pub fn utf8_env(
    env: impl Iterator<Item = (OsString, OsString)>,
) -> impl Iterator<Item = (String, String)> {
    env.filter_map(|(name, value)| Some((name.into_string().ok()?, value.into_string().ok()?)))
}

/// Names of `RESONANCE_VAR_` entries that [`utf8_env`] has to skip, so the run
/// can say why a variable the user passed is missing.
pub fn unreadable_prefixed_env(env: impl Iterator<Item = (OsString, OsString)>) -> Vec<String> {
    env.filter(|(name, value)| {
        name.to_string_lossy().starts_with(ENV_PREFIX)
            && (name.to_str().is_none() || value.to_str().is_none())
    })
    .map(|(name, _)| name.to_string_lossy().into_owned())
    .collect()
}

/// An environment picked from a desktop export file.
#[derive(Debug)]
pub struct EnvironmentFile {
    pub name: String,
    pub variables: Variables,
    pub secret_keys: Vec<String>,
}

pub fn load_env_file(path: &Path, name: Option<&str>) -> Result<EnvironmentFile, CliError> {
    let json = std::fs::read_to_string(path).map_err(|source| CliError::Io {
        path: path.to_path_buf(),
        source,
    })?;
    let selected = environment_from_export(&json, name)?;
    Ok(EnvironmentFile {
        name: selected.name,
        variables: selected.variables,
        secret_keys: selected.secret_keys,
    })
}

/// Later layers win: environment file, then the process environment, then
/// `--var` flags.
pub fn merge(layers: Vec<Variables>) -> Variables {
    let mut merged = Variables::new();
    for layer in layers {
        merged.extend(layer);
    }
    merged
}

/// Secret keys whose value is still empty after every layer was applied.
pub fn unfilled_secrets(secret_keys: &[String], variables: &Variables) -> Vec<String> {
    secret_keys
        .iter()
        .filter(|key| {
            variables
                .get(*key)
                .is_none_or(|v| v.as_str().is_some_and(str::is_empty) || v.is_null())
        })
        .cloned()
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn assignment_splits_on_first_equals() {
        assert_eq!(
            parse_assignment("token=a=b").unwrap(),
            ("token".into(), "a=b".into())
        );
        assert_eq!(parse_assignment("empty=").unwrap().1, "");
    }

    #[test]
    fn assignment_without_equals_or_key_is_usage_error() {
        assert!(matches!(
            parse_assignment("token").unwrap_err(),
            CliError::Usage(_)
        ));
        assert!(matches!(
            parse_assignment("=x").unwrap_err(),
            CliError::Usage(_)
        ));
    }

    #[test]
    fn prefixed_env_keeps_key_case_and_ignores_other_variables() {
        let vars = prefixed_env(
            vec![
                ("RESONANCE_VAR_baseUrl".to_string(), "https://x".to_string()),
                ("RESONANCE_VAR_".to_string(), "no key".to_string()),
                ("PATH".to_string(), "/bin".to_string()),
            ]
            .into_iter(),
        );
        assert_eq!(vars.len(), 1);
        assert_eq!(vars["baseUrl"], "https://x");
    }

    #[cfg(unix)]
    #[test]
    fn non_utf8_entries_are_skipped_and_named_when_they_were_meant_for_us() {
        use std::os::unix::ffi::OsStringExt;
        let env = || {
            vec![
                (
                    OsString::from("LANG_JUNK"),
                    OsString::from_vec(b"\xff".to_vec()),
                ),
                (
                    OsString::from("RESONANCE_VAR_bad"),
                    OsString::from_vec(b"\xfe".to_vec()),
                ),
                (OsString::from("RESONANCE_VAR_good"), OsString::from("ok")),
            ]
            .into_iter()
        };

        let vars = prefixed_env(utf8_env(env()));

        assert_eq!(vars.len(), 1);
        assert_eq!(vars["good"], "ok");
        assert_eq!(
            unreadable_prefixed_env(env()),
            vec!["RESONANCE_VAR_bad".to_string()]
        );
    }

    #[test]
    fn later_layers_win() {
        let merged = merge(vec![
            Variables::from([
                ("a".to_string(), json!("file")),
                ("b".to_string(), json!("file")),
            ]),
            Variables::from([("a".to_string(), json!("env"))]),
            Variables::from([("a".to_string(), json!("flag"))]),
        ]);
        assert_eq!(merged["a"], "flag");
        assert_eq!(merged["b"], "file");
    }

    #[test]
    fn unfilled_secrets_are_reported() {
        let variables = Variables::from([
            ("token".to_string(), json!("")),
            ("filled".to_string(), json!("x")),
        ]);
        assert_eq!(
            unfilled_secrets(
                &["token".into(), "filled".into(), "missing".into()],
                &variables
            ),
            vec!["token", "missing"]
        );
    }

    #[test]
    fn env_file_errors_name_the_file() {
        let error = load_env_file(Path::new("/nonexistent/env.json"), None).unwrap_err();
        assert!(matches!(error, CliError::Io { .. }));
    }
}
