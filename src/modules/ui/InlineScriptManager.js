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
        this._scheduleSave = debounce(() => this.saveScripts(), 1000);
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
        this._scheduleSave();
    }

    async flushPendingSave() {
        await this._scheduleSave.flush();
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
