/**
 * Repository for managing proxy configuration persistence
 * Handles CRUD operations for proxy settings with validation
 */
export class ProxyRepository {
    constructor(electronAPI) {
        this.electronAPI = electronAPI;
        this.PROXY_KEY = 'proxySettings';
    }

    /**
     * Get proxy settings with validation and initialization
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
     * Save proxy settings with validation
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
     * Update specific proxy setting fields
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
     * Reset proxy settings to defaults
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
     * Check if proxy is enabled
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
     * Toggle proxy enabled state
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
     * Validate and sanitize proxy settings
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
     * Validate proxy type
     */
    _validateProxyType(type) {
        const validTypes = ['http', 'https', 'socks4', 'socks5'];
        return validTypes.includes(type);
    }

    /**
     * Validate port number
     */
    _validatePort(port) {
        const portNum = parseInt(port, 10);
        return !isNaN(portNum) && portNum >= 1 && portNum <= 65535;
    }

    /**
     * Validate timeout
     */
    _validateTimeout(timeout) {
        const timeoutNum = parseInt(timeout, 10);
        return !isNaN(timeoutNum) && timeoutNum >= 0 && timeoutNum <= 300000; // Max 5 minutes
    }

    /**
     * Sanitize host string
     */
    _sanitizeHost(host) {
        if (typeof host !== 'string') {return '';}
        // Remove protocol if present
        return host.replace(/^(https?|socks[45]?):\/\//, '').trim();
    }

    /**
     * Get default proxy settings structure
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
