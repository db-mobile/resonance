/**
 * @fileoverview Controller for coordinating mock server operations between UI and service
 * @module controllers/MockServerController
 */

/**
 * Controller for coordinating mock server operations
 *
 * @class
 * @classdesc Coordinates mock server operations between UI components and the service layer.
 * Manages server lifecycle, settings management, collection configuration, and provides
 * methods for UI interaction.
 */
export class MockServerController {
    /**
     * Creates a MockServerController instance
     *
     * @param {MockServerService} service - Service layer for business logic
     * @param {CollectionRepository} collectionRepository - Repository for accessing collections
     */
    constructor(service, collectionRepository) {
        this.service = service;
        this.collectionRepository = collectionRepository;
    }

    /**
     * Initializes the controller
     *
     * Sets up service listeners for UI updates.
     *
     * @async
     * @returns {Promise<void>}
     */
    async initialize() {
        // Register service listeners for UI synchronization
        this.service.addChangeListener((event) => {
            this._handleServiceEvent(event);
        });
    }

    /**
     * Handles service events
     *
     * @private
     * @param {Object} event - Service event object
     */
    _handleServiceEvent(_event) {
        // This can be extended to handle specific events
        // For now, events are primarily for dialog updates
    }

    /**
     * Starts the mock server
     *
     * @async
     * @returns {Promise<Object>} Result object with success status and details
     */
    async handleStart() {
        try {
            // Get all collections
            const collections = await this.collectionRepository.getAll();

            if (collections.length === 0) {
                return {
                    success: false,
                    message: 'No collections available. Please import an OpenAPI or Postman collection first.'
                };
            }

            // Start server via service
            return await this.service.startServer(collections);
        } catch (error) {
            console.error('Error starting mock server:', error);
            return {
                success: false,
                message: error.message || 'Failed to start mock server'
            };
        }
    }

    /**
     * Stops the mock server
     *
     * @async
     * @returns {Promise<Object>} Result object with success status
     */
    async handleStop() {
        try {
            return await this.service.stopServer();
        } catch (error) {
            console.error('Error stopping mock server:', error);
            return {
                success: false,
                message: error.message || 'Failed to stop mock server'
            };
        }
    }

    /**
     * Gets server status
     *
     * @async
     * @returns {Promise<Object>} Status object with running state, port, and request count
     */
    async getStatus() {
        return this.service.getStatus();
    }

    /**
     * Gets mock server settings
     *
     * @async
     * @returns {Promise<Object>} Settings object
     */
    async getSettings() {
        return this.service.getSettings();
    }

    /**
     * Updates mock server port
     *
     * @async
     * @param {number} port - New port number
     * @returns {Promise<Object>} Result object with success status
     */
    async handleUpdatePort(port) {
        try {
            const errors = this.service.validatePort(port);
            if (errors.length > 0) {
                return {
                    success: false,
                    message: errors.join(', ')
                };
            }

            await this.service.updateSettings({ port: parseInt(port, 10) });
            return {
                success: true,
                message: 'Port updated successfully'
            };
        } catch (error) {
            console.error('Error updating port:', error);
            return {
                success: false,
                message: error.message || 'Failed to update port'
            };
        }
    }

    /**
     * Toggles collection enabled state
     *
     * @async
     * @param {string} collectionId - Collection ID to toggle
     * @returns {Promise<Object>} Result object with new enabled state
     */
    async handleToggleCollection(collectionId) {
        try {
            const isEnabled = await this.service.toggleCollectionEnabled(collectionId);
            return {
                success: true,
                enabled: isEnabled,
                message: isEnabled ? 'Collection enabled' : 'Collection disabled'
            };
        } catch (error) {
            console.error('Error toggling collection:', error);
            return {
                success: false,
                message: error.message || 'Failed to toggle collection'
            };
        }
    }

    /**
     * Sets delay for a specific endpoint
     *
     * @async
     * @param {string} collectionId - Collection ID
     * @param {string} endpointId - Endpoint ID
     * @param {number} delayMs - Delay in milliseconds
     * @returns {Promise<Object>} Result object with success status
     */
    async handleSetDelay(collectionId, endpointId, delayMs) {
        try {
            const errors = this.service.validateDelay(delayMs);
            if (errors.length > 0) {
                return {
                    success: false,
                    message: errors.join(', ')
                };
            }

            await this.service.setEndpointDelay(collectionId, endpointId, parseInt(delayMs, 10));
            return {
                success: true,
                message: 'Delay updated successfully'
            };
        } catch (error) {
            console.error('Error setting endpoint delay:', error);
            return {
                success: false,
                message: error.message || 'Failed to set delay'
            };
        }
    }

