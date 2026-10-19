# Resonance execution core

Frontend-independent HTTP/GraphQL execution and collection orchestration. This
crate has no Tauri, GUI, storage, or credential-store dependencies. It builds
without Node or frontend assets:

```sh
cargo build --manifest-path crates/resonance-core/Cargo.toml --locked
cargo test --manifest-path crates/resonance-core/Cargo.toml --locked
```

`execution::execute_request(RequestInput, Cancellation, on_event)` and
`execution::execute_run(RunInput, Cancellation, on_event)` consume owned startup
snapshots. `model` defines the serializable inputs. Request templates contain raw
values; callers must hydrate secrets and capture inherited authentication,
variables, scripts, cookie jars, certificate paths, proxy settings, mock routing,
and execution settings before invoking either function. Ordered run entries may
repeat the same request with different captured overrides. Data files are passed
as name/content pairs; parsing happens here.

`bearerFallback` records the saved runner's legacy empty-bearer-token fallback to
the `bearerToken` variable; editor snapshots leave it disabled.

Both entry points use the same request executor. Each visit resolves variables
and authentication, runs the pre-request script, refreshes derived request
fields, selects cookies/certificates for the final URL, sends HTTP, processes
response cookies, and runs endpoint and runner test scripts. Script environment
and collection changes remain separate; typed local variables live only for the
execution. Runner data overrides environment and collection variables, and local
variables override all three. Dynamic values are cached within a visit.

`RequestResult` and `RunResult` expose typed statuses, termination reasons, and
`RunResult::succeeded()` for headless consumers. Results include request status,
transport response, timings, script logs/assertions and counters. `apiResponse`
is the canonical response; the GUI reconstructs legacy body/header/response report
aliases by reference. Failures include `executionError: {code, details}`; presentation adapters
translate codes. Transport bodies, including binary base64 responses, retain the
existing `api_request::ApiResponse` representation.

Events have `executionId`, monotonic `sequence` (starting at 1), optional `visit`
identity (`index`, `queuePosition`, `iteration`, `attempt`, collection/request IDs),
`kind`, and `data`. Kinds are `run-started`, `request-started`, `request-sent`,
`script`, `warning`, `effect`, `response`, `request-completed`, and `completed`.
There is exactly one terminal `completed` event. Completion events are summaries:
request-completed omits apiResponse, and completed omits apiResponse/requests. The
function return value carries the full typed result. `effect` payloads contain only
environment/collection variable deltas, cookie operations, or renewed OAuth
credential fields and their captured source. They never persist local variables.
Settings, cookies, certificates, auth kinds and credential sources are typed;
auth field values and user bodies stay JSON to preserve variable substitution.
Event callbacks are synchronous; adapters should queue persistence without
blocking transport and drain those writes before presenting completion.

Cancellation stops scheduling, interrupts HTTP and delays, and suppresses results
and effects from unfinished scripts. Boa workers cooperatively observe the same
token at VM budget checks and during auxiliary HTTP calls. Their existing
30-second script limit remains in force. Dropping an async waiter alone does not
terminate a blocking worker.

The desktop adapter registers listeners before invocation, scopes events and
cancellation registrations to the initiating window, and removes registrations
with an RAII guard. Its sequence-0 `registered` event closes the race between an
early cancel and backend registration. The frontend serializes persistence deltas
through the existing secret-aware repositories, targeting captured environments
and collections; persistence failures are surfaced. Invoke replies include the canonical result,
terminal sequence and ordered effect journal, so lost completion/effect events
settle correctly without duplicating persistence. Editor state, history,
schema validation, report exports, and saved-run bookkeeping stay in the GUI.

The behavioral fixtures in `tests/fixtures/execution` at the repository root are
shared migration evidence; see their README for provenance. The `core` job in the CI pipeline
builds/tests this crate and checks its dependency boundary without installing
frontend or desktop dependencies. `scripts/check-core-resolution.py` verifies
matching package versions and resolved normal dependency edges against the desktop
lockfile, which remains the Flathub packaging source. The single idna_adapter pin
lives in the core manifest.

CLI commands, committed-file loading, installation/distribution, subscriptions,
WebSocket, SSE, MQTT, and gRPC are outside this migration.

## Migration verification

Verified locally on Linux: 2,343 frontend tests (207 suites), 164 standalone core
Rust tests, and 467 desktop Rust tests; frontend lint, Rust formatting and Clippy
with warnings denied; production frontend build and desktop debug build. Core
tests include real local HTTP servers, OAuth renewal, cancellation of Boa workers
and auxiliary HTTP, and the legacy golden fixtures. The core dependency tree was
checked for desktop and credential-store libraries.

The built desktop app was exercised using an isolated temporary profile and a
local echo server: HTTP Send, an unsaved pre-request script changing URL/headers,
GraphQL query Send with variables/operation name, a two-request GUI runner with
script logs/assertions and timeline results, and cancellation. Window-scoped IPC
events were inspected through WebKit's local inspector, using its documented
[`WEBKIT_INSPECTOR_HTTP_SERVER` option](https://trac.webkit.org/wiki/EnvironmentVariables).
The review verification also withheld completion and effect events: the desktop
runner recovered through its invoke receipt and still displayed both results. Raw
request-completed events were checked to contain no response bodies.
No production collections or credentials were used.
