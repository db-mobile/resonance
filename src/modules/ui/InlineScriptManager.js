/**
 * @fileoverview Manages inline script editing in the Scripts tab
 * @module ui/InlineScriptManager
 */

import { createLazyEditorProxy } from '../editorLoader.js';
import { debounce } from '../utils/debounce.js';

/**
 * Manages inline script editing with auto-save functionality
 *
 * @class
 * @classdesc Handles loading, saving, and managing scripts in the Scripts tab using CodeMirror
 */
export class InlineScriptManager {
    /**
     * Creates an InlineScriptManager instance
     */
    constructor() {
        this.preRequestContainer = document.getElementById('pre-request-script-container');
        this.testScriptContainer = document.getElementById('test-script-container');
        this.preRequestEditor = null;
        this.testScriptEditor = null;
        this.currentCollectionId = null;
        this.currentEndpointId = null;
        this._inFlightSave = null;
        this._scheduleSave = debounce((collectionId, endpointId) => {
            this._inFlightSave = this._saveScriptsFor(collectionId, endpointId).finally(() => {
                this._inFlightSave = null;
            });
            return this._inFlightSave;
        }, 1000);
        this.initialized = false;
    }

    /**
     * Initialize CodeMirror editors and event listeners for auto-save
     */
    initialize() {
        if (this.initialized) {
            return;
        }

        if (this.preRequestContainer && !this.preRequestEditor) {
            this.preRequestEditor = createLazyEditorProxy('script', this.preRequestContainer);
            this.preRequestEditor.onChange(() => {
                this.scheduleAutoSave();
            });
        }

        if (this.testScriptContainer && !this.testScriptEditor) {
            this.testScriptEditor = createLazyEditorProxy('script', this.testScriptContainer);
            this.testScriptEditor.onChange(() => {
                this.scheduleAutoSave();
            });
        }

        this.initialized = true;
    }

    /**
     * Load scripts for a specific endpoint
     * @param {string} collectionId - Collection ID
     * @param {string} endpointId - Endpoint ID
     * @async
     */
    async loadScripts(collectionId, endpointId) {
        await this.flushPendingSave();

        this.currentCollectionId = collectionId;
        this.currentEndpointId = endpointId;

        try {
            const scripts = await window.backendAPI.scripts.get(collectionId, endpointId);

            if (this.preRequestEditor) {
                this.preRequestEditor.setContent(scripts.preRequestScript || '', { emitChange: false });
            }

            if (this.testScriptEditor) {
                this.testScriptEditor.setContent(scripts.testScript || '', { emitChange: false });
            }
        } catch (error) {
            void error;
        }
    }

    /**
     * Clear script editors
     */
    async clear() {
        await this.flushPendingSave();

        this.currentCollectionId = null;
        this.currentEndpointId = null;

        if (this.preRequestEditor) {
            this.preRequestEditor.clear({ emitChange: false });
        }

        if (this.testScriptEditor) {
            this.testScriptEditor.clear({ emitChange: false });
        }
    }

    /**
     * Schedule auto-save with debouncing
     * @private
     */
    scheduleAutoSave() {
        if (this.currentCollectionId && this.currentEndpointId) {
            this._scheduleSave(this.currentCollectionId, this.currentEndpointId);
        }
    }

    /**
     * Flushes a pending debounced script save and waits for it to settle.
     * @returns {Promise<void>} Resolves once no script save is pending or in flight
     */
    async flushPendingSave() {
        await this._scheduleSave.flush();
        await this._inFlightSave;
    }

    /**
     * Save current scripts
     * @async
     */
    async saveScripts() {
        await this._saveScriptsFor(this.currentCollectionId, this.currentEndpointId);
    }

    /**
     * Saves the editors' scripts for the given endpoint.
     * @private
     * @param {string} collectionId - Collection ID captured when the save was scheduled
     * @param {string} endpointId - Endpoint ID captured when the save was scheduled
     * @returns {Promise<void>}
     */
    async _saveScriptsFor(collectionId, endpointId) {
        if (!collectionId || !endpointId) {
            return;
        }

        const scripts = {
            preRequestScript: this.preRequestEditor?.getContent() || '',
            testScript: this.testScriptEditor?.getContent() || ''
        };

        try {
            await window.backendAPI.scripts.save(collectionId, endpointId, scripts);
        } catch (error) {
            void error;
        }
    }

    /**
     * Get current script values
     * @returns {Object} Current scripts
     */
    getCurrentScripts() {
        return {
            preRequestScript: this.preRequestEditor?.getContent() || '',
            testScript: this.testScriptEditor?.getContent() || ''
        };
    }
}
