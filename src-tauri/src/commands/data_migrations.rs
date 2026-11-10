//! Versioned conversion of on-disk data, run once per launch before the
//! webview reads anything.
//!
//! The main store carries a `dataVersion` stamp. Each step lifts the data to
//! its `to` version and the stamp is written after every step, so a crash or
//! a failed step resumes at that step on the next launch. Every step is
//! idempotent. A fresh install has no main store yet and is stamped
//! [`CURRENT_DATA_VERSION`] outright, since there is nothing to convert.
//!
//! Retiring a converter means deleting its step and raising
//! [`MIN_SUPPORTED_DATA_VERSION`] to that step's `to`. Data stamped below the
//! minimum is left untouched and reported, so the user can upgrade through a
//! release that still converts it instead of losing it. Leftovers that were
//! converted lazily rather than by a step (v1 collection directories, store
//! scripts, store runners) are reported the same way. Every converter that
//! ever shipped was retired after 3.6.0, the last release carrying them.

use serde::Serialize;
use serde_json::{Map, Value};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use super::collections::{COLLECTION_INDEX_KEY, COLLECTIONS_DIR};
use super::store_files::{MAIN_STORE, read_store, write_store};

/// The version a fresh install is stamped with and the last step lifts to.
pub const CURRENT_DATA_VERSION: u32 = 4;
pub const MIN_SUPPORTED_DATA_VERSION: u32 = 4;
const _: () = assert!(MIN_SUPPORTED_DATA_VERSION <= CURRENT_DATA_VERSION);

const DATA_VERSION_KEY: &str = "dataVersion";
const GLOBAL_STORE_COLLECTIONS_KEY: &str = "collections";
const STORE_RUNNERS_KEY: &str = "collectionRunners";
const STORE_SCRIPTS_KEY: &str = "persistedScripts";
const V1_MARKER: &str = "collection.json";
const V2_MARKER: &str = "collection.yaml";

struct Step {
    to: u32,
    name: &'static str,
    run: fn(&Path) -> Result<(), String>,
}

const STEPS: &[Step] = &[];

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

/// Brings the data in `dir` up to [`CURRENT_DATA_VERSION`].
///
/// @param dir - The app data directory
/// @returns Everything the user needs to be told about
pub fn run(dir: &Path) -> Vec<MigrationIssue> {
    run_steps(dir, STEPS, MIN_SUPPORTED_DATA_VERSION, CURRENT_DATA_VERSION)
}

fn run_steps(dir: &Path, steps: &[Step], min_supported: u32, current: u32) -> Vec<MigrationIssue> {
    let mut issues = Vec::new();

    if !dir.join(MAIN_STORE).exists() {
        if let Err(message) = stamp_version(dir, current) {
            eprintln!("stamping a fresh install failed: {}", message);
        }
        return issues;
    }

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

    issues.extend(
        unsupported_leftovers(dir)
            .into_iter()
            .map(|data| MigrationIssue::Unsupported {
                data: data.to_string(),
            }),
    );

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

/// Data whose converter was retired, named the way the notice dialog keys it.
///
/// @param dir - The app data directory
/// @returns One name per kind of leftover found
fn unsupported_leftovers(dir: &Path) -> Vec<&'static str> {
    let main = read_store(&dir.join(MAIN_STORE));
    let mut found = Vec::new();
    if holds_non_empty_array(&main, GLOBAL_STORE_COLLECTIONS_KEY) {
        found.push("globalStoreCollections");
    }
    if holds_non_empty_array(&main, STORE_RUNNERS_KEY) {
        found.push("collectionRunners");
    }
    if holds_scripts_of_registered_collections(&main) {
        found.push("storeScripts");
    }
    if holds_v1_collections(dir, &main) {
        found.push("v1Collections");
    }
    found
}

fn holds_non_empty_array(main: &Map<String, Value>, key: &str) -> bool {
    matches!(main.get(key), Some(Value::Array(items)) if !items.is_empty())
}

