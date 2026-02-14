/**
 * @fileoverview Service for collection runner business logic and execution
 * @module services/RunnerService
 */

import { VariableProcessor } from '../variables/VariableProcessor.js';
import { VariableRepository } from '../storage/VariableRepository.js';
import { EnvironmentRepository } from '../storage/EnvironmentRepository.js';
import { CollectionRepository } from '../storage/CollectionRepository.js';

/**
 * Service for managing collection runner operations and execution
 *
 * @class
 * @classdesc Provides high-level runner operations including CRUD, sequential
 * request execution, variable chaining with precedence rules, and post-response
 * script execution. Coordinates between repository and execution layers.
 *
 * Variable Precedence (highest to lowest):
 * 1. Post-response script variables (set during execution)
 * 2. Environment variables
 * 3. Collection variables
 */
export class RunnerService {
    /**
     * Creates a RunnerService instance
     *
     * @param {RunnerRepository} repository - Data access layer for runners
     * @param {Object} backendAPI - Backend API for HTTP requests and scripts
     * @param {IStatusDisplay} statusDisplay - Status display interface
     */
    constructor(repository, backendAPI, statusDisplay) {
        this.repository = repository;
        this.backendAPI = backendAPI;
        this.statusDisplay = statusDisplay;
        this.variableProcessor = new VariableProcessor();
        this.variableRepository = new VariableRepository(backendAPI);
        this.environmentRepository = new EnvironmentRepository(backendAPI);
        this.collectionRepository = new CollectionRepository(backendAPI);

        // Execution state
        this.isRunning = false;
        this.shouldStop = false;
        this.currentRunId = null;
        this.listeners = [];
    }

    /**
     * Gets all runners
     *
     * @async
     * @returns {Promise<Array<Object>>} Array of runner objects
     */
    async getAllRunners() {
        return this.repository.getAll();
    }

    /**
     * Gets a runner by ID
     *
     * @async
     * @param {string} id - Runner ID
     * @returns {Promise<Object|undefined>} Runner object or undefined
     */
    async getRunner(id) {
        return this.repository.getById(id);
    }

    /**
     * Creates a new runner
     *
     * @async
     * @param {Object} runnerData - Runner configuration
     * @returns {Promise<Object>} Created runner object
     */
    async createRunner(runnerData) {
        const runner = await this.repository.add(runnerData);
        this.statusDisplay?.update(`Runner "${runner.name}" created`, null);
        return runner;
    }

    /**
     * Updates an existing runner
     *
     * @async
     * @param {string} id - Runner ID
     * @param {Object} updates - Updates to apply
     * @returns {Promise<Object|null>} Updated runner or null
     */
    async updateRunner(id, updates) {
        const runner = await this.repository.update(id, updates);
        if (runner) {
            this.statusDisplay?.update(`Runner "${runner.name}" saved`, null);
        }
        return runner;
    }

    /**
     * Deletes a runner
     *
     * @async
     * @param {string} id - Runner ID
     * @returns {Promise<boolean>} True if deleted
     */
    async deleteRunner(id) {
        const success = await this.repository.delete(id);
        if (success) {
            this.statusDisplay?.update('Runner deleted', null);
        }
        return success;
    }

