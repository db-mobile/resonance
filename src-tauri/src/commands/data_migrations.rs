//! Versioned conversion of on-disk data, run once per launch before the
//! webview reads anything.
//!
//! The main store carries a `dataVersion` stamp. Each step lifts the data to
//! its `to` version and the stamp is written after every step, so a crash or
//! a failed step resumes at that step on the next launch. Every step is
//! idempotent, which is what lets an install without a stamp (version 0) run
//! the whole chain safely.
//!
//! Retiring a converter means deleting its step and raising
//! [`MIN_SUPPORTED_DATA_VERSION`] to that step's `to`. Data stamped below the
//! minimum is left untouched and reported, so the user can upgrade through a
//! release that still converts it instead of losing it.

use serde::Serialize;
use serde_json::{Map, Value};
use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::sync::Mutex;

use super::collections::{COLLECTIONS_DIR, absorb_store_scripts, convert_v1_dir};
use super::store_files::{
    MAIN_STORE, migrate_store_split, read_store, store_file_for, write_store,
};

pub const MIN_SUPPORTED_DATA_VERSION: u32 = 0;

const DATA_VERSION_KEY: &str = "dataVersion";
const STORE_SCRIPTS_KEY: &str = "persistedScripts";
const GLOBAL_STORE_COLLECTIONS_KEY: &str = "collections";
const COOKIE_JAR_KEY: &str = "cookieJar";
const DEFAULT_COOKIE_ENVIRONMENT: &str = "default";

struct Step {
    to: u32,
    name: &'static str,
    run: fn(&Path) -> Result<(), String>,
}

const STEPS: &[Step] = &[
    Step {
        to: 1,
        name: "store split",
        run: store_split,
    },
    Step {
        to: 2,
        name: "collection format v1 to v2",
        run: convert_v1_collections,
    },
    Step {
        to: 3,
        name: "scripts from the store into request files",
        run: move_store_scripts,
    },
    Step {
        to: 4,
        name: "cookie jar ids",
        run: rekey_cookies,
    },
];

/// Something the user has to know about after the chain ran.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum MigrationIssue {
    /// A step failed; it is retried on the next launch.
    #[serde(rename_all = "camelCase")]
    Failed { step: String, message: String },
    /// The data predates every step this build still carries.
    #[serde(rename_all = "camelCase")]
    TooOld { found: u32, min: u32 },
    /// Data in a format no step converts any more, left in place.
    #[serde(rename_all = "camelCase")]
    Unsupported { data: String },
}

/// Issues from this launch's migration run, for the frontend to show.
#[derive(Default)]
pub struct MigrationStatus(pub Mutex<Vec<MigrationIssue>>);

#[tauri::command]
pub async fn data_migration_status(
    state: tauri::State<'_, MigrationStatus>,
) -> Result<Vec<MigrationIssue>, String> {
    Ok(state.0.lock().unwrap().clone())
}

/// Brings the data in `dir` up to the last step's version.
///
/// @param dir - The app data directory
/// @returns Everything the user needs to be told about
pub fn run(dir: &Path) -> Vec<MigrationIssue> {
    run_steps(dir, STEPS, MIN_SUPPORTED_DATA_VERSION)
}

fn run_steps(dir: &Path, steps: &[Step], min_supported: u32) -> Vec<MigrationIssue> {
    let mut issues = Vec::new();
    let found = stored_version(dir);

    if found < min_supported {
        issues.push(MigrationIssue::TooOld {
            found,
            min: min_supported,
        });
        return issues;
    }

    for step in steps.iter().filter(|step| step.to > found) {
        if let Err(message) = (step.run)(dir).and_then(|_| stamp_version(dir, step.to)) {
            eprintln!("data migration '{}' failed: {}", step.name, message);
            issues.push(MigrationIssue::Failed {
                step: step.name.to_string(),
                message,
            });
            break;
        }
    }

    if holds_global_store_collections(dir) {
        issues.push(MigrationIssue::Unsupported {
            data: "globalStoreCollections".to_string(),
        });
    }

    issues
}

fn stored_version(dir: &Path) -> u32 {
    read_store(&dir.join(MAIN_STORE))
        .get(DATA_VERSION_KEY)
        .and_then(Value::as_u64)
        .and_then(|version| u32::try_from(version).ok())
        .unwrap_or(0)
}

fn stamp_version(dir: &Path, version: u32) -> Result<(), String> {
    let path = dir.join(MAIN_STORE);
    let mut main = read_store(&path);
    main.insert(DATA_VERSION_KEY.to_string(), Value::from(version));
    write_store(&path, &main)
}

