/**
 * @fileoverview Repository for managing mock server configuration persistence
 * @module storage/MockServerRepository
 */

/**
 * Repository for managing mock server configuration persistence
 *
 * @class
 * @classdesc Handles CRUD operations for mock server settings with comprehensive validation
 * in electron-store. Supports port configuration, enabled collections, and per-endpoint delays.
 * Implements defensive programming with auto-initialization for packaged app compatibility.
 */
export class MockServerRepository {
    /**
     * Creates a MockServerRepository instance
     *
     * @param {Object} electronAPI - The Electron IPC API bridge from preload script
     */
    constructor(electronAPI) {
        this.electronAPI = electronAPI;
        this.SETTINGS_KEY = 'mockServer';
    }

    /**
     * Retrieves mock server settings with validation and initialization
     *
     * Automatically initializes storage with default settings if undefined (packaged
     * app first run). Validates structure and provides defaults for missing fields.
     *
     * @async
     * @returns {Promise<Object>} Complete mock server settings object
     * @returns {Promise<number>} return.port - Server port (1024-65535)
     * @returns {Promise<Array<string>>} return.enabledCollections - Array of enabled collection IDs
     * @returns {Promise<Object>} return.endpointDelays - Per-endpoint delays in milliseconds
     * @returns {Promise<Object>} return.customResponses - Per-endpoint custom response bodies
     * @throws {Error} If storage access fails
     */
    async getSettings() {
        try {
            const data = await this.electronAPI.store.get(this.SETTINGS_KEY);

            if (!data || typeof data !== 'object') {
                console.warn('Mock server settings are invalid or undefined, initializing with defaults');
                const defaultData = this._getDefaultSettings();
                await this.electronAPI.store.set(this.SETTINGS_KEY, defaultData);
                return defaultData;
            }

            // Validate structure and provide defaults for missing fields
            const validatedData = {
                ...this._getDefaultSettings(),
                ...data
            };

            // Ensure enabledCollections is an array
            if (!Array.isArray(validatedData.enabledCollections)) {
                validatedData.enabledCollections = [];
            }

            // Ensure endpointDelays is an object
            if (!validatedData.endpointDelays || typeof validatedData.endpointDelays !== 'object') {
                validatedData.endpointDelays = {};
            }

            // Ensure customResponses is an object
            if (!validatedData.customResponses || typeof validatedData.customResponses !== 'object') {
                validatedData.customResponses = {};
            }

            return validatedData;
        } catch (error) {
            console.error('Error loading mock server settings:', error);
            throw new Error(`Failed to load mock server settings: ${error.message}`);
        }
    }

    /**
     * Saves mock server settings with validation
     *
     * Validates and sanitizes all settings before saving.
     *
     * @async
     * @param {Object} settings - Mock server settings object to save
     * @returns {Promise<Object>} The validated and saved settings
     * @throws {Error} If settings format invalid or save fails
     */
    async saveSettings(settings) {
        try {
            if (!settings || typeof settings !== 'object') {
                throw new Error('Invalid mock server settings format');
            }

            // Validate and sanitize settings
            const validatedSettings = this._validateSettings(settings);

            await this.electronAPI.store.set(this.SETTINGS_KEY, validatedSettings);
            return validatedSettings;
        } catch (error) {
            console.error('Error saving mock server settings:', error);
            throw new Error(`Failed to save mock server settings: ${error.message}`);
        }
    }

    /**
     * Updates specific mock server setting fields
     *
     * Merges updates with existing settings. EndpointDelays object is merged to preserve
     * existing delays.
     *
     * @async
     * @param {Object} updates - Object with fields to update
     * @returns {Promise<Object>} The updated settings object
     * @throws {Error} If update or save fails
     */
    async updateSettings(updates) {
        try {
            const currentSettings = await this.getSettings();
            const updatedSettings = {
                ...currentSettings,
                ...updates
            };

            // If endpointDelays is being updated, merge with existing
            if (updates.endpointDelays) {
                updatedSettings.endpointDelays = {
                    ...currentSettings.endpointDelays,
                    ...updates.endpointDelays
                };
            }

            // If customResponses is being updated, merge with existing
            if (updates.customResponses) {
                updatedSettings.customResponses = {
                    ...currentSettings.customResponses,
                    ...updates.customResponses
                };
            }

            return await this.saveSettings(updatedSettings);
        } catch (error) {
            console.error('Error updating mock server settings:', error);
            throw new Error(`Failed to update mock server settings: ${error.message}`);
        }
    }

    /**
     * Sets delay for a specific endpoint
     *
     * @async
     * @param {string} collectionId - Collection ID
     * @param {string} endpointId - Endpoint ID
     * @param {number} delayMs - Delay in milliseconds (0-30000)
     * @returns {Promise<Object>} The updated settings object
     * @throws {Error} If delay is invalid or save fails
     */
    async setEndpointDelay(collectionId, endpointId, delayMs) {
        try {
            if (!this._validateDelay(delayMs)) {
                throw new Error('Delay must be between 0 and 30000 milliseconds');
            }

            const settings = await this.getSettings();
            const key = `${collectionId}_${endpointId}`;

            if (delayMs === 0) {
                // Remove delay entry if set to 0
                delete settings.endpointDelays[key];
            } else {
                settings.endpointDelays[key] = delayMs;
            }

            return await this.saveSettings(settings);
        } catch (error) {
            console.error('Error setting endpoint delay:', error);
            throw new Error(`Failed to set endpoint delay: ${error.message}`);
        }
    }

