mod common;

use common::{Collection, Server, run};

fn petstore() -> Collection {
    let collection = Collection::new("Petstore");
    collection.request("health.yaml", "r_health", "Health", 10, "/health", 200);
    collection.request("pets/list.yaml", "r_list", "List pets", 20, "/pets", 200);
    collection.request(
        "pets/create.yaml",
        "r_create",
        "Create pet",
        10,
        "/status/201",
        201,
    );
    collection.request(
        "pets/broken.yaml",
        "r_broken",
        "Broken",
        30,
        "/status/500",
        200,
    );
    collection
}

#[tokio::test(flavor = "multi_thread")]
async fn the_whole_collection_runs_in_tree_order_and_fails_on_a_failed_test() {
    let server = Server::start().await;
    let collection = petstore();
    let cli = run(&collection, &server, &[]);
    let out = cli.stdout();
    assert_eq!(cli.code(), 1, "{out}\n{}", cli.stderr());
    assert!(out.contains("Running 4 requests"), "{out}");
    let health = out.find("GET /health 200").unwrap();
    let create = out.find("GET /status/201 201").unwrap();
    let list = out.find("GET /pets 200").unwrap();
    let broken = out.find("✗ GET /status/500 500").unwrap();
    assert!(health < create && create < list && list < broken, "{out}");
    assert!(out.contains("  ✗ status is 200"), "{out}");
    assert!(out.contains("Passed 3  Failed 1  Skipped 0"), "{out}");
}

#[tokio::test(flavor = "multi_thread")]
async fn a_passing_selection_exits_zero() {
    let server = Server::start().await;
    let collection = petstore();
    let cli = run(&collection, &server, &["health.yaml"]);
    assert_eq!(cli.code(), 0, "{}", cli.stdout());
    assert!(
        cli.stdout().contains("Running 1 request\n"),
        "{}",
        cli.stdout()
    );
    assert!(cli.stdout().contains("Passed 1  Failed 0  Skipped 0"));
}

