# Production Logging System

Resonance uses `electron-log` for production-tier logging across both main and renderer processes.

## Features

- **File logging** with automatic rotation (10MB max per file)
- **Console logging** with environment-aware levels
- **Scoped logging** for better organization
- **Structured metadata** support
- **Automatic log file location** management

## Log Levels

The logging system supports 5 log levels (from most to least severe):

1. **error** - Errors and exceptions
2. **warn** - Warnings and potential issues
3. **info** - General information messages
4. **debug** - Debugging information
5. **verbose** - Detailed tracing information

### Environment-Specific Behavior

#### Development Mode (unpacked app)
- Console: Shows all levels (debug and above)
- File: Logs all levels (debug and above)

#### Production Mode (packaged app)
- Console: Shows only warnings and errors
- File: Logs info and above

## Log File Location

Logs are automatically stored in:
- **Linux:** `~/.config/Resonance/logs/main.log`
- **macOS:** `~/Library/Logs/Resonance/main.log`
- **Windows:** `%USERPROFILE%\AppData\Roaming\Resonance\logs\main.log`

## Usage

### Main Process

```javascript
import loggerService from './services/LoggerService.js';

// Create scoped logger
const log = loggerService.scope('ModuleName');

// Log messages
log.error('Something failed', { error: errorObject });
log.warn('Potential issue detected', { details: 'info' });
log.info('Operation completed successfully');
log.debug('Detailed state information', { state: currentState });
log.verbose('Trace-level details');

// Get log file path
const logPath = loggerService.getLogPath();
```

### Renderer Process

The renderer process uses a logger wrapper that communicates with electron-log through the preload script's exposed API.

```javascript
import logger from './modules/logger.js';

// Create scoped logger
const log = logger.scope('ComponentName');

// Log messages (same API as main process)
log.error('UI error occurred', { component: 'MyComponent' });
log.warn('User action may cause issues');
log.info('Feature initialized');
log.debug('State updated', { newState: state });
```

**Note:** The renderer logger uses `window.electronAPI.logger` which communicates with the main process via IPC. All log messages from the renderer are forwarded to the main process logger, which handles file writing and console output.

## Best Practices

### 1. Always Use Scoped Loggers

```javascript
// Good
const log = logger.scope('ApiHandler');
log.info('Request sent');

// Bad
logger.info('Request sent'); // No scope context
```

### 2. Include Structured Metadata

```javascript
// Good
log.error('API request failed', {
    url: requestUrl,
    status: response.status,
    error: error.message
});

// Bad
log.error(`API request failed: ${requestUrl} - ${error.message}`);
```

### 3. Use Appropriate Log Levels

```javascript
// Errors - for exceptions and failures
log.error('Database connection failed', { error });

// Warnings - for recoverable issues
log.warn('Rate limit approaching', { remaining: requests });

// Info - for significant events
log.info('User logged in', { userId });

// Debug - for development/troubleshooting
log.debug('Cache hit', { key, value });

// Verbose - for detailed tracing
log.verbose('Function entry', { params });
```

### 4. Avoid Logging Sensitive Data

```javascript
// Bad
log.info('User authenticated', { password: user.password });

// Good
log.info('User authenticated', { userId: user.id });
```

### 5. Use Meaningful Scope Names

```javascript
// Good scope names
logger.scope('WorkspaceTabManager')
logger.scope('ApiRequestHandler')
logger.scope('CollectionService')

// Bad scope names
logger.scope('utils')
logger.scope('helpers')
```

## Migration from console.log

The logging system has replaced all `console.log` statements to comply with production logging standards:

```javascript
// Before
console.log('[WorkspaceTabManager] Restoring response:', response);
console.warn('Tab not found:', tabId);

// After
const log = logger.scope('WorkspaceTabManager');
log.debug('Restoring response', { response });
log.warn('Tab not found', { tabId });
```

## Viewing Logs

### During Development

Logs appear in both:
1. The DevTools console (when app is running)
2. The log file (persisted across sessions)

### In Production

To access logs from a packaged app:
1. Navigate to the log file location (see "Log File Location" above)
2. Open the log file with any text editor

### Programmatically

```javascript
// Get log file path and open it
import loggerService from './services/LoggerService.js';
import { shell } from 'electron';

const logPath = loggerService.getLogPath();
shell.showItemInFolder(logPath);
```

## Troubleshooting

### Logs Not Appearing

1. Check if logger is initialized:
   ```javascript
   // In main.js, should be called early
   loggerService.initialize({
       appName: 'Resonance',
       isDevelopment: !app.isPackaged
   });
   ```

2. Verify log level is appropriate:
   ```javascript
   // Debug logs won't show in production console
   log.debug('This only shows in dev mode');

   // Use info or higher for production visibility
   log.info('This shows in production');
   ```

### Performance Concerns

- Logging is asynchronous and won't block execution
- File I/O is handled by electron-log efficiently
- Use `debug` and `verbose` levels for high-frequency logs
- These levels are automatically filtered in production

## Architecture

```
┌─────────────────────────────────────────────┐
│         Main Process                         │
│  ┌────────────────────────────────────┐     │
│  │   LoggerService.js                  │     │
│  │   (main process logger)             │     │
│  └────────────────────────────────────┘     │
└─────────────────────────────────────────────┘
                   │
                   │ electron-log
                   │
┌─────────────────────────────────────────────┐
│         Preload Script                       │
│  ┌────────────────────────────────────┐     │
│  │   preload.js                        │     │
│  │   Exposes logger via contextBridge  │     │
│  │   Uses IPC to forward logs          │     │
│  └────────────────────────────────────┘     │
└─────────────────────────────────────────────┘
                   │
                   │ IPC (logger:error, logger:warn, etc.)
                   │
┌─────────────────────────────────────────────┐
│       Renderer Process                       │
│  ┌────────────────────────────────────┐     │
│  │   logger.js                         │     │
│  │   (renderer logger wrapper)         │     │
│  └────────────────────────────────────┘     │
└─────────────────────────────────────────────┘
                   │
                   ▼
        ┌──────────────────────┐
        │   Log Files           │
        │   (persistent storage)│
        └──────────────────────┘
```

The renderer process logger forwards all log messages to the main process via IPC handlers. The preload script exposes the logger API through contextBridge, which invokes IPC handlers (`logger:error`, `logger:warn`, etc.) in the main process. This ensures:

- **Security**: Maintains Electron's security model with sandboxed renderer
- **Centralized logging**: All logs (main + renderer) written by main process
- **File access**: Avoids file system access from renderer process
- **Simplicity**: Single electron-log instance in main process

## Dependencies

- **electron-log** (^5.x) - Core logging functionality
- Automatically included in production builds

## Configuration

Current configuration in `LoggerService.js`:

```javascript
// File rotation
maxSize: 10 * 1024 * 1024 (10MB)

// Log format
file: '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}'
console: '[{h}:{i}:{s}] [{level}] {text}' (dev)
         '{text}' (production)
```

To customize, modify `LoggerService.js` initialization.
