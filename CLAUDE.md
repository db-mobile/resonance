# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview
Resonance is an Electron-based API client application that provides a clean and minimal interface for testing APIs. The application supports OpenAPI/Swagger and Postman collection imports, variable templating with environments, multi-language code generation, and features a modern modular architecture with secure IPC communication between main and renderer processes.

## Development Commands

### Running the Application
- `npm start` - Start the Electron app in development mode
- `npm run build` - Build the application using esbuild

### Building and Packaging
- `npm run dist` - Create distributables for all platforms using electron-builder
- `npm run dist:linux` - Create Linux-specific distributables
- `npm run dist:dir` - Create directory distribution (unpacked)
- **Note:** Application uses ASAR packaging (`asar: true` in electron-builder config)

### Testing
- `npm test` - Run tests with Jest
- `npm run test:watch` - Run tests in watch mode
- `npm run test:coverage` - Run tests with coverage report

## Architecture

### Main Process (`src/main.js` and `src/main/`)
- Entry point for Electron application (`src/main.js`)
- Modular main process architecture in `src/main/`:
  - `windowManager.js` - Window creation and lifecycle management
  - `apiRequestHandlers.js` - HTTP request handling via axios
  - `storeHandlers.js` - electron-store IPC operations with fallback handling
  - `schemaProcessor.js` - OpenAPI schema processing and example generation
  - `openApiParser.js` - OpenAPI file import and parsing
  - `postmanParser.js` - Postman collection and environment import
  - `digestAuthHandler.js` - Digest authentication implementation
  - `proxyHandlers.js` - Proxy configuration and connection testing
- Uses `electron-store` for persistent storage of collections and variables
- Uses `electron-window-state` for window state management
- Makes HTTP requests via `axios` in the main process for security
- Handles OpenAPI file imports and parsing via `js-yaml`
- Handles Postman collection imports (v2.0 and v2.1 formats)
- Store initialization includes validation and auto-recovery for sandboxed environments

### Renderer Process (`src/renderer.js`)
- Main UI orchestrator that initializes all modules
- Imports and coordinates functionality from modular components
- Sets up event listeners and initial UI state

### Modular Architecture (`src/modules/`)
The codebase follows a sophisticated modular pattern with MVC-like separation:

#### Core Modules
- `apiHandler.js` - Handles sending requests and processing responses
- `authManager.js` - Manages authentication methods (Bearer, Basic, API Key, OAuth2, Digest)
- `codeGenerator.js` - Multi-language code generation (cURL, Python, JavaScript, Node.js, Go, PHP, Ruby, Java)
- `collectionManager.js` - Manages OpenAPI and Postman collection imports and organization
- `cookieParser.js` - Parses and displays cookies from responses
- `copyHandler.js` - Handles copying responses and request data to clipboard
- `curlGenerator.js` - Generates cURL commands from requests (legacy, now part of codeGenerator)
- `domElements.js` - Centralized DOM element references and exports
- `graphqlEditor.bundle.js` - GraphQL query editor with syntax support
- `httpVersionManager.js` - Manages HTTP protocol version selection
- `keyboardShortcuts.js` - Manages keyboard shortcuts with platform-aware bindings and help dialog
- `keyValueManager.js` - Manages key-value input pairs (headers, query params, path params)
- `logger.js` - Centralized logging with scopes and levels
- `performanceMetrics.js` - Request performance visualization (DNS, TCP, TLS, TTFB, download timing)
- `resizer.js` - Handles UI panel resizing functionality
- `responseEditor.js` - CodeMirror-based response viewer with syntax highlighting
- `ResponseContainerManager.js` - Manages response containers for workspace tabs
- `statusDisplay.js` - Manages status display updates
- `tabManager.js` - Handles tab switching functionality for request/response sections
- `themeManager.js` - Manages theme switching and settings
- `timeoutManager.js` - Manages request timeout configuration
- `WorkspaceTabStateManager.js` - Captures and restores workspace tab state

