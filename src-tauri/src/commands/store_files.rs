//! Which on-disk store file each key lives in.
//!
//! The key-value store started as one file, which meant writing a sidebar width
//! rewrote the request history too: `store.save()` serializes every key it
//! holds. The bulky, frequently-written keys therefore get their own files, so
//! a small preference write stays small.
//!
//! The split is invisible to the frontend. `store_get`/`store_set` take a key
//! and nothing else, so routing happens here and no JS call site changes.

use serde_json::{Map, Value};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use super::fs_secure::restrict_file;

/// Everything not claimed by one of the files below.
pub const MAIN_STORE: &str = "resonance-store.json";

pub const HISTORY_STORE: &str = "resonance-history.json";
pub const TABS_STORE: &str = "resonance-tabs.json";
pub const COOKIES_STORE: &str = "resonance-cookies.json";
pub const GRAPHQL_CACHE_STORE: &str = "resonance-graphql-cache.json";

/// Keys that live outside [`MAIN_STORE`], paired with the file that holds them.
///
/// These are all written from JS only, and each is either large or written
/// often enough that dragging it along on unrelated saves is what made the
/// single-file store expensive.
const RELOCATED_KEYS: [(&str, &str); 5] = [
    ("requestHistory", HISTORY_STORE),
    ("workspace-tabs", TABS_STORE),
    ("active-tab-id", TABS_STORE),
    ("cookieJar", COOKIES_STORE),
    ("graphqlSchemaCache", GRAPHQL_CACHE_STORE),
];

/// Every store file the app owns, for startup permission tightening.
pub const ALL_STORES: [&str; 5] = [
    MAIN_STORE,
    HISTORY_STORE,
    TABS_STORE,
    COOKIES_STORE,
    GRAPHQL_CACHE_STORE,
];

/// The file a key is stored in.
///
/// @param key - Store key
/// @returns The store file name that holds it
pub fn store_file_for(key: &str) -> &'static str {
    RELOCATED_KEYS
        .iter()
        .find(|(name, _)| *name == key)
        .map(|(_, file)| *file)
        .unwrap_or(MAIN_STORE)
}

/// Reads a store file into its key-value map, treating a missing or unreadable
/// file as empty so a first run and a corrupt file behave the same.
fn read_store(path: &Path) -> Map<String, Value> {
    fs::read_to_string(path)
        .ok()
        .and_then(|source| serde_json::from_str::<Value>(&source).ok())
        .and_then(|value| match value {
            Value::Object(map) => Some(map),
            _ => None,
        })
        .unwrap_or_default()
}

/// Writes a store file atomically, so an interrupted migration cannot leave a
/// half-written store behind.
fn write_store(path: &Path, map: &Map<String, Value>) -> Result<(), String> {
    let contents = serde_json::to_string(map)
        .map_err(|e| format!("Failed to serialize {}: {}", path.display(), e))?;

    let parent = path
        .parent()
        .ok_or_else(|| format!("{} has no parent directory", path.display()))?;
    let temp = parent.join(format!(
        ".{}.tmp",
        path.file_name().and_then(|n| n.to_str()).unwrap_or("store")
    ));

    let result = (|| -> Result<(), String> {
        let mut file = fs::File::create(&temp)
            .map_err(|e| format!("Failed to create {}: {}", temp.display(), e))?;
        file.write_all(contents.as_bytes())
            .map_err(|e| format!("Failed to write {}: {}", temp.display(), e))?;
        file.sync_all()
            .map_err(|e| format!("Failed to flush {}: {}", temp.display(), e))?;
        drop(file);

        restrict_file(&temp);

        fs::rename(&temp, path).map_err(|e| format!("Failed to place {}: {}", path.display(), e))
    })();

    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result
}

