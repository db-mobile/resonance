/**
 * @fileoverview Mock server handler for generating API responses from OpenAPI schemas
 * @module main/mockServerHandler
 */

import http from 'http';
import { randomUUID } from 'crypto';

/**
 * Handler for managing mock server lifecycle and request processing
 *
 * @class
 * @classdesc Manages HTTP mock server that generates responses from OpenAPI schemas.
 * Supports path parameter matching, configurable delays, request logging, and CORS.
 */
class MockServerHandler {
    /**
     * Creates a MockServerHandler instance
     *
     * @param {Object} store - Store instance for settings persistence
     * @param {Object} schemaProcessor - SchemaProcessor instance for response generation
     */
    constructor(store, schemaProcessor) {
        this.store = store;
        this.schemaProcessor = schemaProcessor;
        this.server = null;
        this.port = null;
        this.settings = null;
        this.endpoints = new Map();
        this.requestLogs = [];
        this.SETTINGS_KEY = 'mockServer';
        this.MAX_LOGS = 100;
    }

    /**
     * Starts the mock server
     *
     * @async
     * @param {Object} settings - Server settings including port and endpoint delays
     * @param {Array} collections - Array of collection objects to mock
     * @returns {Promise<Object>} Result object with success status and details
     */
    async startServer(settings, collections) {
        if (this.server) {
            return {
                success: false,
                message: 'Server is already running'
            };
        }

        try {
            this.settings = settings;
            this.port = settings.port || 3000;

            // Build routing table from collections
            this._buildRoutingTable(collections);

            if (this.endpoints.size === 0) {
                return {
                    success: false,
                    message: 'No endpoints to mock. Please enable at least one collection.'
                };
            }

            // Create HTTP server
            this.server = http.createServer((req, res) => {
                this._handleRequest(req, res).catch(_error => {
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Internal server error' }));
                });
            });

            // Handle server errors
            this.server.on('error', (_error) => {
                this._cleanup();
            });

            // Start listening
            return new Promise((resolve) => {
                this.server.on('error', (error) => {
                    if (error.code === 'EADDRINUSE') {
                        resolve({
                            success: false,
                            message: `Port ${this.port} is already in use`,
                            error: 'EADDRINUSE'
                        });
                    } else {
                        resolve({
                            success: false,
                            message: error.message || 'Failed to start server',
                            error: error.code || 'UNKNOWN'
                        });
                    }
                });

                this.server.listen(this.port, 'localhost', () => {
                    resolve({
                        success: true,
                        message: `Server started on port ${this.port}`,
                        port: this.port
                    });
                });
            });
        } catch (error) {
            this._cleanup();
            return {
                success: false,
                message: error.message || 'Failed to start server',
                error: error.code || 'UNKNOWN'
            };
        }
    }

    /**
     * Stops the mock server
     *
     * @async
     * @returns {Promise<Object>} Result object with success status
     */
    async stopServer() {
        if (!this.server) {
            return {
                success: false,
                message: 'Server is not running'
            };
        }

        try {
            await new Promise((resolve, reject) => {
                this.server.close((error) => {
                    if (error) {
                        reject(error);
                    } else {
                        resolve();
                    }
                });
            });

            this._cleanup();

            return {
                success: true,
                message: 'Server stopped successfully'
            };
        } catch (error) {
            this._cleanup();
            return {
                success: false,
                message: error.message || 'Error stopping server'
            };
        }
    }

    /**
     * Gets server status
     *
     * @returns {Object} Status object with running state, port, and request count
     */
    getStatus() {
        return {
            running: this.server !== null,
            port: this.port,
            requestCount: this.requestLogs.length
        };
    }