    /**
     * Sets custom response for a specific endpoint
     *
     * @async
     * @param {string} collectionId - Collection ID
     * @param {string} endpointId - Endpoint ID
     * @param {Object|string|null} response - Custom response body (null to reset)
     * @returns {Promise<Object>} Result object with success status
     */
    async handleSetCustomResponse(collectionId, endpointId, response) {
        try {
            // Validate JSON if response is a string
            if (typeof response === 'string' && response.trim()) {
                try {
                    response = JSON.parse(response);
                } catch (parseError) {
                    return {
                        success: false,
                        message: 'Invalid JSON format'
                    };
                }
            }

            await this.service.setCustomResponse(collectionId, endpointId, response);
            return {
                success: true,
                message: 'Custom response updated successfully'
            };
        } catch (error) {
            console.error('Error setting custom response:', error);
            return {
                success: false,
                message: error.message || 'Failed to set custom response'
            };
        }
    }

    /**
     * Gets custom response for a specific endpoint
     *
     * @async
     * @param {string} collectionId - Collection ID
     * @param {string} endpointId - Endpoint ID
     * @returns {Promise<Object|null>} Custom response or null
     */
    async getCustomResponse(collectionId, endpointId) {
        try {
            return await this.service.getCustomResponse(collectionId, endpointId);
        } catch (error) {
            console.error('Error getting custom response:', error);
            return null;
        }
    }

    /**
     * Gets default response for a specific endpoint (from schema)
     *
     * @async
     * @param {string} collectionId - Collection ID
     * @param {string} endpointId - Endpoint ID
     * @returns {Promise<Object|null>} Default response or null
     */
    async getDefaultResponse(collectionId, endpointId) {
        try {
            return await this.service.getDefaultResponse(collectionId, endpointId);
        } catch (error) {
            console.error('Error getting default response:', error);
            return null;
        }
    }

    /**
     * Sets custom status code for a specific endpoint
     *
     * @async
     * @param {string} collectionId - Collection ID
     * @param {string} endpointId - Endpoint ID
     * @param {number|null} statusCode - Custom status code (null to reset)
     * @returns {Promise<Object>} Result object with success status
     */
    async handleSetCustomStatusCode(collectionId, endpointId, statusCode) {
        try {
            // Validate status code if not null
            if (statusCode !== null) {
                const errors = this.service.validateStatusCode(statusCode);
                if (errors.length > 0) {
                    return {
                        success: false,
                        message: errors.join(', ')
                    };
                }
            }

            await this.service.setCustomStatusCode(collectionId, endpointId, statusCode);
            return {
                success: true,
                message: 'Custom status code updated successfully'
            };
        } catch (error) {
            console.error('Error setting custom status code:', error);
            return {
                success: false,
                message: error.message || 'Failed to set custom status code'
            };
        }
    }

    /**
     * Gets custom status code for a specific endpoint
     *
     * @async
     * @param {string} collectionId - Collection ID
     * @param {string} endpointId - Endpoint ID
     * @returns {Promise<number|null>} Custom status code or null
     */
    async getCustomStatusCode(collectionId, endpointId) {
        try {
            return await this.service.getCustomStatusCode(collectionId, endpointId);
        } catch (error) {
            console.error('Error getting custom status code:', error);
            return null;
        }
    }

    /**
     * Gets all collections
     *
     * @async
     * @returns {Promise<Array>} Array of collection objects
     */
    async getCollections() {
        try {
            return await this.collectionRepository.getAll();
        } catch (error) {
            console.error('Error getting collections:', error);
            return [];
        }
    }

    /**
     * Gets request logs
     *
     * @async
     * @param {number} limit - Maximum number of logs to return
     * @returns {Promise<Array>} Array of request log entries
     */
    async getRequestLogs(limit = 20) {
        return this.service.getRequestLogs(limit);
    }

    /**
     * Clears request logs
     *
     * @async
     * @returns {Promise<Object>} Result object
     */
    async clearRequestLogs() {
        try {
            await this.service.clearRequestLogs();
            return {
                success: true,
                message: 'Logs cleared successfully'
            };
        } catch (error) {
            console.error('Error clearing logs:', error);
            return {
                success: false,
                message: error.message || 'Failed to clear logs'
            };
        }
    }
}
