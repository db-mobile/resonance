# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Resonance is a local-first, zero-account API client built with Tauri v2.0.0. It's a cross-platform desktop application (Linux, macOS, Windows) supporting REST, GraphQL, gRPC (with server reflection), and WebSocket protocols, plus OpenAPI/Postman import, a built-in mock server, pre-request/test scripting, collection runner, client certificates (mTLS) with custom CA trust, and environment management.

**Prerequisites**: Node.js v20+, Rust stable.

Collections, environments, history, and settings are persisted as human-readable JSON files (git-friendly) via the repository layer in `src/modules/storage/`.

## Build Commands

```bash
npm run dev              # Start dev server with hot reload (Tauri dev mode)
npm run build            # Build frontend assets (esbuild bundling)
npm run build:tauri      # Build production application
```

## Testing

```bash
npm test                 # Run Jest tests
npm test -- --testPathPattern="VariableService"  # Run single test file
npm run test:watch       # Run tests in watch mode
npm run test:coverage    # Generate coverage report
```

## Code Quality

```bash
npm run lint             # Run ESLint
npm run lint:fix         # Auto-fix ESLint issues
npm run format           # Format with Prettier
npm run format:check     # Check formatting without writing
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check   # Check Rust formatting
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings  # Lint Rust
```

## Architecture

### Frontend (Vanilla JavaScript)
- **Entry Point**: `src/renderer.js` - orchestrates all modules
- **IPC Bridge**: `src/modules/ipcBridge.js` - abstraction layer for Tauri IPC, use `window.electronAPI.*`
- **Bundled Editors**: CodeMirror v6 editors in `src/modules/*.bundle.js`

### Backend (Rust)
- **Entry Point**: `src-tauri/src/main.rs`
- **Commands**: `src-tauri/src/commands/` - IPC handlers for HTTP requests, mock server, scripts, storage
- **Key crates**:
  - `reqwest` v0.12 — async HTTP client (HTTP/2, SOCKS proxy)
  - `Axum` v0.7 — powers the built-in mock server
  - `Boa Engine` v0.19 — JS engine for pre-request/test scripts (sandboxed, 10s timeout)
  - `tauri-plugin-store` — persistent config storage
  - `serde_yaml` — OpenAPI YAML parsing

### Scripts Subsystem
Pre-request and test scripts execute in Boa with access to: `request` (mutable URL/method/headers/body/params), `response` (test scripts only — status/headers/body/cookies/timings), `environment` (get/set/delete env vars), `console`, and `expect()` assertions. See `SCRIPTS.md` for the full API.

### Module Organization
```
src/modules/
├── controllers/    # MVC controllers - coordinate services and UI
├── services/       # Business logic with event emission
├── storage/        # Repository pattern for data persistence
├── ui/             # UI components and dialogs
├── variables/      # Variable processor ({{ varName }}) and dynamic variables ({{$uuid}})
└── schema/         # OpenAPI schema handling
```

### Key Patterns

1. **Observer Pattern**: Services emit change events (e.g., 'environment-switched') that controllers listen to with `.addChangeListener(callback)`

2. **Dependency Injection**: Controllers/services receive dependencies via constructors

3. **Repository Pattern**: Repositories validate data, auto-initialize defaults, and use defensive programming

4. **Variable System**:
   - Static: `{{ variableName }}` - resolved from environments
   - Dynamic: `{{$uuid}}`, `{{$timestamp}}`, etc. - generated at request time

### Adding New Features

1. Create modules in appropriate `src/modules/` subdirectories
2. Export from index files
3. Import and initialize in `renderer.js`
4. For backend functionality: add Tauri commands in `src-tauri/src/commands/` and register in `main.rs`

## ESLint Rules (Enforced)

- `prefer-const`, `no-var`, `eqeqeq: always`, `curly: all` - all errors
- `no-eval`, `no-implied-eval` - errors
- Unused variables prefixed with `_` are ignored
- `max-depth: 4`, `max-nested-callbacks: 3` - warnings