    /**
     * Reloads settings from store without restarting the server
     *
     * Hot-reloads delays, custom responses, and custom status codes
     * for the currently running server.
     *
     * @async
     * @returns {Promise<Object>} Result object with success status
     */
    async reloadSettings() {
        if (!this.server) {
            return {
                success: false,
                message: 'Server is not running'
            };
        }

        try {
            // Fetch fresh settings from store
            const freshSettings = this.store.get(this.SETTINGS_KEY);

            if (!freshSettings) {
                return {
                    success: false,
                    message: 'Failed to load settings'
                };
            }

            // Update settings (keeps port and other config)
            this.settings = {
                ...this.settings,
                endpointDelays: freshSettings.endpointDelays || {},
                customResponses: freshSettings.customResponses || {},
                customStatusCodes: freshSettings.customStatusCodes || {}
            };

            return {
                success: true,
                message: 'Settings reloaded successfully'
            };
        } catch (error) {
            return {
                success: false,
                message: error.message || 'Failed to reload settings'
            };
        }
    }

    /**
     * Gets request logs
     *
     * @param {number} limit - Maximum number of logs to return
     * @returns {Array} Array of request log entries, newest first
     */
    getRequestLogs(limit = 20) {
        return this.requestLogs.slice(-limit).reverse();
    }

    /**
     * Clears request logs
     *
     * @returns {Object} Result object
     */
    clearRequestLogs() {
        this.requestLogs = [];
        return { success: true };
    }

