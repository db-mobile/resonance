/**
 * @fileoverview Service for managing mock server business logic with event notifications
 * @module services/MockServerService
 */

export class MockServerService {
    /**
     * @param {MockServerRepository} repository
     * @param {IStatusDisplay} statusDisplay
     */
    constructor(repository, statusDisplay) {
        this.repository = repository;
        this.statusDisplay = statusDisplay;
        this.listeners = new Set();
    }

    /**
     * @param {Function} callback
     * @param {Object} callback.event
     * @param {string} callback.event.type
     * @returns {void}
     */
    addChangeListener(callback) {
        this.listeners.add(callback);
    }

    /**
     * @param {Function} callback
     * @returns {void}
     */
    removeChangeListener(callback) {
        this.listeners.delete(callback);
    }

    /**
     * @param {Object} event
     * @returns {void}
     */
    _notifyListeners(event) {
        this.listeners.forEach(callback => {
            try {
                callback(event);
            } catch (error) {
                void error;
            }
        });
    }

    /**
     * @param {Array} collections
     * @returns {Promise<Object>}
     */
    async startServer(collections) {
        try {
            const settings = await this.repository.getSettings();

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

            const result = await window.backendAPI.mockServer.start(settings, enabledCollections);

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

    /** @returns {Promise<Object>} */
    async stopServer() {
        try {
            const result = await window.backendAPI.mockServer.stop();

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

    /** @returns {Promise<Object>} */
    async getStatus() {
        try {
            return await window.backendAPI.mockServer.status();
        } catch (error) {
            return {
                running: false,
                port: null,
                requestCount: 0
            };
        }
    }

    /**
     * @param {string} collectionId
     * @returns {Promise<{shouldUseMock: boolean, mockBaseUrl: string|null}>}
     */
    async shouldUseMockServer(collectionId) {
        try {
            const [status, settings] = await Promise.all([
                this.getStatus(),
                this.getSettings()
            ]);

            if (!status.running) {
                return { shouldUseMock: false, mockBaseUrl: null };
            }

            if (!settings.enabledCollections.includes(collectionId)) {
                return { shouldUseMock: false, mockBaseUrl: null };
            }

            return {
                shouldUseMock: true,
                mockBaseUrl: `http://localhost:${status.port}`
            };
        } catch (error) {
            return { shouldUseMock: false, mockBaseUrl: null };
        }
    }

    /**
     * @param {number} limit
     * @returns {Promise<Array>}
     */
    async getRequestLogs(limit = 20) {
        try {
            return await window.backendAPI.mockServer.logs(limit);
        } catch (error) {
            return [];
        }
    }

    /** @returns {Promise<Object>} */
    async clearRequestLogs() {
        return window.backendAPI.mockServer.clearLogs();
    }

    /** @returns {Promise<Object>} */
    async getSettings() {
        try {
            return await this.repository.getSettings();
        } catch (error) {
            this.statusDisplay.update(`Error loading mock server settings: ${error.message}`, null);
            throw error;
        }
    }

    /**
     * @param {Object} updates
     * @returns {Promise<Object>}
     */
    async updateSettings(updates) {
        try {
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
     * @param {string} collectionId
     * @param {string} endpointId
     * @param {number} delayMs
     * @returns {Promise<Object>}
     */
    async setEndpointDelay(collectionId, endpointId, delayMs) {
        try {
            const errors = this.validateDelay(delayMs);
            if (errors.length > 0) {
                throw new Error(errors.join(', '));
            }

            const result = await this.repository.setEndpointDelay(collectionId, endpointId, delayMs);

            await this._reloadServerSettings();

            return result;
        } catch (error) {
            this.statusDisplay.update(`Error setting endpoint delay: ${error.message}`, null);
            throw error;
        }
    }

    /**
     * @param {string} collectionId
     * @param {string} endpointId
     * @param {Object|null} response
     * @returns {Promise<Object>}
     */
    async setCustomResponse(collectionId, endpointId, response) {
        try {
            const result = await this.repository.setCustomResponse(collectionId, endpointId, response);

            await this._reloadServerSettings();

            return result;
        } catch (error) {
            this.statusDisplay.update(`Error setting custom response: ${error.message}`, null);
            throw error;
        }
    }

    /**
     * @param {string} collectionId
     * @param {string} endpointId
     * @returns {Promise<Object|null>}
     */
    async getCustomResponse(collectionId, endpointId) {
        try {
            return await this.repository.getCustomResponse(collectionId, endpointId);
        } catch (error) {
            return null;
        }
    }

    /**
     * @param {string} _collectionId
     * @param {string} _endpointId
     * @returns {Promise<Object|null>}
     */
    async getDefaultResponse(_collectionId, _endpointId) {
        return null;
    }

    /**
     * @param {string} collectionId
     * @param {string} endpointId
     * @param {number|null} statusCode
     * @returns {Promise<Object>}
     */
    async setCustomStatusCode(collectionId, endpointId, statusCode) {
        try {
            const result = await this.repository.setCustomStatusCode(collectionId, endpointId, statusCode);

            await this._reloadServerSettings();

            return result;
        } catch (error) {
            this.statusDisplay.update(`Error setting custom status code: ${error.message}`, null);
            throw error;
        }
    }

    /**
     * @param {string} collectionId
     * @param {string} endpointId
     * @returns {Promise<number|null>}
     */
    async getCustomStatusCode(collectionId, endpointId) {
        try {
            return await this.repository.getCustomStatusCode(collectionId, endpointId);
        } catch (error) {
            return null;
        }
    }

    /**
     * @param {string} collectionId
     * @returns {Promise<boolean>}
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
     * @param {number} port
     * @returns {Array<string>}
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
     * @param {number} delay
     * @returns {Array<string>}
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

    /**
     * @param {number} statusCode
     * @returns {Array<string>}
     */
    validateStatusCode(statusCode) {
        const errors = [];
        const code = parseInt(statusCode, 10);

        if (isNaN(code)) {
            errors.push('Status code must be a number');
        } else if (code < 100 || code > 599) {
            errors.push('Status code must be between 100 and 599');
        }

        return errors;
    }

    /** @returns {Promise<void>} */
    async _reloadServerSettings() {
        try {
            const status = await this.getStatus();
            if (status.running) {
                await window.backendAPI.mockServer.reloadSettings();
            }
        } catch (error) {
        }
    }
}
