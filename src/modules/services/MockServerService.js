/**
 * @fileoverview Service for managing mock server business logic with event notifications
 * @module services/MockServerService
 */

/**
 * Service for managing mock server business logic
 *
 * @class
 * @classdesc Provides high-level mock server operations with validation, error handling,
 * and event notifications. Manages server lifecycle, settings management, and collection
 * configuration. Implements observer pattern for mock server change notifications to keep
 * UI synchronized.
 *
 * Event types emitted:
 * - 'mock-server-started': When mock server starts successfully
 * - 'mock-server-stopped': When mock server stops
 * - 'mock-server-settings-updated': When settings are modified
 * - 'mock-server-error': When an error occurs
 */
export class MockServerService {
    /**
     * Creates a MockServerService instance
     *
     * @param {MockServerRepository} repository - Data access layer
     * @param {IStatusDisplay} statusDisplay - Status display interface
     */
    constructor(repository, statusDisplay) {
        this.repository = repository;
        this.statusDisplay = statusDisplay;
        this.listeners = new Set();
    }

    /**
     * Registers a listener for mock server changes
     *
     * Listener receives event objects with type and relevant data.
     *
     * @param {Function} callback - The callback function
     * @param {Object} callback.event - Event object
     * @param {string} callback.event.type - Event type
     * @returns {void}
     */
    addChangeListener(callback) {
        this.listeners.add(callback);
    }

    /**
     * Removes a change listener
     *
     * @param {Function} callback - The callback function to remove
     * @returns {void}
     */
    removeChangeListener(callback) {
        this.listeners.delete(callback);
    }

    /**
     * Notifies all listeners of mock server change
     *
     * Catches and logs listener errors to prevent disruption.
     *
     * @private
     * @param {Object} event - Event object with type and data
     * @returns {void}
     */
    _notifyListeners(event) {
        this.listeners.forEach(callback => {
            try {
                callback(event);
            } catch (error) {
                console.error('Error in mock server change listener:', error);
            }
        });
    }

    /**
     * Starts the mock server
     *
     * @async
     * @param {Array} collections - Array of all collection objects
     * @returns {Promise<Object>} Result object with success status and details
     * @throws {Error} If startup fails
     * @fires MockServerService#mock-server-started
     * @fires MockServerService#mock-server-error
     */
    async startServer(collections) {
        try {
            const settings = await this.repository.getSettings();

            // Filter to only enabled collections
            const enabledCollections = collections.filter(collection =>
                settings.enabledCollections.includes(collection.id)
            );

            if (enabledCollections.length === 0) {
                const error = new Error('No collections enabled. Please enable at least one collection.');
                this.statusDisplay.update(error.message, null);
                this._notifyListeners({
                    type: 'mock-server-error',
                    message: error.message
                });
                throw error;
            }

            // Call IPC to start server in main process
            const result = await window.electronAPI.mockServer.start(settings, enabledCollections);

            if (result.success) {
                this.statusDisplay.update(`Mock server started on port ${result.port}`, null);
                this._notifyListeners({
                    type: 'mock-server-started',
                    port: result.port,
                    collectionsCount: enabledCollections.length
                });
            } else {
                this.statusDisplay.update(`Failed to start mock server: ${result.message}`, null);
                this._notifyListeners({
                    type: 'mock-server-error',
                    message: result.message
                });
            }

            return result;
        } catch (error) {
            const message = error.message || 'Failed to start mock server';
            this.statusDisplay.update(message, null);
            this._notifyListeners({
                type: 'mock-server-error',
                message
            });
            throw error;
        }
    }

    /**
     * Stops the mock server
     *
     * @async
     * @returns {Promise<Object>} Result object with success status
     * @throws {Error} If stop operation fails
     * @fires MockServerService#mock-server-stopped
     * @fires MockServerService#mock-server-error
     */
    async stopServer() {
        try {
            const result = await window.electronAPI.mockServer.stop();

            if (result.success) {
                this.statusDisplay.update('Mock server stopped', null);
                this._notifyListeners({
                    type: 'mock-server-stopped'
                });
            } else {
                this.statusDisplay.update(`Failed to stop mock server: ${result.message}`, null);
                this._notifyListeners({
                    type: 'mock-server-error',
                    message: result.message
                });
            }

            return result;
        } catch (error) {
            const message = error.message || 'Failed to stop mock server';
            this.statusDisplay.update(message, null);
            this._notifyListeners({
                type: 'mock-server-error',
                message
            });
            throw error;
        }
    }

