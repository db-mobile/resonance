# CLAUDE.md

## Project Overview
Resonance is an Electron-based API client for testing APIs with OpenAPI/Postman import, variable templating, multi-language code generation, and a modular MVC architecture.

## Development Commands
- `npm start` - Development mode
- `npm run build` - Build with esbuild
- `npm run dist` - Package for all platforms (uses ASAR)
- `npm test` - Run Jest tests
- `npm run lint` - Lint (must pass before commits)

## Architecture

### Process Structure
- **Main Process** (`src/main.js`, `src/main/`)
  - Electron entry point with modular handlers
  - HTTP requests via axios for security
  - IPC handlers for store, requests, scripts, mock server
  - Sandboxed script execution (10s timeout)
  - Uses `electron-store` for persistence, `js-yaml` for OpenAPI parsing

- **Renderer Process** (`src/renderer.js`)
  - UI orchestrator importing modular components
  - ES6 modules throughout

- **Preload** (`preload.js`)
  - CommonJS, exposes safe APIs via `contextBridge`
  - Path: Uses `__dirname` for ASAR compatibility

### Module Organization (`src/modules/`)
Follows MVC pattern with layered separation:

- **Layers:**
  - `controllers/` - UI coordination (Collection, Environment, History, MockServer, Proxy, Script, WorkspaceTab)
  - `services/` - Business logic with validation
  - `storage/` - Data persistence via `electron-store` (includes `_getObjectFromStore()` fallback helper)
  - `ui/` - Reusable dialogs and renderers
  - `variables/` - Variable templating (`{{ variableName }}` syntax)
  - `schema/` - OpenAPI schema processing

- **Core Modules:** `domElements.js`, `apiHandler.js`, `authManager.js`, `codeGenerator.js`, `keyboardShortcuts.js`, `themeManager.js`, CodeMirror editors

### Key Features
- **Collections:** Import OpenAPI 3.0 (YAML/JSON) and Postman v2.x (collections/environments)
- **Variables:** Environment-scoped templating with `{{ }}` syntax
- **Auth:** Bearer, Basic, API Key, OAuth2, Digest
- **Scripts:** Pre-request and test scripts with sandboxed execution, `expect()` assertions, environment integration (see `SCRIPTS.md`)
- **Mock Server:** Local HTTP server with OpenAPI schema-generated responses
- **Code Gen:** Export to 9 languages (cURL, Python, JS, Node, Go, PHP, Ruby, Java)
- **GraphQL:** Dedicated query/variables editors with syntax highlighting
- **Workspace Tabs:** Multi-tab state with persistence
- **i18n:** 5 languages (EN, DE, ES, FR, IT) via `data-i18n` attributes
- **Themes:** Light, dark, system, blueprint via CSS custom properties

### Data Persistence
`electron-store` with IPC handlers (`store:get/set`, `settings:get/set`):
- Collections: `{ collections: [] }`
- Environments: `{ items: [], activeEnvironmentId: null }`
- Scripts: `{ preRequestScript: '', testScript: '' }` per endpoint
- Repository layer validates/auto-initializes on undefined values

## Key Patterns
- **Modules:** ES6 in renderer/main (via `type: "module"`), CommonJS in preload
- **Architecture:** Repository → Service → Controller pattern with defensive programming
- **IPC:** Renderer → Preload → Main → External APIs
- **Security:** `contextIsolation: true`, `nodeIntegration: false`, ASAR packaging
- **DOM:** Centralized element refs in `domElements.js`
- **Events:** Observer pattern for environment changes, modular event handling
- **Auto-save:** 1s debounce for scripts and GraphQL editors

## Common Issues

### Packaged Apps (ASAR)
1. **Store returns undefined:** Repository `_getObjectFromStore()` auto-initializes
2. **Preload paths:** Use `__dirname` (not `app.getAppPath()`)
3. **Resource paths:** Use `app.isPackaged` check, `process.resourcesPath` for assets