/// Collections kept in the main store itself, from before collections had
/// their own directories. Their converter was retired.
fn holds_global_store_collections(dir: &Path) -> bool {
    matches!(
        read_store(&dir.join(MAIN_STORE)).get(GLOBAL_STORE_COLLECTIONS_KEY),
        Some(Value::Array(collections)) if !collections.is_empty()
    )
}

/// Collection directories the app owns. Linked collections live in the
/// user's own checkouts and are only rewritten when the user saves them.
fn app_collection_dirs(dir: &Path) -> Result<Vec<std::path::PathBuf>, String> {
    let root = dir.join(COLLECTIONS_DIR);
    if !root.is_dir() {
        return Ok(Vec::new());
    }
    let mut dirs: Vec<_> = fs::read_dir(&root)
        .map_err(|e| format!("Failed to read {}: {}", root.display(), e))?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.is_dir())
        .collect();
    dirs.sort();
    Ok(dirs)
}

fn store_split(dir: &Path) -> Result<(), String> {
    migrate_store_split(dir).map(|_| ())
}

fn convert_v1_collections(dir: &Path) -> Result<(), String> {
    let failures: Vec<String> = app_collection_dirs(dir)?
        .iter()
        .filter_map(|path| {
            convert_v1_dir(path)
                .err()
                .map(|e| format!("{}: {}", path.display(), e))
        })
        .collect();
    if failures.is_empty() {
        Ok(())
    } else {
        Err(failures.join("; "))
    }
}

fn move_store_scripts(dir: &Path) -> Result<(), String> {
    let main_path = dir.join(MAIN_STORE);
    let mut main = read_store(&main_path);
    let Some(Value::Object(scripts)) = main.get(STORE_SCRIPTS_KEY).cloned() else {
        return Ok(());
    };

    let mut remaining: Map<String, Value> = scripts;
    let before = remaining.len();
    let mut failures = Vec::new();
    for path in app_collection_dirs(dir)? {
        if let Err(e) = absorb_store_scripts(&path, &mut remaining) {
            failures.push(format!("{}: {}", path.display(), e));
        }
    }

    if remaining.len() != before {
        main.insert(STORE_SCRIPTS_KEY.to_string(), Value::Object(remaining));
        write_store(&main_path, &main)?;
    }

    if failures.is_empty() {
        Ok(())
    } else {
        Err(failures.join("; "))
    }
}

/// Rekeys every cookie jar entry to `{environment}|{domain}|{path}|{name}`,
/// the id cookies have carried since 2.12.6, and keeps only the newest entry
/// per id. Mirrors `CookieRepository._migrateLegacyIds`, which the webview
/// still runs lazily until this step retires it.
fn rekey_cookies(dir: &Path) -> Result<(), String> {
    let path = dir.join(store_file_for(COOKIE_JAR_KEY));
    let mut store = read_store(&path);
    let Some(Value::Array(cookies)) = store.get(COOKIE_JAR_KEY) else {
        return Ok(());
    };
    let Some(rekeyed) = rekeyed_cookies(cookies) else {
        return Ok(());
    };
    store.insert(COOKIE_JAR_KEY.to_string(), Value::Array(rekeyed));
    write_store(&path, &store)
}

/// @returns The jar with current ids, or None when it already had them
fn rekeyed_cookies(cookies: &[Value]) -> Option<Vec<Value>> {
    let mut changed = false;
    let mut order = Vec::new();
    let mut by_id: HashMap<String, Value> = HashMap::new();

    for (index, cookie) in cookies.iter().enumerate() {
        let Value::Object(fields) = cookie else {
            order.push(format!("\0{index}"));
            by_id.insert(format!("\0{index}"), cookie.clone());
            continue;
        };
        let environment = string_or_empty(fields, "environmentId");
        let environment = if environment.is_empty() {
            DEFAULT_COOKIE_ENVIRONMENT
        } else {
            environment
        };
        let id = format!(
            "{}|{}|{}|{}",
            environment,
            string_or_empty(fields, "domain"),
            string_or_empty(fields, "path"),
            string_or_empty(fields, "name")
        );
        let mut entry = fields.clone();
        if fields.get("id").and_then(Value::as_str) != Some(&id) {
            changed = true;
            entry.insert("id".to_string(), Value::String(id.clone()));
            entry.insert(
                "environmentId".to_string(),
                Value::String(environment.to_string()),
            );
        }
        match by_id.get(&id) {
            None => {
                order.push(id.clone());
                by_id.insert(id, Value::Object(entry));
            }
            Some(existing) => {
                changed = true;
                if updated_at(&entry) > existing.as_object().map_or(0.0, updated_at) {
                    by_id.insert(id, Value::Object(entry));
                }
            }
        }
    }

    changed.then(|| {
        order
            .into_iter()
            .filter_map(|id| by_id.remove(&id))
            .collect()
    })
}

