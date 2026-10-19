//! Reading and writing the `runners/` directory of a v2 collection.
//!
//! One `runners/<slug>.yaml` per saved runner, beside the request tree but
//! never part of it: the reader skips the directory at the collection root and
//! the whole-tree writer never touches it, so only the functions here create,
//! move or remove runner files. A runner references its requests by id and
//! belongs to the collection whose directory holds it; the data file it
//! iterates over is stored relative to that directory when it sits inside.
//!
//! Secrets typed into header overrides are committed as typed, exactly like
//! header rows in request files; a `{{var}}` reference is the supported way to
//! keep a secret out of the file.

use std::fs;
use std::path::{Component, Path, PathBuf};

use super::layout::{RUNNERS_DIR, find_available_path, runner_stem};
use super::link::is_under;
use super::model::{FORMAT_VERSION, FormatProbe, RunnerDoc};
use super::read::{check_version, sort_key};
use super::write::{ensure_dir, relocate, to_yaml, write_if_changed};

/// One runner, paired with the file it came from so a rename moves that file
/// rather than orphaning it.
#[derive(Debug, Clone)]
pub(crate) struct RunnerEntry {
    /// Where this runner was read from; `None` for one never written.
    pub source: Option<PathBuf>,
    pub doc: RunnerDoc,
}

impl RunnerEntry {
    pub fn new(doc: RunnerDoc) -> Self {
        Self { source: None, doc }
    }
}

/// What a read of the directory produced.
#[derive(Debug, Default)]
pub(crate) struct ReadRunners {
    pub entries: Vec<RunnerEntry>,
    /// Ids that were re-minted because a file had none or claimed one already
    /// taken; the caller persists these so the fresh id survives the next read.
    pub reassigned: Vec<(String, String)>,
}

/// Top-level keys only a request document carries.
const REQUEST_KEYS: &[&str] = &["method", "protocol", "path", "url", "body", "grpc", "mqtt"];

/// The directory holding a collection's runner files.
pub(crate) fn runners_dir(dir: &Path) -> PathBuf {
    dir.join(RUNNERS_DIR)
}

/// Mints a runner id that no counter could reproduce on another branch.
pub(crate) fn new_runner_id() -> String {
    format!("runner_{}", uuid::Uuid::new_v4().simple())
}

/// Reads every runner file in a collection.
///
/// A missing directory means no runners. Foreign files are skipped and logged,
/// the same policy as request files; a document from a newer build is fatal.
///
/// @param dir - The collection directory
/// @returns The runners, ordered by `seq`, name, id
pub(crate) fn read_runners(dir: &Path) -> Result<ReadRunners, String> {
    let runners = runners_dir(dir);
    if !runners.is_dir() {
        return Ok(ReadRunners::default());
    }

    let mut read = ReadRunners::default();
    let listing = fs::read_dir(&runners)
        .map_err(|e| format!("Failed to read {}: {}", runners.display(), e))?;

    for entry in listing {
        let path = entry
            .map_err(|e| format!("Failed to read dir entry: {}", e))?
            .path();
        let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        if name.starts_with('.') || name.starts_with('_') {
            continue;
        }
        let is_symlink = fs::symlink_metadata(&path)
            .map(|meta| meta.is_symlink())
            .unwrap_or(false);
        if is_symlink || !path.is_file() || !is_yaml(&path) {
            continue;
        }
        if let Some(doc) = read_runner_file(&path)? {
            read.entries.push(RunnerEntry {
                source: Some(path),
                doc,
            });
        }
    }

    read.entries
        .sort_by_key(|entry| sort_key(entry.doc.seq, &entry.doc.name, &entry.doc.id));

    let mut seen = std::collections::HashSet::new();
    for entry in &mut read.entries {
        if entry.doc.id.is_empty() || !seen.insert(entry.doc.id.clone()) {
            let old = entry.doc.id.clone();
            let fresh = new_runner_id();
            seen.insert(fresh.clone());
            entry.doc.id = fresh.clone();
            read.reassigned.push((old, fresh));
        }
    }

    Ok(read)
}

fn is_yaml(path: &Path) -> bool {
    matches!(
        path.extension().and_then(|e| e.to_str()),
        Some("yaml") | Some("yml")
    )
}

