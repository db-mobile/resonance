/**
 * @fileoverview Service for script business logic
 * @module services/ScriptService
 */

import { app } from '../appContext.js';

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
     * @param {Object} statusDisplay
     * @param {Object|null} [variableRepository]
     */
    constructor(scriptRepository, environmentService, statusDisplay, variableRepository = null) {
        this.repository = scriptRepository;
        this.environmentService = environmentService;
        this.statusDisplay = statusDisplay;
        this.variableRepository = variableRepository;
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
     * @param {string} script
     * @param {Object} requestConfig
     * @param {Object} options
     * @param {Object} [options.environment]
     * @param {Object} [options.iteration]
     * @param {string} [options.collectionId]
     * @param {Object} [extra]
     * @returns {Promise<Object>}
     */
    async _scriptPayload(script, requestConfig, { environment, iteration, collectionId }, extra = {}) {
        const environmentVariables = environment ?? await this.environmentService.getActiveEnvironmentVariables();

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
            collectionVariables: await this._readCollectionVariables(collectionId),
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
    async _applyScriptSideEffects(result, collectionId) {
        if (result.modifiedEnvironment && Object.keys(result.modifiedEnvironment).length > 0) {
            await this._applyEnvironmentChanges(result.modifiedEnvironment);
        }
        await this._applyCollectionVariableChanges(collectionId, result.modifiedCollectionVariables);
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
            const result = await window.backendAPI.scripts.executePreRequest(scriptData);
            await this._applyScriptSideEffects(result, options.collectionId);

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
            const result = await window.backendAPI.scripts.executeTest(scriptData);
            await this._applyScriptSideEffects(result, options.collectionId);

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
        const controller = app.cookieController;
        if (!controller) {
            return null;
        }
        try {
            const settings = app.getApiHandlerSettingsCache?.() ?? await window.backendAPI.settings.get();
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
