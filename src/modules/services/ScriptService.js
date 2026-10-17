/**
 * @fileoverview Service for script business logic
 * @module services/ScriptService
 */


import { createExecutionScope, applyVariableChanges } from './ScriptExecutionScope.js';

/** @type {ReadonlyArray<string>} */
export const SCRIPT_MUTABLE_REQUEST_FIELDS = Object.freeze([
    'url',
    'method',
    'headers',
    'body',
    'queryParams',
    'pathParams'
]);

export class ScriptService {
    /**
     * @param {Object} scriptRepository
     * @param {Object} environmentService
     * @param {Object} _statusDisplay
     * @param {Object|null} [variableRepository]
     * @param {{backendAPI?: Object|null, cookieController?: Object|null, getSettings?: (function(): (Object|null))|null}} [deps]
     */
    constructor(scriptRepository, environmentService, _statusDisplay, variableRepository = null, { backendAPI = null, cookieController = null, getSettings = null } = {}) {
        this.repository = scriptRepository;
        this.environmentService = environmentService;
        this.variableRepository = variableRepository;
        this.backendAPI = backendAPI;
        this.cookieController = cookieController;
        this.getSettings = getSettings;
    }

    /**
     * @param {string|undefined} collectionId
     * @returns {Promise<Object>}
     */
    async _readCollectionVariables(collectionId) {
        if (!collectionId || !this.variableRepository) {
            return {};
        }
        try {
            const values = await this.variableRepository.getVariablesForCollection(collectionId);
            const normalized = {};
            for (const [key, value] of Object.entries(values || {})) {
                normalized[key] = value === null || value === undefined ? '' : String(value);
            }
            return normalized;
        } catch {
            return {};
        }
    }

    /**
     * @param {string|undefined} collectionId
     * @param {Object|undefined} changes
     * @returns {Promise<void>}
     */
    async _applyCollectionVariableChanges(collectionId, changes) {
        if (!collectionId || !this.variableRepository || !changes || Object.keys(changes).length === 0) {
            return;
        }
        await this.variableRepository.applyVariableChanges(collectionId, changes);
    }

    /**
     * @param {string} collectionId
     * @param {string} endpointId
     * @returns {Promise<Object>}
     */
    async getScripts(collectionId, endpointId) {
        try {
            return await this.repository.getScripts(collectionId, endpointId);
        } catch (error) {
            return {
                preRequestScript: '',
                testScript: ''
            };
        }
    }

    /**
     * @param {string} collectionId
     * @param {string} endpointId
     * @param {Object} scripts
     * @returns {Promise<void>}
     */
    async saveScripts(collectionId, endpointId, scripts) {
        try {
            await this.repository.saveScripts(collectionId, endpointId, scripts);
        } catch (error) {
            throw new Error(`Failed to save scripts: ${error.message}`, { cause: error });
        }
    }

    /**
     * Pin and hydrate the environment once for this send or runner execution.
     * @param {Object} [options]
     * @returns {Promise<Object>}
     */
    async createExecutionScope(options = {}) {
        const active = await this.environmentService.getActiveEnvironment?.();
        const environment = active?.id && this.environmentService.getVariablesForEnvironment
            ? await this.environmentService.getVariablesForEnvironment(active.id)
            : await this.environmentService.getActiveEnvironmentVariables();
        return createExecutionScope({ ...options, environment, environmentId: active?.id || null });
    }

    async loadCollectionScope(scope, collectionId) {
        if (!scope.collections.has(collectionId)) { scope.collections.set(collectionId, await this._readCollectionVariables(collectionId)); }
        return scope.collections.get(collectionId);
    }

    async _scriptPayload(script, requestConfig, { environment, iteration, collectionId, scope, requestId }, extra = {}) {
        const environmentVariables = scope?.environment ?? environment ?? await this.environmentService.getActiveEnvironmentVariables();

        let collectionVariables = scope?.collections.get(collectionId);
        if (!collectionVariables) {
            collectionVariables = await this._readCollectionVariables(collectionId);
            scope?.collections.set(collectionId, collectionVariables);
        }
        return {
            script,
            request: {
                url: requestConfig.url,
                method: requestConfig.method,
                headers: requestConfig.headers || {},
                body: requestConfig.body,
                queryParams: requestConfig.queryParams || {},
                pathParams: requestConfig.pathParams || {}
            },
            ...extra,
            environment: environmentVariables || {},
            collectionVariables,
            ...(scope ? { localVariables: { ...scope.localVariables }, executionContext: { runner: Boolean(scope.runner), requestId: requestId || null } } : {}),
            cookies: await this._readCookieJar(),
            ...(iteration ? { iteration } : {})
        };
    }

    /**
     * @param {Object} response
     * @returns {Object}
     */
    _scriptResponse(response) {
        return {
            status: response?.status ?? response?.statusCode ?? response?.status_code ?? null,
            statusText: response?.statusText ?? response?.status_text ?? response?.statusMessage ?? '',
            headers: response?.headers || {},
            body: response?.data ?? response?.body ?? null,
            timings: response?.timings || {},
            cookies: response?.cookies || []
        };
    }

