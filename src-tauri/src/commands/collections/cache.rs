//! Caching of parsed collection directories.
//!
//! Reading a collection means parsing every request file in it, and the IPC
//! surface does that on nearly every call — a single debounced save from the
//! request editor used to re-parse the whole tree several times over.
//!
//! The directory is the source of truth and is meant to be edited outside the
//! app (a `git checkout`, a merge, a hand-edited file), so a cache entry is
//! only served when a fingerprint of the directory still matches: the size and
//! mtime of every file the parse would read. That trades a `stat` per file for
//! a parse per file, and leaves external edits visible immediately.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::UNIX_EPOCH;

use super::read::{read_collection_dir, LoadedCollection};

/// How many collections stay resident, mirroring the frontend repository's own
/// bound so a user with many collections cannot grow this without limit.
const MAX_ENTRIES: usize = 20;

/// Size and mtime of every file under a collection directory, sorted by path.
///
/// A plain file list is what makes an added or removed request visible: an
/// mtime check alone would miss both.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub(crate) struct Fingerprint(Vec<(PathBuf, u64, u128)>);

/// Fingerprints a collection directory.
///
/// Mirrors the reader's own traversal rules — dot-directories like `.git` and
/// symlinks are skipped — so the fingerprint covers exactly the files a parse
/// would consume and nothing else.
///
/// @param dir - The collection directory
/// @returns The fingerprint, or an error if the directory cannot be walked
pub(crate) fn fingerprint(dir: &Path) -> Result<Fingerprint, String> {
    let mut files = Vec::new();
    collect(dir, dir, &mut files)?;
    files.sort();
    Ok(Fingerprint(files))
}

fn collect(root: &Path, dir: &Path, out: &mut Vec<(PathBuf, u64, u128)>) -> Result<(), String> {
    let entries =
        fs::read_dir(dir).map_err(|e| format!("Failed to read {}: {}", dir.display(), e))?;

    for entry in entries {
        let path = entry
            .map_err(|e| format!("Failed to read dir entry: {}", e))?
            .path();

        let name = match path.file_name().and_then(|n| n.to_str()) {
            Some(name) => name.to_string(),
            None => continue,
        };

        if name.starts_with('.') {
            continue;
        }

        let meta = match fs::symlink_metadata(&path) {
            Ok(meta) => meta,
            Err(_) => continue,
        };

        if meta.is_symlink() {
            continue;
        }

        if meta.is_dir() {
            collect(root, &path, out)?;
            continue;
        }

        let mtime = meta
            .modified()
            .ok()
            .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
            .map(|delta| delta.as_nanos())
            .unwrap_or(0);

        let relative = path.strip_prefix(root).unwrap_or(&path).to_path_buf();
        out.push((relative, meta.len(), mtime));
    }

    Ok(())
}

struct Entry {
    dir: PathBuf,
    fingerprint: Fingerprint,
    collection: LoadedCollection,
}

/// Parsed collections, keyed by directory.
///
/// Every method takes `&self` rather than reaching for the process-wide
/// instance, so a test can drive its own cache in isolation.
#[derive(Default)]
pub struct CollectionCache {
    entries: Mutex<Vec<Entry>>,
}

impl CollectionCache {
    /// Returns the cached parse when the directory is unchanged.
    pub(crate) fn get(&self, dir: &Path, fingerprint: &Fingerprint) -> Option<LoadedCollection> {
        let mut entries = self.entries.lock().ok()?;
        let index = entries.iter().position(|entry| entry.dir == dir)?;

        if &entries[index].fingerprint != fingerprint {
            entries.remove(index);
            return None;
        }

        let entry = entries.remove(index);
        let collection = entry.collection.clone();
        entries.push(entry);
        Some(collection)
    }

    /// Stores a parse against the fingerprint it was read at.
    pub(crate) fn put(&self, dir: &Path, fingerprint: Fingerprint, collection: LoadedCollection) {
        let Ok(mut entries) = self.entries.lock() else {
            return;
        };

        if let Some(index) = entries.iter().position(|entry| entry.dir == dir) {
            entries.remove(index);
        }

        while entries.len() >= MAX_ENTRIES {
            entries.remove(0);
        }

        entries.push(Entry {
            dir: dir.to_path_buf(),
            fingerprint,
            collection,
        });
    }

    /// Drops a directory, for a collection that was deleted.
    pub(crate) fn remove(&self, dir: &Path) {
        if let Ok(mut entries) = self.entries.lock() {
            entries.retain(|entry| entry.dir != dir);
        }
    }

    /// Re-reads a directory's fingerprint and stores `collection` against it.
    ///
    /// Used right after a write: the writer leaves its `LoadedCollection`
    /// mirroring what it put on disk, so a save can leave the cache warm rather
    /// than cold.
    pub(crate) fn refresh(&self, dir: &Path, collection: &LoadedCollection) {
        if let Ok(fingerprint) = fingerprint(dir) {
            self.put(dir, fingerprint, collection.clone());
        }
    }

    #[cfg(test)]
    fn len(&self) -> usize {
        self.entries
            .lock()
            .map(|entries| entries.len())
            .unwrap_or(0)
    }
}

