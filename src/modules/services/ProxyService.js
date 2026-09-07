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

        const updatedSettings = await this.repository.saveProxySettings(settings);

        this._notifyListeners({
            type: 'proxy-settings-updated',
            settings: updatedSettings
        });

        return updatedSettings;
    }

    async resetToDefaults() {
        const defaultSettings = await this.repository.resetToDefaults();

        this._notifyListeners({
            type: 'proxy-settings-reset',
            settings: defaultSettings
        });

        return defaultSettings;
    }

    async isEnabled() {
        try {
            return await this.repository.isProxyEnabled();
        } catch (error) {
            return false;
        }
    }

    shouldBypassProxy(url, bypassList) {
        if (!url || !Array.isArray(bypassList) || bypassList.length === 0) {
            return false;
        }

        try {
            const urlObj = new URL(url);
            const {hostname} = urlObj;

            return bypassList.some(pattern => {
                const cleanPattern = pattern.trim();
                if (!cleanPattern) {return false;}

                if (cleanPattern === hostname) {return true;}

                if (cleanPattern.startsWith('*.')) {
                    const domain = cleanPattern.substring(2);
                    return hostname.endsWith(domain);
                }

                if (cleanPattern.startsWith('.')) {
                    return hostname.endsWith(cleanPattern);
                }

                return false;
            });
        } catch (error) {
            return false;
        }
    }

    async getAxiosProxyConfig(requestUrl) {
        try {
            const settings = await this.repository.getProxySettings();

            if (!settings.enabled) {
                return null;
            }

            if (this.shouldBypassProxy(requestUrl, settings.bypassList)) {
                return null;
            }

            const proxyConfig = {
                protocol: settings.type,
                host: settings.host,
                port: settings.port
            };

            if (settings.auth.enabled && settings.auth.username) {
                proxyConfig.auth = {
                    username: settings.auth.username,
                    password: settings.auth.password || ''
                };
            }

            return proxyConfig;
        } catch (error) {
            return null;
        }
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
