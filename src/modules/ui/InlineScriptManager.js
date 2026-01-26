/**
 * @fileoverview Manages inline script editing in the Scripts tab
 * @module ui/InlineScriptManager
 */

/**
 * Manages inline script editing with auto-save functionality
 *
 * @class
 * @classdesc Handles loading, saving, and managing scripts in the Scripts tab
 */
export class InlineScriptManager {
    /**
     * Creates an InlineScriptManager instance
     */
    constructor() {
        this.preRequestTextarea = document.getElementById('pre-request-script');
        this.testScriptTextarea = document.getElementById('test-script');
        this.currentCollectionId = null;
        this.currentEndpointId = null;
        this.saveTimeout = null;
        this.initialized = false;
    }

    /**
     * Initialize event listeners for auto-save
     */
    initialize() {
        if (this.initialized) {
            return;
        }

        if (this.preRequestTextarea) {
            this.preRequestTextarea.addEventListener('input', () => {
                this.scheduleAutoSave();
            });
        }

        if (this.testScriptTextarea) {
            this.testScriptTextarea.addEventListener('input', () => {
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

            if (this.preRequestTextarea) {
                this.preRequestTextarea.value = scripts.preRequestScript || '';
            }

            if (this.testScriptTextarea) {
                this.testScriptTextarea.value = scripts.testScript || '';
            }
        } catch (error) {
            void error;
        }
    }

    /**
     * Clear script textareas
     */
    clear() {
        this.currentCollectionId = null;
        this.currentEndpointId = null;

        if (this.preRequestTextarea) {
            this.preRequestTextarea.value = '';
        }

        if (this.testScriptTextarea) {
            this.testScriptTextarea.value = '';
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
            preRequestScript: this.preRequestTextarea?.value || '',
            testScript: this.testScriptTextarea?.value || ''
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
            preRequestScript: this.preRequestTextarea?.value || '',
            testScript: this.testScriptTextarea?.value || ''
        };
    }
}
