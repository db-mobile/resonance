/**
 * @fileoverview Manages inline script editing in the Scripts tab
 * @module ui/InlineScriptManager
 */

import { createLazyEditorProxy } from '../editorLoader.js';
import { debounce } from '../utils/debounce.js';

export class InlineScriptManager {
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
     * @param {string} collectionId
     * @param {string} endpointId
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

    scheduleAutoSave() {
        if (this.currentCollectionId && this.currentEndpointId) {
            this._scheduleSave(this.currentCollectionId, this.currentEndpointId);
        }
    }

    /** @returns {Promise<void>} */
    async flushPendingSave() {
        await this._scheduleSave.flush();
        await this._inFlightSave;
    }

    async saveScripts() {
        await this._saveScriptsFor(this.currentCollectionId, this.currentEndpointId);
    }

    /**
     * @param {string} collectionId
     * @param {string} endpointId
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

    /** @returns {Object} */
    getCurrentScripts() {
        return {
            preRequestScript: this.preRequestEditor?.getContent() || '',
            testScript: this.testScriptEditor?.getContent() || ''
        };
    }
}
