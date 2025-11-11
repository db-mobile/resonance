# JSDoc Style Guide for Resonance

This document defines the JSDoc standards for the Resonance project.

## General Principles

1. **All exported functions, classes, and methods must have JSDoc comments**
2. **Use consistent formatting and terminology**
3. **Include examples for complex functions**
4. **Document exceptions and edge cases**

## File-Level Documentation

Every module should start with a file-level JSDoc comment:

```javascript
/**
 * @fileoverview Brief description of the module's purpose
 * @module moduleName
 */
```

## Class Documentation

```javascript
/**
 * Brief description of the class
 *
 * @class
 * @classdesc Detailed description of what the class does and its responsibilities
 */
class ExampleClass {
    /**
     * Creates an instance of ExampleClass
     *
     * @param {Object} options - Configuration options
     * @param {string} options.name - The name property
     * @param {number} options.count - The count property
     */
    constructor(options) {
        // ...
    }
}
```

## Method/Function Documentation

### Basic Function

```javascript
/**
 * Brief one-line description of what the function does
 *
 * Optional longer description providing more context about the function's
 * purpose, behavior, and any important implementation details.
 *
 * @param {string} param1 - Description of param1
 * @param {number} param2 - Description of param2
 * @param {Object} [optionalParam] - Optional parameter description
 * @returns {Promise<Object>} Description of what is returned
 * @throws {Error} When invalid parameters are provided
 *
 * @example
 * const result = await exampleFunction('test', 42);
 * console.log(result);
 */
async function exampleFunction(param1, param2, optionalParam) {
    // ...
}
```

### Async Functions

Always specify `@async` or use `Promise<T>` in the return type:

```javascript
/**
 * Fetches user data from the API
 *
 * @async
 * @param {string} userId - The user ID
 * @returns {Promise<Object>} The user data object
 * @throws {Error} If the user is not found
 */
async function fetchUser(userId) {
    // ...
}
```

### Callbacks

```javascript
/**
 * Registers a callback for events
 *
 * @param {Function} callback - The callback function
 * @param {Object} callback.event - The event object passed to the callback
 * @param {string} callback.event.type - The event type
 * @returns {void}
 */
function onEvent(callback) {
    // ...
}
```

## Type Definitions

### Complex Objects

Use `@typedef` for complex object structures:

```javascript
/**
 * @typedef {Object} RequestConfig
 * @property {string} method - HTTP method (GET, POST, etc.)
 * @property {string} url - The request URL
 * @property {Object.<string, string>} headers - Request headers
 * @property {Object} [body] - Optional request body
 */

/**
 * Sends an API request
 *
 * @param {RequestConfig} config - The request configuration
 * @returns {Promise<Object>} The response data
 */
async function sendRequest(config) {
    // ...
}
```

### Enums

```javascript
/**
 * @enum {string}
 */
const HttpMethod = {
    GET: 'GET',
    POST: 'POST',
    PUT: 'PUT',
    DELETE: 'DELETE'
};
```

## Parameter Types

### Common Types

- Primitives: `{string}`, `{number}`, `{boolean}`, `{null}`, `{undefined}`
- Objects: `{Object}`, `{Array}`, `{Function}`
- Specific: `{HTMLElement}`, `{Error}`, `{Promise}`
- Union: `{string|number}` (value can be string or number)
- Array of type: `{Array<string>}` or `{string[]}`
- Object with specific shape: `{Object.<string, number>}` (object with string keys and number values)

### Optional Parameters

```javascript
/**
 * @param {string} required - This parameter is required
 * @param {string} [optional] - This parameter is optional
 * @param {string} [optionalWithDefault='default'] - Optional with default value
 */
```

### Nullable Types

```javascript
/**
 * @param {?string} nullableString - Can be string or null
 * @param {!string} nonNullString - Cannot be null
 */
```

## Special Tags

### Private Methods

```javascript
/**
 * Internal helper function
 *
 * @private
 * @param {string} value - Input value
 * @returns {string} Processed value
 */
function _internalHelper(value) {
    // ...
}
```

### Deprecated Functions

```javascript
/**
 * Old function that should not be used
 *
 * @deprecated Use newFunction() instead
 * @param {string} data - Data to process
 * @returns {Object} Processed data
 */
function oldFunction(data) {
    // ...
}
```

