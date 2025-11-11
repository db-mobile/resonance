/**
 * @fileoverview Repository for managing proxy configuration persistence
 * @module storage/ProxyRepository
 */

/**
 * Repository for managing proxy configuration persistence
 *
 * @class
 * @classdesc Handles CRUD operations for proxy settings with comprehensive validation
 * in electron-store. Supports HTTP, HTTPS, SOCKS4, and SOCKS5 proxies with optional
 * authentication, bypass lists, and timeout configuration. Implements defensive
 * programming with auto-initialization and sanitization for packaged app compatibility.
 */
export class ProxyRepository {
    /**
     * Creates a ProxyRepository instance
     *
     * @param {Object} electronAPI - The Electron IPC API bridge from preload script
     */
    constructor(electronAPI) {
        this.electronAPI = electronAPI;
        this.PROXY_KEY = 'proxySettings';
    }

    /**
     * Retrieves proxy settings with validation and initialization
     *
     * Automatically initializes storage with default settings if undefined (packaged
     * app first run). Validates structure and provides defaults for missing fields.
     *
     * @async
     * @returns {Promise<Object>} Complete proxy settings object
     * @returns {Promise<boolean>} return.enabled - Whether proxy is enabled
     * @returns {Promise<boolean>} return.useSystemProxy - Whether to use system proxy
     * @returns {Promise<string>} return.type - Proxy type (http, https, socks4, socks5)
     * @returns {Promise<string>} return.host - Proxy host
     * @returns {Promise<number>} return.port - Proxy port (1-65535)
     * @returns {Promise<Object>} return.auth - Authentication settings
     * @returns {Promise<Array<string>>} return.bypassList - Domains to bypass proxy
     * @returns {Promise<number>} return.timeout - Request timeout in milliseconds
     * @throws {Error} If storage access fails
     */
    async getProxySettings() {
        try {
            const data = await this.electronAPI.store.get(this.PROXY_KEY);

            if (!data || typeof data !== 'object') {
                console.warn('Proxy settings are invalid or undefined, initializing with defaults');
                const defaultData = this._getDefaultProxySettings();
                await this.electronAPI.store.set(this.PROXY_KEY, defaultData);
                return defaultData;
            }

            // Validate structure and provide defaults for missing fields
            const validatedData = {
                ...this._getDefaultProxySettings(),
                ...data
            };

            // Ensure auth object exists with proper structure
            if (!validatedData.auth || typeof validatedData.auth !== 'object') {
                validatedData.auth = this._getDefaultProxySettings().auth;
            } else {
                validatedData.auth = {
                    ...this._getDefaultProxySettings().auth,
                    ...validatedData.auth
                };
            }

            // Ensure bypassList is an array
            if (!Array.isArray(validatedData.bypassList)) {
                validatedData.bypassList = [];
            }

            return validatedData;
        } catch (error) {
            console.error('Error loading proxy settings:', error);
            throw new Error(`Failed to load proxy settings: ${error.message}`);
        }
    }

    /**
     * Saves proxy settings with validation
     *
     * Validates and sanitizes all settings before saving.
     *
     * @async
     * @param {Object} settings - Proxy settings object to save
     * @returns {Promise<Object>} The validated and saved settings
     * @throws {Error} If settings format invalid or save fails
     */
    async saveProxySettings(settings) {
        try {
            if (!settings || typeof settings !== 'object') {
                throw new Error('Invalid proxy settings format');
            }

            // Validate and sanitize settings
            const validatedSettings = this._validateSettings(settings);

            await this.electronAPI.store.set(this.PROXY_KEY, validatedSettings);
            return validatedSettings;
        } catch (error) {
            console.error('Error saving proxy settings:', error);
            throw new Error(`Failed to save proxy settings: ${error.message}`);
        }
    }

    /**
     * Updates specific proxy setting fields
     *
     * Merges updates with existing settings. Auth object is deep merged to preserve
     * sub-properties.
     *
     * @async
     * @param {Object} updates - Object with fields to update
     * @returns {Promise<Object>} The updated settings object
     * @throws {Error} If update or save fails
     */
    async updateProxySettings(updates) {
        try {
            const currentSettings = await this.getProxySettings();
            const updatedSettings = {
                ...currentSettings,
                ...updates
            };

            // If auth is being updated, merge with existing auth
            if (updates.auth) {
                updatedSettings.auth = {
                    ...currentSettings.auth,
                    ...updates.auth
                };
            }

            return await this.saveProxySettings(updatedSettings);
        } catch (error) {
            console.error('Error updating proxy settings:', error);
            throw new Error(`Failed to update proxy settings: ${error.message}`);
        }
    }

