use resonance_collections::{read::read_collection_dir, snapshot};
use serde_json::json;
use std::{collections::HashMap, fs};
use tempfile::TempDir;

#[test]
fn an_unreadable_sidecar_directory_does_not_make_the_collection_missing() {
    let dir = TempDir::new().unwrap();
    fs::write(
        dir.path().join("collection.json"),
        json!({"id":"c", "name":"C", "endpoints":[{"id":"e"}]}).to_string(),
    )
    .unwrap();
    // A file where the directory should be reproduces a sidecar read error
    // independently of the current user's filesystem privileges.
    fs::write(dir.path().join("requests"), "not a directory").unwrap();
    let snapshot = snapshot::read_v1("c", dir.path(), &["e".into()], &HashMap::new()).unwrap();
    assert!(snapshot.collection.is_some());
    assert_eq!(snapshot.targets[0].endpoint.as_ref().unwrap()["id"], "e");
    assert!(snapshot.targets[0].scripts.test_script.is_empty());
}

#[test]
fn a_new_capture_revalidates_disk_while_the_previous_snapshot_stays_owned() {
    use resonance_collections::cache::{CollectionCache, read_collection_dir_cached};
    let dir = TempDir::new().unwrap();
    fs::write(
        dir.path().join("collection.yaml"),
        "resonanceFormat: 2\nid: c\nname: C\n",
    )
    .unwrap();
    let request = dir.path().join("request.yaml");
    fs::write(
        &request,
        "resonanceFormat: 2\nid: e\nname: E\npath: /before\n",
    )
    .unwrap();
    let cache = CollectionCache::default();
    let capture = || {
        snapshot::from_loaded(
            "c",
            &read_collection_dir_cached(&cache, dir.path()).unwrap(),
            &["e".into()],
            &HashMap::new(),
        )
    };
    let before = capture();
    fs::write(
        &request,
        "resonanceFormat: 2\nid: e\nname: E\npath: /external-edit\n",
    )
    .unwrap();
    let after = capture();
    assert_eq!(
        before.targets[0].endpoint.as_ref().unwrap()["path"],
        "/before"
    );
    assert_eq!(
        after.targets[0].endpoint.as_ref().unwrap()["path"],
        "/external-edit"
    );
}

#[test]
fn batch_loads_each_collection_once_and_deduplicates_references() {
    let refs: Vec<_> = (0..100)
        .map(|i| snapshot::TargetRef {
            collection_id: "c".into(),
            endpoint_id: format!("e{i}"),
        })
        .chain([
            snapshot::TargetRef {
                collection_id: "c".into(),
                endpoint_id: "e0".into(),
            },
            snapshot::TargetRef {
                collection_id: "other".into(),
                endpoint_id: "e0".into(),
            },
        ])
        .collect();
    let mut loads = Vec::new();
    let result = snapshot::capture_collections(&refs, |id, ids| {
        loads.push(id.to_string());
        snapshot::CollectionSnapshot::missing(id, ids)
    });
    assert_eq!(loads, ["c", "other"]);
    assert_eq!(result[0].targets.len(), 100);
    assert_eq!(result[1].targets.len(), 1);
    assert!(result[0].collection.is_none());
}

