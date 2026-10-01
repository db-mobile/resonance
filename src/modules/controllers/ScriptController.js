/**
 * @fileoverview Controller for coordinating script operations
 * @module controllers/ScriptController
 */

import { toast } from '../ui/Toast.js';

/** @type {string} */
const PRE_REQUEST_SCRIPT_ERROR = 'PreRequestScriptError';

/**
 * @param {Array<string>} errors
 * @returns {Error}
 */
function preRequestScriptError(errors) {
    const error = new Error((errors || []).filter(Boolean).join('\n') || 'the script failed');
    error.name = PRE_REQUEST_SCRIPT_ERROR;
    return error;
}

export class ScriptController {
    /**
     * @param {Object} scriptService
     * @param {Object} inlineScriptManager
     * @param {Object} scriptConsolePanel
     */
    constructor(scriptService, inlineScriptManager, scriptConsolePanel) {
        this.service = scriptService;
        this.scriptManager = inlineScriptManager;
        this.consolePanel = scriptConsolePanel;
    }

    /**
     * @param {string} collectionId
     * @param {string} endpointId
     * @returns {Promise<void>}
     */
    async loadScriptsForEndpoint(collectionId, endpointId) {
        try {
            await this.scriptManager.loadScripts(collectionId, endpointId);
        } catch (error) {
            this._showError('Failed to load scripts', error.message);
        }
    }

    /**
     * @param {string} collectionId
     * @param {string} endpointId
     * @returns {boolean}
     */
    isShowingScriptsFor(collectionId, endpointId) {
        return this.scriptManager?.currentCollectionId === collectionId &&
            this.scriptManager?.currentEndpointId === endpointId;
    }

    /** @returns {Promise<void>} */
    async clearScripts() {
        await this.scriptManager.clear();
    }

    /**
     * @param {string} collectionId
     * @param {string} endpointId
     * @returns {Promise<{preRequestScript: string, testScript: string}>}
     */
    async getScriptsForEndpoint(collectionId, endpointId) {
        if (this.scriptManager?.flushPendingSave) {
            await this.scriptManager.flushPendingSave();
        }

        if (this.isShowingScriptsFor(collectionId, endpointId) && this.scriptManager?.getCurrentScripts) {
            return this.scriptManager.getCurrentScripts();
        }
        return this.service.getScripts(collectionId, endpointId);
    }

    /**
     * @param {string} collectionId
     * @param {string} endpointId
     * @param {Object} requestConfig
     * @returns {Promise<Object>}
     */
    async executePreRequest(collectionId, endpointId, requestConfig) {
        try {
            const scripts = await this.getScriptsForEndpoint(collectionId, endpointId);

            if (!scripts.preRequestScript || scripts.preRequestScript.trim() === '') {
                return requestConfig;
            }

            const { modifiedRequest, result } = await this.service.executePreRequestScript(
                scripts.preRequestScript,
                requestConfig,
                { collectionId }
            );

            if (result.logs.length > 0 || result.errors.length > 0) {
                this.consolePanel.show(result.logs, result.errors);
            }

            if (!result.success) {
                throw preRequestScriptError(result.errors);
            }

            return modifiedRequest;

        } catch (error) {
            if (error.name === PRE_REQUEST_SCRIPT_ERROR) {
                throw error;
            }
            throw preRequestScriptError([error.message]);
        }
    }

    /**
     * @param {string} collectionId
     * @param {string} endpointId
     * @param {Object} requestConfig
     * @param {Object} response
     * @returns {Promise<Object>}
     */
    async executeTest(collectionId, endpointId, requestConfig, response) {
        try {
            const scripts = await this.getScriptsForEndpoint(collectionId, endpointId);

            if (!scripts.testScript || scripts.testScript.trim() === '') {
                return null;
            }

            const result = await this.service.executeTestScript(
                scripts.testScript,
                requestConfig,
                response,
                { collectionId }
            );

            if (this.consolePanel) {
                this.consolePanel.showTestResults(result);
            }

            return result;

        } catch (error) {
            this._showError('Test script error', error.message);
            return null;
        }
    }

    /**
     * @param {string} title
     * @param {string} message
     */
    _showError(title, message) {
        toast.error(`${title}: ${message}`);
    }
}
