/**
 * @fileoverview Service for managing proxy configuration business logic
 * @module services/ProxyService
 */

/**
 * Service for managing proxy configuration business logic
 *
 * @class
 * @classdesc Provides high-level proxy operations with comprehensive validation,
 * error handling, and event notifications. Manages HTTP/HTTPS/SOCKS proxy settings,
 * authentication, bypass lists, and timeout configuration. Implements observer pattern
 * for proxy configuration change notifications and provides axios-compatible
 * proxy configuration generation.
 *
 * Event types emitted:
 * - 'proxy-settings-updated': When proxy settings are modified
 * - 'proxy-toggled': When proxy is enabled/disabled
 * - 'proxy-settings-reset': When settings are reset to defaults
 */
export class ProxyService {
    /**
     * Creates a ProxyService instance
     *
     * @param {ProxyRepository} proxyRepository - Data access layer for proxy settings
     * @param {IStatusDisplay} statusDisplay - Status display interface
     */
    constructor(proxyRepository, statusDisplay) {
        this.repository = proxyRepository;
        this.statusDisplay = statusDisplay;
        this.listeners = new Set();
    }

    /**
     * Registers a listener for proxy configuration changes
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
     * Notifies all listeners of proxy configuration change
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
                console.error('Error in proxy change listener:', error);
            }
        });
    }

    /**
     * Gets current proxy settings
     *
     * @async
     * @returns {Promise<Object>} Proxy settings object
     * @throws {Error} If retrieval fails
     */
    async getSettings() {
        try {
            return await this.repository.getProxySettings();
        } catch (error) {
            console.error('Error getting proxy settings:', error);
            throw error;
        }
    }

    /**
     * Updates proxy settings with comprehensive validation
     *
     * Validates all settings before saving and notifies listeners of changes.
     *
     * @async
     * @param {Object} settings - Proxy settings object
     * @param {boolean} [settings.enabled] - Whether proxy is enabled
     * @param {string} [settings.type] - Proxy type (http, https, socks4, socks5)
     * @param {string} [settings.host] - Proxy host
     * @param {number} [settings.port] - Proxy port (1-65535)
     * @param {Object} [settings.auth] - Authentication settings
     * @param {boolean} [settings.auth.enabled] - Whether auth is enabled
     * @param {string} [settings.auth.username] - Username for auth
     * @param {string} [settings.auth.password] - Password for auth
     * @param {Array<string>} [settings.bypassList] - Domains to bypass proxy
     * @param {number} [settings.timeout] - Proxy timeout in ms
     * @returns {Promise<Object>} Updated proxy settings
     * @throws {Error} If validation fails or update fails
     * @fires ProxyService#proxy-settings-updated
     */
    async updateSettings(settings) {
        try {
            // Validate settings
            const validationErrors = this.validateSettings(settings);
            if (validationErrors.length > 0) {
                const errorMessage = validationErrors.join('; ');
                throw new Error(errorMessage);
            }

            const updatedSettings = await this.repository.saveProxySettings(settings);

            const statusMessage = settings.enabled
                ? `Proxy enabled: ${settings.type}://${settings.host}:${settings.port}`
                : 'Proxy disabled';

            this.statusDisplay.update(statusMessage, null);

            this._notifyListeners({
                type: 'proxy-settings-updated',
                settings: updatedSettings
            });

            return updatedSettings;
        } catch (error) {
            this.statusDisplay.update(`Error updating proxy settings: ${error.message}`, null);
            throw error;
        }
    }

    /**
     * Toggles proxy enabled/disabled state
     *
     * @async
     * @returns {Promise<boolean>} New enabled state
     * @throws {Error} If toggle fails
     * @fires ProxyService#proxy-toggled
     */
    async toggleProxy() {
        try {
            const enabled = await this.repository.toggleProxyEnabled();
            const settings = await this.repository.getProxySettings();

            const statusMessage = enabled
                ? `Proxy enabled: ${settings.type}://${settings.host}:${settings.port}`
                : 'Proxy disabled';

            this.statusDisplay.update(statusMessage, null);

            this._notifyListeners({
                type: 'proxy-toggled',
                enabled: enabled
            });

            return enabled;
        } catch (error) {
            this.statusDisplay.update(`Error toggling proxy: ${error.message}`, null);
            throw error;
        }
    }

    /**
     * Reset proxy settings to defaults
     */
    async resetToDefaults() {
        try {
            const defaultSettings = await this.repository.resetToDefaults();

            this.statusDisplay.update('Proxy settings reset to defaults', null);

            this._notifyListeners({
                type: 'proxy-settings-reset',
                settings: defaultSettings
            });

            return defaultSettings;
        } catch (error) {
            this.statusDisplay.update(`Error resetting proxy settings: ${error.message}`, null);
            throw error;
        }
    }

    /**
     * Check if proxy is enabled
     */
    async isEnabled() {
        try {
            return await this.repository.isProxyEnabled();
        } catch (error) {
            console.error('Error checking proxy enabled status:', error);
            return false;
        }
    }

    /**
     * Check if URL should bypass proxy
     */
    shouldBypassProxy(url, bypassList) {
        if (!url || !Array.isArray(bypassList) || bypassList.length === 0) {
            return false;
        }

        try {
            const urlObj = new URL(url);
            const {hostname} = urlObj;

            return bypassList.some(pattern => {
                // Remove whitespace
                const cleanPattern = pattern.trim();
                if (!cleanPattern) {return false;}

                // Exact match
                if (cleanPattern === hostname) {return true;}

                // Wildcard match (*.example.com)
                if (cleanPattern.startsWith('*.')) {
                    const domain = cleanPattern.substring(2);
                    return hostname.endsWith(domain);
                }

                // Suffix match (.example.com matches subdomain.example.com)
                if (cleanPattern.startsWith('.')) {
                    return hostname.endsWith(cleanPattern);
                }

                return false;
            });
        } catch (error) {
            console.error('Error checking bypass list:', error);
            return false;
        }
    }