/// Store scripts keyed `{collectionId}_{requestId}` for a collection that is
/// still registered. Entries of collections long gone are orphans and not
/// worth a notice.
fn holds_scripts_of_registered_collections(main: &Map<String, Value>) -> bool {
    let Some(Value::Object(scripts)) = main.get(STORE_SCRIPTS_KEY) else {
        return false;
    };
    registered_collection_ids(main)
        .iter()
        .any(|id| scripts.keys().any(|key| key.starts_with(&format!("{id}_"))))
}

fn registered_collection_ids(main: &Map<String, Value>) -> Vec<String> {
    match main.get(COLLECTION_INDEX_KEY) {
        Some(Value::Object(index)) => index.keys().cloned().collect(),
        _ => Vec::new(),
    }
}

fn registered_collection_dirs(main: &Map<String, Value>) -> Vec<PathBuf> {
    match main.get(COLLECTION_INDEX_KEY) {
        Some(Value::Object(index)) => index
            .values()
            .filter_map(Value::as_str)
            .map(PathBuf::from)
            .collect(),
        _ => Vec::new(),
    }
}

fn app_collection_dirs(dir: &Path) -> Vec<PathBuf> {
    std::fs::read_dir(dir.join(COLLECTIONS_DIR))
        .map(|entries| {
            entries
                .filter_map(Result::ok)
                .map(|entry| entry.path())
                .collect()
        })
        .unwrap_or_default()
}

