/**
 * @fileoverview Service for collection runner business logic and execution
 * @module services/RunnerService
 */

import { app } from '../appContext.js';
import { VariableProcessor } from '../variables/VariableProcessor.js';
import { VariableRepository } from '../storage/VariableRepository.js';
import { EnvironmentRepository } from '../storage/EnvironmentRepository.js';
import { CollectionRepository } from '../storage/CollectionRepository.js';
import { CertificateRepository } from '../storage/CertificateRepository.js';
import { CertificateService } from './CertificateService.js';
import { normalizeFormRows } from '../utils/formDataRows.js';

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
        this.variableRepository = new VariableRepository(backendAPI, app.secretStore);
        this.environmentRepository = new EnvironmentRepository(backendAPI, app.secretStore);
        this.collectionRepository = new CollectionRepository(backendAPI, app.secretStore);
        this.certificateService = new CertificateService(new CertificateRepository(backendAPI));

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
     * Resolves an endpoint's saved request config, used to seed per-request
     * runner overrides when a request is added to a runner.
     *
     * @async
     * @param {string} collectionId - Collection ID
     * @param {string} endpointId - Endpoint ID
     * @returns {Promise<Object>} { pathParams, queryParams, headers, body }
     */
    async getEndpointRequestConfig(collectionId, endpointId) {
        const [pathParams, queryParams, headers, body] = await Promise.all([
            this.collectionRepository.getPersistedPathParams(collectionId, endpointId),
            this.collectionRepository.getPersistedQueryParams(collectionId, endpointId),
            this.collectionRepository.getPersistedHeaders(collectionId, endpointId),
            this.collectionRepository.getModifiedRequestBody(collectionId, endpointId)
        ]);

        return {
            pathParams: pathParams || [],
            queryParams: queryParams || [],
            headers: headers || [],
            body: body || ''
        };
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

                if (onProgress) {
                    onProgress(i, runner.requests.length, requestResult);
                }
                this._notifyListeners('request-completed', { index: i, result: requestResult });

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
            const variables = await this._buildVariables(request.collectionId, runtimeVariables);

            const collection = await this.collectionRepository.getById(request.collectionId);
            if (!collection) {
                throw new Error(`Collection not found: ${request.collectionId}`);
            }

            const endpoint = this._findEndpoint(collection, request.endpointId);
            if (!endpoint) {
                throw new Error(`Endpoint not found: ${request.endpointId}`);
            }

            const requestConfig = await this._buildRequestConfig(collection, endpoint, variables, request.overrides);

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

        try {
            const collectionVars = await this.variableRepository.getVariablesForCollection(collectionId);
            variables = { ...variables, ...collectionVars };
        } catch (e) {
        }

        try {
            const envVars = await this.environmentRepository.getActiveEnvironmentVariables();
            variables = { ...variables, ...envVars };
        } catch (e) {
        }

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
        let endpoint = collection.endpoints?.find(e => e.id === endpointId);
        if (endpoint) {return endpoint;}

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
     * @param {Object} [overrides] - Per-request overrides (pathParams, queryParams, headers, body)
     * @returns {Promise<Object>} Request configuration
     */
    async _buildRequestConfig(collection, endpoint, variables, overrides) {
        const persistedHeaders = await this.collectionRepository.getPersistedHeaders(collection.id, endpoint.id) || [];
        const persistedBody = await this.collectionRepository.getModifiedRequestBody(collection.id, endpoint.id);
        const persistedFormBodyData = await this.collectionRepository.getFormBodyData(collection.id, endpoint.id);
        const persistedQueryParams = await this.collectionRepository.getPersistedQueryParams(collection.id, endpoint.id) || [];
        const persistedPathParams = await this.collectionRepository.getPersistedPathParams(collection.id, endpoint.id) || [];
        const persistedAuthConfig = await this.collectionRepository.getPersistedAuthConfig(collection.id, endpoint.id);

        const effectivePathParams = overrides?.pathParams?.length ? overrides.pathParams : persistedPathParams;
        const effectiveQueryParams = overrides?.queryParams?.length ? overrides.queryParams : persistedQueryParams;
        const effectiveHeaders = overrides?.headers?.length ? overrides.headers : persistedHeaders;
        const overrideBody = typeof overrides?.body === 'string' && overrides.body.trim() !== '' ? overrides.body : null;

        let effectiveAuthConfig = persistedAuthConfig || endpoint.security || { type: 'inherit', config: {} };
        if (effectiveAuthConfig?.type === 'inherit') {
            effectiveAuthConfig = await this.collectionRepository.getInheritedAuthConfig(collection.id, endpoint.id) || null;
        }
        
        let url = endpoint.path;
        
        if (!endpoint.path.includes('{{baseUrl}}')) {
            url = `{{baseUrl}}${endpoint.path}`;
        }

        const effectiveVariables = {
            ...variables,
            baseUrl: variables.baseUrl || collection.baseUrl || ''
        };

        if (effectivePathParams.length > 0) {
            for (const param of effectivePathParams) {
                if (param.key && param.value) {
                    effectiveVariables[param.key] = param.value;
                }
            }
        } else if (endpoint.parameters?.path) {
            for (const [key, param] of Object.entries(endpoint.parameters.path)) {
                if (param.example && !effectiveVariables[key]) {
                    effectiveVariables[key] = param.example;
                }
            }
        }

        url = this.variableProcessor.processTemplate(url, effectiveVariables);

        const queryParams = {};
        if (effectiveQueryParams.length > 0) {
            for (const param of effectiveQueryParams) {
                if (param.key) {
                    queryParams[param.key] = this.variableProcessor.processTemplate(param.value || '', effectiveVariables);
                }
            }
        } else if (endpoint.parameters?.query) {
            for (const [key, param] of Object.entries(endpoint.parameters.query)) {
                if (param.example) {
                    queryParams[key] = this.variableProcessor.processTemplate(param.example, effectiveVariables);
                }
            }
        }

        const queryString = Object.entries(queryParams)
            .filter(([key, value]) => key && value)
            .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
            .join('&');
        if (queryString) {
            url += (url.includes('?') ? '&' : '?') + queryString;
        }

        if (url && !url.match(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//)) {
            url = `https://${url}`;
        }

        let headers = { ...collection.defaultHeaders };
        if (endpoint.headers) {
            headers = { ...headers, ...endpoint.headers };
        }
        for (const h of effectiveHeaders) {
            if (h.key) {
                headers[h.key] = h.value;
            }
        }
        const processedHeaders = {};
        for (const [key, value] of Object.entries(headers)) {
            const processedKey = this.variableProcessor.processTemplate(key, effectiveVariables);
            const processedValue = this.variableProcessor.processTemplate(String(value), effectiveVariables);
            processedHeaders[processedKey] = processedValue;
        }

        let body = undefined;
        let bodyType = undefined;

        if (!overrideBody && persistedFormBodyData && (persistedFormBodyData.mode === 'formdata' || persistedFormBodyData.mode === 'urlencoded')) {
            const processed = normalizeFormRows(persistedFormBodyData.fields)
                .filter((row) => row.enabled !== false)
                .map((row) => ({
                    key: this.variableProcessor.processTemplate(row.key, effectiveVariables),
                    value: row.type === 'file'
                        ? ''
                        : this.variableProcessor.processTemplate(row.value || '', effectiveVariables),
                    type: row.type || 'text',
                    filePath: row.filePath
                        ? this.variableProcessor.processTemplate(row.filePath, effectiveVariables)
                        : undefined,
                    contentType: row.contentType || undefined
                }));
            if (processed.length > 0) {
                body = processed;
            }
            bodyType = persistedFormBodyData.mode;
        } else if (!overrideBody && persistedFormBodyData && persistedFormBodyData.mode === 'binary') {
            if (persistedFormBodyData.filePath) {
                body = {
                    filePath: this.variableProcessor.processTemplate(persistedFormBodyData.filePath, effectiveVariables),
                    contentType: persistedFormBodyData.contentType || undefined
                };
                bodyType = 'binary';
            }
        } else if (overrideBody || ['POST', 'PUT', 'PATCH'].includes(endpoint.method)) {
            let bodyContent = overrideBody || persistedBody;
            if (!bodyContent && endpoint.requestBody) {
                if (endpoint.requestBody.example && endpoint.requestBody.example !== 'null') {
                    bodyContent = endpoint.requestBody.example;
                } else if (endpoint.requestBody.schema) {
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

        const authData = this._generateAuthData(effectiveAuthConfig, effectiveVariables);
        Object.assign(processedHeaders, authData.headers);
        if (Object.keys(authData.queryParams).length > 0) {
            const authQueryString = Object.entries(authData.queryParams)
                .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
                .join('&');
            url += (url.includes('?') ? '&' : '?') + authQueryString;
        }

        let httpVersion = 'auto';
        let timeout = 30000;
        try {
            const settings = await this.backendAPI.settings.get();
            httpVersion = settings.httpVersion || 'auto';
            const savedTimeout = settings.requestTimeout ?? settings.timeout;
            timeout = savedTimeout === 0 ? null : (savedTimeout ?? 30000);
        } catch (e) {
        }

        let clientCert = null;
        try {
            await this.certificateService.getItems();
            clientCert = this.certificateService.getForHost(new URL(url).host);
        } catch (e) {
            void e;
        }

        return {
            method: endpoint.method,
            url,
            headers: processedHeaders,
            body,
            bodyType,
            httpVersion,
            timeout,
            auth: authData.authConfig,
            awsAuth: authData.awsAuth || null,
            clientCert
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

            const rawEnv = result.modifiedEnvironment || {};
            const variablesSet = {};
            for (const [key, value] of Object.entries(rawEnv)) {
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

        if (!authConfig || !authConfig.type || authConfig.type === 'none' || authConfig.type === 'inherit') {
            return authData;
        }

        const { type, config } = authConfig;

        const processValue = (val) => {
            if (typeof val === 'string') {
                return this.variableProcessor.processTemplate(val, variables);
            }
            return val || '';
        };

        switch (type) {
            case 'bearer': {
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

            case 'aws-v4':
                if (config.accessKeyId && config.secretAccessKey) {
                    authData.awsAuth = {
                        accessKeyId: processValue(config.accessKeyId),
                        secretAccessKey: processValue(config.secretAccessKey),
                        region: processValue(config.region) || 'us-east-1',
                        service: processValue(config.service) || '',
                        sessionToken: config.sessionToken ? processValue(config.sessionToken) : null
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
            }
        });
    }
}