    /**
     * Gets server status
     *
     * @async
     * @returns {Promise<Object>} Status object with running state, port, and request count
     */
    async getStatus() {
        try {
            return await window.electronAPI.mockServer.status();
        } catch (error) {
            console.error('Error getting mock server status:', error);
            return {
                running: false,
                port: null,
                requestCount: 0
            };
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
        try {
            return await window.electronAPI.mockServer.logs(limit);
        } catch (error) {
            console.error('Error getting request logs:', error);
            return [];
        }
    }

    /**
     * Clears request logs
     *
     * @async
     * @returns {Promise<Object>} Result object
     */
    async clearRequestLogs() {
        try {
            return await window.electronAPI.mockServer.clearLogs();
        } catch (error) {
            console.error('Error clearing request logs:', error);
            throw error;
        }
    }

    /**
     * Gets mock server settings
     *
     * @async
     * @returns {Promise<Object>} Settings object
     * @throws {Error} If loading fails
     */
    async getSettings() {
        try {
            return await this.repository.getSettings();
        } catch (error) {
            this.statusDisplay.update(`Error loading mock server settings: ${error.message}`, null);
            throw error;
        }
    }

    /**
     * Updates mock server settings
     *
     * @async
     * @param {Object} updates - Update object
     * @returns {Promise<Object>} The updated settings object
     * @throws {Error} If validation fails or update fails
     * @fires MockServerService#mock-server-settings-updated
     */
    async updateSettings(updates) {
        try {
            // Check if server is running and port is being changed
            const status = await this.getStatus();
            const requiresRestart = status.running && updates.port !== undefined;

            const updatedSettings = await this.repository.updateSettings(updates);

            this.statusDisplay.update('Mock server settings updated', null);

            this._notifyListeners({
                type: 'mock-server-settings-updated',
                settings: updatedSettings,
                requiresRestart
            });

            if (requiresRestart) {
                this.statusDisplay.update('Port changed. Please restart the mock server for changes to take effect.', null);
            }

            return updatedSettings;
        } catch (error) {
            this.statusDisplay.update(`Error updating mock server settings: ${error.message}`, null);
            throw error;
        }
    }

    /**
     * Sets delay for a specific endpoint
     *
     * @async
     * @param {string} collectionId - Collection ID
     * @param {string} endpointId - Endpoint ID
     * @param {number} delayMs - Delay in milliseconds
     * @returns {Promise<Object>} Updated settings
     * @throws {Error} If validation fails or update fails
     */
    async setEndpointDelay(collectionId, endpointId, delayMs) {
        try {
            const errors = this.validateDelay(delayMs);
            if (errors.length > 0) {
                throw new Error(errors.join(', '));
            }

            return await this.repository.setEndpointDelay(collectionId, endpointId, delayMs);
        } catch (error) {
            this.statusDisplay.update(`Error setting endpoint delay: ${error.message}`, null);
            throw error;
        }
    }

    /**
     * Sets custom response for a specific endpoint
     *
     * @async
     * @param {string} collectionId - Collection ID
     * @param {string} endpointId - Endpoint ID
     * @param {Object|null} response - Custom response body (null to reset to default)
     * @returns {Promise<Object>} Updated settings
     * @throws {Error} If update fails
     */
    async setCustomResponse(collectionId, endpointId, response) {
        try {
            return await this.repository.setCustomResponse(collectionId, endpointId, response);
        } catch (error) {
            this.statusDisplay.update(`Error setting custom response: ${error.message}`, null);
            throw error;
        }
    }

    /**
     * Gets custom response for a specific endpoint
     *
     * @async
     * @param {string} collectionId - Collection ID
     * @param {string} endpointId - Endpoint ID
     * @returns {Promise<Object|null>} Custom response or null if using default
     */
    async getCustomResponse(collectionId, endpointId) {
        try {
            return await this.repository.getCustomResponse(collectionId, endpointId);
        } catch (error) {
            console.error('Error getting custom response:', error);
            return null;
        }
    }

    /**
     * Gets default response for a specific endpoint (from schema)
     *
     * @async
     * @param {string} _collectionId - Collection ID (unused, for future implementation)
     * @param {string} _endpointId - Endpoint ID (unused, for future implementation)
     * @returns {Promise<Object|null>} Default schema-generated response or null
     */
    async getDefaultResponse(_collectionId, _endpointId) {
        // This will be implemented to get the schema-generated response
        // For now, return null - will be implemented when we have access to collections
        return null;
    }

    /**
     * Toggles collection enabled state
     *
     * @async
     * @param {string} collectionId - Collection ID to toggle
     * @returns {Promise<boolean>} New enabled state
     * @throws {Error} If toggle operation fails
     */
    async toggleCollectionEnabled(collectionId) {
        try {
            const settings = await this.repository.toggleCollectionEnabled(collectionId);
            const isEnabled = settings.enabledCollections.includes(collectionId);

            this._notifyListeners({
                type: 'mock-server-settings-updated',
                settings,
                collectionToggled: {
                    collectionId,
                    enabled: isEnabled
                }
            });

            return isEnabled;
        } catch (error) {
            this.statusDisplay.update(`Error toggling collection: ${error.message}`, null);
            throw error;
        }
    }

    /**
     * Validates port number
     *
     * @param {number} port - Port to validate
     * @returns {Array<string>} Array of error messages (empty if valid)
     */
    validatePort(port) {
        const errors = [];
        const portNum = parseInt(port, 10);

        if (isNaN(portNum)) {
            errors.push('Port must be a number');
        } else if (portNum < 1024) {
            errors.push('Port must be 1024 or higher (avoiding system ports)');
        } else if (portNum > 65535) {
            errors.push('Port must be 65535 or lower');
        }

        return errors;
    }

    /**
     * Validates delay value
     *
     * @param {number} delay - Delay in milliseconds to validate
     * @returns {Array<string>} Array of error messages (empty if valid)
     */
    validateDelay(delay) {
        const errors = [];
        const delayNum = parseInt(delay, 10);

        if (isNaN(delayNum)) {
            errors.push('Delay must be a number');
        } else if (delayNum < 0) {
            errors.push('Delay cannot be negative');
        } else if (delayNum > 30000) {
            errors.push('Delay cannot exceed 30000ms (30 seconds)');
        }

        return errors;
    }
}