    /**
     * Gets delay for a specific endpoint
     *
     * @async
     * @param {string} collectionId - Collection ID
     * @param {string} endpointId - Endpoint ID
     * @returns {Promise<number>} Delay in milliseconds (0 if not set)
     */
    async getEndpointDelay(collectionId, endpointId) {
        try {
            const settings = await this.getSettings();
            const key = `${collectionId}_${endpointId}`;
            return settings.endpointDelays[key] || 0;
        } catch (error) {
            console.error('Error getting endpoint delay:', error);
            return 0;
        }
    }

    /**
     * Sets custom response for a specific endpoint
     *
     * @async
     * @param {string} collectionId - Collection ID
     * @param {string} endpointId - Endpoint ID
     * @param {Object|null} response - Custom response body (null to reset to default)
     * @returns {Promise<Object>} The updated settings object
     * @throws {Error} If save fails
     */
    async setCustomResponse(collectionId, endpointId, response) {
        try {
            const settings = await this.getSettings();
            const key = `${collectionId}_${endpointId}`;

            if (response === null) {
                // Remove custom response entry to use default
                delete settings.customResponses[key];
            } else {
                settings.customResponses[key] = response;
            }

            return await this.saveSettings(settings);
        } catch (error) {
            console.error('Error setting custom response:', error);
            throw new Error(`Failed to set custom response: ${error.message}`);
        }
    }

    /**
     * Gets custom response for a specific endpoint
     *
     * @async
     * @param {string} collectionId - Collection ID
     * @param {string} endpointId - Endpoint ID
     * @returns {Promise<Object|null>} Custom response body or null if using default
     */
    async getCustomResponse(collectionId, endpointId) {
        try {
            const settings = await this.getSettings();
            const key = `${collectionId}_${endpointId}`;
            return settings.customResponses[key] || null;
        } catch (error) {
            console.error('Error getting custom response:', error);
            return null;
        }
    }

    /**
     * Toggles collection enabled state
     *
     * @async
     * @param {string} collectionId - Collection ID to toggle
     * @returns {Promise<Object>} Updated settings with new enabled state
     * @throws {Error} If toggle operation fails
     */
    async toggleCollectionEnabled(collectionId) {
        try {
            const settings = await this.getSettings();
            const index = settings.enabledCollections.indexOf(collectionId);

            if (index === -1) {
                // Enable collection
                settings.enabledCollections.push(collectionId);
            } else {
                // Disable collection
                settings.enabledCollections.splice(index, 1);
            }

            return await this.saveSettings(settings);
        } catch (error) {
            console.error('Error toggling collection:', error);
            throw new Error(`Failed to toggle collection: ${error.message}`);
        }
    }

    /**
     * Checks if a collection is enabled
     *
     * @async
     * @param {string} collectionId - Collection ID to check
     * @returns {Promise<boolean>} True if collection is enabled
     */
    async isCollectionEnabled(collectionId) {
        try {
            const settings = await this.getSettings();
            return settings.enabledCollections.includes(collectionId);
        } catch (error) {
            console.error('Error checking collection enabled status:', error);
            return false;
        }
    }

    /**
     * Resets mock server settings to defaults
     *
     * @async
     * @returns {Promise<Object>} The default settings object
     * @throws {Error} If reset fails
     */
    async resetToDefaults() {
        try {
            const defaultSettings = this._getDefaultSettings();
            await this.electronAPI.store.set(this.SETTINGS_KEY, defaultSettings);
            return defaultSettings;
        } catch (error) {
            console.error('Error resetting mock server settings:', error);
            throw new Error(`Failed to reset mock server settings: ${error.message}`);
        }
    }

    /**
     * Validates and sanitizes mock server settings
     *
     * Ensures all fields have valid values, falling back to defaults for invalid data.
     *
     * @private
     * @param {Object} settings - Settings object to validate
     * @returns {Object} Validated and sanitized settings object
     */
    _validateSettings(settings) {
        const defaults = this._getDefaultSettings();

        return {
            port: this._validatePort(settings.port) ? settings.port : defaults.port,
            enabledCollections: Array.isArray(settings.enabledCollections)
                ? settings.enabledCollections.filter(id => typeof id === 'string' && id.trim())
                : defaults.enabledCollections,
            endpointDelays: this._validateEndpointDelays(settings.endpointDelays),
            customResponses: this._validateCustomResponses(settings.customResponses)
        };
    }

    /**
     * Validates port number
     *
     * @private
     * @param {number|string} port - Port number to validate
     * @returns {boolean} True if port is valid (1024-65535, avoiding system ports)
     */
    _validatePort(port) {
        const portNum = parseInt(port, 10);
        return !isNaN(portNum) && portNum >= 1024 && portNum <= 65535;
    }

    /**
     * Validates delay value
     *
     * @private
     * @param {number|string} delay - Delay in milliseconds to validate
     * @returns {boolean} True if delay is valid (0-30000ms)
     */
    _validateDelay(delay) {
        const delayNum = parseInt(delay, 10);
        return !isNaN(delayNum) && delayNum >= 0 && delayNum <= 30000;
    }

    /**
     * Validates and sanitizes endpoint delays object
     *
     * @private
     * @param {Object} delays - Endpoint delays object to validate
     * @returns {Object} Validated endpoint delays object
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
     * Validates and sanitizes custom responses object
     *
     * @private
     * @param {Object} responses - Custom responses object to validate
     * @returns {Object} Validated custom responses object
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
     * Creates the default mock server settings structure
     *
     * @private
     * @returns {Object} Default mock server settings object
     */
    _getDefaultSettings() {
        return {
            port: 3000,
            enabledCollections: [],
            endpointDelays: {},
            customResponses: {}
        };
    }
}
