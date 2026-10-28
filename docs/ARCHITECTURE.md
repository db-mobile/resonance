# Architecture

Technical overview of Resonance for contributors. For usage documentation, see the [documentation site](https://db-mobile.github.io/resonance/).

For shared controls, visual tokens and presentation conventions, see the [UI style guide](UI_STYLE_GUIDE.md).

## Project Structure

```
src/
├── renderer.js          # Renderer process coordinator (boots the FeatureRegistry)
├── styles/             # Modular CSS (tokens, layout, widgets, per-feature styles)
├── themes/             # Light/dark theme CSS
├── i18n/               # Internationalization (6 languages)
└── modules/            # Modular renderer components
    ├── controllers/    # MVC controllers (Collection, Environment, History, Script, Proxy, WorkspaceTab, MockServer)
    ├── services/       # Business logic services (Script, Environment, Collection, etc.)
    ├── storage/        # Data persistence repositories (Script, Environment, Collection, etc.)
    ├── ui/             # UI components (dialogs, renderers, selectors, script editors)
    ├── variables/      # Variable processing and templating
    ├── schema/         # OpenAPI schema handling
    ├── registry/       # FeatureRegistry booting co-located *.feature.js descriptors
    ├── state/          # Encapsulated app state modules
    ├── ipcBridge.js    # Tauri IPC compatibility layer
    ├── protocols/              # protocolRegistry: descriptors, ui data and the send/cancel/isLive handler table
    ├── apiHandler.js           # HTTP/GraphQL snapshot capture and core result presentation
    ├── responseView.js         # Response pane rendering shared by every protocol handler (leaf)
    ├── sendControls.js         # Send/cancel button state driven by the active handler's isLive
    ├── requestServices.js      # Variable/auth helpers for previews and other protocol handlers
    ├── endpointSave.js         # Debounced save of the current endpoint's modifications
    ├── graphqlIntrospection.js # Introspection fetch and client-schema build
    ├── requestPipeline.feature.js # Wires repositories and preview helpers used by CoreExecutionService
    ├── collection.feature.js   # Composition root of the collection sidebar stack (repository → services → UI → controller)
    ├── auth.feature.js         # Builds the request form's AuthManager; auth types live in auth/authTypes.js
    ├── requestFormReader.js    # Reads the request editor form into plain data for the collection services
    ├── collections/endpointSidecars.js # The single writer of a new request's sidecar records
    ├── codeGenerator.js        # Multi-language code export
    ├── *.feature.js            # Per-feature wiring descriptors
    └── [60+ other modules]     # Protocol handlers (gRPC, WebSocket, MQTT, SSE), editors, managers

crates/resonance-core/
├── Cargo.toml         # Independent library; no Tauri, GUI or keychain dependencies
└── src/
    ├── model.rs       # Request and runner snapshot inputs
    ├── context.rs     # Settings, auth, cookies and certificate input types
    ├── results.rs     # Typed request/run results and termination reasons
    ├── execution.rs   # Shared Send/runner executor, scripts, effects, cancellation
    ├── preparation.rs # Variables, auth, URL/body construction, cookies and certificates
    ├── runner.rs      # Queue traversal, branching, iterations and data parsing
    ├── api_request.rs # HTTP transport, auth, binary bodies and response timings
    └── scripts.rs     # Bounded Boa execution and execution-local script state

src-tauri/
├── Cargo.toml         # Rust dependencies
├── tauri.conf.json    # Tauri configuration
└── src/
    ├── main.rs        # Application entry point
    └── commands/      # IPC command handlers
        ├── execution.rs          # Window-scoped execution IPC, cancellation and effect receipts
        ├── api_request.rs        # Low-level HTTP command adapter delegating to resonance-core
        ├── grpc_reflection.rs    # gRPC server reflection (v1/v1alpha negotiation)
        ├── grpc_streaming.rs     # gRPC unary and streaming calls
        ├── grpc_proto.rs         # Proto descriptor handling
        ├── websocket.rs          # WebSocket connections
        ├── sse.rs                # Server-Sent Events streaming
        ├── mqtt.rs               # MQTT broker connections
        ├── graphql_subscription.rs  # GraphQL subscriptions (graphql-transport-ws)
        ├── mock_server.rs        # Mock server with Axum
        ├── scripts.rs            # Desktop script storage (execution lives in resonance-core)
        ├── import_export/        # OpenAPI/Postman import and export
        ├── collections/          # Git-friendly collection file storage
        ├── store.rs              # Settings/data persistence
        ├── secrets.rs            # OS keychain secret storage
        ├── oauth.rs              # OAuth 2.0 token fetching
        ├── proxy.rs              # Proxy configuration
        ├── certificates.rs       # Native file picker for client certificate (mTLS) files
        ├── tls.rs                # Re-exports core TLS helpers for other desktop protocols
        └── updater.rs            # Auto-update and install-type detection
```

## Closing collections

Collections stored outside the app's default collections directory can be closed,
including imports into a custom folder. The backend derives `canClose` from the
storage location when listing or fetching collections. This is separate from
`linked`, which records folders opened in place and protects them from deletion
and directory renames. Closing unregisters the collection and closes its tabs;
files, collection variables and keychain credentials remain available when it is
opened again. Collections in default storage are discovered automatically and
offer Delete instead of Close.

## Shared request execution

HTTP and GraphQL Send and collection runs call `resonance-core` with owned startup
snapshots. The runner uses the same request executor as Send. Preparation,
variable precedence, OAuth renewal, pre-request/test scripts, transport, cookies,
branching, limits and cancellation live in Rust. Script mutations update execution
state for subsequent visits. Boa workers observe cancellation while retaining the
bounded script runtime.

`CoreExecutionService` captures desktop inputs, including unsaved editor values,
hydrated secrets and saved request defaults. It registers the event listener before
invoking execution, applies persistence deltas through the existing repositories,
and drains those writes before showing completion. The captured environment and
collection remain the persistence targets even after the user switches tabs or
environments. `RunnerService` retains saved-run bookkeeping, history and reports;
`apiHandler` retains response rendering, history and schema validation.

Progress events carry ordered execution/visit identities. A response body appears
in the response event and canonical invoke result; request-completed and completed
events carry summaries. The desktop invoke reply also includes the ordered effect
journal, allowing the GUI to recover missing effect/completion events and deduplicate
already applied writes. Legacy report body aliases are restored in the GUI by
reference. JSON/JUnit report formats remain compatible.

The core exposes typed results, statuses, termination reasons and context inputs.
User body data, script-visible request objects and templatable auth fields remain
JSON by design. YAML loading, keychain access and desktop repositories are adapters,
not core dependencies. Capture fixtures in `tests/fixtures/execution/*capture.json`
pin the saved/editor mapping rules; `resonance-collections` ports them to Rust
for headless loading and is checked against the same fixtures.

The repository is one Cargo workspace (root `Cargo.toml`): the desktop package in
`src-tauri` and the headless crates under `crates/` share a single `Cargo.lock`,
one version (`workspace.package.version`, checked against `package.json` and
`tauri.conf.json` by `scripts/check-version.py`) and the release profiles. Every
member builds into the root `target/` directory; the Flathub manifest in the
sibling packaging repository vendors crates from the root lockfile. The
`workspace` job in the CI pipeline builds/tests the headless crates and checks
their dependency boundary without frontend or desktop system dependencies.

## Command line

`crates/resonance-collections` is the Tauri-free collection reader shared by the
desktop and the CLI: the v2 YAML model, reader/writer, runner files, secrets
scopes and git helpers moved there unchanged, plus a loader API (`load_collection`,
request addressing by path/folder/id/name, `variables.yaml` and environment-export
parsing) and `capture.rs`, a one-to-one port of the desktop's `captureRunnerEntry`
that turns loaded requests into core `RequestTemplate`s. The git helpers in
`git/` derive the branch badge and the worktree-vs-index change markers by
reading `.git` files directly: no git library, no subprocess, and only the
index is compared, so staged-but-uncommitted files read as clean. `src-tauri`
keeps the Tauri commands and re-exports the crate's modules.

`crates/resonance-cli` builds the `resonance` binary. `run` loads a collection,
resolves selectors or a runner, layers variables (collection < `--env-file` <
`RESONANCE_VAR_*` < `--var`), and always executes through `execute_run`, so plain
requests, folders and runners share one path for reports, `--bail`, iterations,
data files and exit codes (0 passed, 1 failed, 2 usage/config, 130 interrupted).
Console output is an event listener on the core's progress events; `--junit` and
`--json` reuse `resonance-core::report`, a byte-compatible port of the desktop's
report writer. The release workflow attaches static Linux (musl), macOS universal
and Windows archives of the binary, built with the `cli` profile (`opt-level = 3`),
to every GitHub release.

## Collection runners

Runner startup uses `backendAPI.collections.captureExecutionSnapshot(targets)`
(`collections_capture_execution_snapshot`) to capture distinct
`{collectionId, endpointId}` references in one IPC call. The command runs on the
native blocking pool and loads each collection once. `snapshot.rs` projects
selected endpoints, persisted data, scripts and closest-folder-first auth sources
alongside one compact collection metadata object and its variable entries. It
never sends the collection tree or sibling OpenAPI document per request. Legacy
collections retain their metadata and sidecar precedence without conversion;
legacy global scripts are a read-only fallback.

Repositories hydrate keychain values from the supplied data. Repeated auth secret
scopes share an in-flight read only for this capture; collection variables bypass
the shared cache so disk edits appear on the next run. Current script editor
content is pinned before awaiting its pending save and overlaid on saved scripts.
Other pending edits keep their existing save behavior. Metadata is shared while
assembling targets, and final queue templates are cloned independently so
duplicate visits retain separate overrides. Captures own their loaded values;
they do not provide an atomic transaction against simultaneous external edits.
See [runner capture measurements](RUNNER_CAPTURE_PERFORMANCE.md) for the benchmark
and its limitations.

Saved runners live inside their collection as `runners/<slug>.yaml`, one file per
runner (`collections/runners.rs` reads and writes them; `collections/model.rs`
holds `RunnerDoc`). A runner belongs to the collection whose directory holds it
and references requests by id; `name`, `method` and `path` are hints for
re-linking after a merge re-ids a request. `runners/` is a reserved directory:
the reader skips it at the collection root, a request folder slugging to
`runners` is written as `runners-2/`, and the whole-tree writer never touches
it. The commands `collection_runners_list/save/delete` and
`collection_runner_data_read` are the only writers; a data file is stored
relative to the collection directory when it sits inside it and is resolved
there on read, never outside.

`RunnerRepository` caches runners per collection and maps the file shape to the
in-memory runner (`storage/runnerDoc.js`), re-attaching `collectionId` and
`endpointId` so execution capture is unchanged. Desktop-local state stays in
the store: `runnerLastRuns` (last-run timestamps), `runnerRunHistory` and the
`lastRunnerId` setting. `runner.feature.js` wires the shared repositories and
`RunnerBookkeeping`, which runs the resumable migration from the legacy
`collectionRunners` store key on every collections load (markers in
`runnersMigratedCollections`, backup in `collectionRunnersLegacyBackup`) and
clears local state when a collection is deleted. The runner tab binds to the
collection of its first queued request; the palette then offers only that
collection and the saved-runner dropdown groups runners by collection.

## Key Technologies

- **Tauri** (v2.0.0): Cross-platform desktop app framework with Rust backend
- **Rust**: Backend language for performance and security
- **reqwest** (v0.12): Async HTTP client with HTTP/2, SOCKS proxy support
- **Axum** (v0.7): Mock server HTTP framework
- **Boa Engine** (v0.19): JavaScript engine for script execution
- **CodeMirror** (v6.x): Advanced syntax highlighting and code editing
- **tauri-plugin-store**: Persistent configuration storage
- **serde_yaml**: YAML parsing for OpenAPI specs
- **esbuild** (v0.28.x): Fast JavaScript bundler
- **Jest** (v30.0.x): Testing framework

## Security Features

- Tauri's secure IPC communication
- Content Security Policy (CSP) enforcement
- Native system integration without Node.js in renderer
- Sandboxed JavaScript execution for scripts
- Minimal attack surface with Rust backend

## Development Architecture

The application follows a modular MVC-like architecture:

- **Models**: Data structures and storage repositories
- **Views**: UI components and renderers
- **Controllers**: Coordination between models and views
- **Services**: Business logic and API interactions
- **Commands**: Rust backend IPC handlers

Window geometry is tracked and saved by `tauri-plugin-window-state`. On Linux,
`src-tauri/src/window_state.rs` restores the main window after display association,
using the monitor scale and measured GTK decoration extents. Maximization waits
for the normal size to settle so unmaximizing recovers the saved bounds. This
avoids early scaling errors and [growth on each restart from GTK decorations](https://github.com/tauri-apps/plugins-workspace/issues/3553).

## Development Scripts

- `npm run dev` - Start development server with hot reload
- `npm run build` - Build frontend assets
- `npm run build:tauri` - Build production application
- `npm test` - Run tests with Jest
- `npm run test:watch` - Run tests in watch mode
- `npm run test:coverage` - Run tests with coverage report
- `npm run lint` - Run ESLint to check code quality
- `npm run lint:fix` - Automatically fix ESLint issues
- `npm run format` - Format code with Prettier
- `npm run format:check` - Check code formatting

## Adding New Features

1. Create the feature's modules in the appropriate `src/modules/` subdirectories (controller, service, repository, UI) and export them from index files
2. Add a co-located `src/modules/<name>.feature.js` descriptor that wires the stack together
3. Register the descriptor on the `FeatureRegistry` in `renderer.js` with a single `.register(...)` call — avoid manual wiring in `renderer.js`
   (order matters: a feature may `ctx.get(...)` only what earlier features `provides`; see the registration list in `renderer.js`)
4. Add Tauri commands in `src-tauri/src/commands/` if backend functionality is needed
5. Register commands in `src-tauri/src/main.rs`
