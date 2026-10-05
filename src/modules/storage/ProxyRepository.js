/**
 * @fileoverview Repository for managing proxy configuration persistence
 * @module storage/ProxyRepository
 */

import { isValidProxyType, isValidPort, isValidTimeout } from '../utils/proxyValidation.js';

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
     * @param {Object} settings
     * @returns {Object}
     */
    _validateSettings(settings) {
        const defaults = this._getDefaultProxySettings();

        return {
            enabled: typeof settings.enabled === 'boolean' ? settings.enabled : defaults.enabled,
            useSystemProxy: typeof settings.useSystemProxy === 'boolean' ? settings.useSystemProxy : defaults.useSystemProxy,
            type: isValidProxyType(settings.type) ? settings.type : defaults.type,
            host: this._sanitizeHost(settings.host),
            port: isValidPort(settings.port)
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
            timeout: isValidTimeout(settings.timeout)
                ? Number.parseInt(settings.timeout, 10)
                : defaults.timeout
        };
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