#### Architectural Layers
- `controllers/` - MVC controllers
  - CollectionController.js - Manages collection operations (OpenAPI and Postman imports)
  - EnvironmentController.js - Coordinates environment operations between UI and services
  - HistoryController.js - Manages request history
  - ProxyController.js - Manages proxy configuration and testing
  - WorkspaceTabController.js - Coordinates workspace tab operations and state
- `services/` - Business logic services
  - CollectionService.js - Collection business logic
  - EnvironmentService.js - Environment management with validation and event notifications
  - HistoryService.js - Request history tracking and management
  - ProxyService.js - Proxy configuration business logic and validation
  - VariableService.js - Variable substitution logic with environment support
  - WorkspaceTabService.js - Workspace tab management and state persistence
- `storage/` - Data persistence layer with robust error handling
  - CollectionRepository.js - Includes `_getObjectFromStore()` helper for safe store access
  - EnvironmentRepository.js - Persists environments and manages active environment state
  - HistoryRepository.js - Persists request history with validation
  - ProxyRepository.js - Persists proxy configuration
  - VariableRepository.js - Validates and initializes store data
  - WorkspaceTabRepository.js - Persists workspace tab state
- `ui/` - UI components
  - CodeSnippetDialog.js - Multi-language code export dialog
  - CollectionRenderer.js - Renders collection tree
  - ConfirmDialog.js - Confirmation dialog component
  - ContextMenu.js - Right-click context menus
  - CurlDialog.js - cURL export dialog (legacy, replaced by CodeSnippetDialog)
  - EnvironmentManager.js - Environment management dialog with full CRUD operations
  - EnvironmentSelector.js - Dropdown for quick environment switching
  - HistoryRenderer.js - Request history UI
  - RenameDialog.js - Collection/endpoint rename dialog
  - VariableManager.js - Variable management UI
  - WorkspaceTabBar.js - Workspace tab management UI
- `variables/` - Variable processing and templating (VariableProcessor.js)
- `schema/` - OpenAPI schema processing (SchemaProcessor.js)
- `interfaces/` - TypeScript-like interfaces for structure (IStatusDisplay.js)

### Additional Architecture Components
- `src/themes/` - Theme system with CSS custom properties for light, dark, system, and blueprint themes
- `src/i18n/` - Internationalization system supporting multiple languages
- `themeManager.js` - Centralized theme and settings management with unified modal interface

### Key Features

#### Collection Import Support
**OpenAPI/Swagger:**
- Import OpenAPI 3.0 specs (YAML/JSON format)
- Parse endpoints into organized collections
- Generate intelligent request examples from schemas with context-aware defaults
- Handle complex schema references and nested objects

**Postman:**
- Import Postman Collection Format v2.0 and v2.1
- Import Postman Environment files
- Preserve exact request examples from Postman collections
- Automatically extract and store collection variables
- Convert nested folder structures to flat organization by path segment
- Full authentication mapping (Bearer, Basic, API Key, OAuth2, Digest)
- Support for all Postman body modes (raw, urlencoded, formdata, GraphQL)

#### Variable System
- Template variable support using `{{ variableName }}` syntax
- Environment-scoped variables for API keys, base URLs, etc.
- Automatic substitution in URLs, headers, and request bodies
- Variable management UI for easy editing
- Variables are organized within environments for different contexts (e.g., Development, Staging, Production)

#### Environment Management
- Create, edit, delete, and duplicate environments via `EnvironmentController`
- Switch between environments with dropdown selector (`EnvironmentSelector`)
- Full-featured environment management dialog (`EnvironmentManager`)
- Environment-specific variable sets for different API contexts
- Import/export environments as JSON for backup and sharing
- Active environment state persisted across sessions
- Event-driven architecture for environment changes with listener notifications
- Validation and error handling for environment operations

#### Request Body Schema Generation
- Automatically generates example request bodies from OpenAPI schemas
- Supports nested objects, arrays, and complex data types
- Handles $ref resolution for schema references

