/**
 * @fileoverview Repository for persisting pre-request and test scripts
 * @module storage/ScriptRepository
 */

export class ScriptRepository {
    /** @param {Object} backendAPI */
    constructor(backendAPI) {
        this.backendAPI = backendAPI;
        this.SCRIPTS_KEY = 'persistedScripts';
    }

    /**
     * @param {string} collectionId
     * @param {string} endpointId
     * @returns {Promise<{preRequestScript: string, testScript: string}>}
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
     * @param {string} collectionId
     * @param {string} endpointId
     * @param {Object} scriptData
     * @param {string} scriptData.preRequestScript
     * @param {string} scriptData.testScript
     * @returns {Promise<void>}
     */
    async saveScripts(collectionId, endpointId, scriptData) {
        const scripts = await this._getObjectFromStore(this.SCRIPTS_KEY);
        const key = this._buildKey(collectionId, endpointId);

        scripts[key] = {
            preRequestScript: scriptData.preRequestScript || '',
            testScript: scriptData.testScript || ''
        };

        await this.backendAPI.store.set(this.SCRIPTS_KEY, scripts);
    }

    /**
     * @param {string} collectionId
     * @param {string} endpointId
     * @returns {Promise<void>}
     */
    async deleteScripts(collectionId, endpointId) {
        const scripts = await this._getObjectFromStore(this.SCRIPTS_KEY);
        const key = this._buildKey(collectionId, endpointId);

        delete scripts[key];

        await this.backendAPI.store.set(this.SCRIPTS_KEY, scripts);
    }

    /**
     * @param {string} key
     * @param {Object} defaultValue
     * @returns {Promise<Object>}
     */
    async _getObjectFromStore(key, defaultValue = {}) {
        const value = await this.backendAPI.store.get(key);

        if (value === undefined || value === null || typeof value !== 'object') {
            return defaultValue;
        }

        return value;
    }

    /**
     * @param {string} collectionId
     * @param {string} endpointId
     * @returns {string}
     */
    _buildKey(collectionId, endpointId) {
        return `${collectionId}_${endpointId}`;
    }
}
