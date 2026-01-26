# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Resonance is a local-first, zero-account API client built with Tauri v2.0.0. It's a cross-platform desktop application (Linux, macOS, Windows) for REST/GraphQL testing, OpenAPI/Postman import, mock server, scripting, and environment management.

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
npm run test:coverage    # Generate coverage report
```

## Code Quality

```bash
npm run lint             # Run ESLint
npm run lint:fix         # Auto-fix ESLint issues
npm run format           # Format with Prettier
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
