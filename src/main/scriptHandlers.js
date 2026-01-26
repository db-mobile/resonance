/**
 * @fileoverview IPC handlers for script operations
 * @module main/scriptHandlers
 */

/**
 * IPC handlers for script CRUD and execution operations
 *
 * @class
 * @classdesc Handles script-related IPC calls from renderer process
 */
export default class ScriptHandlers {
    /**
     * Creates a ScriptHandlers instance
     * @param {Object} store - store instance
     * @param {Object} scriptExecutor - ScriptExecutor instance
     */
    constructor(store, scriptExecutor) {
        this.store = store;
        this.scriptExecutor = scriptExecutor;
        this.SCRIPTS_KEY = 'persistedScripts';
    }

    /**
     * Handle getting scripts for an endpoint
     * @param {Object} event - IPC event
     * @param {string} collectionId - Collection ID
     * @param {string} endpointId - Endpoint ID
     * @returns {Object} Script data
     */
    handleGetScripts(event, collectionId, endpointId) {
        const scripts = this.store.get(this.SCRIPTS_KEY, {});
        const key = `${collectionId}_${endpointId}`;

        return scripts[key] || {
            preRequestScript: '',
            testScript: ''
        };
    }

    /**
     * Handle saving scripts for an endpoint
     * @param {Object} event - IPC event
     * @param {string} collectionId - Collection ID
     * @param {string} endpointId - Endpoint ID
     * @param {Object} scriptData - Script data to save
     * @returns {void}
     */
    handleSaveScripts(event, collectionId, endpointId, scriptData) {
        const scripts = this.store.get(this.SCRIPTS_KEY, {});
        const key = `${collectionId}_${endpointId}`;

        scripts[key] = {
            preRequestScript: scriptData.preRequestScript || '',
            testScript: scriptData.testScript || ''
        };

        this.store.set(this.SCRIPTS_KEY, scripts);
    }

    /**
     * Handle executing a pre-request script
     * @param {Object} event - IPC event
     * @param {Object} scriptData - Script execution data
     * @param {string} scriptData.script - The script code
     * @param {Object} scriptData.request - Request context
     * @param {Object} scriptData.environment - Environment variables
     * @returns {Promise<Object>} Execution result
     */
    async handlePreRequestScript(event, scriptData) {
        try {
            const result = await this.scriptExecutor.executePreRequest(
                scriptData.script,
                scriptData.request,
                scriptData.environment
            );

            return result;
        } catch (error) {
            return {
                success: false,
                logs: [],
                errors: [error.message],
                testResults: [],
                modifiedRequest: scriptData.request,
                modifiedEnvironment: {}
            };
        }
    }

    /**
     * Handle executing a test script
     * @param {Object} event - IPC event
     * @param {Object} scriptData - Script execution data
     * @param {string} scriptData.script - The script code
     * @param {Object} scriptData.request - Request context
     * @param {Object} scriptData.response - Response context
     * @param {Object} scriptData.environment - Environment variables
     * @returns {Promise<Object>} Execution result
     */
    async handleTestScript(event, scriptData) {
        try {
            const result = await this.scriptExecutor.executeTest(
                scriptData.script,
                scriptData.request,
                scriptData.response,
                scriptData.environment
            );

            return result;
        } catch (error) {
            return {
                success: false,
                logs: [],
                errors: [error.message],
                testResults: [],
                modifiedEnvironment: {}
            };
        }
    }
}
