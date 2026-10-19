# Resonance command line

`resonance` runs the requests and saved runners of a committed Resonance
collection without the desktop app: in CI, in a container, on a server.
It is a single static binary built from the same Rust execution core the
desktop uses, so scripts, variables, authentication, cookies, proxies and
certificates behave exactly as in the app.

## Install

Download the archive for your platform from the
[latest release](https://github.com/db-mobile/resonance/releases/latest),
verify it against `SHA256SUMS`, and put the `resonance` binary on your `PATH`:

```sh
VERSION=3.4.0
curl -fsSLO "https://github.com/db-mobile/resonance/releases/download/v${VERSION}/resonance-cli_${VERSION}_x86_64-unknown-linux-musl.tar.gz"
tar -xzf "resonance-cli_${VERSION}_x86_64-unknown-linux-musl.tar.gz"
sudo install "resonance-cli_${VERSION}_x86_64-unknown-linux-musl/resonance" /usr/local/bin/
resonance --version
```

Archives exist for Linux x86_64 and arm64 (static, no system libraries
needed), macOS (universal) and Windows x64. From a checkout:
`cargo build -p resonance-cli --profile cli --locked` produces
`target/cli/resonance`.

## Usage

```
resonance run <COLLECTION_DIR> [SELECTOR...] [options]
resonance list <COLLECTION_DIR> [--json]
```

`COLLECTION_DIR` is the directory holding `collection.yaml` (a collection
saved by Resonance 3 or later; a legacy `collection.json` directory must be
opened in the app once to convert it). Without selectors every request of
the collection runs in tree order.

A selector is one of:

| Selector | Example |
|---|---|
| request file path, with or without `.yaml` | `pets/create-pet.yaml`, `pets/create-pet` |
| folder path (recursive, in the app's order) | `pets` |
| request id | `req_7f3a…` |
| request name (exact, then case-insensitive) | `"Create pet"` |

A name shared by several requests is an error that lists the candidates;
use the file path instead. `resonance list` prints every path, name and id.

### Runners

`--runner <stem|name|id>` runs a saved runner from `runners/<stem>.yaml`
with its own queue, overrides, iteration count, delay, stop-on-error setting
and data file. It cannot be combined with selectors.

### Options

| Option | Effect |
|---|---|
| `--var KEY=VALUE` | Set a variable (repeatable) |
| `--env-file FILE` | Variables from an environment export of the desktop app (JSON) |
| `--env NAME` | Which environment to take from `--env-file` when it holds several |
| `-n, --iterations N` | Run the queue N times (1–1000) |
| `-d, --data FILE` | CSV or JSON data file, one iteration per row; overrides a runner's data file |
| `--delay MS` | Pause between requests |
| `--bail` / `--no-bail` | Stop at the first failed request. Plain runs default to `--no-bail`; a runner uses its file's `stopOnError` |
| `--strict-variables` | Fail a request before sending when it still contains unresolved `{{variables}}` |
| `--timeout MS` | Request timeout (default 30000, `0` disables) |
| `-k, --insecure` | Skip TLS certificate verification |
| `--http1` / `--http2` | Force an HTTP version |
| `--no-follow-redirects`, `--no-cookies` | Transport switches |
| `--proxy URL` / `--no-proxy` | Manual proxy or none; by default `HTTP_PROXY`, `HTTPS_PROXY` and `NO_PROXY` apply |
| `--cert FILE --key FILE [--cacert FILE] --cert-host HOST[:PORT]` | Client certificate and extra CA for one host |
| `--junit FILE`, `--json FILE` | Write reports (same formats the desktop exports) |
| `-q, --quiet` / `-v, --verbose` | Only failures and the summary / also script logs and redacted traffic |
| `--no-color` | Disable colours (`NO_COLOR` and non-terminal output do too) |

### Variables and secrets

Values are layered, later layers winning:

1. the collection's `variables.yaml`
2. `--env-file` (optionally narrowed with `--env`)
3. `RESONANCE_VAR_<KEY>` environment variables (the key keeps its case)
4. `--var KEY=VALUE`

Secrets are never written to collection files. Pass them from your CI
secret store, for example `RESONANCE_VAR_apiToken=…` or
`--var apiToken="$API_TOKEN"`. The CLI warns on standard error when a
variable flagged secret still has no value.

### Exit codes

| Code | Meaning |
|---|---|
| 0 | every request succeeded and every test passed |
| 1 | a request or test failed, or the run stopped early (stop-on-error, execution limit, invalid target) |
| 2 | usage or configuration problem: not a collection, unknown or ambiguous selector, bad flag, unreadable file, run could not start |
| 130 | interrupted with Ctrl-C; reports written for what ran |

### Example: GitHub Actions

```yaml
jobs:
  api-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - name: Install Resonance CLI
        run: |
          VERSION=3.4.0
          curl -fsSLO "https://github.com/db-mobile/resonance/releases/download/v${VERSION}/resonance-cli_${VERSION}_x86_64-unknown-linux-musl.tar.gz"
          tar -xzf "resonance-cli_${VERSION}_x86_64-unknown-linux-musl.tar.gz"
          sudo install "resonance-cli_${VERSION}_x86_64-unknown-linux-musl/resonance" /usr/local/bin/
      - name: Run smoke tests
        env:
          RESONANCE_VAR_apiToken: ${{ secrets.API_TOKEN }}
        run: |
          resonance run collections/petstore --runner smoke \
            --var baseUrl=https://staging.example.com \
            --junit reports/junit.xml
      - uses: actions/upload-artifact@v6
        if: always()
        with:
          name: api-test-report
          path: reports/
```

Any CI system that understands JUnit XML (GitLab, Jenkins, Azure Pipelines,
CircleCI) can render the `--junit` file as test results.
