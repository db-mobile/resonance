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
import { MockServerRepository } from '../storage/MockServerRepository.js';
import { CertificateService } from './CertificateService.js';
import { MockServerService } from './MockServerService.js';
import { RequestBuilderService } from './RequestBuilderService.js';
import { ChangeEmitter } from './ChangeEmitter.js';
import { normalizeFormRows } from '../utils/formDataRows.js';
import { activeKeyValueRows } from '../utils/keyValueRows.js';
import { findRequest } from '../collections/collectionTree.js';
import { buildEndpointUrl } from '../collections/endpointUrl.js';
import { resolveEffectiveAuthConfig } from '../auth/authInheritance.js';
import { resolveAuthConfigVariables } from '../auth/authVariables.js';
import { generateAuthData } from '../auth/authData.js';
import { deriveRequestSettings } from '../state/settingsCache.js';
import { extractCookies } from '../cookieParser.js';
import { translate, translateCount } from '../utils/translate.js';
import { RUNNABLE_PROTOCOLS } from '../utils/runnableRequests.js';
import { parseDataFile } from '../utils/dataFile.js';

const BODY_METHODS = ['POST', 'PUT', 'PATCH'];

const ABSOLUTE_OR_TEMPLATED_PATH = /^([a-zA-Z][a-zA-Z0-9+.-]*:\/\/|\{\{)/;

export class RunnerService {
    /**
     * @param {RunnerRepository} repository
     * @param {Object} backendAPI
     * @param {IStatusDisplay} statusDisplay
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
        this.mockServerService = new MockServerService(new MockServerRepository(backendAPI), null);
        this.requestBuilder = new RequestBuilderService(null, null);

        this.isRunning = false;
        this.shouldStop = false;
        this.currentRunId = null;
        this._stopWaiters = new Set();
        this._events = new ChangeEmitter();
    }

    /** @returns {Set<Function>} */
    get listeners() {
        return this._events.listeners;
    }

    /** @returns {Promise<Array<Object>>} */
    async getAllRunners() {
        return this.repository.getAll();
    }

    /**
     * @param {string} id
     * @returns {Promise<Object|undefined>}
     */
    async getRunner(id) {
        return this.repository.getById(id);
    }

    /**
     * @param {Object} runnerData
     * @returns {Promise<Object>}
     */
    async createRunner(runnerData) {
        const runner = await this.repository.add(runnerData);
        this.statusDisplay?.update(translate('runner.created', 'Runner "{{name}}" created', { name: runner.name }), null);
        return runner;
    }

    /**
     * @param {string} id
     * @param {Object} updates
     * @returns {Promise<Object|null>}
     */
    async updateRunner(id, updates) {
        const runner = await this.repository.update(id, updates);
        if (runner) {
            this.statusDisplay?.update(translate('runner.saved', 'Runner "{{name}}" saved', { name: runner.name }), null);
        }
        return runner;
    }

    /**
     * @param {string} id
     * @returns {Promise<boolean>}
     */
    async deleteRunner(id) {
        const success = await this.repository.delete(id);
        if (success) {
            this.statusDisplay?.update(translate('runner.deleted', 'Runner deleted'), null);
        }
        return success;
    }

    /**
     * @param {string} collectionId
     * @param {string} endpointId
     * @returns {Promise<Object>}
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
     * @param {string} runnerId
     * @param {Function} [onProgress]
     * @returns {Promise<Object>}
     */
    async executeRunner(runnerId, onProgress) {
        if (this.isRunning) {
            throw new Error(translate('runner.error_already_running', 'A runner is already executing'));
        }

        const runner = await this.repository.getById(runnerId);
        if (!runner) {
            throw new Error(translate('runner.error_not_found', 'Runner not found'));
        }

        return this._execute(runner, {
            runnerId,
            runnerName: runner.name,
            onProgress,
            onFinish: () => this.repository.updateLastRun(runnerId)
        });
    }

    /**
     * @param {Object} runnerData
     * @param {Function} [onProgress]
     * @returns {Promise<Object>}
     */
    async executeRunnerData(runnerData, onProgress) {
        if (this.isRunning) {
            throw new Error(translate('runner.error_already_running', 'A runner is already executing'));
        }

        return this._execute(runnerData, {
            runnerId: null,
            runnerName: runnerData.name || translate('runner.untitled', 'Untitled Runner'),
            onProgress
        });
    }

    /**
     * @param {Object} runner
     * @param {Object} identity
     * @param {string|null} identity.runnerId
     * @param {string} identity.runnerName
     * @param {Function} [identity.onProgress]
     * @param {Function} [identity.onFinish]
     * @returns {Promise<Object>}
     */
    async _execute(runner, { runnerId, runnerName, onProgress, onFinish = null }) {
        if (!runner.requests || runner.requests.length === 0) {
            throw new Error(translate('runner.error_no_requests', 'Runner has no requests to execute'));
        }

        this.isRunning = true;
        this.shouldStop = false;
        this.currentRunId = runnerId ?? 'temp';

        const queue = runner.requests;
        const results = {
            runnerId,
            runnerName,
            startTime: Date.now(),
            endTime: null,
            totalRequests: 0,
            iterations: 1,
            passed: 0,
            failed: 0,
            skipped: 0,
            requests: [],
            variablesSet: {}
        };

        let runtimeVariables = {};

        try {
            const dataRows = await this._loadDataRows(runner.options?.dataFile);
            const iterations = dataRows ? dataRows.length : clampIterations(runner.options?.iterations);
            const total = queue.length * iterations;
            results.iterations = iterations;
            results.totalRequests = total;

            this._notifyListeners('run-started', {
                runnerId,
                total,
                iterations,
                iterationLabels: dataRows ? dataRows.map(describeDataRow) : null
            });

            const runContext = await this._buildRunContext();

            for (let flat = 0; flat < total; flat++) {
                if (this.shouldStop) {
                    this._markRemainingAsSkipped(queue, results, flat, translate('runner.skip_stopped', 'Execution stopped by user'));
                    break;
                }

                const iteration = Math.floor(flat / queue.length);
                this._notifyListeners('request-started', { index: flat });

                const request = queue[flat % queue.length];
                const requestResult = await this._untilStopped(
                    this._executeRequest(request, runtimeVariables, flat, runContext, {
                        index: iteration,
                        count: iterations,
                        data: dataRows?.[iteration] ?? null
                    })
                );

                if (!requestResult) {
                    this._markRemainingAsSkipped(queue, results, flat, translate('runner.skip_stopped', 'Execution stopped by user'));
                    break;
                }

                requestResult.iteration = iteration + 1;
                results.requests.push(requestResult);

                if (requestResult.variablesSet) {
                    runtimeVariables = { ...runtimeVariables, ...requestResult.variablesSet };
                    Object.assign(results.variablesSet, requestResult.variablesSet);
                }

                const failed = requestResult.status !== 'success';
                if (failed) {
                    results.failed++;
                } else {
                    results.passed++;
                }

                if (onProgress) {
                    onProgress(flat, total, requestResult);
                }
                this._notifyListeners('request-completed', { index: flat, result: requestResult });

                if (failed && runner.options?.stopOnError) {
                    this._markRemainingAsSkipped(queue, results, flat + 1, translate('runner.skip_previous_error', 'Skipped due to previous error'));
                    break;
                }

                if (runner.options?.delayMs > 0 && flat < total - 1) {
                    await this._delay(runner.options.delayMs);
                }
            }
        } finally {
            results.endTime = Date.now();
            results.totalTime = results.endTime - results.startTime;

            this.isRunning = false;
            this.shouldStop = false;
            this.currentRunId = null;
            this._stopWaiters.clear();

            if (onFinish) {
                await onFinish();
            }

            this._notifyListeners('run-completed', results);
        }

        return results;
    }

    stopExecution() {
        if (this.isRunning) {
            this.shouldStop = true;
            this.statusDisplay?.update(translate('runner.stopping', 'Stopping runner...'), null);
            const waiters = [...this._stopWaiters];
            this._stopWaiters.clear();
            waiters.forEach(wake => wake());
        }
    }

    /** @returns {boolean} */
    isExecuting() {
        return this.isRunning;
    }

    /**
     * @param {Promise<Object>} work
     * @returns {Promise<Object|null>}
     */
    _untilStopped(work) {
        return new Promise((resolve, reject) => {
            const wake = () => resolve(null);
            this._stopWaiters.add(wake);
            work.then(resolve, reject).finally(() => this._stopWaiters.delete(wake));
        });
    }

    /**
     * @param {Array} queue
     * @param {Object} results
     * @param {number} startIndex
     * @param {string} reason
     */
    _markRemainingAsSkipped(queue, results, startIndex, reason) {
        for (let flat = startIndex; flat < results.totalRequests; flat++) {
            results.requests.push({
                index: flat,
                ...queue[flat % queue.length],
                iteration: Math.floor(flat / queue.length) + 1,
                status: 'skipped',
                error: reason
            });
            results.skipped++;
        }
    }

    /**
     * @param {{path: string, name: string}|null|undefined} dataFile
     * @returns {Promise<Array<Object<string, string>>|null>}
     */
    async _loadDataRows(dataFile) {
        if (!dataFile?.path) {
            return null;
        }
        let rows;
        try {
            const file = await this.backendAPI.runner.readDataFile(dataFile.path);
            rows = parseDataFile(file.name || dataFile.name, file.content);
        } catch (error) {
            throw new Error(translate('runner.data_file_error', 'Data file {{name}}: {{message}}', {
                name: dataFile.name,
                message: error?.message || String(error)
            }), { cause: error });
        }
        if (rows.length === 0) {
            throw new Error(translate('runner.data_file_empty', 'Data file {{name}} has no rows', { name: dataFile.name }));
        }
        return rows;
    }

    /**
     * @param {Object} request
     * @param {Object} runtimeVariables
     * @param {number} index
     * @param {Object|null} [runContext]
     * @param {{index: number, count: number, data: Object<string, string>|null}|null} [iteration]
     * @returns {Promise<Object>}
     */
    async _executeRequest(request, runtimeVariables, index, runContext = null, iteration = null) {
        this.variableProcessor.clearDynamicCache();
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
            logs: [],
            testResults: []
        };

        try {
            let variables = await this._buildVariables(request.collectionId, runtimeVariables, runContext, iteration?.data ?? null);
            const scriptIteration = {
                iteration: iteration?.index ?? 0,
                iterationCount: iteration?.count ?? 1,
                data: iteration?.data ?? {},
                requestName: request.name || null
            };

            const collection = await this._getCollectionForRun(request.collectionId, runContext);
            if (!collection) {
                throw new Error(translate(
                    'runner.error_collection_missing',
                    'The collection this request came from is not open. Remove the request and add it again from Available Requests.'
                ));
            }

            const endpoint = this._findEndpoint(collection, request.endpointId);
            if (!endpoint) {
                throw new Error(translate(
                    'runner.error_endpoint_missing',
                    '"{{name}}" no longer exists in {{collection}}. Remove it and add it again from Available Requests.',
                    { name: request.name, collection: collection.name }
                ));
            }

            const protocol = endpoint.protocol || 'http';
            if (!RUNNABLE_PROTOCOLS.has(protocol)) {
                throw new Error(translate(
                    'runner.error_protocol',
                    '{{protocol}} requests cannot be run by the collection runner',
                    { protocol }
                ));
            }

            const scripts = await this._getEndpointScripts(collection.id, endpoint.id);
            const prepared = await this._buildRequestConfig(collection, endpoint, variables, request.overrides, runContext);
            const outcome = { variablesSet: {}, logs: [], testResults: [], errors: [] };

            let { requestConfig } = prepared;
            if (scripts.preRequestScript.trim()) {
                requestConfig = await this._runPreRequestScript(scripts.preRequestScript, prepared, variables, outcome, scriptIteration);
                variables = mergeVariables(variables, outcome.variablesSet);
            }

            await this._attachClientCert(requestConfig, runContext);
            await this._attachCookies(requestConfig);

            const response = await this.backendAPI.sendApiRequest(requestConfig);

            result.statusCode = response.status || null;
            result.responseTime = Date.now() - startTime;
            result.time = result.responseTime;
            result.httpSuccess = Boolean(response.success);
            result.body = response.data ?? null;
            result.headers = response.headers || {};
            result.cookies = extractCookies(response.headers);
            result.response = {
                status: response.status,
                statusText: response.statusText,
                headers: response.headers,
                body: response.data
            };

            await this._storeResponseCookies(response, requestConfig.url);
            this._recordHistory(requestConfig, response, collection.id, endpoint.id, prepared.authData, runContext);

            for (const script of [scripts.testScript, request.postResponseScript]) {
                if (script && script.trim()) {
                    await this._runTestScript(script, requestConfig, response, variables, outcome, scriptIteration);
                    variables = mergeVariables(variables, outcome.variablesSet);
                }
            }

            result.variablesSet = outcome.variablesSet;
            result.logs = outcome.logs;
            result.testResults = outcome.testResults;
            if (outcome.errors.length > 0) {
                result.scriptError = outcome.errors.join('; ');
            }

            const failureSummary = this._summarizePostScriptFailure(outcome.testResults, result.scriptError || null);
            if (failureSummary) {
                result.status = 'error';
                result.error = failureSummary;
            } else if (outcome.testResults.length > 0 || response.success) {
                result.status = 'success';
            } else {
                result.status = 'error';
                result.error = response.message
                    || (response.status
                        ? `${response.status} ${response.statusText || ''}`.trim()
                        : translate('runner.error_request_failed', 'Request failed'));
            }
        } catch (error) {
            result.status = 'error';
            result.error = error.message;
            result.responseTime = Date.now() - startTime;
            result.time = result.responseTime;
        }

        return result;
    }

    /**
     * @param {Array<{passed: boolean, message: string}>} testResults
     * @param {string|null} scriptError
     * @returns {string|null}
     */
    _summarizePostScriptFailure(testResults, scriptError) {
        const failedTests = (testResults || []).filter(test => !test.passed);
        if (failedTests.length === 0 && !scriptError) {
            return null;
        }

        const parts = [];
        if (failedTests.length > 0) {
            const count = translateCount('runner.tests_failed', failedTests.length, {
                one: '{{count}} test failed',
                other: '{{count}} tests failed'
            });
            const names = failedTests.map(test => test.message).filter(Boolean);
            parts.push(names.length > 0 ? `${count}: ${names.join('; ')}` : count);
        }
        if (scriptError) {
            parts.push(translate('runner.script_error', 'Script error: {{message}}', { message: scriptError }));
        }
        return parts.join(' | ');
    }

    /**
     * @param {string} collectionId
     * @param {Object} runtimeVariables
     * @param {Object|null} [runContext]
     * @param {Object<string, string>|null} [dataRow]
     * @returns {Promise<Object>}
     */
    async _buildVariables(collectionId, runtimeVariables, runContext = null, dataRow = null) {
        let variables = {};

        try {
            let collectionVars = runContext?.collectionVars.get(collectionId);
            if (!collectionVars) {
                collectionVars = await this.variableRepository.getVariablesForCollection(collectionId);
                runContext?.collectionVars.set(collectionId, collectionVars);
            }
            variables = { ...variables, ...collectionVars };
        } catch (e) {
            void e;
        }

        try {
            const envVars = runContext
                ? runContext.envVars
                : await this.environmentRepository.getActiveEnvironmentVariables();
            variables = { ...variables, ...envVars };
        } catch (e) {
            void e;
        }

        return { ...mergeVariables(variables, runtimeVariables), ...dataRow };
    }

    /** @returns {Promise<Object>} */
    async _buildRunContext() {
        const context = {
            settings: null,
            envVars: {},
            environmentName: null,
            collections: new Map(),
            collectionVars: new Map(),
            mockBaseUrls: new Map(),
            certificatesLoaded: false
        };

        context.settings = await this._loadSettings();

        try {
            context.envVars = await this.environmentRepository.getActiveEnvironmentVariables();
        } catch (e) {
            void e;
        }

        try {
            const activeEnvironment = await app.environmentController?.service?.getActiveEnvironment();
            context.environmentName = activeEnvironment?.name || null;
        } catch (e) {
            void e;
        }

        try {
            await this.certificateService.getItems();
            context.certificatesLoaded = true;
        } catch (e) {
            void e;
        }

        return context;
    }

    /** @returns {Promise<Object|null>} */
    async _loadSettings() {
        try {
            return await this.backendAPI.settings.get();
        } catch (e) {
            void e;
            return null;
        }
    }

    /**
     * @param {string} collectionId
     * @param {Object|null} runContext
     * @returns {Promise<Object|null>}
     */
    async _getCollectionForRun(collectionId, runContext) {
        if (runContext?.collections.has(collectionId)) {
            return runContext.collections.get(collectionId);
        }
        const collection = await this.collectionRepository.getById(collectionId);
        runContext?.collections.set(collectionId, collection);
        return collection;
    }

    /**
     * @param {Object} collection
     * @param {string} endpointId
     * @returns {Object|null}
     */
    _findEndpoint(collection, endpointId) {
        return findRequest(collection, endpointId);
    }

    /**
     * @param {string} collectionId
     * @param {string} endpointId
     * @returns {Promise<{preRequestScript: string, testScript: string}>}
     */
    async _getEndpointScripts(collectionId, endpointId) {
        try {
            const scripts = await app.scriptController?.getScriptsForEndpoint(collectionId, endpointId);
            return {
                preRequestScript: scripts?.preRequestScript || '',
                testScript: scripts?.testScript || ''
            };
        } catch (e) {
            void e;
            return { preRequestScript: '', testScript: '' };
        }
    }

    /**
     * @param {Object} collection
     * @param {Object} endpoint
     * @param {Object} variables
     * @param {Object} [overrides]
     * @param {Object|null} [runContext]
     * @returns {Promise<{requestConfig: Object, rawUrl: string, authData: Object, mockRewrite: Object|null}>}
     */
    async _buildRequestConfig(collection, endpoint, variables, overrides, runContext = null) {
        const processor = this.variableProcessor;
        const persisted = await this.collectionRepository.getAllPersistedEndpointData(collection.id, endpoint.id);
        const persistedAuthConfig = await this.collectionRepository.getPersistedAuthConfig(collection.id, endpoint.id);
        const isGraphQL = (endpoint.protocol || 'http') === 'graphql';
        const method = isGraphQL ? 'POST' : endpoint.method;

        const effectiveVariables = {
            ...variables,
            baseUrl: variables.baseUrl || collection.baseUrl || ''
        };

        const rawUrl = buildEndpointUrl({
            ...endpoint,
            persistedUrl: persisted.url,
            collectionBaseUrl: !ABSOLUTE_OR_TEMPLATED_PATH.test(endpoint.path)
        });

        const pathParams = this._effectivePathParams(endpoint, overrides, persisted);
        const headers = this._effectiveHeaders(collection, endpoint, overrides, persisted);
        const queryRows = this._effectiveQueryRows(endpoint, overrides, persisted);
        const queryParams = Object.fromEntries(queryRows.map(row => [row.key, row.value]));

        const configuredAuth = persistedAuthConfig || endpoint.security || { type: 'inherit', config: {} };
        const resolvedAuth = withBearerFallback(await resolveEffectiveAuthConfig(configuredAuth, {
            collectionId: collection.id,
            endpointId: endpoint.id,
            repository: this.collectionRepository
        }), effectiveVariables);
        const { authConfig: substitutedAuth } = resolveAuthConfigVariables(resolvedAuth, effectiveVariables, processor);
        const authData = generateAuthData(substitutedAuth);
        this.requestBuilder.mergeAuthData(headers, queryParams, authData);

        const rowKeys = new Set(queryRows.map(row => row.key));
        for (const [key, value] of Object.entries(authData.queryParams)) {
            if (!rowKeys.has(key)) {
                queryRows.push({ key, value });
            }
        }

        const { url: resolvedUrl, queryString, pathParams: processedPathParams } = this.requestBuilder.processRequestComponents({
            url: rawUrl,
            pathParams,
            headers,
            queryParams,
            queryRows,
            variables: effectiveVariables,
            processor
        });

        let url = resolvedUrl;
        let mockRewrite = null;
        const mockBaseUrl = await this._mockBaseUrlFor(collection.id, runContext);
        if (mockBaseUrl && endpoint.path) {
            let mockPath = endpoint.path;
            for (const [key, value] of Object.entries(processedPathParams)) {
                mockPath = mockPath.replace(`{${key}}`, () => value);
            }
            mockRewrite = { baseUrl: mockBaseUrl, pathTemplate: endpoint.path };
            url = queryString ? `${mockBaseUrl}${mockPath}?${queryString}` : `${mockBaseUrl}${mockPath}`;
        }

        const { body, bodyType } = this._buildBody({
            endpoint,
            method,
            isGraphQL,
            persisted,
            overrides,
            variables: effectiveVariables
        });

        const settings = deriveRequestSettings(runContext ? runContext.settings : await this._loadSettings());

        return {
            requestConfig: {
                method,
                url,
                rawUrl,
                headers,
                queryParams,
                pathParams: processedPathParams,
                body,
                bodyType,
                httpVersion: settings.httpVersion,
                timeout: settings.timeout,
                verifySsl: settings.verifySsl,
                followRedirects: settings.followRedirects,
                auth: authData.authConfig,
                awsAuth: authData.awsAuth || null,
                ntlm: authData.ntlmAuth || null,
                clientCert: null
            },
            rawUrl,
            authData,
            mockRewrite
        };
    }

    /**
     * @param {Object} endpoint
     * @param {Object} [overrides]
     * @param {Object} persisted
     * @returns {Object}
     */
    _effectivePathParams(endpoint, overrides, persisted) {
        const rows = overrides?.pathParams?.length ? overrides.pathParams : persisted.pathParams || [];
        const pathParams = {};
        if (rows.length > 0) {
            for (const row of rows) {
                if (row.key && row.value) {
                    pathParams[row.key] = row.value;
                }
            }
        } else if (endpoint.parameters?.path) {
            for (const [key, param] of Object.entries(endpoint.parameters.path)) {
                if (param.example) {
                    pathParams[key] = String(param.example);
                }
            }
        }
        return pathParams;
    }

    /**
     * @param {Object} collection
     * @param {Object} endpoint
     * @param {Object} [overrides]
     * @param {Object} persisted
     * @returns {Object}
     */
    _effectiveHeaders(collection, endpoint, overrides, persisted) {
        const headers = { ...collection.defaultHeaders, ...endpoint.headers };
        const rows = activeKeyValueRows(Array.isArray(overrides?.headers) ? overrides.headers : persisted.headers);
        for (const row of rows) {
            headers[row.key] = row.value;
        }
        for (const [key, value] of Object.entries(headers)) {
            headers[key] = value === null || value === undefined ? '' : String(value);
        }
        return headers;
    }

    /**
     * @param {Object} endpoint
     * @param {Object} [overrides]
     * @param {Object} persisted
     * @returns {Array<{key: string, value: string}>}
     */
    _effectiveQueryRows(endpoint, overrides, persisted) {
        const rows = activeKeyValueRows(
            Array.isArray(overrides?.queryParams) ? overrides.queryParams : persisted.queryParams
        ).map(row => ({ key: row.key, value: row.value }));

        if (rows.length === 0 && endpoint.parameters?.query) {
            for (const [key, param] of Object.entries(endpoint.parameters.query)) {
                if (param.example) {
                    rows.push({ key, value: String(param.example) });
                }
            }
        }
        return rows;
    }

    /**
     * @param {Object} opts
     * @param {Object} opts.endpoint
     * @param {string} opts.method
     * @param {boolean} opts.isGraphQL
     * @param {Object} opts.persisted
     * @param {Object} [opts.overrides]
     * @param {Object} opts.variables
     * @returns {{body: *, bodyType: string|undefined}}
     */
    _buildBody({ endpoint, method, isGraphQL, persisted, overrides, variables }) {
        const process = (text) => this.variableProcessor.processTemplate(text, variables);
        const hasBodyOverride = typeof overrides?.body === 'string';
        const overrideBody = hasBodyOverride && overrides.body.trim() !== '' ? overrides.body : null;
        const form = persisted.formBodyData;

        if (isGraphQL && !overrideBody && persisted.graphqlData) {
            return { body: this._buildGraphQLBody(persisted.graphqlData, process), bodyType: undefined };
        }

        if (!overrideBody && (form?.mode === 'formdata' || form?.mode === 'urlencoded')) {
            const processed = normalizeFormRows(form.fields)
                .filter((row) => row.enabled !== false)
                .map((row) => ({
                    key: process(row.key),
                    value: row.type === 'file' ? '' : process(row.value || ''),
                    type: row.type || 'text',
                    filePath: row.filePath ? process(row.filePath) : undefined,
                    contentType: row.contentType || undefined
                }));
            return { body: processed.length > 0 ? processed : undefined, bodyType: form.mode };
        }

        if (!overrideBody && form?.mode === 'binary') {
            if (!form.filePath) {
                throw new Error(translate('runner.error_no_binary_file', 'No file selected for binary body'));
            }
            return {
                body: { filePath: process(form.filePath), contentType: form.contentType || undefined },
                bodyType: 'binary'
            };
        }

        if (!overrideBody && !BODY_METHODS.includes(method)) {
            return { body: undefined, bodyType: undefined };
        }

        if (form?.mode === 'text') {
            const text = overrideBody || (hasBodyOverride ? '' : form.content || '');
            return { body: text ? process(text) : undefined, bodyType: 'text' };
        }

        let bodyContent = overrideBody || (hasBodyOverride ? null : persisted.modifiedBody);
        if (!bodyContent && !hasBodyOverride && endpoint.requestBody) {
            if (endpoint.requestBody.example && endpoint.requestBody.example !== 'null') {
                bodyContent = endpoint.requestBody.example;
            } else if (endpoint.requestBody.schema) {
                bodyContent = JSON.stringify(endpoint.requestBody.schema.example || {}, null, 2);
            }
        }
        if (typeof bodyContent !== 'string') {
            bodyContent = bodyContent ? JSON.stringify(bodyContent) : '';
        }
        if (!bodyContent.trim()) {
            return { body: undefined, bodyType: undefined };
        }

        try {
            return { body: JSON.parse(process(bodyContent.trim())), bodyType: undefined };
        } catch (e) {
            throw new Error(translate('runner.error_invalid_body', 'Invalid Body JSON: {{message}}', { message: e.message }), { cause: e });
        }
    }

    /**
     * @param {Object} graphqlData
     * @param {function(string): string} process
     * @returns {Object}
     */
    _buildGraphQLBody(graphqlData, process) {
        const query = process((graphqlData.query || '').trim());
        const variablesText = process((graphqlData.variables || '').trim());

        let parsedVariables = {};
        if (variablesText) {
            try {
                parsedVariables = JSON.parse(variablesText);
            } catch (e) {
                throw new Error(
                    translate('runner.error_invalid_graphql_variables', 'Invalid GraphQL Variables JSON: {{message}}', { message: e.message }),
                    { cause: e }
                );
            }
        }

        const body = { query, variables: parsedVariables };
        if (graphqlData.operationName) {
            body.operationName = graphqlData.operationName;
        }
        return body;
    }

    /**
     * @param {string} collectionId
     * @param {Object|null} runContext
     * @returns {Promise<string|null>}
     */
    async _mockBaseUrlFor(collectionId, runContext) {
        if (runContext?.mockBaseUrls.has(collectionId)) {
            return runContext.mockBaseUrls.get(collectionId);
        }
        let mockBaseUrl = null;
        try {
            const { shouldUseMock, mockBaseUrl: base } = await this.mockServerService.shouldUseMockServer(collectionId);
            mockBaseUrl = shouldUseMock && base ? base : null;
        } catch (e) {
            void e;
        }
        runContext?.mockBaseUrls.set(collectionId, mockBaseUrl);
        return mockBaseUrl;
    }

    /**
     * @param {Object} requestConfig
     * @param {Object|null} runContext
     * @returns {Promise<void>}
     */
    async _attachClientCert(requestConfig, runContext) {
        try {
            if (!runContext?.certificatesLoaded) {
                await this.certificateService.getItems();
            }
            requestConfig.clientCert = this.certificateService.getForHost(new URL(requestConfig.url).host) || null;
        } catch (e) {
            void e;
        }
    }

    /**
     * @param {Object} requestConfig
     * @returns {Promise<void>}
     */
    async _attachCookies(requestConfig) {
        if (!app.cookieController) {
            return;
        }
        const cookieHeader = await app.cookieController.getCookieHeader(requestConfig.url);
        if (!cookieHeader) {
            return;
        }
        requestConfig.headers = requestConfig.headers || {};
        if (!requestConfig.headers['Cookie'] && !requestConfig.headers['cookie']) {
            requestConfig.headers['Cookie'] = cookieHeader;
        }
    }

    /**
     * @param {Object} response
     * @param {string} requestUrl
     * @returns {Promise<void>}
     */
    async _storeResponseCookies(response, requestUrl) {
        if (app.cookieController && response.setCookies?.length > 0) {
            await app.cookieController.handleCookiesFromResponse(response.setCookies, requestUrl);
        }
    }

    /**
     * @param {Object} requestConfig
     * @param {Object} response
     * @param {string} collectionId
     * @param {string} endpointId
     * @param {Object} authData
     * @param {Object|null} runContext
     */
    _recordHistory(requestConfig, response, collectionId, endpointId, authData, runContext) {
        if (!app.historyController) {
            return;
        }
        const sensitive = {
            headerNames: Object.keys(authData.headers || {}),
            queryNames: Object.keys(authData.queryParams || {})
        };
        app.historyController
            .addHistoryEntry(requestConfig, response, { collectionId, endpointId }, runContext?.environmentName ?? null, sensitive)
            .catch(() => {});
    }

    /**
     * @param {string} script
     * @param {Object} prepared
     * @param {Object} variables
     * @param {Object} outcome
     * @param {Object} iteration
     * @returns {Promise<Object>}
     */
    async _runPreRequestScript(script, prepared, variables, outcome, iteration) {
        const scriptService = app.scriptController?.service;
        const { requestConfig } = prepared;
        if (!scriptService) {
            return requestConfig;
        }

        const snapshot = {
            url: requestConfig.url,
            queryParams: { ...requestConfig.queryParams },
            pathParams: { ...requestConfig.pathParams }
        };
        const { modifiedRequest, result } = await scriptService.executePreRequestScript(script, requestConfig, {
            environment: variables,
            iteration
        });
        this._collectScriptResult(result, outcome);

        modifiedRequest.url = this.requestBuilder.applyScriptParamMutations({
            requestConfig: modifiedRequest,
            snapshot,
            rawUrl: prepared.rawUrl,
            variables,
            processor: this.variableProcessor,
            mockRewrite: prepared.mockRewrite
        });
        const authStripped = this.requestBuilder.stripCrossOriginAuth({
            requestConfig: modifiedRequest,
            originalUrl: snapshot.url,
            authData: prepared.authData
        });
        if (authStripped) {
            outcome.logs.push({
                level: 'warn',
                message: translate(
                    'runner.auth_stripped',
                    'Authentication was not sent: the pre-request script changed the request host.'
                ),
                timestamp: Date.now()
            });
        }
        return modifiedRequest;
    }

    /**
     * @param {string} script
     * @param {Object} requestConfig
     * @param {Object} response
     * @param {Object} variables
     * @param {Object} outcome
     * @param {Object} iteration
     * @returns {Promise<void>}
     */
    async _runTestScript(script, requestConfig, response, variables, outcome, iteration) {
        const scriptService = app.scriptController?.service;
        if (!scriptService) {
            return;
        }
        const result = await scriptService.executeTestScript(
            script,
            requestConfig,
            { ...response, cookies: extractCookies(response.headers) },
            { environment: variables, iteration }
        );
        this._collectScriptResult(result, outcome);
    }

    /**
     * @param {Object} result
     * @param {Object} outcome
     */
    _collectScriptResult(result, outcome) {
        outcome.logs.push(...(result?.logs || []));
        outcome.testResults.push(...(result?.testResults || []));
        outcome.errors.push(...(result?.errors || []));
        Object.assign(outcome.variablesSet, result?.modifiedEnvironment || {});
    }

    /**
     * @param {number} ms
     * @returns {Promise<void>}
     */
    _delay(ms) {
        return new Promise(resolve => {
            let timer = null;
            const wake = () => {
                clearTimeout(timer);
                this._stopWaiters.delete(wake);
                resolve();
            };
            timer = setTimeout(wake, ms);
            this._stopWaiters.add(wake);
        });
    }

    /** @param {Function} listener */
    addListener(listener) {
        this._events.add(listener);
    }

    /** @param {Function} listener */
    removeListener(listener) {
        this._events.remove(listener);
    }

    /**
     * @param {string} event
     * @param {*} data
     */
    _notifyListeners(event, data) {
        this._events.emit(event, data);
    }
}

export const MAX_ITERATIONS = 1000;

/**
 * @param {*} value
 * @returns {number}
 */
function clampIterations(value) {
    const count = parseInt(value, 10);
    return Number.isFinite(count) ? Math.min(MAX_ITERATIONS, Math.max(1, count)) : 1;
}

/**
 * @param {Object<string, string>} row
 * @returns {string}
 */
function describeDataRow(row) {
    const [first] = Object.entries(row);
    return first ? `${first[0]}=${first[1]}` : '';
}

/**
 * @param {Object} base
 * @param {Object} changes
 * @returns {Object}
 */
function mergeVariables(base, changes) {
    const merged = { ...base };
    for (const [key, value] of Object.entries(changes || {})) {
        if (value === null || value === undefined) {
            delete merged[key];
        } else {
            merged[key] = value;
        }
    }
    return merged;
}

/**
 * @param {Object} authConfig
 * @param {Object} variables
 * @returns {Object}
 */
function withBearerFallback(authConfig, variables) {
    if (authConfig?.type !== 'bearer' || authConfig.config?.token || !variables.bearerToken) {
        return authConfig;
    }
    return { ...authConfig, config: { ...authConfig.config, token: '{{bearerToken}}' } };
}