fn string_or_empty<'a>(fields: &'a Map<String, Value>, key: &str) -> &'a str {
    fields.get(key).and_then(Value::as_str).unwrap_or("")
}

fn updated_at(cookie: &Map<String, Value>) -> f64 {
    cookie
        .get("updatedAt")
        .and_then(Value::as_f64)
        .unwrap_or(0.0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use tempfile::TempDir;

    fn write_main(dir: &Path, value: Value) {
        fs::write(dir.join(MAIN_STORE), value.to_string()).unwrap();
    }

    fn read_main(dir: &Path) -> Value {
        serde_json::from_str(&fs::read_to_string(dir.join(MAIN_STORE)).unwrap()).unwrap()
    }

    fn write_v1_collection(dir: &Path) -> std::path::PathBuf {
        let collection = dir.join(COLLECTIONS_DIR).join("pets");
        fs::create_dir_all(collection.join("requests")).unwrap();
        fs::write(
            collection.join("collection.json"),
            json!({
                "id": "c1",
                "name": "Pets",
                "baseUrl": "https://api.example.com",
                "endpoints": [{"id": "r1", "name": "List", "method": "GET", "path": "/pets"}],
                "folders": []
            })
            .to_string(),
        )
        .unwrap();
        collection
    }

    fn failing(_: &Path) -> Result<(), String> {
        Err("boom".into())
    }

    fn succeeding(_: &Path) -> Result<(), String> {
        Ok(())
    }

    #[test]
    fn a_fresh_install_runs_every_step_and_is_stamped_current() {
        let temp = TempDir::new().unwrap();

        assert!(run(temp.path()).is_empty());

        assert_eq!(stored_version(temp.path()), STEPS.last().unwrap().to);
    }

    #[test]
    fn a_second_run_changes_nothing() {
        let temp = TempDir::new().unwrap();
        write_v1_collection(temp.path());
        run(temp.path());
        let after_first = read_main(temp.path());

        assert!(run(temp.path()).is_empty());

        assert_eq!(read_main(temp.path()), after_first);
    }

    #[test]
    fn a_failed_step_keeps_the_previous_stamp_and_stops_the_chain() {
        let temp = TempDir::new().unwrap();
        let steps = [
            Step {
                to: 1,
                name: "ok",
                run: succeeding,
            },
            Step {
                to: 2,
                name: "broken",
                run: failing,
            },
            Step {
                to: 3,
                name: "never",
                run: succeeding,
            },
        ];

        let issues = run_steps(temp.path(), &steps, 0);

        assert_eq!(
            issues,
            vec![MigrationIssue::Failed {
                step: "broken".into(),
                message: "boom".into()
            }]
        );
        assert_eq!(stored_version(temp.path()), 1);
    }

    #[test]
    fn a_failed_step_is_retried_on_the_next_launch() {
        let temp = TempDir::new().unwrap();
        run_steps(
            temp.path(),
            &[Step {
                to: 1,
                name: "broken",
                run: failing,
            }],
            0,
        );

        let issues = run_steps(
            temp.path(),
            &[Step {
                to: 1,
                name: "fixed",
                run: succeeding,
            }],
            0,
        );

        assert!(issues.is_empty());
        assert_eq!(stored_version(temp.path()), 1);
    }

    #[test]
    fn data_older_than_the_minimum_is_reported_and_left_untouched() {
        let temp = TempDir::new().unwrap();
        write_main(
            temp.path(),
            json!({"dataVersion": 1, "requestHistory": [1]}),
        );

        let issues = run_steps(
            temp.path(),
            &[Step {
                to: 5,
                name: "x",
                run: failing,
            }],
            2,
        );

        assert_eq!(issues, vec![MigrationIssue::TooOld { found: 1, min: 2 }]);
        assert_eq!(
            read_main(temp.path()),
            json!({"dataVersion": 1, "requestHistory": [1]})
        );
    }

    #[test]
    fn the_chain_converts_v1_collections_and_moves_store_scripts() {
        let temp = TempDir::new().unwrap();
        let collection = write_v1_collection(temp.path());
        write_main(
            temp.path(),
            json!({
                "requestHistory": [],
                "persistedScripts": {
                    "c1_r1": {"preRequestScript": "", "testScript": "check();"},
                    "elsewhere_r9": {"testScript": "linked();"}
                }
            }),
        );

        assert!(run(temp.path()).is_empty());

        assert!(collection.join("collection.yaml").exists());
        assert!(!collection.join("collection.json").exists());
        assert!(!collection.join("runners").exists());
        let request = fs::read_to_string(collection.join("list.yaml")).unwrap();
        assert!(request.contains("check();"), "{}", request);
        let main = read_main(temp.path());
        assert_eq!(
            main["persistedScripts"],
            json!({"elsewhere_r9": {"testScript": "linked();"}})
        );
        assert!(
            main.get("requestHistory").is_none(),
            "store split did not run"
        );
        assert!(temp.path().join("resonance-history.json").exists());
    }

    #[test]
    fn the_chain_rekeys_cookies_after_the_store_split_moved_them() {
        let temp = TempDir::new().unwrap();
        write_main(
            temp.path(),
            json!({
                "cookieJar": [
                    {"id": "old-1", "domain": "a.test", "path": "/", "name": "s", "value": "stale", "updatedAt": 1},
                    {"id": "default|a.test|/|s", "environmentId": "default", "domain": "a.test", "path": "/", "name": "s", "value": "fresh", "updatedAt": 2},
                    {"id": "env1|b.test|/|t", "environmentId": "env1", "domain": "b.test", "path": "/", "name": "t", "value": "kept"}
                ]
            }),
        );

        assert!(run(temp.path()).is_empty());

        assert!(read_main(temp.path()).get("cookieJar").is_none());
        let cookies = read_store(&temp.path().join(store_file_for("cookieJar")));
        assert_eq!(
            cookies["cookieJar"],
            json!([
                {"id": "default|a.test|/|s", "environmentId": "default", "domain": "a.test", "path": "/", "name": "s", "value": "fresh", "updatedAt": 2},
                {"id": "env1|b.test|/|t", "environmentId": "env1", "domain": "b.test", "path": "/", "name": "t", "value": "kept"}
            ])
        );
        assert_eq!(stored_version(temp.path()), 4);
    }

    #[test]
    fn a_jar_with_current_ids_is_not_rewritten() {
        let cookies = vec![
            json!({"id": "default|a.test|/|s", "environmentId": "default", "domain": "a.test", "path": "/", "name": "s"}),
            json!({"id": "env1|b.test|/|t", "environmentId": "env1", "domain": "b.test", "path": "/", "name": "t"}),
        ];

        assert_eq!(rekeyed_cookies(&cookies), None);
    }

    #[test]
    fn a_rekeyed_entry_keeps_its_position_and_the_older_duplicate_loses() {
        let cookies = vec![
            json!({"id": "x", "environmentId": null, "domain": "a.test", "path": "/", "name": "s", "value": "newer", "updatedAt": 5}),
            json!({"id": "y", "domain": "c.test", "path": "/", "name": "u"}),
            json!({"id": "default|a.test|/|s", "environmentId": "default", "domain": "a.test", "path": "/", "name": "s", "value": "older", "updatedAt": 3}),
        ];

        let rekeyed = rekeyed_cookies(&cookies).unwrap();

        assert_eq!(rekeyed.len(), 2);
        assert_eq!(rekeyed[0]["id"], "default|a.test|/|s");
        assert_eq!(rekeyed[0]["value"], "newer");
        assert_eq!(rekeyed[1]["id"], "default|c.test|/|u");
        assert_eq!(rekeyed[1]["environmentId"], "default");
    }

    #[test]
    fn a_missing_jar_is_a_no_op() {
        let temp = TempDir::new().unwrap();

        assert_eq!(rekey_cookies(temp.path()), Ok(()));

        assert!(!temp.path().join(store_file_for("cookieJar")).exists());
    }

    #[test]
    fn global_store_collections_are_reported_and_kept() {
        let temp = TempDir::new().unwrap();
        write_main(temp.path(), json!({"collections": [{"id": "old"}]}));

        let issues = run(temp.path());

        assert_eq!(
            issues,
            vec![MigrationIssue::Unsupported {
                data: "globalStoreCollections".into()
            }]
        );
        assert_eq!(
            read_main(temp.path())["collections"],
            json!([{"id": "old"}])
        );
    }

    #[test]
    fn an_issue_serializes_with_a_kind_tag() {
        let value = serde_json::to_value(MigrationIssue::TooOld { found: 0, min: 2 }).unwrap();
        assert_eq!(value, json!({"kind": "tooOld", "found": 0, "min": 2}));
    }
}