/// Reads a v2 collection directory, serving an unchanged one from `cache`.
///
/// @param cache - The parsed-collection cache
/// @param dir - The collection directory
/// @returns The collection in memory
pub(crate) fn read_collection_dir_cached(
    cache: &CollectionCache,
    dir: &Path,
) -> Result<LoadedCollection, String> {
    let Ok(fingerprint) = fingerprint(dir) else {
        return read_collection_dir(dir);
    };

    if let Some(hit) = cache.get(dir, &fingerprint) {
        return Ok(hit);
    }

    let loaded = read_collection_dir(dir)?;
    cache.put(dir, fingerprint, loaded.clone());
    Ok(loaded)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::thread::sleep;
    use std::time::Duration;
    use tempfile::TempDir;

    fn seed(dir: &Path) {
        fs::write(
            dir.join("collection.yaml"),
            "version: 2\nid: c1\nname: Demo\n",
        )
        .unwrap();
        fs::write(
            dir.join("get-users.yaml"),
            "id: req_1\nname: Get users\nseq: 10\n",
        )
        .unwrap();
    }

    fn touch(path: &Path, contents: &str) {
        sleep(Duration::from_millis(10));
        fs::write(path, contents).unwrap();
    }

    #[test]
    fn a_second_read_of_an_untouched_directory_is_a_hit() {
        let temp = TempDir::new().unwrap();
        seed(temp.path());
        let cache = CollectionCache::default();

        let first = read_collection_dir_cached(&cache, temp.path()).unwrap();
        let second = read_collection_dir_cached(&cache, temp.path()).unwrap();

        assert_eq!(first.meta.id, second.meta.id);
        assert_eq!(first.root.requests.len(), second.root.requests.len());
        assert_eq!(cache.len(), 1);
        assert!(cache
            .get(temp.path(), &fingerprint(temp.path()).unwrap())
            .is_some());
    }

    #[test]
    fn editing_a_request_file_invalidates_the_entry() {
        let temp = TempDir::new().unwrap();
        seed(temp.path());
        let cache = CollectionCache::default();

        read_collection_dir_cached(&cache, temp.path()).unwrap();
        touch(
            &temp.path().join("get-users.yaml"),
            "id: req_1\nname: Renamed\nseq: 10\n",
        );

        let after = read_collection_dir_cached(&cache, temp.path()).unwrap();

        assert_eq!(after.root.requests[0].doc.name, "Renamed");
    }

    #[test]
    fn adding_a_request_file_invalidates_the_entry() {
        let temp = TempDir::new().unwrap();
        seed(temp.path());
        let cache = CollectionCache::default();

        read_collection_dir_cached(&cache, temp.path()).unwrap();
        touch(
            &temp.path().join("create-user.yaml"),
            "id: req_2\nname: Create user\nseq: 20\n",
        );

        let after = read_collection_dir_cached(&cache, temp.path()).unwrap();

        assert_eq!(after.root.requests.len(), 2);
    }

    #[test]
    fn removing_a_request_file_invalidates_the_entry() {
        let temp = TempDir::new().unwrap();
        seed(temp.path());
        let cache = CollectionCache::default();

        read_collection_dir_cached(&cache, temp.path()).unwrap();
        fs::remove_file(temp.path().join("get-users.yaml")).unwrap();

        let after = read_collection_dir_cached(&cache, temp.path()).unwrap();

        assert!(after.root.requests.is_empty());
    }

    #[test]
    fn a_dot_directory_does_not_affect_the_fingerprint() {
        let temp = TempDir::new().unwrap();
        seed(temp.path());
        let before = fingerprint(temp.path()).unwrap();

        fs::create_dir(temp.path().join(".git")).unwrap();
        fs::write(temp.path().join(".git").join("HEAD"), "ref: main").unwrap();

        assert_eq!(fingerprint(temp.path()).unwrap(), before);
    }

    #[test]
    fn refresh_leaves_a_warm_entry() {
        let temp = TempDir::new().unwrap();
        seed(temp.path());
        let cache = CollectionCache::default();

        let loaded = read_collection_dir(temp.path()).unwrap();
        cache.refresh(temp.path(), &loaded);

        assert!(cache
            .get(temp.path(), &fingerprint(temp.path()).unwrap())
            .is_some());
    }

    #[test]
    fn remove_drops_the_entry() {
        let temp = TempDir::new().unwrap();
        seed(temp.path());
        let cache = CollectionCache::default();

        read_collection_dir_cached(&cache, temp.path()).unwrap();
        cache.remove(temp.path());

        assert_eq!(cache.len(), 0);
    }

    #[test]
    fn the_cache_evicts_past_its_bound() {
        let cache = CollectionCache::default();
        let mut dirs = Vec::new();

        for index in 0..(MAX_ENTRIES + 5) {
            let temp = TempDir::new().unwrap();
            seed(temp.path());
            read_collection_dir_cached(&cache, temp.path()).unwrap();
            let _ = index;
            dirs.push(temp);
        }

        assert_eq!(cache.len(), MAX_ENTRIES);
    }
}
