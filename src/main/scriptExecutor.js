/**
 * @fileoverview Script execution engine using Node.js VM for sandboxing
 * @module main/scriptExecutor
 */

import vm from 'vm';

/**
 * Custom assertion error for test failures
 */
class AssertionError extends Error {
    constructor(message) {
        super(message);
        this.name = 'AssertionError';
    }
}

/**
 * Script execution engine with VM sandboxing
 * Executes pre-request and test scripts in a secure, isolated context
 *
 * @class
 * @classdesc Provides secure script execution with timeout and sandboxing
 */
export default class ScriptExecutor {
    /**
     * Creates a ScriptExecutor instance
     * @param {Object} store - electron-store instance for environment access
     */
    constructor(store) {
        this.store = store;
        this.timeout = 10000; // 10 seconds default timeout
    }

    /**
     * Execute a pre-request script
     * @param {string} script - The JavaScript code to execute
     * @param {Object} requestContext - Request data (url, method, headers, body, etc.)
     * @param {Object} environmentContext - Environment variables
     * @returns {Promise<Object>} Execution result
     */
    async executePreRequest(script, requestContext, environmentContext) {
        if (!script || script.trim() === '') {
            return {
                success: true,
                logs: [],
                errors: [],
                modifiedRequest: requestContext,
                modifiedEnvironment: {}
            };
        }

        const logs = [];
        const testResults = [];
        const errors = [];
        const environmentChanges = {};

        try {
            // Create mutable request object
            const request = {
                url: requestContext.url,
                method: requestContext.method,
                headers: { ...requestContext.headers },
                body: requestContext.body,
                queryParams: { ...requestContext.queryParams },
                pathParams: { ...requestContext.pathParams }
            };

            // Build sandbox context
            const sandbox = {
                request,
                environment: this._buildEnvironmentAPI(environmentContext, environmentChanges),
                console: this._buildConsoleAPI(logs),
                // Safely pass some globals
                Date,
                Math,
                JSON,
                parseInt,
                parseFloat,
                isNaN,
                isFinite,
                encodeURIComponent,
                decodeURIComponent,
                encodeURI,
                decodeURI,
                btoa: (str) => Buffer.from(str).toString('base64'),
                atob: (str) => Buffer.from(str, 'base64').toString()
            };

            // Create VM context
            const context = vm.createContext(sandbox);

            // Compile and run script
            const vmScript = new vm.Script(script, {
                filename: 'pre-request-script.js',
                displayErrors: true
            });

            vmScript.runInContext(context, {
                timeout: this.timeout,
                breakOnSigint: true
            });

            return {
                success: true,
                logs,
                errors,
                testResults,
                modifiedRequest: request,
                modifiedEnvironment: environmentChanges
            };

        } catch (error) {
            errors.push(this._formatError(error));

            return {
                success: false,
                logs,
                errors,
                testResults,
                modifiedRequest: requestContext,
                modifiedEnvironment: environmentChanges
            };
        }
    }

    /**
     * Execute a test/post-request script
     * @param {string} script - The JavaScript code to execute
     * @param {Object} requestContext - Request data (read-only)
     * @param {Object} responseContext - Response data (status, body, headers, etc.)
     * @param {Object} environmentContext - Environment variables
     * @returns {Promise<Object>} Execution result
     */
    async executeTest(script, requestContext, responseContext, environmentContext) {
        if (!script || script.trim() === '') {
            return {
                success: true,
                logs: [],
                errors: [],
                testResults: [],
                modifiedEnvironment: {}
            };
        }

        const logs = [];
        const testResults = [];
        const errors = [];
        const environmentChanges = {};

        try {
            // Create read-only request object
            const request = {
                url: requestContext.url,
                method: requestContext.method,
                headers: { ...requestContext.headers },
                body: requestContext.body,
                queryParams: { ...requestContext.queryParams },
                pathParams: { ...requestContext.pathParams }
            };

            // Create read-only response object
            const response = {
                status: responseContext.status,
                statusText: responseContext.statusText,
                headers: { ...responseContext.headers },
                body: responseContext.body,
                timings: { ...responseContext.timings },
                cookies: responseContext.cookies || []
            };

            // Build sandbox context
            const sandbox = {
                request,
                response,
                environment: this._buildEnvironmentAPI(environmentContext, environmentChanges),
                console: this._buildConsoleAPI(logs),
                expect: this._buildExpectAPI(testResults),
                // Safely pass some globals
                Date,
                Math,
                JSON,
                parseInt,
                parseFloat,
                isNaN,
                isFinite,
                encodeURIComponent,
                decodeURIComponent,
                encodeURI,
                decodeURI,
                btoa: (str) => Buffer.from(str).toString('base64'),
                atob: (str) => Buffer.from(str, 'base64').toString()
            };

            // Create VM context
            const context = vm.createContext(sandbox);

            // Compile and run script
            const vmScript = new vm.Script(script, {
                filename: 'test-script.js',
                displayErrors: true
            });

            vmScript.runInContext(context, {
                timeout: this.timeout,
                breakOnSigint: true
            });

            return {
                success: true,
                logs,
                errors,
                testResults,
                modifiedEnvironment: environmentChanges
            };

        } catch (error) {
            errors.push(this._formatError(error));

            return {
                success: false,
                logs,
                errors,
                testResults,
                modifiedEnvironment: environmentChanges
            };
        }
    }

