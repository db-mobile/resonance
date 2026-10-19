#![cfg(unix)]
mod common;

use common::{Collection, Server};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

#[tokio::test(flavor = "multi_thread")]
async fn sigint_stops_the_run_writes_reports_and_exits_130() {
    let server = Server::start().await;
    let collection = Collection::new("Slow");
    collection.request("slow.yaml", "r_slow", "Slow", 1, "/slow", 200);
    collection.request("after.yaml", "r_after", "After", 2, "/after", 200);
    let json = collection.dir.path().join("run.json");
    let child = common::command()
        .arg("run")
        .arg(collection.path())
        .arg("--var")
        .arg(format!("baseUrl={}", server.base_url()))
        .arg("--json")
        .arg(&json)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    std::thread::sleep(Duration::from_millis(1500));
    let status = Command::new("kill")
        .args(["-INT", &child.id().to_string()])
        .status()
        .unwrap();
    assert!(status.success());
    let started = Instant::now();
    let output = child.wait_with_output().unwrap();
    assert!(
        started.elapsed() < Duration::from_secs(8),
        "the run did not stop on SIGINT"
    );
    assert_eq!(
        output.status.code(),
        Some(130),
        "{}",
        String::from_utf8_lossy(&output.stdout)
    );
    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(!stdout.contains("GET /after"), "{stdout}");
    let report: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(&json).unwrap()).unwrap();
    assert_eq!(report["terminationReason"], "stoppedByUser");
}