#[test]
fn snapshot_selects_requests_with_their_folder_auth_and_live_data() {
    let dir = TempDir::new().unwrap();
    fs::create_dir_all(dir.path().join("outer/inner")).unwrap();
    for (name, content) in [
        (
            "collection.yaml",
            "resonanceFormat: 2\nid: c\nname: C\nbaseUrl: https://example.test\nauth: {type: basic, config: {username: user}}\n",
        ),
        (
            "variables.yaml",
            "- {key: token, value: '', secret: true}\n",
        ),
        (
            "outer/_folder.yaml",
            "id: outer\nname: Outer\nauth: {type: bearer, config: {token: outer}}\n",
        ),
        ("outer/inner/_folder.yaml", "id: inner\nname: Inner\n"),
        (
            "outer/inner/request.yaml",
            "resonanceFormat: 2\nid: e\nname: E\nmethod: POST\nurl: https://example.test/items\ntags: [smoke]\nbody: {mode: json, content: '{\"a\":1}'}\nscripts: {test: 'expect(1)'}\n",
        ),
        ("other.yaml", "resonanceFormat: 2\nid: other\nname: Other\n"),
    ] {
        fs::write(dir.path().join(name), content).unwrap();
    }
    let loaded = read_collection_dir(dir.path()).unwrap();
    let result = snapshot::from_loaded(
        "c",
        &loaded,
        &["e".into(), "missing".into()],
        &HashMap::new(),
    );
    let value = serde_json::to_value(result).unwrap();
    assert_eq!(
        value["collection"],
        json!({"id":"c", "baseUrl":"https://example.test", "defaultHeaders":{}})
    );
    assert_eq!(value["variables"][0]["secret"], true);
    assert_eq!(value["targets"].as_array().unwrap().len(), 2);
    let target = &value["targets"][0];
    assert_eq!(target["endpoint"]["tags"], json!(["smoke"]));
    assert_eq!(target["persisted"]["modifiedBody"], "{\"a\":1}");
    assert_eq!(target["scripts"]["testScript"], "expect(1)");
    assert!(target["persisted"]["scripts"].is_null());
    assert_eq!(
        target["inheritedAuth"][0]["source"],
        json!({"kind":"folder", "folderId":"inner"})
    );
    assert_eq!(target["inheritedAuth"][0]["authConfig"]["type"], "inherit");
    assert_eq!(
        target["inheritedAuth"][1]["authConfig"]["config"]["token"],
        "outer"
    );
    assert_eq!(
        target["inheritedAuth"][2]["source"],
        json!({"kind":"collection"})
    );
    assert!(value["targets"][1]["endpoint"].is_null());
}

#[test]
fn legacy_snapshot_keeps_metadata_sidecar_precedence_and_script_fallback() {
    let dir = TempDir::new().unwrap();
    fs::create_dir(dir.path().join("requests")).unwrap();
    fs::write(dir.path().join("collection.json"), json!({
        "id":"c", "name":"C", "endpoints":[{"id":"e", "headers":{"X-Legacy":"kept"}, "security":{"type":"bearer","config":{"token":"legacy"}}}]
    }).to_string()).unwrap();
    fs::write(
        dir.path().join("requests/e.json"),
        json!({"modifiedBody":"preferred"}).to_string(),
    )
    .unwrap();
    fs::write(
        dir.path().join("requests/name--e.json"),
        json!({"modifiedBody":"wrong"}).to_string(),
    )
    .unwrap();
    let scripts = HashMap::from([(
        "c_e".into(),
        resonance_core::scripts::ScriptData {
            pre_request_script: "pre()".into(),
            test_script: "test()".into(),
        },
    )]);
    let result = snapshot::read_v1("c", dir.path(), &["e".into()], &scripts).unwrap();
    let value = serde_json::to_value(result).unwrap();
    assert_eq!(
        value["targets"][0]["endpoint"]["headers"]["X-Legacy"],
        "kept"
    );
    assert_eq!(
        value["targets"][0]["persisted"]["modifiedBody"],
        "preferred"
    );
    assert_eq!(value["targets"][0]["scripts"]["preRequestScript"], "pre()");
    assert!(dir.path().join("collection.json").exists());
    assert!(!dir.path().join("collection.yaml").exists());

    fs::write(
        dir.path().join("requests/e.json"),
        json!({"scripts":{"preRequestScript":"", "testScript":""}}).to_string(),
    )
    .unwrap();
    let cleared = snapshot::read_v1("c", dir.path(), &["e".into()], &scripts).unwrap();
    assert!(cleared.targets[0].scripts.pre_request_script.is_empty());

    fs::write(dir.path().join("requests/e.json"), "invalid json").unwrap();
    let broken = snapshot::read_v1("c", dir.path(), &["e".into()], &scripts).unwrap();
    assert!(broken.targets[0].scripts.pre_request_script.is_empty());
}