#### Authentication Support
- Multiple authentication methods via `authManager.js`
- Supported types: Bearer Token, Basic Auth, API Key, OAuth2, Digest Auth
- Authentication state persisted per request
- Secure credential handling
- Per-request and collection-level authentication configuration

#### Request History
- Complete request/response history tracking via `HistoryController`
- Persistent storage of request history with timestamps
- History UI for browsing and replaying past requests
- Automatic cleanup and management

#### Advanced Features
- **Multi-Language Code Generation**: Export requests in 9 languages via `codeGenerator.js`
  - cURL, Python (requests), JavaScript (Fetch), JavaScript (Axios)
  - Node.js (axios), Go (net/http), PHP (cURL), Ruby (net/http), Java (HttpClient)
- **GraphQL Support**: Dedicated GraphQL query editor with syntax support
- **Workspace Tabs**: Multiple concurrent request tabs with independent state
  - Save and restore tab state across sessions
  - Switch between tabs with keyboard shortcuts (Ctrl/Cmd+1-9)
  - Per-tab request/response isolation
- **Performance Metrics**: Detailed request timing breakdown
  - DNS lookup, TCP connection, TLS handshake timing
  - Time to First Byte (TTFB), content download time
  - Visual timeline representation
- **Cookie Management**: Parse and display response cookies
  - Cookie attributes (domain, path, expires, httpOnly, secure)
  - Dedicated Cookies tab in response viewer
- **Proxy Support**: HTTP/HTTPS proxy configuration
  - Authentication support for proxies
  - Bypass list for specific domains
  - Connection testing
- **Syntax Highlighting**: CodeMirror-based response viewer with language detection
- **HTTP Version Control**: Support for HTTP/1.1, HTTP/2, and HTTP/3
- **Request Timeouts**: Configurable timeout settings per request
- **Copy to Clipboard**: Easy copying of responses and request data
- **Keyboard Shortcuts**: Comprehensive keyboard shortcuts system via `keyboardShortcuts.js`
  - Platform-aware (⌘ on macOS, Ctrl on Windows/Linux)
  - Context-aware activation (respects input field focus)
  - Categorized help dialog with i18n support (Ctrl/Cmd+/)
  - Available shortcuts for requests, navigation, actions, settings, and tab switching

#### Theme System
- Dynamic theme loading via `ThemeManager` class
- Available themes: light, dark, system (follows OS preference), blueprint
- CSS custom properties-based architecture with semantic naming
- Theme preferences persisted via electron-store
- Automatic OS theme detection and response

#### Internationalization (i18n)
- Multi-language support via `I18nManager` class in `src/i18n/`
- Supported languages: English, German, Spanish, French, Italian
- Translation interpolation with `{{variableName}}` syntax
- Automatic UI updates via `data-i18n` attributes
- Language preferences persisted via electron-store

### Security Configuration
- `contextIsolation: true` and `nodeIntegration: false` in webPreferences
- Uses `preload.js` to expose safe APIs via `contextBridge`
- ASAR packaging enabled for code integrity and protection
- **Preload Path:** Uses `__dirname` for reliable preload script resolution in both dev and packaged (ASAR) environments
- Secure credential handling in authentication manager

### Key Dependencies
- **Electron** (v35.0.0) - Cross-platform desktop framework
- **Axios** (v1.10.0) - HTTP client for API requests in main process
- **CodeMirror** (v6.x) - Advanced syntax highlighting and code editing
  - `@codemirror/lang-json`, `@codemirror/lang-html`, `@codemirror/lang-xml`
  - `@codemirror/language`, `@codemirror/state`, `@codemirror/view`
- **electron-store** (v10.1.0) - Persistent configuration storage
- **electron-window-state** (v5.0.3) - Window state management
- **js-yaml** (v4.1.0) - YAML parsing for OpenAPI specs
- **esbuild** (v0.25.x) - Fast JavaScript bundler for build process
- **electron-builder** (v26.0.x) - Application packaging and distribution
- **Jest** (v30.0.x) - Testing framework with Babel integration

