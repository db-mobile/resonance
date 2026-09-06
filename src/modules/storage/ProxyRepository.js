/**
 * @fileoverview Repository for managing proxy configuration persistence
 * @module storage/ProxyRepository
 */

export class ProxyRepository {
    /** @param {Object} backendAPI */
    constructor(backendAPI) {
        this.backendAPI = backendAPI;
        this.PROXY_KEY = 'proxySettings';
    }

    /** @returns {Promise<Object>} */
    async getProxySettings() {
        try {
            const data = await this.backendAPI.store.get(this.PROXY_KEY);

            if (!data || typeof data !== 'object') {
                return await this.saveProxySettings(this._getDefaultProxySettings());
            }

            const validatedData = {
                ...this._getDefaultProxySettings(),
                ...data
            };

            if (!validatedData.auth || typeof validatedData.auth !== 'object') {
                validatedData.auth = this._getDefaultProxySettings().auth;
            } else {
                validatedData.auth = {
                    ...this._getDefaultProxySettings().auth,
                    ...validatedData.auth
                };
            }

            if (!Array.isArray(validatedData.bypassList)) {
                validatedData.bypassList = [];
            }

            return validatedData;
        } catch (error) {
            throw new Error(`Failed to load proxy settings: ${error.message}`, { cause: error });
        }
    }

    /**
     * @param {Object} settings
     * @returns {Promise<Object>}
     */
    async saveProxySettings(settings) {
        try {
            if (!settings || typeof settings !== 'object') {
                throw new Error('Invalid proxy settings format');
            }

            const validatedSettings = this._validateSettings(settings);

            await this.backendAPI.proxySettings.set(validatedSettings);
            return validatedSettings;
        } catch (error) {
            throw new Error(`Failed to save proxy settings: ${error.message}`, { cause: error });
        }
    }

    /**
     * @param {Object} updates
     * @returns {Promise<Object>}
     */
    async updateProxySettings(updates) {
        try {
            const currentSettings = await this.getProxySettings();
            const updatedSettings = {
                ...currentSettings,
                ...updates
            };

            if (updates.auth) {
                updatedSettings.auth = {
                    ...currentSettings.auth,
                    ...updates.auth
                };
            }

            return await this.saveProxySettings(updatedSettings);
        } catch (error) {
            throw new Error(`Failed to update proxy settings: ${error.message}`, { cause: error });
        }
    }

    /** @returns {Promise<Object>} */
    async resetToDefaults() {
        try {
            return await this.saveProxySettings(this._getDefaultProxySettings());
        } catch (error) {
            throw new Error(`Failed to reset proxy settings: ${error.message}`, { cause: error });
        }
    }

    /** @returns {Promise<boolean>} */
    async isProxyEnabled() {
        try {
            const settings = await this.getProxySettings();
            return settings.enabled === true;
        } catch (error) {
            return false;
        }
    }

    /**
     * @param {Object} settings
     * @returns {Object}
     */
    _validateSettings(settings) {
        const defaults = this._getDefaultProxySettings();

        return {
            enabled: typeof settings.enabled === 'boolean' ? settings.enabled : defaults.enabled,
            useSystemProxy: typeof settings.useSystemProxy === 'boolean' ? settings.useSystemProxy : defaults.useSystemProxy,
            type: this._validateProxyType(settings.type) ? settings.type : defaults.type,
            host: this._sanitizeHost(settings.host),
            port: this._validatePort(settings.port)
                ? Number.parseInt(settings.port, 10)
                : defaults.port,
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
            timeout: this._validateTimeout(settings.timeout)
                ? Number.parseInt(settings.timeout, 10)
                : defaults.timeout
        };
    }

    /**
     * @param {string} type
     * @returns {boolean}
     */
    _validateProxyType(type) {
        const validTypes = ['http', 'https', 'socks4', 'socks5'];
        return validTypes.includes(type);
    }

    /**
     * @param {number|string} port
     * @returns {boolean}
     */
    _validatePort(port) {
        const portNum = parseInt(port, 10);
        return !isNaN(portNum) && portNum >= 1 && portNum <= 65535;
    }

    /**
     * @param {number|string} timeout
     * @returns {boolean}
     */
    _validateTimeout(timeout) {
        const timeoutNum = parseInt(timeout, 10);
        return !isNaN(timeoutNum) && timeoutNum >= 0 && timeoutNum <= 300000;
    }

    /**
     * @param {string} host
     * @returns {string}
     */
    _sanitizeHost(host) {
        if (typeof host !== 'string') {return '';}
        return host.replace(/^(https?|socks[45]?):\/\//, '').trim();
    }

    /** @returns {Object} */
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