    /**
     * Executes a runner's request sequence
     *
     * Runs requests sequentially, executing post-response scripts after each
     * request to chain variables. Respects stopOnError and delay options.
     *
     * @async
     * @param {string} runnerId - Runner ID to execute
     * @param {Function} [onProgress] - Progress callback (requestIndex, total, result)
     * @returns {Promise<Object>} Execution results
     */
    async executeRunner(runnerId, onProgress) {
        if (this.isRunning) {
            throw new Error('A runner is already executing');
        }

        const runner = await this.repository.getById(runnerId);
        if (!runner) {
            throw new Error('Runner not found');
        }

        if (!runner.requests || runner.requests.length === 0) {
            throw new Error('Runner has no requests to execute');
        }

        this.isRunning = true;
        this.shouldStop = false;
        this.currentRunId = runnerId;

        const results = {
            runnerId,
            runnerName: runner.name,
            startTime: Date.now(),
            endTime: null,
            totalRequests: runner.requests.length,
            passed: 0,
            failed: 0,
            skipped: 0,
            requests: [],
            variablesSet: {}
        };

        // Initialize runtime variables (will accumulate post-response script outputs)
        let runtimeVariables = {};

        this._notifyListeners('run-started', { runnerId, total: runner.requests.length });

        try {
            for (let i = 0; i < runner.requests.length; i++) {
                if (this.shouldStop) {
                    this._markRemainingAsSkipped(runner.requests, results, i, 'Execution stopped by user');
                    break;
                }

                const request = runner.requests[i];
                const requestResult = await this._executeRequest(request, runtimeVariables, i);

                results.requests.push(requestResult);

                if (requestResult.status === 'success') {
                    results.passed++;
                    if (requestResult.variablesSet) {
                        runtimeVariables = { ...runtimeVariables, ...requestResult.variablesSet };
                        Object.assign(results.variablesSet, requestResult.variablesSet);
                    }
                } else {
                    results.failed++;
                    if (runner.options?.stopOnError) {
                        this._markRemainingAsSkipped(runner.requests, results, i + 1, 'Skipped due to previous error');
                        break;
                    }
                }

                // Notify progress
                if (onProgress) {
                    onProgress(i, runner.requests.length, requestResult);
                }
                this._notifyListeners('request-completed', { index: i, result: requestResult });

                // Delay between requests
                if (runner.options?.delayMs > 0 && i < runner.requests.length - 1) {
                    await this._delay(runner.options.delayMs);
                }
            }
        } finally {
            results.endTime = Date.now();
            results.totalTime = results.endTime - results.startTime;

            this.isRunning = false;
            this.shouldStop = false;
            this.currentRunId = null;

            // Update last run timestamp
            await this.repository.updateLastRun(runnerId);

            this._notifyListeners('run-completed', results);
        }

        return results;
    }

    /**
     * Executes runner data directly without requiring a saved runner
     *
     * @async
     * @param {Object} runnerData - Runner configuration with requests array
     * @param {Function} [onProgress] - Progress callback (requestIndex, total, result)
     * @returns {Promise<Object>} Execution results
     */
    async executeRunnerData(runnerData, onProgress) {
        if (this.isRunning) {
            throw new Error('A runner is already executing');
        }

        if (!runnerData.requests || runnerData.requests.length === 0) {
            throw new Error('Runner has no requests to execute');
        }

        this.isRunning = true;
        this.shouldStop = false;
        this.currentRunId = 'temp';

        const results = {
            runnerId: null,
            runnerName: runnerData.name || 'Untitled Runner',
            startTime: Date.now(),
            endTime: null,
            totalRequests: runnerData.requests.length,
            passed: 0,
            failed: 0,
            skipped: 0,
            requests: [],
            variablesSet: {}
        };

        let runtimeVariables = {};

        this._notifyListeners('run-started', { runnerId: null, total: runnerData.requests.length });

        try {
            for (let i = 0; i < runnerData.requests.length; i++) {
                if (this.shouldStop) {
                    this._markRemainingAsSkipped(runnerData.requests, results, i, 'Execution stopped by user');
                    break;
                }

                const request = runnerData.requests[i];
                const requestResult = await this._executeRequest(request, runtimeVariables, i);

                results.requests.push(requestResult);

                if (requestResult.status === 'success') {
                    results.passed++;
                    if (requestResult.variablesSet) {
                        runtimeVariables = { ...runtimeVariables, ...requestResult.variablesSet };
                        Object.assign(results.variablesSet, requestResult.variablesSet);
                    }
                } else {
                    results.failed++;
                    if (runnerData.options?.stopOnError) {
                        this._markRemainingAsSkipped(runnerData.requests, results, i + 1, 'Skipped due to previous error');
                        break;
                    }
                }

                if (onProgress) {
                    onProgress(i, runnerData.requests.length, requestResult);
                }
                this._notifyListeners('request-completed', { index: i, result: requestResult });

                if (runnerData.options?.delayMs > 0 && i < runnerData.requests.length - 1) {
                    await this._delay(runnerData.options.delayMs);
                }
            }
        } finally {
            results.endTime = Date.now();
            results.totalTime = results.endTime - results.startTime;

            this.isRunning = false;
            this.shouldStop = false;
            this.currentRunId = null;

            this._notifyListeners('run-completed', results);
        }

        return results;
    }

