/**
 * @fileoverview Repository for managing mock server configuration persistence
 * @module storage/MockServerRepository
 */

export class MockServerRepository {
    /** @param {Object} backendAPI */
    constructor(backendAPI) {
        this.backendAPI = backendAPI;
        this.SETTINGS_KEY = 'mockServer';
    }

    /** @returns {Promise<Object>} */
    async getSettings() {
        try {
            const data = await this.backendAPI.store.get(this.SETTINGS_KEY);

            if (!data || typeof data !== 'object') {
                const defaultData = this._getDefaultSettings();
                await this.backendAPI.store.set(this.SETTINGS_KEY, defaultData);
                return defaultData;
            }

            const validatedData = {
                ...this._getDefaultSettings(),
                ...data
            };

            if (!Array.isArray(validatedData.enabledCollections)) {
                validatedData.enabledCollections = [];
            }

            if (!validatedData.endpointDelays || typeof validatedData.endpointDelays !== 'object') {
                validatedData.endpointDelays = {};
            }

            if (!validatedData.customResponses || typeof validatedData.customResponses !== 'object') {
                validatedData.customResponses = {};
            }

            if (!validatedData.customStatusCodes || typeof validatedData.customStatusCodes !== 'object') {
                validatedData.customStatusCodes = {};
            }

            return validatedData;
        } catch (error) {
            throw new Error(`Failed to load mock server settings: ${error.message}`, { cause: error });
        }
    }

    /**
     * @param {Object} settings
     * @returns {Promise<Object>}
     */
    async saveSettings(settings) {
        try {
            if (!settings || typeof settings !== 'object') {
                throw new Error('Invalid mock server settings format');
            }

            const validatedSettings = this._validateSettings(settings);

            await this.backendAPI.store.set(this.SETTINGS_KEY, validatedSettings);
            return validatedSettings;
        } catch (error) {
            throw new Error(`Failed to save mock server settings: ${error.message}`, { cause: error });
        }
    }

    /**
     * @param {Object} updates
     * @returns {Promise<Object>}
     */
    async updateSettings(updates) {
        try {
            const currentSettings = await this.getSettings();
            const updatedSettings = {
                ...currentSettings,
                ...updates
            };

            if (updates.endpointDelays) {
                updatedSettings.endpointDelays = {
                    ...currentSettings.endpointDelays,
                    ...updates.endpointDelays
                };
            }

            if (updates.customResponses) {
                updatedSettings.customResponses = {
                    ...currentSettings.customResponses,
                    ...updates.customResponses
                };
            }

            if (updates.customStatusCodes) {
                updatedSettings.customStatusCodes = {
                    ...currentSettings.customStatusCodes,
                    ...updates.customStatusCodes
                };
            }

            return await this.saveSettings(updatedSettings);
        } catch (error) {
            throw new Error(`Failed to update mock server settings: ${error.message}`, { cause: error });
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
            if (!this._validateDelay(delayMs)) {
                throw new Error('Delay must be between 0 and 30000 milliseconds');
            }

            const settings = await this.getSettings();
            const key = `${collectionId}_${endpointId}`;

            if (delayMs === 0) {
                delete settings.endpointDelays[key];
            } else {
                settings.endpointDelays[key] = delayMs;
            }

            return await this.saveSettings(settings);
        } catch (error) {
            throw new Error(`Failed to set endpoint delay: ${error.message}`, { cause: error });
        }
    }

    /**
     * @param {string} collectionId
     * @param {string} endpointId
     * @returns {Promise<number>}
     */
    async getEndpointDelay(collectionId, endpointId) {
        try {
            const settings = await this.getSettings();
            const key = `${collectionId}_${endpointId}`;
            return settings.endpointDelays[key] || 0;
        } catch (error) {
            return 0;
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
            const settings = await this.getSettings();
            const key = `${collectionId}_${endpointId}`;

            if (response === null) {
                delete settings.customResponses[key];
            } else {
                settings.customResponses[key] = response;
            }

            return await this.saveSettings(settings);
        } catch (error) {
            throw new Error(`Failed to set custom response: ${error.message}`, { cause: error });
        }
    }

