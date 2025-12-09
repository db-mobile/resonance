/**
 * @fileoverview Repository for persisting pre-request and test scripts
 * @module storage/ScriptRepository
 */

/**
 * Repository for managing script persistence using electron-store
 * Follows the established {collectionId}_{endpointId} key pattern
 *
 * @class
 * @classdesc Handles CRUD operations for pre-request and test scripts
 */
export class ScriptRepository {
    /**
     * Creates a ScriptRepository instance
     * @param {Object} electronAPI - The Electron API bridge from preload
     */
    constructor(electronAPI) {
        this.electronAPI = electronAPI;
        this.SCRIPTS_KEY = 'persistedScripts';
    }

    /**
     * Get scripts for a specific endpoint
     * @param {string} collectionId - The collection ID
     * @param {string} endpointId - The endpoint ID
     * @returns {Promise<{preRequestScript: string, testScript: string}>} The scripts
     */
    async getScripts(collectionId, endpointId) {
        const scripts = await this._getObjectFromStore(this.SCRIPTS_KEY);
        const key = this._buildKey(collectionId, endpointId);

        return scripts[key] || {
            preRequestScript: '',
            testScript: ''
        };
    }

    /**
     * Save scripts for a specific endpoint
     * @param {string} collectionId - The collection ID
     * @param {string} endpointId - The endpoint ID
     * @param {Object} scriptData - The script data
     * @param {string} scriptData.preRequestScript - Pre-request script code
     * @param {string} scriptData.testScript - Test script code
     * @returns {Promise<void>}
     */
    async saveScripts(collectionId, endpointId, scriptData) {
        const scripts = await this._getObjectFromStore(this.SCRIPTS_KEY);
        const key = this._buildKey(collectionId, endpointId);

        scripts[key] = {
            preRequestScript: scriptData.preRequestScript || '',
            testScript: scriptData.testScript || ''
        };

        await this.electronAPI.store.set(this.SCRIPTS_KEY, scripts);
    }

    /**
     * Delete scripts for a specific endpoint
     * @param {string} collectionId - The collection ID
     * @param {string} endpointId - The endpoint ID
     * @returns {Promise<void>}
     */
    async deleteScripts(collectionId, endpointId) {
        const scripts = await this._getObjectFromStore(this.SCRIPTS_KEY);
        const key = this._buildKey(collectionId, endpointId);

        delete scripts[key];

        await this.electronAPI.store.set(this.SCRIPTS_KEY, scripts);
    }

    /**
     * Get all scripts (for debugging/export purposes)
     * @returns {Promise<Object>} All scripts
     */
    async getAllScripts() {
        return this._getObjectFromStore(this.SCRIPTS_KEY);
    }

    /**
     * Helper to safely get object from store with fallback
     * Handles packaged app environments where store may return undefined
     * @private
     * @param {string} key - The store key
     * @param {Object} defaultValue - Default value if undefined
     * @returns {Promise<Object>} The store value or default
     */
    async _getObjectFromStore(key, defaultValue = {}) {
        const value = await this.electronAPI.store.get(key);

        // Handle undefined (packaged apps) or invalid values
        if (value === undefined || value === null || typeof value !== 'object') {
            return defaultValue;
        }

        return value;
    }

    /**
     * Build composite key for endpoint
     * @private
     * @param {string} collectionId - The collection ID
     * @param {string} endpointId - The endpoint ID
     * @returns {string} The composite key
     */
    _buildKey(collectionId, endpointId) {
        return `${collectionId}_${endpointId}`;
    }
}