fn read_runner_file(path: &Path) -> Result<Option<RunnerDoc>, String> {
    let source = fs::read_to_string(path)
        .map_err(|e| format!("Failed to read {}: {}", path.display(), e))?;

    if serde_yaml_ng::from_str::<FormatProbe>(&source).is_err() {
        eprintln!("Skipping {}: not a YAML document", path.display());
        return Ok(None);
    }
    check_version(&source, path)?;

    match serde_yaml_ng::from_str::<RunnerDoc>(&source) {
        // A request file that ended up here (a folder the user named
        // `runners`, before the name was reserved) also parses: id and name
        // are all a runner needs. Its request fields give it away.
        Ok(doc) if REQUEST_KEYS.iter().any(|key| doc.extra.contains_key(*key)) => {
            eprintln!("Skipping {}: a request file, not a runner", path.display());
            Ok(None)
        }
        Ok(doc) => Ok(Some(doc)),
        Err(error) => {
            eprintln!("Skipping {}: not a runner file ({})", path.display(), error);
            Ok(None)
        }
    }
}

/// Writes one runner to its file, moving the file first when the name changed.
///
/// @param dir - The collection directory
/// @param entry - The runner, updated in memory; its source is set on return
/// @returns Ok once the file is in place
pub(crate) fn write_runner_entry(dir: &Path, entry: &mut RunnerEntry) -> Result<(), String> {
    let runners = runners_dir(dir);
    ensure_dir(&runners)?;

    let stem = runner_stem(&entry.doc.name);
    let desired = find_available_path(&runners, &stem, "yaml", entry.source.as_deref());
    if let Some(current) = &entry.source {
        relocate(current, &desired)?;
    }
    write_if_changed(&desired, &to_yaml(&entry.doc)?)?;
    entry.source = Some(desired);
    Ok(())
}

/// Writes every runner. An empty list creates no directory.
///
/// @param dir - The collection directory
/// @param runners - The runners to write
/// @returns Ok once every file is in place
#[cfg(test)]
pub(crate) fn write_runners(dir: &Path, runners: &mut [RunnerEntry]) -> Result<(), String> {
    for entry in runners.iter_mut() {
        write_runner_entry(dir, entry)?;
    }
    Ok(())
}

/// Removes a runner's file, and the directory once it holds nothing else.
fn remove_runner_file(dir: &Path, entry: &RunnerEntry) -> Result<(), String> {
    if let Some(path) = &entry.source
        && path.exists()
    {
        fs::remove_file(path).map_err(|e| format!("Failed to remove {}: {}", path.display(), e))?;
    }
    let runners = runners_dir(dir);
    if runners.is_dir()
        && fs::read_dir(&runners)
            .map(|mut listing| listing.next().is_none())
            .unwrap_or(false)
    {
        let _ = fs::remove_dir(&runners);
    }
    Ok(())
}

/// Stores a runner, replacing the one with the same id or adding it.
///
/// Validation happens here rather than in the command so a headless caller
/// gets the same rules: every entry must name a request, and none may point at
/// another collection. An empty id means a new runner.
///
/// @param dir - The collection directory
/// @param runners - The collection's runners, updated in place
/// @param incoming - The runner as the caller sent it
/// @param collection_id - The id of the collection that owns `dir`
/// @returns The runner as written
pub(crate) fn upsert_runner(
    dir: &Path,
    runners: &mut Vec<RunnerEntry>,
    mut incoming: RunnerDoc,
    collection_id: &str,
) -> Result<RunnerDoc, String> {
    for request in &mut incoming.requests {
        if request.request_id.is_empty() {
            return Err(format!(
                "Runner \"{}\" has an entry without a request id",
                incoming.name
            ));
        }
        if let Some(foreign) = request
            .collection_id
            .as_deref()
            .filter(|id| !id.is_empty() && *id != collection_id)
        {
            return Err(format!(
                "Runner \"{}\" references request {} of collection {}; a runner may only use requests of its own collection",
                incoming.name, request.request_id, foreign
            ));
        }
        request.collection_id = None;
        if request
            .post_response_script
            .as_deref()
            .is_some_and(|script| script.trim().is_empty())
        {
            request.post_response_script = None;
        }
    }

    incoming.format = FORMAT_VERSION;
    if incoming.name.trim().is_empty() {
        incoming.name = "Untitled Runner".to_string();
    }
    if incoming.id.is_empty() {
        incoming.id = new_runner_id();
    }
    if let Some(data_file) = &mut incoming.options.data_file {
        data_file.path = portable_data_path(dir, &data_file.path);
        if data_file.name.is_empty() {
            data_file.name = Path::new(&data_file.path)
                .file_name()
                .map(|name| name.to_string_lossy().to_string())
                .unwrap_or_default();
        }
    }
    if incoming.seq == 0 {
        incoming.seq = runners
            .iter()
            .filter(|entry| entry.doc.id != incoming.id)
            .map(|entry| entry.doc.seq)
            .max()
            .unwrap_or(0)
            + 10;
    }

    let index = match runners.iter().position(|entry| entry.doc.id == incoming.id) {
        Some(index) => {
            runners[index].doc = incoming;
            index
        }
        None => {
            runners.push(RunnerEntry::new(incoming));
            runners.len() - 1
        }
    };
    write_runner_entry(dir, &mut runners[index])?;
    Ok(runners[index].doc.clone())
}

