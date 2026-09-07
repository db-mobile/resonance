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
     */
    constructor(scriptRepository, environmentService, statusDisplay) {
        this.repository = scriptRepository;
        this.environmentService = environmentService;
        this.statusDisplay = statusDisplay;
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
     * @returns {Promise<Object>}
     */
    async executePreRequestScript(script, requestConfig) {
        if (!script || script.trim() === '') {
            return {
                modifiedRequest: requestConfig,
                result: { success: true, logs: [], errors: [], testResults: [] }
            };
        }

        try {
            const environmentVariables = await this.environmentService.getActiveEnvironmentVariables();

            const scriptData = {
                script,
                request: {
                    url: requestConfig.url,
                    method: requestConfig.method,
                    headers: requestConfig.headers || {},
                    body: requestConfig.body,
                    queryParams: requestConfig.queryParams || {},
                    pathParams: requestConfig.pathParams || {}
                },
                environment: environmentVariables || {},
                cookies: await this._readCookieJar()
            };

            const result = await window.backendAPI.scripts.executePreRequest(scriptData);

            if (result.modifiedEnvironment && Object.keys(result.modifiedEnvironment).length > 0) {
                await this._applyEnvironmentChanges(result.modifiedEnvironment);
            }
            await this._applyCookieChanges(result.cookieChanges);

            return {
                modifiedRequest: this._mergeModifiedRequest(requestConfig, result.modifiedRequest),
                result
            };

        } catch (error) {
            return {
                modifiedRequest: requestConfig,
                result: {
                    success: false,
                    logs: [],
                    errors: [error.message],
                    testResults: []
                }
            };
        }
    }

    /**
     * @param {string} script
     * @param {Object} requestConfig
     * @param {Object} response
     * @returns {Promise<Object>}
     */
    async executeTestScript(script, requestConfig, response) {
        if (!script || script.trim() === '') {
            return {
                success: true,
                logs: [],
                errors: [],
                testResults: []
            };
        }

        try {
            const environmentVariables = await this.environmentService.getActiveEnvironmentVariables();

            const status = response?.status ?? response?.statusCode ?? response?.status_code ?? null;
            const statusText = response?.statusText ?? response?.status_text ?? response?.statusMessage ?? '';
            const headers = response?.headers || {};
            const body = response?.data ?? response?.body ?? null;
            const timings = response?.timings || {};
            const cookies = response?.cookies || [];

            const scriptData = {
                script,
                request: {
                    url: requestConfig.url,
                    method: requestConfig.method,
                    headers: requestConfig.headers || {},
                    body: requestConfig.body,
                    queryParams: requestConfig.queryParams || {},
                    pathParams: requestConfig.pathParams || {}
                },
                response: {
                    status,
                    statusText,
                    headers,
                    body,
                    timings,
                    cookies
                },
                environment: environmentVariables || {},
                cookies: await this._readCookieJar()
            };

            const result = await window.backendAPI.scripts.executeTest(scriptData);

            if (result.modifiedEnvironment && Object.keys(result.modifiedEnvironment).length > 0) {
                await this._applyEnvironmentChanges(result.modifiedEnvironment);
            }
            await this._applyCookieChanges(result.cookieChanges);

            return result;

        } catch (error) {
            return {
                success: false,
                logs: [],
                errors: [error.message],
                testResults: []
            };
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
        } catch (_e) {
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
        } catch (_e) {
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
        } catch (_e) {
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

            const secretKeys = Array.isArray(activeEnv.secretKeys) ? activeEnv.secretKeys : [];

            for (const [key, value] of Object.entries(changes)) {
                if (value === null) {
                    await this.environmentService.deleteVariable(activeEnv.id, key);
                } else {
                    await this.environmentService.setVariable(
                        activeEnv.id,
                        key,
                        value,
                        secretKeys.includes(key)
                    );
                }
            }

        } catch (error) {
        }
    }

    /**
     * @param {string} script
     * @returns {Object}
     */
    validateScript(script) {
        if (!script || script.trim() === '') {
            return { valid: true, error: null };
        }

        try {
            new Function(script);
            return { valid: true, error: null };
        } catch (error) {
            return { valid: false, error: error.message };
        }
    }
}