    /**
     * Get axios-compatible proxy configuration
     */
    async getAxiosProxyConfig(requestUrl) {
        try {
            const settings = await this.repository.getProxySettings();

            // If proxy is disabled, return null
            if (!settings.enabled) {
                return null;
            }

            // Check if URL should bypass proxy
            if (this.shouldBypassProxy(requestUrl, settings.bypassList)) {
                return null;
            }

            // Build proxy config
            const proxyConfig = {
                protocol: settings.type,
                host: settings.host,
                port: settings.port
            };

            // Add authentication if enabled
            if (settings.auth.enabled && settings.auth.username) {
                proxyConfig.auth = {
                    username: settings.auth.username,
                    password: settings.auth.password || ''
                };
            }

            return proxyConfig;
        } catch (error) {
            console.error('Error getting axios proxy config:', error);
            return null;
        }
    }

    /**
     * Validate proxy settings
     * Returns array of error messages (empty if valid)
     */
    validateSettings(settings) {
        const errors = [];

        if (!settings || typeof settings !== 'object') {
            errors.push('Invalid settings format');
            return errors;
        }

        // Validate type
        if (settings.type && !this.isValidProxyType(settings.type)) {
            errors.push('Invalid proxy type. Must be: http, https, socks4, or socks5');
        }

        // Validate host
        if (settings.enabled) {
            if (!settings.host || typeof settings.host !== 'string' || settings.host.trim() === '') {
                errors.push('Proxy host is required when proxy is enabled');
            } else if (!this.isValidHost(settings.host)) {
                errors.push('Invalid proxy host format');
            }
        }

        // Validate port
        if (settings.port !== undefined && !this.isValidPort(settings.port)) {
            errors.push('Invalid port number. Must be between 1 and 65535');
        }

        // Validate auth
        if (settings.auth?.enabled) {
            if (!settings.auth.username || settings.auth.username.trim() === '') {
                errors.push('Username is required when proxy authentication is enabled');
            }
        }

        // Validate bypass list
        if (settings.bypassList && !Array.isArray(settings.bypassList)) {
            errors.push('Bypass list must be an array');
        }

        // Validate timeout
        if (settings.timeout !== undefined && !this.isValidTimeout(settings.timeout)) {
            errors.push('Invalid timeout. Must be between 0 and 300000ms (5 minutes)');
        }

        return errors;
    }

    /**
     * Validate proxy type
     */
    isValidProxyType(type) {
        const validTypes = ['http', 'https', 'socks4', 'socks5'];
        return validTypes.includes(type);
    }

    /**
     * Validate host format
     */
    isValidHost(host) {
        if (!host || typeof host !== 'string') {return false;}

        const trimmed = host.trim();
        if (trimmed.length === 0) {return false;}

        // Remove protocol if present (shouldn't be there, but just in case)
        const cleanHost = trimmed.replace(/^(https?|socks[45]?):\/\//, '');

        // Basic hostname validation
        // Allow IP addresses (IPv4) and domain names
        const ipv4Pattern = /^(\d{1,3}\.){3}\d{1,3}$/;
        const hostnamePattern = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

        return ipv4Pattern.test(cleanHost) || hostnamePattern.test(cleanHost);
    }

    /**
     * Validate port number
     */
    isValidPort(port) {
        const portNum = parseInt(port, 10);
        return !isNaN(portNum) && portNum >= 1 && portNum <= 65535;
    }

    /**
     * Validate timeout
     */
    isValidTimeout(timeout) {
        const timeoutNum = parseInt(timeout, 10);
        return !isNaN(timeoutNum) && timeoutNum >= 0 && timeoutNum <= 300000;
    }

    /**
     * Add domain to bypass list
     */
    async addBypassDomain(domain) {
        try {
            const settings = await this.repository.getProxySettings();

            if (!domain || typeof domain !== 'string' || domain.trim() === '') {
                throw new Error('Invalid domain');
            }

            const cleanDomain = domain.trim();

            // Check if already in list
            if (settings.bypassList.includes(cleanDomain)) {
                throw new Error('Domain already in bypass list');
            }

            settings.bypassList.push(cleanDomain);
            await this.repository.saveProxySettings(settings);

            this.statusDisplay.update(`Added ${cleanDomain} to proxy bypass list`, null);

            return settings;
        } catch (error) {
            this.statusDisplay.update(`Error adding bypass domain: ${error.message}`, null);
            throw error;
        }
    }

    /**
     * Remove domain from bypass list
     */
    async removeBypassDomain(domain) {
        try {
            const settings = await this.repository.getProxySettings();

            const index = settings.bypassList.indexOf(domain);
            if (index === -1) {
                throw new Error('Domain not found in bypass list');
            }

            settings.bypassList.splice(index, 1);
            await this.repository.saveProxySettings(settings);

            this.statusDisplay.update(`Removed ${domain} from proxy bypass list`, null);

            return settings;
        } catch (error) {
            this.statusDisplay.update(`Error removing bypass domain: ${error.message}`, null);
            throw error;
        }
    }
}