    /**
     * Stops the currently running execution
     */
    stopExecution() {
        if (this.isRunning) {
            this.shouldStop = true;
            this.statusDisplay?.update('Stopping runner...', null);
        }
    }

    /**
     * Checks if a runner is currently executing
     *
     * @returns {boolean} True if running
     */
    isExecuting() {
        return this.isRunning;
    }

    /**
     * Marks remaining requests as skipped
     *
     * @private
     * @param {Array} requests - All requests
     * @param {Object} results - Results object to update
     * @param {number} startIndex - Index to start marking from
     * @param {string} reason - Reason for skipping
     */
    _markRemainingAsSkipped(requests, results, startIndex, reason) {
        for (let j = startIndex; j < requests.length; j++) {
            results.requests.push({
                index: j,
                ...requests[j],
                status: 'skipped',
                error: reason
            });
            results.skipped++;
        }
    }

    /**
     * Executes a single request with variable substitution
     *
     * @private
     * @async
     * @param {Object} request - Request configuration
     * @param {Object} runtimeVariables - Variables set during execution
     * @param {number} index - Request index
     * @returns {Promise<Object>} Request result
     */
    async _executeRequest(request, runtimeVariables, index) {
        const startTime = Date.now();
        const result = {
            index,
            collectionId: request.collectionId,
            endpointId: request.endpointId,
            name: request.name,
            method: request.method,
            path: request.path,
            status: 'pending',
            statusCode: null,
            responseTime: null,
            error: null,
            variablesSet: {},
            logs: []
        };

        try {
            // Build merged variables with precedence
            const variables = await this._buildVariables(request.collectionId, runtimeVariables);

            // Get endpoint data from collection
            const collection = await this.collectionRepository.getById(request.collectionId);
            if (!collection) {
                throw new Error(`Collection not found: ${request.collectionId}`);
            }

            const endpoint = this._findEndpoint(collection, request.endpointId);
            if (!endpoint) {
                throw new Error(`Endpoint not found: ${request.endpointId}`);
            }

            // Build request configuration
            const requestConfig = await this._buildRequestConfig(collection, endpoint, variables);

            // Execute the request
            const response = await this.backendAPI.sendApiRequest(requestConfig);

            result.statusCode = response.status;
            result.responseTime = Date.now() - startTime;

            if (response.success) {
                result.status = 'success';
                result.body = response.data;
                result.headers = response.headers || {};
                result.cookies = response.cookies || [];
                result.time = Date.now() - startTime;
                result.response = {
                    status: response.status,
                    statusText: response.statusText,
                    headers: response.headers,
                    body: response.data
                };

                // Execute post-response script if present
                if (request.postResponseScript) {
                    const scriptResult = await this._executePostResponseScript(
                        request.postResponseScript,
                        requestConfig,
                        result.response,
                        variables
                    );

                    result.variablesSet = scriptResult.variablesSet || {};
                    result.logs = scriptResult.logs || [];

                    if (scriptResult.error) {
                        result.scriptError = scriptResult.error;
                    }
                }
            } else {
                result.status = 'error';
                result.error = response.message || 'Request failed';
                result.statusCode = response.status || null;
                result.time = Date.now() - startTime;
                result.body = response.data || null;
                result.headers = response.headers || {};
            }
        } catch (error) {
            result.status = 'error';
            result.error = error.message;
            result.responseTime = Date.now() - startTime;
            result.time = Date.now() - startTime;
        }

        return result;
    }