    /**
     * Resets proxy settings to defaults
     *
     * @async
     * @returns {Promise<Object>} The default settings object
     * @throws {Error} If reset fails
     */
    async resetToDefaults() {
        try {
            const defaultSettings = this._getDefaultProxySettings();
            await this.electronAPI.store.set(this.PROXY_KEY, defaultSettings);
            return defaultSettings;
        } catch (error) {
            console.error('Error resetting proxy settings:', error);
            throw new Error(`Failed to reset proxy settings: ${error.message}`);
        }
    }

    /**
     * Checks if proxy is currently enabled
     *
     * @async
     * @returns {Promise<boolean>} True if proxy is enabled
     */
    async isProxyEnabled() {
        try {
            const settings = await this.getProxySettings();
            return settings.enabled === true;
        } catch (error) {
            console.error('Error checking proxy enabled status:', error);
            return false;
        }
    }

    /**
     * Toggles proxy enabled state
     *
     * @async
     * @returns {Promise<boolean>} The new enabled state (true/false)
     * @throws {Error} If toggle operation fails
     */
    async toggleProxyEnabled() {
        try {
            const settings = await this.getProxySettings();
            settings.enabled = !settings.enabled;
            await this.saveProxySettings(settings);
            return settings.enabled;
        } catch (error) {
            console.error('Error toggling proxy:', error);
            throw new Error(`Failed to toggle proxy: ${error.message}`);
        }
    }

    /**
     * Validates and sanitizes proxy settings
     *
     * Ensures all fields have valid values, falling back to defaults for invalid data.
     *
     * @private
     * @param {Object} settings - Settings object to validate
     * @returns {Object} Validated and sanitized settings object
     */
    _validateSettings(settings) {
        const defaults = this._getDefaultProxySettings();

        return {
            enabled: typeof settings.enabled === 'boolean' ? settings.enabled : defaults.enabled,
            useSystemProxy: typeof settings.useSystemProxy === 'boolean' ? settings.useSystemProxy : defaults.useSystemProxy,
            type: this._validateProxyType(settings.type) ? settings.type : defaults.type,
            host: this._sanitizeHost(settings.host),
            port: this._validatePort(settings.port) ? settings.port : defaults.port,
            auth: {
                enabled: typeof settings.auth?.enabled === 'boolean'
                    ? settings.auth.enabled
                    : defaults.auth.enabled,
                username: typeof settings.auth?.username === 'string'
                    ? settings.auth.username.trim()
                    : defaults.auth.username,
                password: typeof settings.auth?.password === 'string'
                    ? settings.auth.password
                    : defaults.auth.password
            },
            bypassList: Array.isArray(settings.bypassList)
                ? settings.bypassList.filter(item => typeof item === 'string' && item.trim())
                : defaults.bypassList,
            timeout: this._validateTimeout(settings.timeout) ? settings.timeout : defaults.timeout
        };
    }

    /**
     * Validates proxy type
     *
     * @private
     * @param {string} type - Proxy type to validate
     * @returns {boolean} True if type is valid
     */
    _validateProxyType(type) {
        const validTypes = ['http', 'https', 'socks4', 'socks5'];
        return validTypes.includes(type);
    }

    /**
     * Validates port number
     *
     * @private
     * @param {number|string} port - Port number to validate
     * @returns {boolean} True if port is valid (1-65535)
     */
    _validatePort(port) {
        const portNum = parseInt(port, 10);
        return !isNaN(portNum) && portNum >= 1 && portNum <= 65535;
    }

    /**
     * Validates timeout value
     *
     * @private
     * @param {number|string} timeout - Timeout in milliseconds to validate
     * @returns {boolean} True if timeout is valid (0-300000ms)
     */
    _validateTimeout(timeout) {
        const timeoutNum = parseInt(timeout, 10);
        return !isNaN(timeoutNum) && timeoutNum >= 0 && timeoutNum <= 300000; // Max 5 minutes
    }

    /**
     * Sanitizes host string
     *
     * Removes protocol prefixes if present.
     *
     * @private
     * @param {string} host - Host string to sanitize
     * @returns {string} Sanitized host string
     */
    _sanitizeHost(host) {
        if (typeof host !== 'string') {return '';}
        // Remove protocol if present
        return host.replace(/^(https?|socks[45]?):\/\//, '').trim();
    }

    /**
     * Creates the default proxy settings structure
     *
     * @private
     * @returns {Object} Default proxy settings object
     */
    _getDefaultProxySettings() {
        return {
            enabled: false,
            useSystemProxy: false,
            type: 'http',
            host: '',
            port: 8080,
            auth: {
                enabled: false,
                username: '',
                password: ''
            },
            bypassList: [],
            timeout: 10000
        };
    }
}
