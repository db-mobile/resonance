mod common;
use common::{Collection, Server, run};
use serde_json::json;

#[tokio::test(flavor = "multi_thread")]
async fn get_and_delete_send_saved_json_and_text_bodies() {
    let server = Server::start().await;
    let collection = Collection::new("Request bodies");
    for method in ["GET", "DELETE"] {
        for (mode, content, expected, content_type) in [
            (
                "json",
                r#"{"id":{{id}}}"#,
                r#"{"id":7}"#,
                "application/json",
            ),
            ("text", "Grüße {{id}}", "Grüße 7", "text/plain"),
        ] {
            collection.write(
                &format!("{method}-{mode}.yaml"),
                &format!(
                    "resonanceFormat: 2\nid: r_{method}_{mode}\nname: {method} {mode}\nmethod: {method}\npath: /echo\nbody:\n  mode: {mode}\n  content: '{content}'\nscripts:\n  test: |\n    pm.test('method and body reached server', function () {{\n      var echo = pm.response.json();\n      pm.expect(echo.method).to.equal('{method}');\n      pm.expect(echo.body).to.equal({expected});\n      pm.expect(echo.headers['content-type']).to.equal('{content_type}');\n    }});\n",
                    expected = json!(expected),
                ),
            );
        }
    }
    let cli = run(&collection, &server, &["--var", "id=7"]);
    assert_eq!(cli.code(), 0, "{}\n{}", cli.stdout(), cli.stderr());
    assert!(
        cli.stdout().contains("Passed 4  Failed 0"),
        "{}",
        cli.stdout()
    );
}