/// Deletes a runner and its file.
///
/// @param dir - The collection directory
/// @param runners - The collection's runners, updated in place
/// @param runner_id - The runner to remove
/// @returns True when a runner was removed
pub(crate) fn delete_runner(
    dir: &Path,
    runners: &mut Vec<RunnerEntry>,
    runner_id: &str,
) -> Result<bool, String> {
    let Some(index) = runners.iter().position(|entry| entry.doc.id == runner_id) else {
        return Ok(false);
    };
    let entry = runners.remove(index);
    remove_runner_file(dir, &entry)?;
    Ok(true)
}

/// Resolves a runner's data-file reference to a path that can be read.
///
/// A relative reference is joined onto the collection directory and must stay
/// inside it once resolved, so neither `..` nor a symlink can reach outside
/// the checkout a committed runner came from.
///
/// @param dir - The collection directory
/// @param reference - The path as stored in the runner file
/// @returns The absolute path to read
pub(crate) fn resolve_data_file(dir: &Path, reference: &str) -> Result<PathBuf, String> {
    let referenced = Path::new(reference);
    if referenced.is_absolute() {
        return Ok(referenced.to_path_buf());
    }

    let escapes = referenced.components().any(|component| {
        matches!(
            component,
            Component::ParentDir | Component::RootDir | Component::Prefix(_)
        )
    });
    if escapes {
        return Err(format!(
            "Data file {} must stay inside the collection directory",
            reference
        ));
    }

    let joined = dir.join(referenced);
    let resolved = joined
        .canonicalize()
        .map_err(|e| format!("Cannot read data file {}: {}", joined.display(), e))?;
    let root = dir
        .canonicalize()
        .map_err(|e| format!("Cannot resolve {}: {}", dir.display(), e))?;
    if !is_under(&root, &resolved) {
        return Err(format!(
            "Data file {} must stay inside the collection directory",
            reference
        ));
    }
    Ok(resolved)
}

