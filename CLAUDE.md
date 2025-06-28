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

### Testing
- `npm test` - Currently outputs "no test specified" error (no tests configured)

## Architecture

### Main Process (`src/main.js`)
- Entry point for Electron application
- Manages BrowserWindow creation and lifecycle
- Handles IPC communication for API requests, file operations, and data persistence
- Uses `electron-store` for persistent storage of collections and variables
- Uses `electron-window-state` for window state management
- Makes HTTP requests via `axios` in the main process for security
- Handles OpenAPI file imports and parsing via `js-yaml`

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
- `storage/` - Data persistence layer (CollectionRepository.js, VariableRepository.js)
- `ui/` - UI components (CollectionRenderer.js, ContextMenu.js, RenameDialog.js, VariableManager.js)
- `variables/` - Variable processing and templating (VariableProcessor.js)
- `schema/` - OpenAPI schema processing (SchemaProcessor.js)
- `interfaces/` - TypeScript-like interfaces for structure (IStatusDisplay.js)

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

### Security Configuration
- `contextIsolation: true` and `nodeIntegration: false` in webPreferences
- Uses `preload.js` to expose safe APIs via `contextBridge`
- Electron Forge fuses configured for security (RunAsNode disabled, cookie encryption enabled, etc.)

### Data Persistence
- Uses `electron-store` to persist collections and variables in JSON format
- Store name: `api-collections` with default structure `{ collections: [] }`
- IPC handlers for `store:get` and `store:set` operations
- Separate storage for collection data and variables

## UI Structure
- Split layout with collections sidebar and main content area
- Collection hierarchy with expandable endpoints
- Tabbed interface for request configuration (Query Params, Headers, Body)
- Tabbed response display (Body, Headers)
- Context menus for collection management (rename, delete)
- Support for multiple HTTP methods (GET, POST, PUT, DELETE, PATCH)

## Key Patterns
- ES6 modules throughout renderer process (`import`/`export`)
- CommonJS in main process and preload script (`require`)
- Repository pattern for data access
- Service layer for business logic separation
- MVC-like controller pattern for UI coordination
- Centralized DOM element management in `domElements.js`
- IPC communication pattern: renderer → preload → main process → external APIs
- Modular event handling with separate initialization functions