    /**
     * @param {Object} result
     * @param {string|undefined} collectionId
     * @returns {Promise<void>}
     */
    async _applyScriptSideEffects(result, collectionId, scope) {
        if (scope?.active === false) { return; }
        if (scope) {
            if (Object.keys(result.modifiedLocalVariables || {}).length || result.removedLocalVariables?.length ||
                Object.keys(result.modifiedEnvironment || {}).length || Object.keys(result.modifiedCollectionVariables || {}).length) {
                scope.revision = (scope.revision || 0) + 1;
            }
            scope.localVariables = applyVariableChanges(scope.localVariables, result.modifiedLocalVariables, result.removedLocalVariables || []);
            scope.environment = applyVariableChanges(scope.environment, result.modifiedEnvironment);
            if (collectionId) {
                scope.collections.set(collectionId, applyVariableChanges(scope.collections.get(collectionId), result.modifiedCollectionVariables));
            }
        }
        if (result.modifiedEnvironment && Object.keys(result.modifiedEnvironment).length > 0) {
            if (scope) {
                if (scope.environmentId) { await this.environmentService.applyVariableChanges(scope.environmentId, result.modifiedEnvironment); }
            } else { await this._applyEnvironmentChanges(result.modifiedEnvironment); }
        }
        if (scope?.active === false) { return; }
        await this._applyCollectionVariableChanges(collectionId, result.modifiedCollectionVariables);
        if (scope?.active === false) { return; }
        await this._applyCookieChanges(result.cookieChanges);
    }

    /**
     * @param {Error} error
     * @returns {{success: boolean, logs: Array, errors: string[], testResults: Array}}
     */
    _scriptFailure(error) {
        return {
            success: false,
            logs: [],
            errors: [error.message],
            testResults: []
        };
    }

    /**
     * @param {string} script
     * @param {Object} requestConfig
     * @param {Object} [options]
     * @param {Object} [options.environment]
     * @param {Object} [options.iteration]
     * @param {string} [options.collectionId]
     * @returns {Promise<Object>}
     */
    async executePreRequestScript(script, requestConfig, options = {}) {
        if (!script || script.trim() === '') {
            return {
                modifiedRequest: requestConfig,
                result: { success: true, logs: [], errors: [], testResults: [] }
            };
        }

        try {
            const scriptData = await this._scriptPayload(script, requestConfig, options);
            if (options.scope?.active === false) { return { modifiedRequest: requestConfig, result: this._scriptFailure(new Error('Execution cancelled')) }; }
            const result = await this.backendAPI.scripts.executePreRequest(scriptData);
            await this._applyScriptSideEffects(result, options.collectionId, options.scope);

            return {
                modifiedRequest: this._mergeModifiedRequest(requestConfig, result.modifiedRequest),
                result
            };
        } catch (error) {
            return {
                modifiedRequest: requestConfig,
                result: this._scriptFailure(error)
            };
        }
    }

    /**
     * @param {string} script
     * @param {Object} requestConfig
     * @param {Object} response
     * @param {Object} [options]
     * @param {Object} [options.environment]
     * @param {Object} [options.iteration]
     * @param {string} [options.collectionId]
     * @returns {Promise<Object>}
     */
    async executeTestScript(script, requestConfig, response, options = {}) {
        if (!script || script.trim() === '') {
            return {
                success: true,
                logs: [],
                errors: [],
                testResults: []
            };
        }

        try {
            const scriptData = await this._scriptPayload(script, requestConfig, options, {
                response: this._scriptResponse(response)
            });
            if (options.scope?.active === false) { return this._scriptFailure(new Error('Execution cancelled')); }
            const result = await this.backendAPI.scripts.executeTest(scriptData);
            await this._applyScriptSideEffects(result, options.collectionId, options.scope);

            return result;
        } catch (error) {
            return this._scriptFailure(error);
        }
    }

    /**
     * @param {Object} requestConfig
     * @param {Object|undefined} modifiedRequest
     * @returns {Object}
     */
    _mergeModifiedRequest(requestConfig, modifiedRequest) {
        if (!modifiedRequest || typeof modifiedRequest !== 'object' || Array.isArray(modifiedRequest)) {
            return requestConfig;
        }
        const merged = { ...requestConfig };
        for (const field of SCRIPT_MUTABLE_REQUEST_FIELDS) {
            if (Object.prototype.hasOwnProperty.call(modifiedRequest, field)) {
                merged[field] = modifiedRequest[field];
            }
        }
        return merged;
    }

    /** @returns {Promise<Object|null>} */
    async _cookieController() {
        const controller = this.cookieController;
        if (!controller) {
            return null;
        }
        try {
            const settings = this.getSettings?.() ?? await this.backendAPI.settings.get();
            if (settings?.cookieJarEnabled === false) {
                return null;
            }
        } catch {
            return null;
        }
        return controller;
    }

    /** @returns {Promise<Array<Object>>} */
    async _readCookieJar() {
        try {
            const controller = await this._cookieController();
            if (!controller) {
                return [];
            }
            return await controller.getCookiesForScripts();
        } catch {
            return [];
        }
    }

    /**
     * @param {Array<Object>|undefined} changes
     * @returns {Promise<void>}
     */
    async _applyCookieChanges(changes) {
        if (!Array.isArray(changes) || changes.length === 0) {
            return;
        }
        try {
            const controller = await this._cookieController();
            if (!controller) {
                return;
            }
            await controller.applyScriptCookieChanges(changes);
        } catch {
        }
    }

    /**
     * @param {Object} changes
     * @returns {Promise<void>}
     */
    async _applyEnvironmentChanges(changes) {
        try {
            const activeEnv = await this.environmentService.getActiveEnvironment();
            if (!activeEnv) {
                return;
            }

            await this.environmentService.applyVariableChanges(activeEnv.id, changes);
        } catch {
        }
    }
}
