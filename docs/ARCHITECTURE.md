# Architecture

Technical overview of Resonance for contributors. For usage documentation, see the [documentation site](https://db-mobile.github.io/resonance/).

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
    ├── codeGenerator.js        # Multi-language code export
    ├── *.feature.js            # Per-feature wiring descriptors
    └── [60+ other modules]     # Protocol handlers (gRPC, WebSocket, MQTT, SSE), editors, managers

src-tauri/
├── Cargo.toml         # Rust dependencies
├── tauri.conf.json    # Tauri configuration
└── src/
    ├── main.rs        # Application entry point
    └── commands/      # IPC command handlers
        ├── api_request.rs        # HTTP requests with reqwest (mTLS, multipart/binary bodies)
        ├── grpc_reflection.rs    # gRPC server reflection (v1/v1alpha negotiation)
        ├── grpc_streaming.rs     # gRPC unary and streaming calls
        ├── grpc_proto.rs         # Proto descriptor handling
        ├── websocket.rs          # WebSocket connections
        ├── sse.rs                # Server-Sent Events streaming
        ├── mqtt.rs               # MQTT broker connections
        ├── graphql_subscription.rs  # GraphQL subscriptions (graphql-transport-ws)
        ├── mock_server.rs        # Mock server with Axum
        ├── scripts.rs            # JavaScript execution with Boa Engine
        ├── import_export/        # OpenAPI/Postman import and export
        ├── collections.rs        # Git-friendly collection file storage
        ├── store.rs              # Settings/data persistence
        ├── secrets.rs            # OS keychain secret storage
        ├── oauth.rs              # OAuth 2.0 token fetching
        ├── proxy.rs              # Proxy configuration
        ├── certificates.rs       # Native file picker for client certificate (mTLS) files
        ├── tls.rs                # Shared TLS helpers (PEM loading, skip-verify)
        └── updater.rs            # Auto-update and install-type detection
```

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
4. Add Tauri commands in `src-tauri/src/commands/` if backend functionality is needed
5. Register commands in `src-tauri/src/main.rs`
