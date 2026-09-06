/**
 * @fileoverview Controller for coordinating script operations
 * @module controllers/ScriptController
 */

import { toast } from '../ui/Toast.js';

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

    /** @returns {Promise<void>} */
    async clearScripts() {
        await this.scriptManager.clear();
    }

    /**
     * @param {string} collectionId
     * @param {string} endpointId
     * @param {Object} requestConfig
     * @returns {Promise<Object>}
     */
    async executePreRequest(collectionId, endpointId, requestConfig) {
        try {
            if (this.scriptManager?.flushPendingSave) {
                await this.scriptManager.flushPendingSave();
            }

            let scripts;
            if (
                this.scriptManager?.currentCollectionId === collectionId &&
                this.scriptManager?.currentEndpointId === endpointId &&
                this.scriptManager?.getCurrentScripts
            ) {
                scripts = this.scriptManager.getCurrentScripts();
            } else {
                scripts = await this.service.getScripts(collectionId, endpointId);
            }

            if (!scripts.preRequestScript || scripts.preRequestScript.trim() === '') {
                return requestConfig;
            }

            const { modifiedRequest, result } = await this.service.executePreRequestScript(
                scripts.preRequestScript,
                requestConfig
            );

            if (result.logs.length > 0 || result.errors.length > 0) {
                this.consolePanel.show(result.logs, result.errors);
            }

            if (!result.success) {
                this._showScriptError('Pre-request script error', result.errors);
            }

            return modifiedRequest;

        } catch (error) {
            this._showError('Pre-request script error', error.message);
            return requestConfig;
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
            if (this.scriptManager?.flushPendingSave) {
                await this.scriptManager.flushPendingSave();
            }

            let scripts;
            if (
                this.scriptManager?.currentCollectionId === collectionId &&
                this.scriptManager?.currentEndpointId === endpointId &&
                this.scriptManager?.getCurrentScripts
            ) {
                scripts = this.scriptManager.getCurrentScripts();
            } else {
                scripts = await this.service.getScripts(collectionId, endpointId);
            }

            if (!scripts.testScript || scripts.testScript.trim() === '') {
                return null;
            }

            const result = await this.service.executeTestScript(
                scripts.testScript,
                requestConfig,
                response
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
     * @param {Array<string>|string} errors
     */
    _showScriptError(title, errors) {
        const errorMessage = Array.isArray(errors) ? errors.join('\n') : errors;
        toast.error(`${title}: ${errorMessage}`);
    }

    /**
     * @param {string} title
     * @param {string} message
     */
    _showError(title, message) {
        toast.error(`${title}: ${message}`);
    }
}
