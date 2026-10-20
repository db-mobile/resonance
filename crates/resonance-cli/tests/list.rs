mod common;

use common::{Collection, command};

fn collection() -> Collection {
    let collection = Collection::new("Listing");
    collection.request("health.yaml", "r_health", "Health", 10, "/health", 200);
    collection.request("pets/list.yaml", "r_list", "List pets", 20, "/pets", 200);
    collection.write(
        "pets/create.yaml",
        "resonanceFormat: 2\nid: r_create\nname: Create pet\nseq: 30\nmethod: GET\npath: /pets\ntags:\n- smoke\n- Pets\n",
    );
    collection.write(
        "runners/smoke.yaml",
        "resonanceFormat: 2\nid: run_1\nname: Smoke\noptions:\n  stopOnError: true\nrequests:\n  - requestId: r_health\n  - requestId: r_list\n",
    );
    collection
}

#[test]
fn list_prints_requests_in_tree_order_and_runners() {
    let collection = collection();
    let output = command()
        .arg("list")
        .arg(collection.path())
        .output()
        .unwrap();
    assert_eq!(output.status.code(), Some(0));
    let out = String::from_utf8(output.stdout).unwrap();
    assert!(out.starts_with("Listing (col_1)\n"), "{out}");
    assert!(
        out.contains("GET  health.yaml  Health  (r_health)"),
        "{out}"
    );
    assert!(
        out.contains("GET  pets/list.yaml  List pets  (r_list)\n"),
        "{out}"
    );
    assert!(
        out.contains("GET  pets/create.yaml  Create pet  (r_create)  [smoke, Pets]\n"),
        "{out}"
    );
    assert!(out.contains("smoke  Smoke  (run_1)  2 requests"), "{out}");
}

#[test]
fn list_json_is_machine_readable() {
    let collection = collection();
    let output = command()
        .arg("list")
        .arg(collection.path())
        .arg("--json")
        .output()
        .unwrap();
    assert_eq!(output.status.code(), Some(0));
    let value: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(value["collection"]["name"], "Listing");
    assert_eq!(value["requests"][0]["path"], "health.yaml");
    assert_eq!(value["requests"][1]["id"], "r_list");
    assert_eq!(value["requests"][1]["tags"], serde_json::json!([]));
    assert_eq!(
        value["requests"][2]["tags"],
        serde_json::json!(["smoke", "Pets"])
    );
    assert_eq!(value["runners"][0]["file"], "runners/smoke.yaml");
    assert_eq!(value["runners"][0]["requests"], 2);
}

#[test]
fn list_refuses_a_non_collection() {
    let empty = tempfile::TempDir::new().unwrap();
    let output = command().arg("list").arg(empty.path()).output().unwrap();
    assert_eq!(output.status.code(), Some(2));
}