fn holds_v1_collections(dir: &Path, main: &Map<String, Value>) -> bool {
    app_collection_dirs(dir)
        .into_iter()
        .chain(registered_collection_dirs(main))
        .any(|path| path.join(V1_MARKER).exists() && !path.join(V2_MARKER).exists())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::fs;
    use tempfile::TempDir;

    fn write_main(dir: &Path, value: Value) {
        fs::write(dir.join(MAIN_STORE), value.to_string()).unwrap();
    }

    fn read_main(dir: &Path) -> Value {
        serde_json::from_str(&fs::read_to_string(dir.join(MAIN_STORE)).unwrap()).unwrap()
    }

    fn failing(_: &Path) -> Result<(), String> {
        Err("boom".into())
    }

    fn succeeding(_: &Path) -> Result<(), String> {
        Ok(())
    }

    fn unsupported(data: &str) -> MigrationIssue {
        MigrationIssue::Unsupported { data: data.into() }
    }

    #[test]
    fn the_last_step_lifts_to_the_current_version() {
        if let Some(last) = STEPS.last() {
            assert_eq!(last.to, CURRENT_DATA_VERSION);
        }
    }

    #[test]
    fn a_fresh_install_is_stamped_current_without_running_a_step() {
        let temp = TempDir::new().unwrap();

        let issues = run_steps(
            temp.path(),
            &[Step {
                to: 9,
                name: "never",
                run: failing,
            }],
            0,
            9,
        );

        assert!(issues.is_empty());
        assert_eq!(read_main(temp.path()), json!({"dataVersion": 9}));
    }

    #[test]
    fn a_fresh_install_runs_clean_and_is_stamped_current() {
        let temp = TempDir::new().unwrap();

        assert!(run(temp.path()).is_empty());

        assert_eq!(stored_version(temp.path()), CURRENT_DATA_VERSION);
    }

    #[test]
    fn a_second_run_changes_nothing() {
        let temp = TempDir::new().unwrap();
        run(temp.path());
        let after_first = read_main(temp.path());

        assert!(run(temp.path()).is_empty());

        assert_eq!(read_main(temp.path()), after_first);
    }

    #[test]
    fn a_failed_step_keeps_the_previous_stamp_and_stops_the_chain() {
        let temp = TempDir::new().unwrap();
        write_main(temp.path(), json!({}));
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

        let issues = run_steps(temp.path(), &steps, 0, 3);

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
        write_main(temp.path(), json!({}));
        run_steps(
            temp.path(),
            &[Step {
                to: 1,
                name: "broken",
                run: failing,
            }],
            0,
            1,
        );

        let issues = run_steps(
            temp.path(),
            &[Step {
                to: 1,
                name: "fixed",
                run: succeeding,
            }],
            0,
            1,
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
            5,
        );

        assert_eq!(issues, vec![MigrationIssue::TooOld { found: 1, min: 2 }]);
        assert_eq!(
            read_main(temp.path()),
            json!({"dataVersion": 1, "requestHistory": [1]})
        );
    }

    #[test]
    fn an_unstamped_store_is_too_old_for_the_retired_chain() {
        let temp = TempDir::new().unwrap();
        write_main(
            temp.path(),
            json!({"requestHistory": [], "persistedScripts": {"c1_r1": {"testScript": "check();"}}}),
        );
        let before = read_main(temp.path());

        let issues = run(temp.path());

        assert_eq!(
            issues,
            vec![MigrationIssue::TooOld {
                found: 0,
                min: MIN_SUPPORTED_DATA_VERSION
            }]
        );
        assert_eq!(read_main(temp.path()), before);
    }

    #[test]
    fn data_stamped_by_the_last_converting_release_is_accepted() {
        let temp = TempDir::new().unwrap();
        write_main(temp.path(), json!({"dataVersion": 4, "theme": "dark"}));

        assert!(run(temp.path()).is_empty());

        assert_eq!(
            read_main(temp.path()),
            json!({"dataVersion": 4, "theme": "dark"})
        );
    }

    #[test]
    fn global_store_collections_are_reported_and_kept() {
        let temp = TempDir::new().unwrap();
        write_main(
            temp.path(),
            json!({"dataVersion": 4, "collections": [{"id": "old"}]}),
        );

        let issues = run(temp.path());

        assert_eq!(issues, vec![unsupported("globalStoreCollections")]);
        assert_eq!(
            read_main(temp.path())["collections"],
            json!([{"id": "old"}])
        );
    }

    #[test]
    fn leftover_store_runners_are_reported_and_an_emptied_key_is_not() {
        let temp = TempDir::new().unwrap();
        write_main(
            temp.path(),
            json!({"dataVersion": 4, "collectionRunners": [{"id": "runner_1"}]}),
        );
        assert_eq!(run(temp.path()), vec![unsupported("collectionRunners")]);

        write_main(
            temp.path(),
            json!({"dataVersion": 4, "collectionRunners": null, "collectionRunnersLegacyBackup": {"runners": [1]}}),
        );
        assert!(run(temp.path()).is_empty());
    }

    #[test]
    fn store_scripts_are_reported_only_for_a_registered_collection() {
        let temp = TempDir::new().unwrap();
        write_main(
            temp.path(),
            json!({
                "dataVersion": 4,
                "collectionIndex": {"c1": "/somewhere/c1"},
                "persistedScripts": {"gone_r1": {"testScript": "orphan();"}}
            }),
        );
        assert!(run(temp.path()).is_empty());

        write_main(
            temp.path(),
            json!({
                "dataVersion": 4,
                "collectionIndex": {"c1": "/somewhere/c1"},
                "persistedScripts": {"c1_r1": {"testScript": "mine();"}}
            }),
        );
        assert_eq!(run(temp.path()), vec![unsupported("storeScripts")]);
    }

    #[test]
    fn a_v1_collection_directory_is_reported_whether_app_owned_or_linked() {
        let temp = TempDir::new().unwrap();
        let owned = temp.path().join(COLLECTIONS_DIR).join("pets");
        fs::create_dir_all(&owned).unwrap();
        fs::write(owned.join("collection.json"), "{}").unwrap();
        write_main(temp.path(), json!({"dataVersion": 4}));
        assert_eq!(run(temp.path()), vec![unsupported("v1Collections")]);

        fs::write(owned.join("collection.yaml"), "resonanceFormat: 2\n").unwrap();
        assert!(run(temp.path()).is_empty());

        let linked = TempDir::new().unwrap();
        fs::write(linked.path().join("collection.json"), "{}").unwrap();
        write_main(
            temp.path(),
            json!({"dataVersion": 4, "collectionIndex": {"c9": linked.path().to_string_lossy()}}),
        );
        assert_eq!(run(temp.path()), vec![unsupported("v1Collections")]);
    }

    #[test]
    fn an_issue_serializes_with_a_kind_tag() {
        let value = serde_json::to_value(MigrationIssue::TooOld { found: 0, min: 2 }).unwrap();
        assert_eq!(value, json!({"kind": "tooOld", "found": 0, "min": 2}));
    }
}