    /**
     * Builds merged variables with precedence
     *
     * @private
     * @async
     * @param {string} collectionId - Collection ID
     * @param {Object} runtimeVariables - Variables set during execution
     * @returns {Promise<Object>} Merged variables
     */
    async _buildVariables(collectionId, runtimeVariables) {
        let variables = {};

        // 1. Collection variables (lowest precedence)
        try {
            const collectionVars = await this.variableRepository.getVariablesForCollection(collectionId);
            variables = { ...variables, ...collectionVars };
        } catch (e) {
            // Continue without collection variables
        }

        // 2. Environment variables
        try {
            const envVars = await this.environmentRepository.getActiveEnvironmentVariables();
            variables = { ...variables, ...envVars };
        } catch (e) {
            // Continue without environment variables
        }

        // 3. Runtime variables from post-response scripts (highest precedence)
        variables = { ...variables, ...runtimeVariables };

        return variables;
    }

    /**
     * Finds an endpoint in a collection (including folders)
     *
     * @private
     * @param {Object} collection - Collection object
     * @param {string} endpointId - Endpoint ID
     * @returns {Object|null} Endpoint or null
     */
    _findEndpoint(collection, endpointId) {
        // Check top-level endpoints
        let endpoint = collection.endpoints?.find(e => e.id === endpointId);
        if (endpoint) {return endpoint;}

        // Check folders
        if (collection.folders) {
            for (const folder of collection.folders) {
                endpoint = folder.endpoints?.find(e => e.id === endpointId);
                if (endpoint) {return endpoint;}
            }
        }

        return null;
    }