### Event Emitters

```javascript
/**
 * Emits an event
 *
 * @fires ClassName#eventName
 */
emitEvent() {
    /**
     * Event description
     *
     * @event ClassName#eventName
     * @type {Object}
     * @property {string} type - Event type
     * @property {*} data - Event data
     */
}
```

## Repository Pattern Documentation

For data access layers:

```javascript
/**
 * Repository for managing collection data persistence
 *
 * @class
 * @classdesc Handles all CRUD operations for collections in electron-store.
 * Implements defensive programming with auto-initialization and validation.
 */
class CollectionRepository {
    /**
     * Creates a CollectionRepository instance
     *
     * @param {Object} electronAPI - The Electron IPC API bridge
     */
    constructor(electronAPI) {
        // ...
    }

    /**
     * Retrieves all collections from storage
     *
     * Automatically initializes storage if undefined (packaged app first run).
     *
     * @async
     * @returns {Promise<Array<Object>>} Array of collection objects
     * @throws {Error} If storage access fails
     */
    async getAll() {
        // ...
    }
}
```

## Service Pattern Documentation

For business logic layers:

```javascript
/**
 * Service for managing environment business logic
 *
 * @class
 * @classdesc Provides high-level environment operations with validation,
 * error handling, and event notifications.
 */
class EnvironmentService {
    /**
     * Creates an EnvironmentService instance
     *
     * @param {EnvironmentRepository} environmentRepository - Data access layer
     * @param {IStatusDisplay} statusDisplay - Status display interface
     */
    constructor(environmentRepository, statusDisplay) {
        // ...
    }
}
```

## Controller Pattern Documentation

For UI coordination:

```javascript
/**
 * Controller for coordinating environment operations
 *
 * @class
 * @classdesc Mediates between UI components and the environment service,
 * handling user interactions and updating the UI accordingly.
 */
class EnvironmentController {
    /**
     * Creates an EnvironmentController instance
     *
     * @param {EnvironmentService} service - The environment service
     * @param {EnvironmentRenderer} renderer - The UI renderer
     */
    constructor(service, renderer) {
        // ...
    }
}
```

## UI Component Documentation

```javascript
/**
 * Dialog component for managing environments
 *
 * @class
 * @classdesc Provides a modal interface for CRUD operations on environments,
 * including import/export functionality.
 */
class EnvironmentManager {
    /**
     * Shows the environment management dialog
     *
     * @param {EnvironmentService} service - The environment service
     * @param {Function} onClose - Callback invoked when dialog closes
     * @returns {void}
     */
    show(service, onClose) {
        // ...
    }
}
```

## Best Practices

1. **Be concise but complete** - The first line should be a brief summary; add details after a blank line
2. **Use active voice** - "Sends a request" not "A request is sent"
3. **Document side effects** - If a function modifies state, document it
4. **Include null/undefined handling** - Document when null/undefined is valid
5. **Link related functions** - Use `@see` to reference related functionality
6. **Keep it updated** - Update JSDoc when code changes
7. **Specify async behavior** - Always document async operations and what they return
8. **Document errors** - Use `@throws` to document possible exceptions

## Examples from the Codebase

### Good Example - EnvironmentService

```javascript
/**
 * Service for managing environment business logic
 * Provides high-level environment operations with validation
 */
export class EnvironmentService {
    /**
     * Creates an EnvironmentService instance
     *
     * @param {EnvironmentRepository} environmentRepository - Data access layer
     * @param {IStatusDisplay} statusDisplay - Status display interface
     */
    constructor(environmentRepository, statusDisplay) {
        this.repository = environmentRepository;
        this.statusDisplay = statusDisplay;
        this.listeners = new Set();
    }

    /**
     * Switches the active environment
     *
     * @async
     * @param {string} environmentId - The ID of the environment to activate
     * @returns {Promise<Object>} The activated environment object
     * @throws {Error} If the environment is not found
     */
    async switchEnvironment(environmentId) {
        // Implementation
    }
}
```

## Tools and Validation

- Consider using ESLint plugin `eslint-plugin-jsdoc` to enforce these standards
- Generate documentation with JSDoc CLI tool if needed
- VS Code provides excellent JSDoc IntelliSense support

## Questions?

For questions or suggestions about this style guide, create an issue or discuss with the team.
