/**
 * @fileoverview Service for script business logic
 * @module services/ScriptService
 */

/**
 * Service for managing script operations and execution
 * Coordinates between storage, execution, and environment management
 *
 * @class
 * @classdesc Handles script CRUD operations and execution coordination
 */
export class ScriptService {
    /**
     * Creates a ScriptService instance
     * @param {Object} scriptRepository - ScriptRepository instance
     * @param {Object} environmentService - EnvironmentService instance
     * @param {Object} statusDisplay - Status display adapter
     */
    constructor(scriptRepository, environmentService, statusDisplay) {
        this.repository = scriptRepository;
        this.environmentService = environmentService;
        this.statusDisplay = statusDisplay;
    }

    /**
     * Get scripts for an endpoint
     * @param {string} collectionId - Collection ID
     * @param {string} endpointId - Endpoint ID
     * @returns {Promise<Object>} Scripts object
     */
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
     * Save scripts for an endpoint
     * @param {string} collectionId - Collection ID
     * @param {string} endpointId - Endpoint ID
     * @param {Object} scripts - Scripts to save
     * @returns {Promise<void>}
     */
    async saveScripts(collectionId, endpointId, scripts) {
        try {
            await this.repository.saveScripts(collectionId, endpointId, scripts);
        } catch (error) {
            throw new Error(`Failed to save scripts: ${error.message}`);
        }
    }

    /**
     * Execute a pre-request script
     * @param {string} script - The script code
     * @param {Object} requestConfig - Request configuration
     * @returns {Promise<Object>} Modified request config and execution result
     */
    async executePreRequestScript(script, requestConfig) {
        if (!script || script.trim() === '') {
            return {
                modifiedRequest: requestConfig,
                result: { success: true, logs: [], errors: [], testResults: [] }
            };
        }

        try {
            // Get active environment variables
            const environmentVariables = await this.environmentService.getActiveEnvironmentVariables();

            // Prepare script execution data
            const scriptData = {
                script,
                request: {
                    url: requestConfig.url,
                    method: requestConfig.method,
                    headers: requestConfig.headers || {},
                    body: requestConfig.body,
                    queryParams: requestConfig.queryParams || {},
                    pathParams: requestConfig.pathParams || {}
                },
                environment: environmentVariables || {}
            };

            // Execute script via IPC
            const result = await window.backendAPI.scripts.executePreRequest(scriptData);

            // Apply environment changes if any
            if (result.modifiedEnvironment && Object.keys(result.modifiedEnvironment).length > 0) {
                await this._applyEnvironmentChanges(result.modifiedEnvironment);
            }

            // Return modified request and result
            return {
                modifiedRequest: result.modifiedRequest || requestConfig,
                result
            };

        } catch (error) {
            return {
                modifiedRequest: requestConfig,
                result: {
                    success: false,
                    logs: [],
                    errors: [error.message],
                    testResults: []
                }
            };
        }
    }

    /**
     * Execute a test script
     * @param {string} script - The script code
     * @param {Object} requestConfig - Request configuration
     * @param {Object} response - Response data
     * @returns {Promise<Object>} Execution result
     */
    async executeTestScript(script, requestConfig, response) {
        if (!script || script.trim() === '') {
            return {
                success: true,
                logs: [],
                errors: [],
                testResults: []
            };
        }

        try {
            // Get active environment variables
            const environmentVariables = await this.environmentService.getActiveEnvironmentVariables();

            const status = response?.status ?? response?.statusCode ?? response?.status_code ?? null;
            const statusText = response?.statusText ?? response?.status_text ?? response?.statusMessage ?? '';
            const headers = response?.headers || {};
            const body = response?.data ?? response?.body ?? null;
            const timings = response?.timings || {};
            const cookies = response?.cookies || [];

            // Prepare script execution data
            const scriptData = {
                script,
                request: {
                    url: requestConfig.url,
                    method: requestConfig.method,
                    headers: requestConfig.headers || {},
                    body: requestConfig.body,
                    queryParams: requestConfig.queryParams || {},
                    pathParams: requestConfig.pathParams || {}
                },
                response: {
                    status,
                    statusText,
                    headers,
                    body,
                    timings,
                    cookies
                },
                environment: environmentVariables || {}
            };

            // Execute script via IPC
            const result = await window.backendAPI.scripts.executeTest(scriptData);

            // Apply environment changes if any
            if (result.modifiedEnvironment && Object.keys(result.modifiedEnvironment).length > 0) {
                await this._applyEnvironmentChanges(result.modifiedEnvironment);
            }

            return result;

        } catch (error) {
            return {
                success: false,
                logs: [],
                errors: [error.message],
                testResults: []
            };
        }
    }

    /**
     * Apply environment variable changes from script execution
     * @private
     * @param {Object} changes - Environment changes object
     * @returns {Promise<void>}
     */
    async _applyEnvironmentChanges(changes) {
        try {
            const activeEnv = await this.environmentService.getActiveEnvironment();
            if (!activeEnv) {
                return;
            }

            // Apply each change
            for (const [key, value] of Object.entries(changes)) {
                if (value === null) {
                    // Delete variable
                    await this.environmentService.deleteVariable(activeEnv.id, key);
                } else {
                    // Set variable
                    await this.environmentService.setVariable(activeEnv.id, key, value);
                }
            }

        } catch (error) {
            // Non-fatal - log and continue
        }
    }

    /**
     * Validate script syntax (basic check)
     * @param {string} script - The script to validate
     * @returns {Object} Validation result {valid: boolean, error: string}
     */
    validateScript(script) {
        if (!script || script.trim() === '') {
            return { valid: true, error: null };
        }

        try {
            // Basic syntax check using Function constructor
            // This doesn't execute the script, just checks syntax
            new Function(script);
            return { valid: true, error: null };
        } catch (error) {
            return { valid: false, error: error.message };
        }
    }
}