#[tokio::test(flavor = "multi_thread")]
async fn selectors_accept_paths_folders_ids_and_names() {
    let server = Server::start().await;
    let collection = petstore();
    let cli = run(
        &collection,
        &server,
        &["pets/list", "r_health", "Create pet"],
    );
    let out = cli.stdout();
    assert_eq!(cli.code(), 0, "{out}");
    let list = out.find("GET /pets 200").unwrap();
    let health = out.find("GET /health 200").unwrap();
    let create = out.find("GET /status/201 201").unwrap();
    assert!(list < health && health < create, "{out}");

    let folder = run(&collection, &server, &["pets", "--no-bail"]);
    assert!(
        folder.stdout().contains("Running 3 requests"),
        "{}",
        folder.stdout()
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn unknown_and_ambiguous_selectors_exit_two() {
    let server = Server::start().await;
    let collection = petstore();
    collection.request(
        "other/health.yaml",
        "r_health2",
        "Health",
        5,
        "/health",
        200,
    );
    let unknown = run(&collection, &server, &["nope"]);
    assert_eq!(unknown.code(), 2);
    assert!(unknown.stderr().contains("nope"), "{}", unknown.stderr());
    let ambiguous = run(&collection, &server, &["Health"]);
    assert_eq!(ambiguous.code(), 2);
    assert!(
        ambiguous.stderr().contains("health.yaml")
            && ambiguous.stderr().contains("other/health.yaml"),
        "{}",
        ambiguous.stderr()
    );
    assert_eq!(run(&collection, &server, &["health.yaml"]).code(), 0);
}

#[tokio::test(flavor = "multi_thread")]
async fn bail_stops_after_the_first_failure_and_skips_the_rest() {
    let server = Server::start().await;
    let collection = Collection::new("Bail");
    collection.request("a.yaml", "a", "A", 1, "/status/500", 200);
    collection.request("b.yaml", "b", "B", 2, "/ok", 200);
    let cli = run(&collection, &server, &["--bail"]);
    assert_eq!(cli.code(), 1);
    let out = cli.stdout();
    assert!(out.contains("✗ GET /status/500"), "{out}");
    assert!(!out.contains("GET /ok"), "{out}");
    assert!(out.contains("Termination: stoppedOnError"), "{out}");
    let all = run(&collection, &server, &[]);
    assert!(all.stdout().contains("GET /ok 200"), "{}", all.stdout());
}

#[tokio::test(flavor = "multi_thread")]
async fn a_v1_collection_and_a_plain_directory_are_refused() {
    let server = Server::start().await;
    let legacy = Collection::new("Legacy");
    std::fs::remove_file(legacy.path().join("collection.yaml")).unwrap();
    legacy.write("collection.json", "{}");
    let cli = run(&legacy, &server, &[]);
    assert_eq!(cli.code(), 2);
    assert!(
        cli.stderr().contains("open it in Resonance once"),
        "{}",
        cli.stderr()
    );
    let empty = tempfile::TempDir::new().unwrap();
    let output = common::command()
        .arg("run")
        .arg(empty.path())
        .output()
        .unwrap();
    assert_eq!(output.status.code(), Some(2));
}

#[tokio::test(flavor = "multi_thread")]
async fn a_runner_runs_its_queue_with_its_own_options() {
    let server = Server::start().await;
    let collection = petstore();
    collection.write(
        "runners/smoke.yaml",
        "resonanceFormat: 2\nid: run_1\nname: Smoke\noptions:\n  stopOnError: true\nrequests:\n  - requestId: r_broken\n  - requestId: r_health\n",
    );
    let by_stem = run(&collection, &server, &["--runner", "smoke"]);
    assert_eq!(by_stem.code(), 1, "{}", by_stem.stdout());
    assert!(
        by_stem.stdout().contains("Termination: stoppedOnError"),
        "{}",
        by_stem.stdout()
    );
    assert!(
        !by_stem.stdout().contains("/health"),
        "{}",
        by_stem.stdout()
    );

    let by_name = run(&collection, &server, &["--runner", "Smoke", "--no-bail"]);
    assert!(
        by_name.stdout().contains("GET /health 200"),
        "{}",
        by_name.stdout()
    );
    assert_eq!(by_name.code(), 1);

    let missing = run(&collection, &server, &["--runner", "nightly"]);
    assert_eq!(missing.code(), 2);
    assert!(missing.stderr().contains("nightly"), "{}", missing.stderr());
}

#[tokio::test(flavor = "multi_thread")]
async fn iterations_and_data_files_multiply_the_queue() {
    let server = Server::start().await;
    let collection = Collection::new("Data");
    collection.write(
        "users.yaml",
        "resonanceFormat: 2\nid: r_user\nname: User\nmethod: GET\npath: /users/{{name}}\nscripts:\n  test: |\n    pm.test('echoes the row', function () { pm.expect(pm.response.json().path).to.equal('/users/' + pm.iterationData.get('name')); });\n",
    );
    collection.write("rows.csv", "name\nalice\nbob\n");
    collection.write(
        "runners/users.yaml",
        "resonanceFormat: 2\nid: run_users\nname: Users\noptions:\n  stopOnError: false\n  dataFile:\n    path: rows.csv\nrequests:\n  - requestId: r_user\n",
    );
    let runner = run(&collection, &server, &["--runner", "users"]);
    assert_eq!(runner.code(), 0, "{}\n{}", runner.stdout(), runner.stderr());
    assert!(
        runner
            .stdout()
            .contains("Running 2 requests (2 iterations)"),
        "{}",
        runner.stdout()
    );
    assert!(
        runner.stdout().contains("Passed 2  Failed 0"),
        "{}",
        runner.stdout()
    );

    let more = collection.write("more.json", r#"[{"name":"a"},{"name":"b"},{"name":"c"}]"#);
    let overridden = run(
        &collection,
        &server,
        &["--runner", "users", "--data", more.to_str().unwrap()],
    );
    assert!(
        overridden.stdout().contains("(3 iterations)"),
        "{}",
        overridden.stdout()
    );
    assert_eq!(overridden.code(), 0);

    let repeated = run(
        &collection,
        &server,
        &["users.yaml", "-n", "2", "--var", "name=x"],
    );
    assert!(
        repeated
            .stdout()
            .contains("Running 2 requests (2 iterations)"),
        "{}",
        repeated.stdout()
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn strict_variables_fails_before_sending() {
    let server = Server::start().await;
    let collection = Collection::new("Strict");
    collection.request("x.yaml", "r_x", "X", 1, "/x/{{missing}}", 200);
    let lenient = run(&collection, &server, &[]);
    assert_eq!(lenient.code(), 0, "{}", lenient.stdout());
    let strict = run(&collection, &server, &["--strict-variables"]);
    assert_eq!(strict.code(), 1, "{}", strict.stdout());
    assert!(
        strict.stdout().contains("{{missing}}"),
        "{}",
        strict.stdout()
    );
    assert_eq!(
        run(
            &collection,
            &server,
            &["--strict-variables", "--var", "missing=1"]
        )
        .code(),
        0
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn quiet_prints_only_failures_and_the_summary() {
    let server = Server::start().await;
    let collection = petstore();
    let cli = run(&collection, &server, &["-q"]);
    let out = cli.stdout();
    assert!(!out.contains("Running"), "{out}");
    assert!(!out.contains("/health"), "{out}");
    assert!(out.contains("✗ GET /status/500"), "{out}");
    assert!(out.contains("Passed 3  Failed 1"), "{out}");
}

fn tagged_petstore() -> Collection {
    let collection = Collection::new("Petstore");
    let tagged = |file: &str, id: &str, name: &str, seq: i64, path: &str, tags: &str| {
        collection.write(
            file,
            &format!(
                "resonanceFormat: 2\nid: {id}\nname: {name}\nseq: {seq}\nmethod: GET\npath: {path}\ntags: [{tags}]\n"
            ),
        );
    };
    tagged("health.yaml", "r_health", "Health", 10, "/health", "smoke");
    tagged(
        "pets/list.yaml",
        "r_list",
        "List pets",
        20,
        "/pets",
        "Pets, smoke",
    );
    tagged(
        "pets/slow.yaml",
        "r_slow",
        "Slow pets",
        30,
        "/pets/all",
        "pets, slow",
    );
    collection.request(
        "pets/create.yaml",
        "r_create",
        "Create pet",
        10,
        "/status/201",
        201,
    );
    collection
}

#[tokio::test(flavor = "multi_thread")]
async fn tags_filter_selected_requests() {
    let server = Server::start().await;
    let collection = tagged_petstore();

    let smoke = run(&collection, &server, &["--tags", "SMOKE"]);
    let out = smoke.stdout();
    assert_eq!(smoke.code(), 0, "{out}\n{}", smoke.stderr());
    assert!(out.contains("Running 2 requests"), "{out}");
    assert!(
        out.contains("GET /health 200") && out.contains("GET /pets 200"),
        "{out}"
    );

    let folder = run(
        &collection,
        &server,
        &["pets", "--exclude-tags", "slow,smoke"],
    );
    let out = folder.stdout();
    assert!(out.contains("Running 1 request\n"), "{out}");
    assert!(out.contains("GET /status/201 201"), "{out}");

    let both = run(
        &collection,
        &server,
        &["--tags", "pets", "--exclude-tags", "slow"],
    );
    let out = both.stdout();
    assert!(out.contains("Running 1 request\n"), "{out}");
    assert!(out.contains("GET /pets 200"), "{out}");

    let none = run(&collection, &server, &["--tags", "nightly"]);
    assert_eq!(none.code(), 2, "{}", none.stdout());
    assert!(
        none.stderr().contains("no requests to run"),
        "{}",
        none.stderr()
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn tags_filter_a_runner_queue_and_flags_replace_its_saved_filter() {
    let server = Server::start().await;
    let collection = tagged_petstore();
    collection.write(
        "runners/smoke.yaml",
        "resonanceFormat: 2\nid: run_1\nname: Smoke\noptions:\n  stopOnError: false\n  tags:\n    exclude:\n    - slow\nrequests:\n  - requestId: r_slow\n  - requestId: r_health\n  - requestId: r_list\n  - requestId: r_create\n    postResponseScript: |\n      resonance.setNextRequest('Slow pets');\n",
    );

    let saved = run(&collection, &server, &["--runner", "smoke"]);
    let out = saved.stdout();
    assert!(out.contains("Running 3 requests"), "{out}");
    assert!(!out.contains("/pets/all"), "{out}");
    assert!(out.contains("✗ GET /status/201"), "{out}");
    assert_eq!(saved.code(), 1, "{out}");

    let flags = run(
        &collection,
        &server,
        &["--runner", "smoke", "--tags", "slow"],
    );
    let out = flags.stdout();
    assert_eq!(flags.code(), 0, "{out}\n{}", flags.stderr());
    assert!(out.contains("Running 1 request\n"), "{out}");
    assert!(out.contains("GET /pets/all 200"), "{out}");
}
