# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview
Resonance is an Electron-based API client application that provides a clean and minimal interface for testing APIs. The application supports OpenAPI/Swagger collection imports, variable templating, and features a modern modular architecture with secure IPC communication between main and renderer processes.

## Development Commands

### Running the Application
- `npm start` - Start the Electron app in development mode
- `electron-forge start` - Alternative way to start the application

### Building and Packaging
- `npm run package` - Package the application for the current platform
- `npm run make` - Create distributables (zip, deb, rpm, squirrel)
- `npm run make:debian` - Create Debian (.deb) package specifically
- **Note:** Application uses ASAR packaging (`asar: true` in forge.config.js)

### Testing
- `npm test` - Currently outputs "no test specified" error (no tests configured)

## Architecture

### Main Process (`src/main.js` and `src/main/`)
- Entry point for Electron application (`src/main.js`)
- Modular main process architecture in `src/main/`:
  - `windowManager.js` - Window creation and lifecycle management
  - `apiRequestHandlers.js` - HTTP request handling via axios
  - `storeHandlers.js` - electron-store IPC operations with fallback handling
  - `schemaProcessor.js` - OpenAPI schema processing
  - `openApiParser.js` - OpenAPI file import and parsing
- Uses `electron-store` for persistent storage of collections and variables
- Uses `electron-window-state` for window state management
- Makes HTTP requests via `axios` in the main process for security
- Handles OpenAPI file imports and parsing via `js-yaml`
- Store initialization includes validation and auto-recovery for sandboxed environments

### Renderer Process (`src/renderer.js`)
- Main UI orchestrator that initializes all modules
- Imports and coordinates functionality from modular components
- Sets up event listeners and initial UI state

### Modular Architecture (`src/modules/`)
The codebase follows a sophisticated modular pattern with MVC-like separation:

#### Core Modules
- `apiHandler.js` - Handles sending requests and processing responses
- `collectionManager.js` - Manages OpenAPI collection imports and organization
- `domElements.js` - Centralized DOM element references and exports
- `keyValueManager.js` - Manages key-value input pairs (headers, query params)
- `statusDisplay.js` - Manages status display updates
- `tabManager.js` - Handles tab switching functionality for request/response sections

#### Architectural Layers
- `controllers/` - MVC controllers (CollectionController.js)
- `services/` - Business logic services (CollectionService.js, VariableService.js)
- `storage/` - Data persistence layer with robust error handling
  - CollectionRepository.js - Includes `_getObjectFromStore()` helper for safe store access
  - VariableRepository.js - Validates and initializes store data
- `ui/` - UI components (CollectionRenderer.js, ContextMenu.js, RenameDialog.js, VariableManager.js)
- `variables/` - Variable processing and templating (VariableProcessor.js)
- `schema/` - OpenAPI schema processing (SchemaProcessor.js)
- `interfaces/` - TypeScript-like interfaces for structure (IStatusDisplay.js)

### Additional Architecture Components
- `src/themes/` - Theme system with CSS custom properties for light, dark, system, and blueprint themes
- `src/i18n/` - Internationalization system supporting multiple languages
- `themeManager.js` - Centralized theme and settings management with unified modal interface

### Key Features

#### OpenAPI Collection Support
- Import OpenAPI 3.0 specs (YAML/JSON format)
- Parse endpoints into organized collections
- Generate request examples from schemas
- Handle complex schema references and nested objects

#### Variable System
- Template variable support using `{{ variableName }}` syntax
- Collection-scoped variables for API keys, base URLs, etc.
- Automatic substitution in URLs, headers, and request bodies
- Variable management UI for easy editing

#### Request Body Schema Generation
- Automatically generates example request bodies from OpenAPI schemas
- Supports nested objects, arrays, and complex data types
- Handles $ref resolution for schema references

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
- Electron Forge fuses configured for security (RunAsNode disabled, cookie encryption enabled, etc.)
- **Preload Path:** Uses `__dirname` for reliable preload script resolution in both dev and packaged (ASAR) environments

### Data Persistence
- Uses `electron-store` to persist collections and variables in JSON format
- Store name: `api-collections` with default structure `{ collections: [] }`
- IPC handlers for `store:get`, `store:set`, `settings:get`, and `settings:set` operations
- Separate storage for collection data, variables, theme preferences, and language settings
- **Important:** Repository layer includes fallback handling for packaged apps where store may return `undefined` on first run
- All store access methods validate data types and auto-initialize with defaults if needed

## UI Structure
- Split layout with collections sidebar and main content area
- Collection hierarchy with expandable endpoints
- Tabbed interface for request configuration (Query Params, Headers, Body)
- Tabbed response display (Body, Headers)
- Context menus for collection management (rename, delete)
- Support for multiple HTTP methods (GET, POST, PUT, DELETE, PATCH)

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