    /**
     * Build environment variable access API
     * @private
     * @param {Object} environmentContext - Current environment variables
     * @param {Object} changes - Object to track changes
     * @returns {Object} Environment API
     */
    _buildEnvironmentAPI(environmentContext, changes) {
        return {
            get: (name) => {
                // Check changes first, then original context
                if (name in changes) {
                    return changes[name];
                }
                return environmentContext[name];
            },
            set: (name, value) => {
                if (typeof name !== 'string') {
                    throw new Error('Environment variable name must be a string');
                }
                if (value === undefined) {
                    throw new Error('Environment variable value cannot be undefined');
                }
                changes[name] = String(value);
            },
            delete: (name) => {
                changes[name] = null; // Mark for deletion
            }
        };
    }

    /**
     * Build console logging API that captures output
     * @private
     * @param {Array} logs - Array to store log entries
     * @returns {Object} Console API
     */
    _buildConsoleAPI(logs) {
        const captureLog = (level, args) => {
            const message = args.map(arg => {
                if (typeof arg === 'object') {
                    try {
                        return JSON.stringify(arg, null, 2);
                    } catch (e) {
                        return String(arg);
                    }
                }
                return String(arg);
            }).join(' ');

            logs.push({
                level,
                message,
                timestamp: Date.now()
            });
        };

        return {
            log: (...args) => captureLog('info', args),
            info: (...args) => captureLog('info', args),
            warn: (...args) => captureLog('warn', args),
            error: (...args) => captureLog('error', args)
        };
    }

