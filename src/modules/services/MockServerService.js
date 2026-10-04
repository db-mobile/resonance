/**
 * @fileoverview Service for managing mock server business logic with event notifications
 * @module services/MockServerService
 */

import { ChangeEmitter } from './ChangeEmitter.js';

export class MockServerService {
    /**
     * @param {MockServerRepository} repository
     * @param {IStatusDisplay} statusDisplay
     */
    constructor(repository, statusDisplay) {
        this.repository = repository;
        this.statusDisplay = statusDisplay;
        this._events = new ChangeEmitter();
    }

    /**
     * @param {(status: {running: boolean, port: number|null}) => void} callback
     * @returns {void}
     */
    addChangeListener(callback) {
        this._events.add(callback);
    }

    /**
     * @param {string} label
     * @param {function(): Promise<*>} work
     * @returns {Promise<*>}
     */
    async _reporting(label, work) {
        try {
            return await work();
        } catch (error) {
            this.statusDisplay.update(`${label}: ${error.message}`, null);
            throw error;
        }
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
                throw error;
            }

            const result = await window.backendAPI.mockServer.start(settings, enabledCollections);

            if (result.success) {
                this.statusDisplay.update(`Mock server started on port ${result.port}`, null);
                this._events.emit({ running: true, port: result.port });
            } else {
                this.statusDisplay.update(`Failed to start mock server: ${result.message}`, null);
            }

            return result;
        } catch (error) {
            const message = error.message || 'Failed to start mock server';
            this.statusDisplay.update(message, null);
            throw error;
        }
    }

    /** @returns {Promise<Object>} */
    async stopServer() {
        try {
            const result = await window.backendAPI.mockServer.stop();

            if (result.success) {
                this.statusDisplay.update('Mock server stopped', null);
                this._events.emit({ running: false, port: null });
            } else {
                this.statusDisplay.update(`Failed to stop mock server: ${result.message}`, null);
            }

            return result;
        } catch (error) {
            const message = error.message || 'Failed to stop mock server';
            this.statusDisplay.update(message, null);
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
        return this._reporting('Error loading mock server settings', () => this.repository.getSettings());
    }

    /**
     * @param {Object} updates
     * @returns {Promise<Object>}
     */
    async updateSettings(updates) {
        return this._reporting('Error updating mock server settings', async () => {
            const status = await this.getStatus();
            const requiresRestart = status.running && updates.port !== undefined;

            const updatedSettings = await this.repository.updateSettings(updates);

            this.statusDisplay.update('Mock server settings updated', null);

            if (requiresRestart) {
                this.statusDisplay.update('Port changed. Please restart the mock server for changes to take effect.', null);
            }

            return updatedSettings;
        });
    }

    /**
     * @param {string} collectionId
     * @param {string} endpointId
     * @param {number} delayMs
     * @returns {Promise<Object>}
     */
    async setEndpointDelay(collectionId, endpointId, delayMs) {
        return this._reporting('Error setting endpoint delay', async () => {
            const errors = this.validateDelay(delayMs);
            if (errors.length > 0) {
                throw new Error(errors.join(', '));
            }

            const result = await this.repository.setEndpointDelay(collectionId, endpointId, delayMs);

            await this._reloadServerSettings();

            return result;
        });
    }

    /**
     * @param {string} collectionId
     * @param {string} endpointId
     * @param {Object|null} response
     * @returns {Promise<Object>}
     */
    async setCustomResponse(collectionId, endpointId, response) {
        return this._reporting('Error setting custom response', async () => {
            const result = await this.repository.setCustomResponse(collectionId, endpointId, response);

            await this._reloadServerSettings();

            return result;
        });
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
     * @param {string} collectionId
     * @param {string} endpointId
     * @param {number|null} statusCode
     * @returns {Promise<Object>}
     */
    async setCustomStatusCode(collectionId, endpointId, statusCode) {
        return this._reporting('Error setting custom status code', async () => {
            const result = await this.repository.setCustomStatusCode(collectionId, endpointId, statusCode);

            await this._reloadServerSettings();

            return result;
        });
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
        return this._reporting('Error toggling collection', async () => {
            const settings = await this.repository.toggleCollectionEnabled(collectionId);
            return settings.enabledCollections.includes(collectionId);
        });
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
                await window.backendAPI.mockServer.reloadSettings(await this.repository.getSettings());
            }
        } catch {
        }
    }
}
