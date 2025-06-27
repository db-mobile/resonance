# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview
This is an Electron-based API client application that allows users to make HTTP requests, manage request history, and view responses. The application features a desktop GUI built with HTML/CSS/JS and uses Electron's IPC communication between main and renderer processes.

## Development Commands

### Running the Application
- `npm start` or `npm run start` - Start the Electron app in development mode
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
- Handles IPC communication for API requests and data persistence
- Uses `electron-store` for persistent storage of request history
- Uses `electron-window-state` for window state management
- Makes HTTP requests via `axios` in the main process for security

### Renderer Process (`src/renderer.js`)
- Main UI orchestrator that initializes all modules
- Imports and coordinates functionality from modular components
- Sets up event listeners and initial UI state

### Modular Architecture (`src/modules/`)
The codebase follows a modular pattern with separate concerns:

- `apiHandler.js` - Handles sending requests and processing responses
- `domElements.js` - Centralized DOM element references and exports
- `keyValueManager.js` - Manages key-value input pairs (headers, query params)
- `requestHistory.js` - Handles saving/loading request history via electron-store
- `statusDisplay.js` - Manages status display updates
- `tabManager.js` - Handles tab switching functionality for request/response sections

### Security Configuration
- `contextIsolation: true` and `nodeIntegration: false` in webPreferences
- Uses `preload.js` to expose safe APIs via `contextBridge`
- Electron Forge fuses configured for security (RunAsNode disabled, cookie encryption enabled, etc.)

### Data Persistence
- Uses `electron-store` to persist request history in JSON format
- Store name: `api-requests` with default empty requests array
- IPC handlers for `store:get` and `store:set` operations

## UI Structure
- Split layout with request history sidebar and main content area
- Tabbed interface for request configuration (Query Params, Headers, Body)
- Tabbed response display (Body, Headers)
- Support for multiple HTTP methods (GET, POST, PUT, DELETE, PATCH)

## Key Patterns
- ES6 modules throughout renderer process (`import`/`export`)
- CommonJS in main process and preload script (`require`)
- Centralized DOM element management in `domElements.js`
- IPC communication pattern: renderer → preload → main process → external APIs
- Modular event handling with separate initialization functions