/// Turns an absolute path inside the collection into the relative form a
/// checkout on another machine can resolve; any other path is kept as-is.
///
/// @param dir - The collection directory
/// @param path - The path as picked or stored
/// @returns The portable reference
pub(crate) fn portable_data_path(dir: &Path, path: &str) -> String {
    let candidate = Path::new(path);
    if !candidate.is_absolute() {
        return path.to_string();
    }
    let root = dir.canonicalize().unwrap_or_else(|_| dir.to_path_buf());
    let resolved = candidate
        .canonicalize()
        .unwrap_or_else(|_| candidate.to_path_buf());
    match resolved.strip_prefix(&root) {
        Ok(relative) if is_under(&root, &resolved) => relative
            .components()
            .map(|component| component.as_os_str().to_string_lossy().to_string())
            .collect::<Vec<_>>()
            .join("/"),
        _ => path.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::collections::layout::COLLECTION_YAML;
    use crate::commands::collections::model::{RunnerDataFile, RunnerRequest};
    use serde_json::Map;
    use tempfile::TempDir;

    fn write(dir: &Path, name: &str, contents: &str) {
        let path = dir.join(name);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(path, contents).unwrap();
    }

    fn minimal_collection(dir: &Path) {
        write(
            dir,
            COLLECTION_YAML,
            "resonanceFormat: 2\nid: c1\nname: Petstore\n",
        );
    }

    fn runner_yaml(id: &str, name: &str) -> String {
        format!(
            "resonanceFormat: 2\nid: {}\nname: {}\nrequests:\n- requestId: req_a\n",
            id, name
        )
    }

    fn entry(id: &str, name: &str) -> RunnerEntry {
        RunnerEntry::new(RunnerDoc::new(id.into(), name.into()))
    }

    fn request(request_id: &str, collection_id: Option<&str>) -> RunnerRequest {
        RunnerRequest {
            collection_id: collection_id.map(String::from),
            request_id: request_id.into(),
            name: String::new(),
            method: None,
            path: None,
            overrides: Default::default(),
            post_response_script: None,
            extra: Map::new(),
        }
    }

    fn files(dir: &Path) -> Vec<String> {
        let mut names: Vec<String> = fs::read_dir(runners_dir(dir))
            .map(|listing| {
                listing
                    .map(|e| e.unwrap().file_name().to_string_lossy().to_string())
                    .collect()
            })
            .unwrap_or_default();
        names.sort();
        names
    }

    #[test]
    fn a_missing_runners_directory_reads_as_no_runners() {
        let temp = TempDir::new().unwrap();
        minimal_collection(temp.path());
        let read = read_runners(temp.path()).unwrap();
        assert!(read.entries.is_empty());
        assert!(read.reassigned.is_empty());
    }

    #[test]
    fn a_written_runner_reads_back_identical() {
        let temp = TempDir::new().unwrap();
        minimal_collection(temp.path());
        let mut doc = RunnerDoc::new("runner_1".into(), "Smoke".into());
        doc.requests.push(request("req_a", None));
        doc.options.delay_ms = 50;
        let mut entries = vec![RunnerEntry::new(doc.clone())];

        write_runners(temp.path(), &mut entries).unwrap();
        assert_eq!(files(temp.path()), vec!["smoke.yaml"]);

        let read = read_runners(temp.path()).unwrap();
        assert_eq!(read.entries.len(), 1);
        assert_eq!(
            to_yaml(&read.entries[0].doc).unwrap(),
            to_yaml(&doc).unwrap()
        );
        assert_eq!(
            read.entries[0].source.as_deref(),
            Some(runners_dir(temp.path()).join("smoke.yaml").as_path())
        );
    }

    #[test]
    fn renaming_a_runner_moves_its_file_and_leaves_no_orphan() {
        let temp = TempDir::new().unwrap();
        minimal_collection(temp.path());
        let mut entries = vec![entry("runner_1", "Smoke")];
        write_runners(temp.path(), &mut entries).unwrap();

        entries[0].doc.name = "Nightly".into();
        write_runners(temp.path(), &mut entries).unwrap();

        assert_eq!(files(temp.path()), vec!["nightly.yaml"]);
    }

    #[test]
    fn two_runners_with_the_same_name_get_distinct_files() {
        let temp = TempDir::new().unwrap();
        minimal_collection(temp.path());
        let mut entries = vec![entry("runner_1", "Smoke"), entry("runner_2", "Smoke")];
        write_runners(temp.path(), &mut entries).unwrap();
        assert_eq!(files(temp.path()), vec!["smoke-2.yaml", "smoke.yaml"]);
    }

    #[test]
    fn re_saving_a_runner_keeps_its_file_name() {
        let temp = TempDir::new().unwrap();
        minimal_collection(temp.path());
        let mut entries = vec![entry("runner_1", "Smoke"), entry("runner_2", "Smoke")];
        write_runners(temp.path(), &mut entries).unwrap();
        let before = fs::read(runners_dir(temp.path()).join("smoke-2.yaml")).unwrap();

        write_runners(temp.path(), &mut entries).unwrap();

        assert_eq!(files(temp.path()), vec!["smoke-2.yaml", "smoke.yaml"]);
        assert_eq!(
            fs::read(runners_dir(temp.path()).join("smoke-2.yaml")).unwrap(),
            before
        );
    }

    #[test]
    fn a_foreign_yaml_file_in_runners_is_skipped() {
        let temp = TempDir::new().unwrap();
        minimal_collection(temp.path());
        write(
            temp.path(),
            "runners/smoke.yaml",
            &runner_yaml("runner_1", "Smoke"),
        );
        write(temp.path(), "runners/notes.yaml", "just: notes\n");
        write(temp.path(), "runners/broken.yaml", ": : not yaml {{\n");

        let read = read_runners(temp.path()).unwrap();
        assert_eq!(read.entries.len(), 1);
        assert_eq!(read.entries[0].doc.id, "runner_1");
    }

    #[test]
    fn a_subdirectory_or_dot_file_in_runners_is_ignored() {
        let temp = TempDir::new().unwrap();
        minimal_collection(temp.path());
        write(
            temp.path(),
            "runners/smoke.yaml",
            &runner_yaml("runner_1", "Smoke"),
        );
        write(
            temp.path(),
            "runners/.hidden.yaml",
            &runner_yaml("runner_2", "Hidden"),
        );
        write(
            temp.path(),
            "runners/nested/deep.yaml",
            &runner_yaml("runner_3", "Deep"),
        );
        write(temp.path(), "runners/README.md", "# runners\n");
        write(
            temp.path(),
            "runners/_folder.yaml",
            "resonanceFormat: 2\nid: f1\nname: Folder\n",
        );
        write(
            temp.path(),
            "runners/ping.yaml",
            "resonanceFormat: 2\nid: r1\nname: Ping\nmethod: GET\n",
        );

        let read = read_runners(temp.path()).unwrap();
        assert_eq!(read.entries.len(), 1);
        assert_eq!(read.entries[0].doc.id, "runner_1");
    }

    #[test]
    fn a_newer_runner_format_is_refused() {
        let temp = TempDir::new().unwrap();
        minimal_collection(temp.path());
        write(
            temp.path(),
            "runners/smoke.yaml",
            "resonanceFormat: 3\nid: runner_1\nname: Smoke\n",
        );
        let error = read_runners(temp.path()).unwrap_err();
        assert!(error.contains("newer version"), "{}", error);
    }

    #[test]
    fn a_duplicate_runner_id_is_reassigned_and_both_survive() {
        let temp = TempDir::new().unwrap();
        minimal_collection(temp.path());
        write(temp.path(), "runners/a.yaml", &runner_yaml("runner_1", "A"));
        write(temp.path(), "runners/b.yaml", &runner_yaml("runner_1", "B"));

        let read = read_runners(temp.path()).unwrap();
        assert_eq!(read.entries.len(), 2);
        assert_eq!(read.reassigned.len(), 1);
        assert_eq!(read.reassigned[0].0, "runner_1");
        assert_ne!(read.entries[0].doc.id, read.entries[1].doc.id);
        assert!(read.entries[1].doc.id.starts_with("runner_"));
    }

    #[test]
    fn a_runner_without_an_id_is_given_one() {
        let temp = TempDir::new().unwrap();
        minimal_collection(temp.path());
        write(
            temp.path(),
            "runners/a.yaml",
            "resonanceFormat: 2\nid: ''\nname: A\n",
        );

        let read = read_runners(temp.path()).unwrap();
        assert!(read.entries[0].doc.id.starts_with("runner_"));
        assert_eq!(read.reassigned[0].0, "");
    }

    #[test]
    fn runners_are_ordered_by_seq_then_name_then_id() {
        let temp = TempDir::new().unwrap();
        minimal_collection(temp.path());
        write(
            temp.path(),
            "runners/z.yaml",
            "resonanceFormat: 2\nid: r_z\nname: Zed\nseq: 10\n",
        );
        write(
            temp.path(),
            "runners/b.yaml",
            "resonanceFormat: 2\nid: r_b\nname: beta\nseq: 20\n",
        );
        write(
            temp.path(),
            "runners/a.yaml",
            "resonanceFormat: 2\nid: r_a\nname: Alpha\nseq: 20\n",
        );

        let ids: Vec<_> = read_runners(temp.path())
            .unwrap()
            .entries
            .iter()
            .map(|e| e.doc.id.clone())
            .collect();
        assert_eq!(ids, vec!["r_z", "r_a", "r_b"]);
    }

    #[test]
    fn an_empty_runner_list_creates_no_directory() {
        let temp = TempDir::new().unwrap();
        minimal_collection(temp.path());
        write_runners(temp.path(), &mut []).unwrap();
        assert!(!runners_dir(temp.path()).exists());
    }

    #[test]
    fn deleting_the_last_runner_removes_the_empty_directory() {
        let temp = TempDir::new().unwrap();
        minimal_collection(temp.path());
        let mut entries = vec![entry("runner_1", "Smoke")];
        write_runners(temp.path(), &mut entries).unwrap();

        assert!(delete_runner(temp.path(), &mut entries, "runner_1").unwrap());
        assert!(entries.is_empty());
        assert!(!runners_dir(temp.path()).exists());
    }

    #[test]
    fn deleting_an_unknown_runner_reports_false() {
        let temp = TempDir::new().unwrap();
        minimal_collection(temp.path());
        let mut entries = vec![entry("runner_1", "Smoke")];
        write_runners(temp.path(), &mut entries).unwrap();

        assert!(!delete_runner(temp.path(), &mut entries, "runner_9").unwrap());
        assert_eq!(files(temp.path()), vec!["smoke.yaml"]);
    }

    #[test]
    fn an_entry_for_another_collection_is_rejected() {
        let temp = TempDir::new().unwrap();
        minimal_collection(temp.path());
        let mut doc = RunnerDoc::new(String::new(), "Smoke".into());
        doc.requests.push(request("req_a", Some("c2")));

        let error = upsert_runner(temp.path(), &mut Vec::new(), doc, "c1").unwrap_err();
        assert!(error.contains("own collection"), "{}", error);
        assert!(!runners_dir(temp.path()).exists());
    }

    #[test]
    fn an_entry_without_a_request_id_is_rejected() {
        let temp = TempDir::new().unwrap();
        minimal_collection(temp.path());
        let mut doc = RunnerDoc::new(String::new(), "Smoke".into());
        doc.requests.push(request("", None));

        let error = upsert_runner(temp.path(), &mut Vec::new(), doc, "c1").unwrap_err();
        assert!(error.contains("without a request id"), "{}", error);
    }

    #[test]
    fn a_stale_request_id_is_stored_rather_than_rejected() {
        let temp = TempDir::new().unwrap();
        minimal_collection(temp.path());
        let mut doc = RunnerDoc::new(String::new(), "Smoke".into());
        doc.requests.push(request("req_gone", Some("c1")));

        let stored = upsert_runner(temp.path(), &mut Vec::new(), doc, "c1").unwrap();
        assert_eq!(stored.requests[0].request_id, "req_gone");
        assert!(stored.id.starts_with("runner_"));
        assert_eq!(stored.seq, 10);
        assert!(
            !fs::read_to_string(runners_dir(temp.path()).join("smoke.yaml"))
                .unwrap()
                .contains("collectionId")
        );
    }

    #[test]
    fn a_new_runner_is_numbered_above_the_existing_ones_and_an_update_keeps_its_file() {
        let temp = TempDir::new().unwrap();
        minimal_collection(temp.path());
        let mut runners = Vec::new();
        let first = upsert_runner(
            temp.path(),
            &mut runners,
            RunnerDoc::new(String::new(), "A".into()),
            "c1",
        )
        .unwrap();
        let second = upsert_runner(
            temp.path(),
            &mut runners,
            RunnerDoc::new(String::new(), "B".into()),
            "c1",
        )
        .unwrap();
        assert_eq!((first.seq, second.seq), (10, 20));

        let mut renamed = RunnerDoc::new(first.id.clone(), "A2".into());
        renamed.seq = first.seq;
        let updated = upsert_runner(temp.path(), &mut runners, renamed, "c1").unwrap();
        assert_eq!(updated.id, first.id);
        assert_eq!(runners.len(), 2);
        assert_eq!(files(temp.path()), vec!["a2.yaml", "b.yaml"]);
    }

    #[test]
    fn an_empty_post_response_script_and_name_are_normalised() {
        let temp = TempDir::new().unwrap();
        minimal_collection(temp.path());
        let mut doc = RunnerDoc::new(String::new(), "  ".into());
        let mut req = request("req_a", None);
        req.post_response_script = Some("  \n".into());
        doc.requests.push(req);

        let stored = upsert_runner(temp.path(), &mut Vec::new(), doc, "c1").unwrap();
        assert_eq!(stored.name, "Untitled Runner");
        assert!(stored.requests[0].post_response_script.is_none());
        assert_eq!(files(temp.path()), vec!["untitled-runner.yaml"]);
    }

    #[test]
    fn a_data_file_inside_the_collection_is_stored_relative() {
        let temp = TempDir::new().unwrap();
        minimal_collection(temp.path());
        write(temp.path(), "data/users.csv", "id\n1\n");
        let mut doc = RunnerDoc::new(String::new(), "Smoke".into());
        doc.options.data_file = Some(RunnerDataFile {
            path: temp
                .path()
                .join("data")
                .join("users.csv")
                .to_string_lossy()
                .to_string(),
            name: String::new(),
        });

        let stored = upsert_runner(temp.path(), &mut Vec::new(), doc, "c1").unwrap();
        let data_file = stored.options.data_file.unwrap();
        assert_eq!(data_file.path, "data/users.csv");
        assert_eq!(data_file.name, "users.csv");
    }

    #[test]
    fn a_data_file_outside_the_collection_stays_absolute() {
        let temp = TempDir::new().unwrap();
        let collection = temp.path().join("petstore");
        fs::create_dir(&collection).unwrap();
        minimal_collection(&collection);
        let outside = temp.path().join("petstore-data").join("users.csv");
        fs::create_dir_all(outside.parent().unwrap()).unwrap();
        fs::write(&outside, "id\n1\n").unwrap();
        let mut doc = RunnerDoc::new(String::new(), "Smoke".into());
        doc.options.data_file = Some(RunnerDataFile {
            path: outside.to_string_lossy().to_string(),
            name: "users.csv".into(),
        });

        let stored = upsert_runner(&collection, &mut Vec::new(), doc, "c1").unwrap();
        assert_eq!(
            stored.options.data_file.unwrap().path,
            outside.to_string_lossy().to_string()
        );
    }

    #[test]
    fn a_relative_data_path_resolves_against_the_collection_dir() {
        let temp = TempDir::new().unwrap();
        minimal_collection(temp.path());
        write(temp.path(), "data/users.csv", "id\n1\n");

        let resolved = resolve_data_file(temp.path(), "data/users.csv").unwrap();
        assert_eq!(
            resolved,
            temp.path().join("data/users.csv").canonicalize().unwrap()
        );
        assert!(resolve_data_file(temp.path(), "data/missing.csv").is_err());
    }

    #[test]
    fn a_relative_data_path_may_not_escape_the_collection() {
        let temp = TempDir::new().unwrap();
        let collection = temp.path().join("petstore");
        fs::create_dir(&collection).unwrap();
        minimal_collection(&collection);
        fs::write(temp.path().join("secrets.csv"), "x\n").unwrap();
        write(&collection, "data/users.csv", "id\n1\n");

        for reference in ["../secrets.csv", "data/../../secrets.csv", "/etc/hostname"] {
            let result = resolve_data_file(&collection, reference);
            if Path::new(reference).is_absolute() {
                assert!(result.is_ok(), "absolute paths are the user's own choice");
            } else {
                assert!(result.is_err(), "{} resolved", reference);
            }
        }
    }

    #[cfg(unix)]
    #[test]
    fn a_symlinked_data_path_may_not_escape_the_collection() {
        let temp = TempDir::new().unwrap();
        let collection = temp.path().join("petstore");
        fs::create_dir(&collection).unwrap();
        minimal_collection(&collection);
        fs::write(temp.path().join("secrets.csv"), "x\n").unwrap();
        fs::create_dir(collection.join("data")).unwrap();
        std::os::unix::fs::symlink(
            temp.path().join("secrets.csv"),
            collection.join("data/link.csv"),
        )
        .unwrap();

        assert!(resolve_data_file(&collection, "data/link.csv").is_err());
    }
}