### Data Persistence
- Uses `electron-store` to persist collections, variables, environments, and request history in JSON format
- Store name: `api-collections` with default structure `{ collections: [] }`
- IPC handlers for `store:get`, `store:set`, `settings:get`, and `settings:set` operations
- Separate storage for collection data, environments, variables, theme preferences, language settings, and request history
- **Environment Storage:** Environments stored with structure `{ items: [], activeEnvironmentId: null }`
- **Important:** Repository layer includes fallback handling for packaged apps where store may return `undefined` on first run
- All store access methods validate data types and auto-initialize with defaults if needed

## UI Structure
- Split layout with collections sidebar and main content area
- Collection hierarchy with expandable endpoints
- **Import menu** with context menu (OpenAPI, Postman Collection, Postman Environment)
- **Workspace tabs** for managing multiple concurrent requests
- Environment selector dropdown for quick switching between environments
- Tabbed interface for request configuration (Path Params, Query Params, Headers, Body, Auth)
- Tabbed response display (Body, Headers, Cookies, Performance)
- Context menus for collection management (rename, delete, export code in multiple languages)
- Request history panel with search, timestamp, and replay functionality
- Authentication panel supporting multiple auth methods (Bearer, Basic, API Key, OAuth2, Digest)
- Environment management dialog with full CRUD operations and import/export
- Settings modal for theme, language, timeout, and proxy configuration
- Keyboard shortcuts help dialog (`Ctrl/Cmd+/`) with categorized shortcuts
- Code snippet export dialog with multi-language support
- Resizable panels for customizable workspace layout
- Support for multiple HTTP methods (GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS)
- HTTP version selector (HTTP/1.1, HTTP/2, HTTP/3)

## Key Patterns
- ES6 modules throughout renderer process (`import`/`export`)
- ES6 modules in main process (using `type: "module"` in package.json)
- CommonJS in preload script (`require`)
- Repository pattern for data access with defensive programming
  - All repository methods validate data types before use
  - Auto-initialization of undefined store values
  - Graceful degradation for packaged app environments
- Service layer for business logic separation
- MVC-like controller pattern for UI coordination
- Centralized DOM element management in `domElements.js`
- IPC communication pattern: renderer → preload → main process → external APIs
- Modular event handling with separate initialization functions
- CSS custom properties for theming with semantic naming conventions
- Attribute-based i18n with automatic DOM updates (`data-i18n` attributes)
- Unified settings management through modal interface
- **CodeMirror Integration**: `responseEditor.js` bundled separately with esbuild for optimal loading
- **Dialog Pattern**: Reusable dialog components (ConfirmDialog, RenameDialog, CodeSnippetDialog, EnvironmentManager, KeyboardShortcuts Help) for user interactions
- **History Tracking**: Automatic request/response capture with timestamp and replay capability
- **Authentication State**: Per-request auth configuration with secure storage
- **Copy/Export Pattern**: Unified handlers for clipboard operations and format exports (multi-language code, environments)
- **Environment Pattern**: Event-driven environment management with controller coordination, service business logic, and repository persistence
- **Change Listeners**: Observer pattern for environment changes with notification system for UI synchronization
- **Keyboard Shortcuts Pattern**: Centralized keyboard event handling with platform detection, context awareness, and categorized help system
- **Import Pattern**: Unified collection import supporting both OpenAPI (schema-based) and Postman (example-based) formats with consistent folder organization
- **Workspace Tab Pattern**: Multi-tab state management with per-tab isolation and persistent state across sessions

## Common Issues & Solutions

### Packaged App Issues
1. **Store returns undefined on first run:**
   - Repository layer automatically detects and initializes with defaults
   - See `_getObjectFromStore()` helper in CollectionRepository.js

2. **Preload script not loading:**
   - WindowManager uses `__dirname` for correct path resolution in ASAR
   - Works in both development and packaged environments

3. **Path resolution in packaged apps:**
   - Use `app.isPackaged` to detect environment
   - Use `process.resourcesPath` for assets in packaged apps
   - Use `__dirname` for internal module paths
- for all changes "npm run lint" must always pass