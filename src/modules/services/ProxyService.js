/**
 * @fileoverview Service for managing proxy configuration business logic
 * @module services/ProxyService
 */

export class ProxyService {
    /**
     * @param {ProxyRepository} proxyRepository
     * @param {IStatusDisplay} statusDisplay
     */
    constructor(proxyRepository, statusDisplay) {
        this.repository = proxyRepository;
        this.statusDisplay = statusDisplay;
    }

    /** @returns {Promise<Object>} */
    async getSettings() {
        return this.repository.getProxySettings();
    }

    /**
     * @param {Object} settings
     * @param {boolean} [settings.enabled]
     * @param {string} [settings.type]
     * @param {string} [settings.host]
     * @param {number} [settings.port]
     * @param {Object} [settings.auth]
     * @param {boolean} [settings.auth.enabled]
     * @param {string} [settings.auth.username]
     * @param {string} [settings.auth.password]
     * @param {Array<string>} [settings.bypassList]
     * @param {number} [settings.timeout]
     * @returns {Promise<Object>}
     */
    async updateSettings(settings) {
        const validationErrors = this.validateSettings(settings);
        if (validationErrors.length > 0) {
            throw new Error(validationErrors.join('; '));
        }

        return this.repository.saveProxySettings(settings);
    }

    validateSettings(settings) {
        const errors = [];

        if (!settings || typeof settings !== 'object') {
            errors.push('Invalid settings format');
            return errors;
        }

        if (settings.type && !this.isValidProxyType(settings.type)) {
            errors.push('Invalid proxy type. Must be: http, https, socks4, or socks5');
        }

        if (settings.enabled && !settings.useSystemProxy && settings.host) {
            if (typeof settings.host !== 'string') {
                errors.push('Invalid proxy host format');
            } else if (settings.host.trim() !== '' && !this.isValidHost(settings.host)) {
                errors.push('Invalid proxy host format');
            }
        }

        if (settings.port !== undefined && !this.isValidPort(settings.port)) {
            errors.push('Invalid port number. Must be between 1 and 65535');
        }

        if (settings.auth?.enabled) {
            if (!settings.auth.username || settings.auth.username.trim() === '') {
                errors.push('Username is required when proxy authentication is enabled');
            }
        }

        if (settings.bypassList && !Array.isArray(settings.bypassList)) {
            errors.push('Bypass list must be an array');
        }

        if (settings.timeout !== undefined && !this.isValidTimeout(settings.timeout)) {
            errors.push('Invalid timeout. Must be between 0 and 300000ms (5 minutes)');
        }

        return errors;
    }

    isValidProxyType(type) {
        const validTypes = ['http', 'https', 'socks4', 'socks5'];
        return validTypes.includes(type);
    }

    isValidHost(host) {
        if (!host || typeof host !== 'string') {return false;}

        const trimmed = host.trim();
        if (trimmed.length === 0) {return false;}

        const cleanHost = trimmed.replace(/^(https?|socks[45]?):\/\//, '');

        const ipv4Pattern = /^(\d{1,3}\.){3}\d{1,3}$/;
        const hostnamePattern = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

        return ipv4Pattern.test(cleanHost) || hostnamePattern.test(cleanHost);
    }

    isValidPort(port) {
        const portNum = parseInt(port, 10);
        return !isNaN(portNum) && portNum >= 1 && portNum <= 65535;
    }

    isValidTimeout(timeout) {
        const timeoutNum = parseInt(timeout, 10);
        return !isNaN(timeoutNum) && timeoutNum >= 0 && timeoutNum <= 300000;
    }

}
