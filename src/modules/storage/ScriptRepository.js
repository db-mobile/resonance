/**
 * @fileoverview Repository for persisting pre-request and test scripts
 * @module storage/ScriptRepository
 */

export class ScriptRepository {
    /** @param {Object} backendAPI */
    constructor(backendAPI) {
        this.backendAPI = backendAPI;
    }

    /**
     * @param {string} collectionId
     * @param {string} endpointId
     * @returns {Promise<{preRequestScript: string, testScript: string}>}
     */
    async getScripts(collectionId, endpointId) {
        const scripts = await this.backendAPI.scripts.get(collectionId, endpointId);
        return {
            preRequestScript: scripts?.preRequestScript || '',
            testScript: scripts?.testScript || ''
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
        await this.backendAPI.scripts.save(collectionId, endpointId, {
            preRequestScript: scriptData.preRequestScript || '',
            testScript: scriptData.testScript || ''
        });
    }
}