    /**
     * @param {string} collectionId
     * @param {string} endpointId
     * @returns {Promise<Object|null>}
     */
    async getCustomResponse(collectionId, endpointId) {
        try {
            const settings = await this.getSettings();
            const key = `${collectionId}_${endpointId}`;
            return settings.customResponses[key] || null;
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
        try {
            const settings = await this.getSettings();
            const key = `${collectionId}_${endpointId}`;

            if (statusCode === null) {
                delete settings.customStatusCodes[key];
            } else {
                settings.customStatusCodes[key] = statusCode;
            }

            return await this.saveSettings(settings);
        } catch (error) {
            throw new Error(`Failed to set custom status code: ${error.message}`, { cause: error });
        }
    }

    /**
     * @param {string} collectionId
     * @param {string} endpointId
     * @returns {Promise<number|null>}
     */
    async getCustomStatusCode(collectionId, endpointId) {
        try {
            const settings = await this.getSettings();
            const key = `${collectionId}_${endpointId}`;
            return settings.customStatusCodes[key] || null;
        } catch (error) {
            return null;
        }
    }

    /**
     * @param {string} collectionId
     * @returns {Promise<Object>}
     */
    async toggleCollectionEnabled(collectionId) {
        try {
            const settings = await this.getSettings();
            const index = settings.enabledCollections.indexOf(collectionId);

            if (index === -1) {
                settings.enabledCollections.push(collectionId);
            } else {
                settings.enabledCollections.splice(index, 1);
            }

            return await this.saveSettings(settings);
        } catch (error) {
            throw new Error(`Failed to toggle collection: ${error.message}`, { cause: error });
        }
    }

    /**
     * @param {string} collectionId
     * @returns {Promise<boolean>}
     */
    async isCollectionEnabled(collectionId) {
        try {
            const settings = await this.getSettings();
            return settings.enabledCollections.includes(collectionId);
        } catch (error) {
            return false;
        }
    }

    /** @returns {Promise<Object>} */
    async resetToDefaults() {
        try {
            const defaultSettings = this._getDefaultSettings();
            await this.backendAPI.store.set(this.SETTINGS_KEY, defaultSettings);
            return defaultSettings;
        } catch (error) {
            throw new Error(`Failed to reset mock server settings: ${error.message}`, { cause: error });
        }
    }

    /**
     * @param {Object} settings
     * @returns {Object}
     */
    _validateSettings(settings) {
        const defaults = this._getDefaultSettings();

        return {
            port: this._validatePort(settings.port) ? settings.port : defaults.port,
            enabledCollections: Array.isArray(settings.enabledCollections)
                ? settings.enabledCollections.filter(id => typeof id === 'string' && id.trim())
                : defaults.enabledCollections,
            endpointDelays: this._validateEndpointDelays(settings.endpointDelays),
            customResponses: this._validateCustomResponses(settings.customResponses),
            customStatusCodes: this._validateCustomStatusCodes(settings.customStatusCodes)
        };
    }

    /**
     * @param {number|string} port
     * @returns {boolean}
     */
    _validatePort(port) {
        const portNum = parseInt(port, 10);
        return !isNaN(portNum) && portNum >= 1024 && portNum <= 65535;
    }

    /**
     * @param {number|string} delay
     * @returns {boolean}
     */
    _validateDelay(delay) {
        const delayNum = parseInt(delay, 10);
        return !isNaN(delayNum) && delayNum >= 0 && delayNum <= 30000;
    }

    /**
     * @param {Object} delays
     * @returns {Object}
     */
    _validateEndpointDelays(delays) {
        if (!delays || typeof delays !== 'object') {
            return {};
        }

        const validatedDelays = {};
        for (const [key, value] of Object.entries(delays)) {
            if (typeof key === 'string' && this._validateDelay(value)) {
                validatedDelays[key] = parseInt(value, 10);
            }
        }

        return validatedDelays;
    }

    /**
     * @param {Object} responses
     * @returns {Object}
     */
    _validateCustomResponses(responses) {
        if (!responses || typeof responses !== 'object') {
            return {};
        }

        const validatedResponses = {};
        for (const [key, value] of Object.entries(responses)) {
            if (typeof key === 'string' && (typeof value === 'object' || typeof value === 'string')) {
                validatedResponses[key] = value;
            }
        }

        return validatedResponses;
    }

    /**
     * @param {Object} statusCodes
     * @returns {Object}
     */
    _validateCustomStatusCodes(statusCodes) {
        if (!statusCodes || typeof statusCodes !== 'object') {
            return {};
        }

        const validatedStatusCodes = {};
        for (const [key, value] of Object.entries(statusCodes)) {
            if (typeof key === 'string' && this._validateStatusCode(value)) {
                validatedStatusCodes[key] = parseInt(value, 10);
            }
        }

        return validatedStatusCodes;
    }

    /**
     * @param {number|string} statusCode
     * @returns {boolean}
     */
    _validateStatusCode(statusCode) {
        const code = parseInt(statusCode, 10);
        return !isNaN(code) && code >= 100 && code <= 599;
    }

    /** @returns {Object} */
    _getDefaultSettings() {
        return {
            port: 3000,
            enabledCollections: [],
            endpointDelays: {},
            customResponses: {},
            customStatusCodes: {}
        };
    }
}