/// Moves every relocated key out of the main store and into its own file.
///
/// Runs on every launch and is a cheap no-op once there is nothing left to
/// move. The new files are written before the main store is rewritten, so an
/// interruption leaves the keys still in the main store and the next launch
/// simply redoes the same move.
///
/// @param dir - The app data directory holding the store files
/// @returns How many keys were relocated
pub fn migrate_store_split(dir: &Path) -> Result<u32, String> {
    let main_path = dir.join(MAIN_STORE);
    if !main_path.exists() {
        return Ok(0);
    }

    let mut main = read_store(&main_path);
    let mut pending: Vec<(PathBuf, Map<String, Value>)> = Vec::new();
    let mut moved = 0u32;

    for file in ALL_STORES.iter().filter(|name| **name != MAIN_STORE) {
        let target_path = dir.join(file);
        let mut target = read_store(&target_path);
        let mut changed = false;

        for (key, _) in RELOCATED_KEYS.iter().filter(|(_, owner)| owner == file) {
            if let Some(value) = main.remove(*key) {
                target.insert((*key).to_string(), value);
                changed = true;
                moved += 1;
            }
        }

        if changed {
            pending.push((target_path, target));
        }
    }

    if moved == 0 {
        return Ok(0);
    }

    for (path, map) in &pending {
        write_store(path, map)?;
    }

    write_store(&main_path, &main)?;

    Ok(moved)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn write_json(dir: &Path, name: &str, value: Value) {
        fs::write(dir.join(name), serde_json::to_string(&value).unwrap()).unwrap();
    }

    fn read_json(dir: &Path, name: &str) -> Value {
        serde_json::from_str(&fs::read_to_string(dir.join(name)).unwrap()).unwrap()
    }

    #[test]
    fn relocated_keys_route_to_their_own_files() {
        assert_eq!(store_file_for("requestHistory"), HISTORY_STORE);
        assert_eq!(store_file_for("workspace-tabs"), TABS_STORE);
        assert_eq!(store_file_for("active-tab-id"), TABS_STORE);
        assert_eq!(store_file_for("cookieJar"), COOKIES_STORE);
        assert_eq!(store_file_for("graphqlSchemaCache"), GRAPHQL_CACHE_STORE);
    }

    #[test]
    fn every_other_key_stays_in_the_main_store() {
        for key in [
            "settings",
            "environments",
            "collectionIndex",
            "linkedCollections",
            "proxySettings",
            "persistedScripts",
            "theme",
            "accent",
            "sidebarWidth",
            "someEndpointScripts",
        ] {
            assert_eq!(store_file_for(key), MAIN_STORE, "key {} moved", key);
        }
    }

    #[test]
    fn migration_moves_each_key_to_its_file_and_strips_it_from_main() {
        let temp = TempDir::new().unwrap();
        write_json(
            temp.path(),
            MAIN_STORE,
            serde_json::json!({
                "requestHistory": [{"id": "h1"}],
                "workspace-tabs": [{"id": "t1"}],
                "active-tab-id": "t1",
                "cookieJar": [{"name": "sid"}],
                "graphqlSchemaCache": {"https://api": {}},
                "settings": {"timeout": 30000},
                "collectionIndex": {"c1": "/tmp/c1"}
            }),
        );

        let moved = migrate_store_split(temp.path()).unwrap();

        assert_eq!(moved, 5);

        let main = read_json(temp.path(), MAIN_STORE);
        assert_eq!(main["settings"]["timeout"], 30000);
        assert_eq!(main["collectionIndex"]["c1"], "/tmp/c1");
        assert!(main.get("requestHistory").is_none());
        assert!(main.get("workspace-tabs").is_none());
        assert!(main.get("active-tab-id").is_none());
        assert!(main.get("cookieJar").is_none());
        assert!(main.get("graphqlSchemaCache").is_none());

        assert_eq!(
            read_json(temp.path(), HISTORY_STORE)["requestHistory"][0]["id"],
            "h1"
        );
        let tabs = read_json(temp.path(), TABS_STORE);
        assert_eq!(tabs["workspace-tabs"][0]["id"], "t1");
        assert_eq!(tabs["active-tab-id"], "t1");
        assert_eq!(
            read_json(temp.path(), COOKIES_STORE)["cookieJar"][0]["name"],
            "sid"
        );
        assert!(read_json(temp.path(), GRAPHQL_CACHE_STORE)["graphqlSchemaCache"].is_object());
    }

    #[test]
    fn migration_is_idempotent() {
        let temp = TempDir::new().unwrap();
        write_json(
            temp.path(),
            MAIN_STORE,
            serde_json::json!({ "requestHistory": [{"id": "h1"}], "settings": {} }),
        );

        assert_eq!(migrate_store_split(temp.path()).unwrap(), 1);
        assert_eq!(migrate_store_split(temp.path()).unwrap(), 0);

        assert_eq!(
            read_json(temp.path(), HISTORY_STORE)["requestHistory"][0]["id"],
            "h1"
        );
    }

    #[test]
    fn migration_leaves_an_already_split_store_untouched() {
        let temp = TempDir::new().unwrap();
        write_json(
            temp.path(),
            MAIN_STORE,
            serde_json::json!({ "settings": {} }),
        );

        assert_eq!(migrate_store_split(temp.path()).unwrap(), 0);

        assert!(!temp.path().join(HISTORY_STORE).exists());
    }

    #[test]
    fn migration_without_a_main_store_is_a_no_op() {
        let temp = TempDir::new().unwrap();

        assert_eq!(migrate_store_split(temp.path()).unwrap(), 0);
    }

    #[test]
    fn migration_preserves_keys_already_in_a_target_file() {
        let temp = TempDir::new().unwrap();
        write_json(
            temp.path(),
            MAIN_STORE,
            serde_json::json!({ "active-tab-id": "t2" }),
        );
        write_json(
            temp.path(),
            TABS_STORE,
            serde_json::json!({ "workspace-tabs": [{"id": "kept"}] }),
        );

        migrate_store_split(temp.path()).unwrap();

        let tabs = read_json(temp.path(), TABS_STORE);
        assert_eq!(tabs["workspace-tabs"][0]["id"], "kept");
        assert_eq!(tabs["active-tab-id"], "t2");
    }

    #[test]
    fn migration_treats_a_corrupt_main_store_as_empty() {
        let temp = TempDir::new().unwrap();
        fs::write(temp.path().join(MAIN_STORE), "{not json").unwrap();

        assert_eq!(migrate_store_split(temp.path()).unwrap(), 0);
    }
}
