mod common;

use common::{Collection, Server, run, run_with};

fn collection() -> Collection {
    let collection = Collection::new("Vars");
    collection.write(
        "variables.yaml",
        "- key: greeting\n  value: file\n- key: token\n  value: ''\n  secret: true\n",
    );
    collection.write(
        "hello.yaml",
        "resonanceFormat: 2\nid: r_hello\nname: Hello\nmethod: GET\npath: /hello/{{greeting}}\nscripts:\n  test: |\n    pm.test('path', function () { pm.expect(pm.response.json().path).to.equal('/hello/' + pm.variables.get('expected')); });\n",
    );
    collection
}

#[tokio::test(flavor = "multi_thread")]
async fn collection_variables_are_the_lowest_layer() {
    let server = Server::start().await;
    let collection = collection();
    let cli = run(&collection, &server, &["--var", "expected=file"]);
    assert_eq!(cli.code(), 0, "{}", cli.stdout());
}

#[tokio::test(flavor = "multi_thread")]
async fn env_file_process_environment_and_flags_override_in_that_order() {
    let server = Server::start().await;
    let collection = collection();
    let env_file = collection.write(
        "envs.json",
        r#"{"version":1,"environments":[{"name":"Staging","variables":{"greeting":"env"}},{"name":"Prod","variables":{"greeting":"prod"}}]}"#,
    );
    let file = env_file.to_str().unwrap();

    let from_file = run(
        &collection,
        &server,
        &[
            "--env-file",
            file,
            "--env",
            "staging",
            "--var",
            "expected=env",
        ],
    );
    assert_eq!(
        from_file.code(),
        0,
        "{}\n{}",
        from_file.stdout(),
        from_file.stderr()
    );
    assert!(
        from_file.stdout().contains("Environment: Staging"),
        "{}",
        from_file.stdout()
    );

    let from_process = run_with(
        &collection,
        &server,
        &[
            "--env-file",
            file,
            "--env",
            "Prod",
            "--var",
            "expected=process",
        ],
        &[("RESONANCE_VAR_greeting", "process")],
    );
    assert_eq!(from_process.code(), 0, "{}", from_process.stdout());

    let from_flag = run_with(
        &collection,
        &server,
        &[
            "--env-file",
            file,
            "--env",
            "Prod",
            "--var",
            "greeting=flag",
            "--var",
            "expected=flag",
        ],
        &[("RESONANCE_VAR_greeting", "process")],
    );
    assert_eq!(from_flag.code(), 0, "{}", from_flag.stdout());

    let unnamed = run(&collection, &server, &["--env-file", file]);
    assert_eq!(unnamed.code(), 2);
    assert!(
        unnamed.stderr().contains("Staging") && unnamed.stderr().contains("Prod"),
        "{}",
        unnamed.stderr()
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn a_single_environment_file_needs_no_name() {
    let server = Server::start().await;
    let collection = collection();
    let env_file = collection.write(
        "one.json",
        r#"{"name":"Only","variables":{"greeting":"one","expected":"one"}}"#,
    );
    let cli = run(
        &collection,
        &server,
        &["--env-file", env_file.to_str().unwrap()],
    );
    assert_eq!(cli.code(), 0, "{}", cli.stdout());
}

#[tokio::test(flavor = "multi_thread")]
async fn blank_secrets_are_warned_about_and_a_bad_var_is_a_usage_error() {
    let server = Server::start().await;
    let collection = collection();
    let warned = run(&collection, &server, &["--var", "expected=file"]);
    assert!(
        warned
            .stderr()
            .contains("secret variables have no value: token"),
        "{}",
        warned.stderr()
    );
    let filled = run(
        &collection,
        &server,
        &["--var", "expected=file", "--var", "token=abc"],
    );
    assert!(
        !filled.stderr().contains("secret variables"),
        "{}",
        filled.stderr()
    );
    let bad = run(&collection, &server, &["--var", "novalue"]);
    assert_eq!(bad.code(), 2);
    assert!(bad.stderr().contains("KEY=VALUE"), "{}", bad.stderr());
}