    /**
     * Build expect() assertion API for tests
     * @private
     * @param {Array} testResults - Array to store test results
     * @returns {Function} Expect function
     */
    _buildExpectAPI(testResults) {
        return (actual) => {
            const assertions = {
                toBe(expected) {
                    if (actual !== expected) {
                        const error = new AssertionError(
                            `Expected ${JSON.stringify(actual)} to be ${JSON.stringify(expected)}`
                        );
                        testResults.push({ passed: false, message: error.message });
                        throw error;
                    }
                    testResults.push({ passed: true, message: `Expected ${JSON.stringify(actual)} to be ${JSON.stringify(expected)}` });
                },

                toEqual(expected) {
                    const actualStr = JSON.stringify(actual);
                    const expectedStr = JSON.stringify(expected);
                    if (actualStr !== expectedStr) {
                        const error = new AssertionError(
                            `Expected ${actualStr} to equal ${expectedStr}`
                        );
                        testResults.push({ passed: false, message: error.message });
                        throw error;
                    }
                    testResults.push({ passed: true, message: `Expected ${actualStr} to equal ${expectedStr}` });
                },

                toContain(item) {
                    let contains = false;
                    if (Array.isArray(actual)) {
                        contains = actual.includes(item);
                    } else if (typeof actual === 'string') {
                        contains = actual.includes(item);
                    } else {
                        const error = new AssertionError('toContain requires array or string');
                        testResults.push({ passed: false, message: error.message });
                        throw error;
                    }

                    if (!contains) {
                        const error = new AssertionError(
                            `Expected ${JSON.stringify(actual)} to contain ${JSON.stringify(item)}`
                        );
                        testResults.push({ passed: false, message: error.message });
                        throw error;
                    }
                    testResults.push({ passed: true, message: `Expected ${JSON.stringify(actual)} to contain ${JSON.stringify(item)}` });
                },

                toBeDefined() {
                    if (actual === undefined) {
                        const error = new AssertionError('Expected value to be defined');
                        testResults.push({ passed: false, message: error.message });
                        throw error;
                    }
                    testResults.push({ passed: true, message: 'Expected value to be defined' });
                },

                toBeUndefined() {
                    if (actual !== undefined) {
                        const error = new AssertionError(`Expected ${JSON.stringify(actual)} to be undefined`);
                        testResults.push({ passed: false, message: error.message });
                        throw error;
                    }
                    testResults.push({ passed: true, message: 'Expected value to be undefined' });
                },

                toBeTruthy() {
                    if (!actual) {
                        const error = new AssertionError(
                            `Expected ${JSON.stringify(actual)} to be truthy`
                        );
                        testResults.push({ passed: false, message: error.message });
                        throw error;
                    }
                    testResults.push({ passed: true, message: `Expected ${JSON.stringify(actual)} to be truthy` });
                },

                toBeFalsy() {
                    if (actual) {
                        const error = new AssertionError(
                            `Expected ${JSON.stringify(actual)} to be falsy`
                        );
                        testResults.push({ passed: false, message: error.message });
                        throw error;
                    }
                    testResults.push({ passed: true, message: `Expected ${JSON.stringify(actual)} to be falsy` });
                },

                toBeGreaterThan(value) {
                    if (!(actual > value)) {
                        const error = new AssertionError(
                            `Expected ${actual} to be greater than ${value}`
                        );
                        testResults.push({ passed: false, message: error.message });
                        throw error;
                    }
                    testResults.push({ passed: true, message: `Expected ${actual} to be greater than ${value}` });
                },

                toBeLessThan(value) {
                    if (!(actual < value)) {
                        const error = new AssertionError(
                            `Expected ${actual} to be less than ${value}`
                        );
                        testResults.push({ passed: false, message: error.message });
                        throw error;
                    }
                    testResults.push({ passed: true, message: `Expected ${actual} to be less than ${value}` });
                },

                toBeGreaterThanOrEqual(value) {
                    if (!(actual >= value)) {
                        const error = new AssertionError(
                            `Expected ${actual} to be greater than or equal to ${value}`
                        );
                        testResults.push({ passed: false, message: error.message });
                        throw error;
                    }
                    testResults.push({ passed: true, message: `Expected ${actual} to be greater than or equal to ${value}` });
                },

                toBeLessThanOrEqual(value) {
                    if (!(actual <= value)) {
                        const error = new AssertionError(
                            `Expected ${actual} to be less than or equal to ${value}`
                        );
                        testResults.push({ passed: false, message: error.message });
                        throw error;
                    }
                    testResults.push({ passed: true, message: `Expected ${actual} to be less than or equal to ${value}` });
                },

                toHaveProperty(key, value) {
                    if (typeof actual !== 'object' || actual === null) {
                        const error = new AssertionError('toHaveProperty requires an object');
                        testResults.push({ passed: false, message: error.message });
                        throw error;
                    }

                    if (!(key in actual)) {
                        const error = new AssertionError(
                            `Expected object to have property "${key}"`
                        );
                        testResults.push({ passed: false, message: error.message });
                        throw error;
                    }

                    if (value !== undefined && actual[key] !== value) {
                        const error = new AssertionError(
                            `Expected property "${key}" to be ${JSON.stringify(value)}, but got ${JSON.stringify(actual[key])}`
                        );
                        testResults.push({ passed: false, message: error.message });
                        throw error;
                    }
                    testResults.push({ passed: true, message: `Expected object to have property "${key}"` });
                },

                toMatch(regex) {
                    if (typeof actual !== 'string') {
                        const error = new AssertionError('toMatch requires a string');
                        testResults.push({ passed: false, message: error.message });
                        throw error;
                    }

                    if (!regex.test(actual)) {
                        const error = new AssertionError(
                            `Expected "${actual}" to match ${regex}`
                        );
                        testResults.push({ passed: false, message: error.message });
                        throw error;
                    }
                    testResults.push({ passed: true, message: `Expected "${actual}" to match ${regex}` });
                }
            };

            return assertions;
        };
    }

    /**
     * Format error for user display
     * @private
     * @param {Error} error - The error to format
     * @returns {string} Formatted error message
     */
    _formatError(error) {
        if (error.name === 'AssertionError') {
            return `Assertion failed: ${error.message}`;
        }

        if (error.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT') {
            return `Script execution timeout (${this.timeout}ms exceeded)`;
        }

        return `${error.name}: ${error.message}`;
    }
}
