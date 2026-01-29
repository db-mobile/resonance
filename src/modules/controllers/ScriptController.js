/**
 * @fileoverview Controller for coordinating script operations
 * @module controllers/ScriptController
 */

/**
 * Controller for managing script editing and execution
 * Coordinates between UI, service layer, and script console
 *
 * @class
 * @classdesc Handles inline script editing, execution, and result display
 */
export class ScriptController {
    /**
     * Creates a ScriptController instance
     * @param {Object} scriptService - ScriptService instance
     * @param {Object} inlineScriptManager - InlineScriptManager instance
     * @param {Object} scriptConsolePanel - ScriptConsolePanel instance
     */
    constructor(scriptService, inlineScriptManager, scriptConsolePanel) {
        this.service = scriptService;
        this.scriptManager = inlineScriptManager;
        this.consolePanel = scriptConsolePanel;
    }

    /**
     * Load scripts for an endpoint
     * @param {string} collectionId - Collection ID
     * @param {string} endpointId - Endpoint ID
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
     * Clear scripts when no endpoint is selected
     */
    clearScripts() {
        this.scriptManager.clear();
    }

    /**
     * Execute pre-request script for an endpoint
     * @param {string} collectionId - Collection ID
     * @param {string} endpointId - Endpoint ID
     * @param {Object} requestConfig - Request configuration
     * @returns {Promise<Object>} Modified request config
     */
    async executePreRequest(collectionId, endpointId, requestConfig) {
        try {
            // Flush pending debounce-save so latest edits are available
            if (this.scriptManager?.flushPendingSave) {
                await this.scriptManager.flushPendingSave();
            }

            // Prefer current editor scripts if they belong to this endpoint; otherwise fall back to persisted scripts
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

            // Execute script
            const { modifiedRequest, result } = await this.service.executePreRequestScript(
                scripts.preRequestScript,
                requestConfig
            );

            // Show console output if any
            if (result.logs.length > 0 || result.errors.length > 0) {
                this.consolePanel.show(result.logs, result.errors);
            }

            // Show error if script failed
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
     * Execute test script for an endpoint
     * @param {string} collectionId - Collection ID
     * @param {string} endpointId - Endpoint ID
     * @param {Object} requestConfig - Request configuration
     * @param {Object} response - Response data
     * @returns {Promise<Object>} Test result
     */
    async executeTest(collectionId, endpointId, requestConfig, response) {
        try {
            // Flush pending debounce-save so latest edits are available
            if (this.scriptManager?.flushPendingSave) {
                await this.scriptManager.flushPendingSave();
            }

            // Prefer current editor scripts if they belong to this endpoint; otherwise fall back to persisted scripts
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

            // Execute script
            const result = await this.service.executeTestScript(
                scripts.testScript,
                requestConfig,
                response
            );

            // Show test results and console output
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
     * Show script error to user
     * @private
     * @param {string} title - Error title
     * @param {Array<string>|string} errors - Error messages
     */
    _showScriptError(title, errors) {
        const errorMessage = Array.isArray(errors) ? errors.join('\n') : errors;

        // Could show in status bar or toast notification
        // For now, just log to console
        console.error(title, errorMessage);
    }

    /**
     * Show generic error to user
     * @private
     * @param {string} title - Error title
     * @param {string} message - Error message
     */
    _showError(title, message) {

        // Could show in status bar or toast notification
        // For now, just log to console
        console.error(title, message);
    }
}
