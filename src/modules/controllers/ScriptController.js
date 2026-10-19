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
     * @param {string} title
     * @param {string} message
     */
    _showError(title, message) {
        toast.error(`${title}: ${message}`);
    }
}