    /**
     * Builds request configuration from endpoint
     *
     * @private
     * @async
     * @param {Object} collection - Collection object
     * @param {Object} endpoint - Endpoint object
     * @param {Object} variables - Variables for substitution
     * @returns {Promise<Object>} Request configuration
     */
    async _buildRequestConfig(collection, endpoint, variables) {
        // Get all persisted data first
        const persistedHeaders = await this.collectionRepository.getPersistedHeaders(collection.id, endpoint.id) || [];
        const persistedBody = await this.collectionRepository.getModifiedRequestBody(collection.id, endpoint.id);
        const persistedQueryParams = await this.collectionRepository.getPersistedQueryParams(collection.id, endpoint.id) || [];
        const persistedPathParams = await this.collectionRepository.getPersistedPathParams(collection.id, endpoint.id) || [];
        const persistedAuthConfig = await this.collectionRepository.getPersistedAuthConfig(collection.id, endpoint.id);
        
        // Use persisted auth config if available, otherwise fall back to endpoint's security definition
        const effectiveAuthConfig = persistedAuthConfig || endpoint.security || null;
        
        // Build URL
        let url = endpoint.path;
        
        // Only prepend baseUrl template if path doesn't already include it
        if (!endpoint.path.includes('{{baseUrl}}')) {
            url = `{{baseUrl}}${endpoint.path}`;
        }

        // Use baseUrl from variables (which respects environment > collection precedence)
        // Fall back to collection.baseUrl only if not in variables
        const effectiveVariables = {
            ...variables,
            baseUrl: variables.baseUrl || collection.baseUrl || ''
        };

        // Apply persisted path parameters to URL
        if (persistedPathParams.length > 0) {
            for (const param of persistedPathParams) {
                if (param.key && param.value) {
                    effectiveVariables[param.key] = param.value;
                }
            }
        } else if (endpoint.parameters?.path) {
            // Fall back to endpoint default path params
            for (const [key, param] of Object.entries(endpoint.parameters.path)) {
                if (param.example && !effectiveVariables[key]) {
                    effectiveVariables[key] = param.example;
                }
            }
        }

        // Substitute variables in URL
        url = this.variableProcessor.processTemplate(url, effectiveVariables);

        // Apply persisted query parameters
        const queryParams = {};
        if (persistedQueryParams.length > 0) {
            for (const param of persistedQueryParams) {
                if (param.key) {
                    queryParams[param.key] = this.variableProcessor.processTemplate(param.value || '', effectiveVariables);
                }
            }
        } else if (endpoint.parameters?.query) {
            // Fall back to endpoint default query params
            for (const [key, param] of Object.entries(endpoint.parameters.query)) {
                if (param.example) {
                    queryParams[key] = this.variableProcessor.processTemplate(param.example, effectiveVariables);
                }
            }
        }

        // Append query params to URL
        const queryString = Object.entries(queryParams)
            .filter(([key, value]) => key && value)
            .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
            .join('&');
        if (queryString) {
            url += (url.includes('?') ? '&' : '?') + queryString;
        }

        // Auto-prepend https if no protocol
        if (url && !url.match(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//)) {
            url = `https://${url}`;
        }

        // Build headers
        let headers = { ...collection.defaultHeaders };
        if (endpoint.headers) {
            headers = { ...headers, ...endpoint.headers };
        }
        // Apply persisted headers
        for (const h of persistedHeaders) {
            if (h.key) {
                headers[h.key] = h.value;
            }
        }
        // Substitute variables in headers (use effectiveVariables which includes runtime vars)
        const processedHeaders = {};
        for (const [key, value] of Object.entries(headers)) {
            const processedKey = this.variableProcessor.processTemplate(key, effectiveVariables);
            const processedValue = this.variableProcessor.processTemplate(String(value), effectiveVariables);
            processedHeaders[processedKey] = processedValue;
        }

        // Build body
        let body = undefined;
        if (['POST', 'PUT', 'PATCH'].includes(endpoint.method)) {
            // Use persisted body first, then fall back to endpoint's requestBody example/schema
            let bodyContent = persistedBody;
            if (!bodyContent && endpoint.requestBody) {
                if (endpoint.requestBody.example && endpoint.requestBody.example !== 'null') {
                    bodyContent = endpoint.requestBody.example;
                } else if (endpoint.requestBody.schema) {
                    // Try to use schema example if available
                    bodyContent = JSON.stringify(endpoint.requestBody.schema.example || {}, null, 2);
                }
            }
            bodyContent = bodyContent || '';
            if (bodyContent) {
                const processedBody = this.variableProcessor.processTemplate(bodyContent, effectiveVariables);
                try {
                    body = JSON.parse(processedBody);
                } catch (e) {
                    body = processedBody;
                }
            }
        }

        // Apply auth config (use effectiveAuthConfig which falls back to endpoint.security)
        const authData = this._generateAuthData(effectiveAuthConfig, effectiveVariables);
        // Merge auth headers into processed headers
        Object.assign(processedHeaders, authData.headers);
        // Merge auth query params into URL
        if (Object.keys(authData.queryParams).length > 0) {
            const authQueryString = Object.entries(authData.queryParams)
                .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
                .join('&');
            url += (url.includes('?') ? '&' : '?') + authQueryString;
        }

        // Get HTTP version and timeout settings
        let httpVersion = 'auto';
        let timeout = 30000;
        try {
            const settings = await this.backendAPI.settings.get();
            httpVersion = settings.httpVersion || 'auto';
            const savedTimeout = settings.requestTimeout ?? settings.timeout;
            timeout = savedTimeout === 0 ? null : (savedTimeout ?? 30000);
        } catch (e) {
            // Use defaults
        }

        return {
            method: endpoint.method,
            url,
            headers: processedHeaders,
            body,
            httpVersion,
            timeout,
            auth: authData.authConfig
        };
    }

    /**
     * Executes post-response script
     *
     * @private
     * @async
     * @param {string} script - Script code
     * @param {Object} request - Request configuration
     * @param {Object} response - Response data
     * @param {Object} currentVariables - Current variables
     * @returns {Promise<Object>} Script result with variablesSet and logs
     */
    async _executePostResponseScript(script, request, response, currentVariables) {
        if (!script || script.trim() === '') {
            return { variablesSet: {}, logs: [] };
        }

        try {
            const scriptData = {
                script,
                request: {
                    url: request.url,
                    method: request.method,
                    headers: request.headers || {},
                    body: request.body
                },
                response: {
                    status: response.status,
                    statusText: response.statusText,
                    headers: response.headers || {},
                    body: response.body
                },
                environment: currentVariables
            };

            const result = await this.backendAPI.scripts.executeTest(scriptData);

            // Extract variables that were set
            // modifiedEnvironment is HashMap<String, Option<String>> from Rust
            // Option<String> serializes as: Some(value) -> value, None -> null
            const rawEnv = result.modifiedEnvironment || {};
            const variablesSet = {};
            for (const [key, value] of Object.entries(rawEnv)) {
                // Only include non-null values (null means unset)
                if (value !== null && value !== undefined) {
                    variablesSet[key] = value;
                }
            }

            return {
                variablesSet,
                logs: result.logs || [],
                error: result.errors?.length > 0 ? result.errors.join('; ') : null
            };
        } catch (error) {
            return {
                variablesSet: {},
                logs: [],
                error: error.message
            };
        }
    }

    /**
     * Generates authentication data from stored auth config
     *
     * @private
     * @param {Object|null} authConfig - Stored authentication configuration
     * @param {Object} variables - Variables for substitution
     * @returns {Object} Auth data with headers, queryParams, and authConfig
     */
    _generateAuthData(authConfig, variables) {
        const authData = {
            headers: {},
            queryParams: {},
            authConfig: null
        };

        if (!authConfig || !authConfig.type || authConfig.type === 'none') {
            return authData;
        }

        const { type, config } = authConfig;

        // Process variable substitution in auth config values
        const processValue = (val) => {
            if (typeof val === 'string') {
                return this.variableProcessor.processTemplate(val, variables);
            }
            return val || '';
        };

        switch (type) {
            case 'bearer': {
                // Use config.token if provided, otherwise fall back to bearerToken variable
                const bearerToken = config.token || variables.bearerToken || '';
                if (bearerToken) {
                    authData.headers['Authorization'] = `Bearer ${processValue(bearerToken)}`;
                }
                break;
            }

            case 'basic':
                if (config.username || config.password) {
                    const credentials = btoa(`${processValue(config.username)}:${processValue(config.password)}`);
                    authData.headers['Authorization'] = `Basic ${credentials}`;
                }
                break;

            case 'api-key':
                if (config.keyName && config.keyValue) {
                    const keyName = processValue(config.keyName);
                    const keyValue = processValue(config.keyValue);
                    if (config.location === 'header') {
                        authData.headers[keyName] = keyValue;
                    } else if (config.location === 'query') {
                        authData.queryParams[keyName] = keyValue;
                    }
                }
                break;

            case 'oauth2':
                if (config.token) {
                    const prefix = config.headerPrefix || 'Bearer';
                    authData.headers['Authorization'] = `${prefix} ${processValue(config.token)}`;
                }
                break;

            case 'digest':
                if (config.username || config.password) {
                    authData.authConfig = {
                        username: processValue(config.username),
                        password: processValue(config.password)
                    };
                }
                break;

            default:
                break;
        }

        return authData;
    }

    /**
     * Delays execution
     *
     * @private
     * @param {number} ms - Milliseconds to delay
     * @returns {Promise<void>}
     */
    _delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Adds a listener for runner events
     *
     * @param {Function} listener - Callback function
     */
    addListener(listener) {
        this.listeners.push(listener);
    }

    /**
     * Removes a listener
     *
     * @param {Function} listener - Callback to remove
     */
    removeListener(listener) {
        this.listeners = this.listeners.filter(l => l !== listener);
    }

    /**
     * Notifies all listeners of an event
     *
     * @private
     * @param {string} event - Event type
     * @param {*} data - Event data
     */
    _notifyListeners(event, data) {
        this.listeners.forEach(listener => {
            try {
                listener(event, data);
            } catch (e) {
                // Ignore listener errors
            }
        });
    }
}
