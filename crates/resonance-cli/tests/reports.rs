mod common;

use common::{Collection, Server, run};
use regex::Regex;

fn collection() -> Collection {
    let collection = Collection::new("Reports");
    collection.request("ok.yaml", "r_ok", "Ok", 1, "/ok", 200);
    collection.request("bad.yaml", "r_bad", "Bad", 2, "/status/500", 200);
    collection
}

#[tokio::test(flavor = "multi_thread")]
async fn junit_and_json_reports_describe_the_run() {
    let server = Server::start().await;
    let collection = collection();
    let out_dir = tempfile::TempDir::new().unwrap();
    let junit = out_dir.path().join("reports/junit.xml");
    let json = out_dir.path().join("reports/run.json");
    let cli = run(
        &collection,
        &server,
        &[
            "--junit",
            junit.to_str().unwrap(),
            "--json",
            json.to_str().unwrap(),
        ],
    );
    assert_eq!(cli.code(), 1, "{}", cli.stdout());
    assert!(cli.stdout().contains("Report: junit →"), "{}", cli.stdout());
    assert!(cli.stdout().contains("Report: json →"), "{}", cli.stdout());

    let xml = std::fs::read_to_string(&junit).unwrap();
    assert!(
        Regex::new(r#"<testsuites name="Reports" tests="2" failures="1""#)
            .unwrap()
            .is_match(&xml),
        "{xml}"
    );
    assert!(xml.contains(r#"<testcase name="status is 200""#), "{xml}");
    assert!(xml.contains("<failure"), "{xml}");

    let report: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(&json).unwrap()).unwrap();
    assert_eq!(report["runnerName"], "Reports");
    assert_eq!(report["summary"]["passed"], 1);
    assert_eq!(report["summary"]["failed"], 1);
    assert_eq!(report["terminationReason"], "completed");
    assert_eq!(report["requests"][0]["path"], "/ok");
    assert_eq!(report["requests"][1]["status"], "error");
    assert_eq!(report["requests"][1]["statusCode"], 500);
    assert_eq!(report["requests"][1]["tests"][0]["passed"], false);
}

#[tokio::test(flavor = "multi_thread")]
async fn an_unwritable_report_path_exits_two() {
    let server = Server::start().await;
    let collection = collection();
    let cli = run(
        &collection,
        &server,
        &["ok.yaml", "--json", "/proc/nonexistent/run.json"],
    );
    assert_eq!(cli.code(), 2, "{}", cli.stdout());
    assert!(
        cli.stderr().contains("/proc/nonexistent"),
        "{}",
        cli.stderr()
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn verbose_shows_redacted_traffic_and_script_logs() {
    let server = Server::start().await;
    let collection = Collection::new("Verbose");
    collection.write(
        "secure.yaml",
        "resonanceFormat: 2\nid: r_secure\nname: Secure\nmethod: POST\npath: /secure\nauth:\n  type: bearer\n  config:\n    token: '{{token}}'\nparams:\n  query:\n    - key: api_key\n      value: '{{apiKey}}'\n  headers:\n    - key: X-Trace\n      value: trace-1\nbody:\n  mode: json\n  content: '{\"hello\":\"world\"}'\nscripts:\n  preRequest: |\n    console.log('about to send');\n  test: |\n    pm.test('ok', function () { pm.response.to.have.status(200); });\n",
    );
    let cli = run(
        &collection,
        &server,
        &[
            "-v",
            "--var",
            "token=sekrit-token",
            "--var",
            "apiKey=plainkey",
        ],
    );
    let out = cli.stdout();
    assert_eq!(cli.code(), 0, "{out}\n{}", cli.stderr());
    assert!(out.contains("[pre] console.log: about to send"), "{out}");
    assert!(out.contains("/secure?api_key=plainkey"), "{out}");
    assert!(out.contains("> X-Trace: trace-1"), "{out}");
    assert!(out.contains("Authorization: [redacted]"), "{out}");
    assert!(!out.contains("sekrit-token"), "{out}");
    assert!(out.contains("< 200 OK"), "{out}");
    assert!(out.contains("< set-cookie: [redacted]"), "{out}");
    assert!(
        out.contains(r#"\"hello\":\"world\""#) || out.contains(r#""hello":"world""#),
        "{out}"
    );
}
