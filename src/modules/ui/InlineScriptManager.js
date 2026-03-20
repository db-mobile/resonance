/**
 * @fileoverview Manages inline script editing in the Scripts tab
 * @module ui/InlineScriptManager
 */

import { ScriptEditor } from '../scriptEditor.bundle.js';

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
        this.saveTimeout = null;
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
            this.preRequestEditor = new ScriptEditor(this.preRequestContainer);
            this.preRequestEditor.onChange(() => {
                this.scheduleAutoSave();
            });
        }

        if (this.testScriptContainer && !this.testScriptEditor) {
            this.testScriptEditor = new ScriptEditor(this.testScriptContainer);
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
        this.currentCollectionId = collectionId;
        this.currentEndpointId = endpointId;

        try {
            const scripts = await window.backendAPI.scripts.get(collectionId, endpointId);

            if (this.preRequestEditor) {
                this.preRequestEditor.setContent(scripts.preRequestScript || '');
            }

            if (this.testScriptEditor) {
                this.testScriptEditor.setContent(scripts.testScript || '');
            }
        } catch (error) {
            void error;
        }
    }

    /**
     * Clear script editors
     */
    clear() {
        this.currentCollectionId = null;
        this.currentEndpointId = null;

        if (this.preRequestEditor) {
            this.preRequestEditor.clear();
        }

        if (this.testScriptEditor) {
            this.testScriptEditor.clear();
        }
    }

    /**
     * Schedule auto-save with debouncing
     * @private
     */
    scheduleAutoSave() {
        if (this.saveTimeout) {
            clearTimeout(this.saveTimeout);
        }

        this.saveTimeout = setTimeout(() => {
            this.saveScripts();
        }, 1000); // Save after 1 second of no typing
    }

    async flushPendingSave() {
        if (this.saveTimeout) {
            clearTimeout(this.saveTimeout);
            this.saveTimeout = null;
            await this.saveScripts();
        }
    }

    /**
     * Save current scripts
     * @async
     * @private
     */
    async saveScripts() {
        if (!this.currentCollectionId || !this.currentEndpointId) {
            return;
        }

        const scripts = {
            preRequestScript: this.preRequestEditor?.getContent() || '',
            testScript: this.testScriptEditor?.getContent() || ''
        };

        try {
            await window.backendAPI.scripts.save(
                this.currentCollectionId,
                this.currentEndpointId,
                scripts
            );
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
