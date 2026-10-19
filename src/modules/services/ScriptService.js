/** Desktop script storage. Execution and transient scopes live in resonance-core. */
export class ScriptService {
    constructor(scriptRepository) {
        this.repository = scriptRepository;
    }

    async getScripts(collectionId, endpointId) {
        try {
            return await this.repository.getScripts(collectionId, endpointId);
        } catch (error) {
            return {
                preRequestScript: '',
                testScript: ''
            };
        }
    }

    /**
     * @param {string} collectionId
     * @param {string} endpointId
     * @param {Object} scripts
     * @returns {Promise<void>}
     */
    async saveScripts(collectionId, endpointId, scripts) {
        try {
            await this.repository.saveScripts(collectionId, endpointId, scripts);
        } catch (error) {
            throw new Error(`Failed to save scripts: ${error.message}`, { cause: error });
        }
    }
}