    /**
     * Builds routing table from collections
     *
     * @private
     * @param {Array} collections - Array of collection objects
     */
    _buildRoutingTable(collections) {
        this.endpoints.clear();

        for (const collection of collections) {
            if (!collection.endpoints || !Array.isArray(collection.endpoints)) {
                continue;
            }

            for (const endpoint of collection.endpoints) {
                // Convert OpenAPI path to regex pattern
                // Example: /users/{id} → /users/([^/]+)
                const pathPattern = endpoint.path
                    .replace(/\{([^}]+)\}/g, '([^/]+)')
                    .replace(/\//g, '\\/');

                const regex = new RegExp(`^${pathPattern}$`);

                // Extract parameter names from path
                const paramNames = [];
                const paramMatches = endpoint.path.matchAll(/\{([^}]+)\}/g);
                for (const match of paramMatches) {
                    paramNames.push(match[1]);
                }

                const key = `${endpoint.method.toUpperCase()}_${endpoint.path}`;
                this.endpoints.set(key, {
                    regex,
                    method: endpoint.method.toUpperCase(),
                    endpoint,
                    collection,
                    paramNames
                });
            }
        }
    }

    /**
     * Matches incoming request to an endpoint
     *
     * @private
     * @param {string} method - HTTP method
     * @param {string} path - Request path
     * @returns {Object|null} Matched endpoint data or null
     */
    _matchEndpoint(method, path) {
        for (const [_key, route] of this.endpoints.entries()) {
            if (route.method !== method.toUpperCase()) {
                continue;
            }

            const match = path.match(route.regex);
            if (match) {
                const pathParams = {};
                route.paramNames.forEach((name, idx) => {
                    pathParams[name] = match[idx + 1];
                });

                return {
                    endpoint: route.endpoint,
                    collection: route.collection,
                    pathParams
                };
            }
        }

        return null;
    }

    /**
     * Handles incoming HTTP request
     *
     * @private
     * @async
     * @param {Object} req - HTTP request object
     * @param {Object} res - HTTP response object
     */
    async _handleRequest(req, res) {
        const startTime = Date.now();

        // Always inject CORS headers for frontend development
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS, HEAD');
        res.setHeader('Access-Control-Allow-Headers', '*');

        // Handle OPTIONS preflight
        if (req.method === 'OPTIONS') {
            res.writeHead(204);
            res.end();
            return;
        }

        // Parse URL
        const url = new URL(req.url, `http://localhost:${this.port}`);
        const matched = this._matchEndpoint(req.method, url.pathname);

        if (!matched) {
            const responseBody = JSON.stringify({
                error: 'Endpoint not found',
                path: url.pathname,
                method: req.method
            }, null, 2);

            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(responseBody);

            // Log 404
            this._logRequest({
                method: req.method,
                path: url.pathname,
                query: Object.fromEntries(url.searchParams),
                responseStatus: 404,
                responseTime: Date.now() - startTime,
                matchedEndpoint: null
            });

            return;
        }

        // Apply delay if configured
        const delayKey = `${matched.collection.id}_${matched.endpoint.id}`;
        const delay = this.settings?.endpointDelays?.[delayKey] || 0;
        if (delay > 0) {
            await new Promise(resolve => setTimeout(resolve, delay));
        }

        // Check for custom response first, otherwise generate from schema
        const customResponse = this.settings?.customResponses?.[delayKey];
        const responseData = customResponse || this._generateResponse(matched.endpoint);
        const responseBody = JSON.stringify(responseData, null, 2);

        // Check for custom status code, otherwise use default based on method
        const customStatusCode = this.settings?.customStatusCodes?.[delayKey];
        const statusCode = customStatusCode || this._getDefaultStatusCode(matched.endpoint.method);

        res.writeHead(statusCode, { 'Content-Type': 'application/json' });
        res.end(responseBody);

        const responseTime = Date.now() - startTime;

        // Log request
        this._logRequest({
            method: req.method,
            path: url.pathname,
            query: Object.fromEntries(url.searchParams),
            responseStatus: statusCode,
            responseTime,
            matchedEndpoint: {
                collectionId: matched.collection.id,
                collectionName: matched.collection.name,
                endpointId: matched.endpoint.id,
                endpointName: matched.endpoint.name
            }
        });
    }

    /**
     * Generates response from endpoint schema
     *
     * @private
     * @param {Object} endpoint - Endpoint configuration
     * @returns {Object} Response data object
     */
    _generateResponse(endpoint) {
        let schema = null;

        // Try to find response schema in priority order
        if (endpoint.responses?.['200']?.content?.['application/json']?.schema) {
            schema = endpoint.responses['200'].content['application/json'].schema;
        } else if (['POST', 'PUT'].includes(endpoint.method.toUpperCase()) &&
                   endpoint.responses?.['201']?.content?.['application/json']?.schema) {
            schema = endpoint.responses['201'].content['application/json'].schema;
        } else {
            // Try any 2xx response
            const responseCodes = Object.keys(endpoint.responses || {})
                .filter(code => code.startsWith('2'))
                .sort();

            for (const code of responseCodes) {
                if (endpoint.responses[code]?.content?.['application/json']?.schema) {
                    schema = endpoint.responses[code].content['application/json'].schema;
                    break;
                }
            }
        }

        if (schema) {
            try {
                // SchemaProcessor.generateExampleFromSchema returns JSON string at depth 0
                const exampleJson = this.schemaProcessor.generateExampleFromSchema(schema);
                return JSON.parse(exampleJson);
            } catch (error) {
                void error;
            }
        }

        // Fallback response
        return {
            message: 'Mock response',
            success: true,
            endpoint: endpoint.name || endpoint.path,
            method: endpoint.method,
            timestamp: new Date().toISOString()
        };
    }

    /**
     * Gets default status code based on HTTP method
     *
     * @private
     * @param {string} method - HTTP method
     * @returns {number} Default status code
     */
    _getDefaultStatusCode(method) {
        const upperMethod = method.toUpperCase();

        switch (upperMethod) {
            case 'POST':
                return 201; // Created
            case 'DELETE':
                return 204; // No Content
            case 'GET':
            case 'PUT':
            case 'PATCH':
            case 'HEAD':
            case 'OPTIONS':
            default:
                return 200; // OK
        }
    }

    /**
     * Logs request details
     *
     * @private
     * @param {Object} logEntry - Request log data
     */
    _logRequest(logEntry) {
        const entry = {
            id: randomUUID(),
            timestamp: Date.now(),
            ...logEntry
        };

        this.requestLogs.push(entry);

        // Maintain circular buffer
        if (this.requestLogs.length > this.MAX_LOGS) {
            this.requestLogs.shift();
        }
    }

    /**
     * Cleans up server state
     *
     * @private
     */
    _cleanup() {
        this.server = null;
        this.port = null;
        this.settings = null;
        this.endpoints.clear();
        this.requestLogs = [];
    }
}

export default MockServerHandler;
