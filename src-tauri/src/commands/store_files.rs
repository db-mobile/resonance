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
use std::path::Path;

use super::fs_secure::restrict_file;

/// Everything not claimed by one of the files below.
pub const MAIN_STORE: &str = "resonance-store.json";

pub const HISTORY_STORE: &str = "resonance-history.json";
pub const TABS_STORE: &str = "resonance-tabs.json";
pub const COOKIES_STORE: &str = "resonance-cookies.json";
pub const GRAPHQL_CACHE_STORE: &str = "resonance-graphql-cache.json";
pub const RUNNER_HISTORY_STORE: &str = "resonance-runner-history.json";

/// Keys that live outside [`MAIN_STORE`], paired with the file that holds them.
///
/// These are all written from JS only, and each is either large or written
/// often enough that dragging it along on unrelated saves is what made the
/// single-file store expensive.
const RELOCATED_KEYS: [(&str, &str); 6] = [
    ("requestHistory", HISTORY_STORE),
    ("workspace-tabs", TABS_STORE),
    ("active-tab-id", TABS_STORE),
    ("cookieJar", COOKIES_STORE),
    ("graphqlSchemaCache", GRAPHQL_CACHE_STORE),
    ("runnerRunHistory", RUNNER_HISTORY_STORE),
];

/// Every store file the app owns, for startup permission tightening.
pub const ALL_STORES: [&str; 6] = [
    MAIN_STORE,
    HISTORY_STORE,
    TABS_STORE,
    COOKIES_STORE,
    GRAPHQL_CACHE_STORE,
    RUNNER_HISTORY_STORE,
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
pub(crate) fn read_store(path: &Path) -> Map<String, Value> {
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
pub(crate) fn write_store(path: &Path, map: &Map<String, Value>) -> Result<(), String> {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn relocated_keys_route_to_their_own_files() {
        assert_eq!(store_file_for("requestHistory"), HISTORY_STORE);
        assert_eq!(store_file_for("workspace-tabs"), TABS_STORE);
        assert_eq!(store_file_for("active-tab-id"), TABS_STORE);
        assert_eq!(store_file_for("cookieJar"), COOKIES_STORE);
        assert_eq!(store_file_for("graphqlSchemaCache"), GRAPHQL_CACHE_STORE);
        assert_eq!(store_file_for("runnerRunHistory"), RUNNER_HISTORY_STORE);
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
            "collectionRunners",
            "theme",
            "accent",
            "sidebarWidth",
            "someEndpointScripts",
        ] {
            assert_eq!(store_file_for(key), MAIN_STORE, "key {} moved", key);
        }
    }
}
