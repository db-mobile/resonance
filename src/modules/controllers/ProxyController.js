/**
 * @fileoverview Controller for coordinating proxy operations between UI and services
 * @module controllers/ProxyController
 */

/**
 * Controller for coordinating proxy operations between UI and services
 *
 * @class
 * @classdesc Mediates between UI components and the ProxyService,
 * handling proxy configuration, testing, and state management.
 * Provides methods for proxy CRUD operations, validation, and connection testing.
 */
export class ProxyController {
    /**
     * Creates a ProxyController instance
     *
     * @param {ProxyService} proxyService - The proxy service for business logic
     */
    constructor(proxyService) {
        this.service = proxyService;
    }

    /**
     * Initializes the controller and sets up event listeners
     *
     * Registers change listener for service events related to proxy configuration.
     *
     * @async
     * @returns {Promise<void>}
     */
    async initialize() {
        // Listen for proxy configuration changes from service
        this.service.addChangeListener((event) => {
            this.handleProxyChange(event);
        });
    }

    /**
     * Handles proxy configuration change events from the service
     *
     * Routes events for UI updates if needed. Can be extended to update
     * specific UI elements based on event type.
     *
     * @param {Object} event - The proxy change event
     * @param {string} event.type - Event type (proxy-settings-updated, proxy-toggled, proxy-settings-reset)
     * @returns {void}
     */
    handleProxyChange(event) {
        switch (event.type) {
            case 'proxy-settings-updated':
            case 'proxy-toggled':
            case 'proxy-settings-reset':
                // Can be used to update UI elements if needed
                break;
        }
    }

    /**
     * Gets current proxy settings
     *
     * @async
     * @returns {Promise<Object>} The current proxy configuration object
     * @throws {Error} If retrieval fails
     */
    async getSettings() {
        try {
            return await this.service.getSettings();
        } catch (error) {
            console.error('Error getting proxy settings:', error);
            throw error;
        }
    }

    /**
     * Updates proxy settings
     *
     * @async
     * @param {Object} settings - The proxy settings to update
     * @param {boolean} [settings.enabled] - Whether proxy is enabled
     * @param {string} [settings.host] - Proxy host
     * @param {number} [settings.port] - Proxy port
     * @param {string} [settings.protocol] - Proxy protocol (http, https, socks)
     * @param {string} [settings.username] - Proxy authentication username
     * @param {string} [settings.password] - Proxy authentication password
     * @param {Array<string>} [settings.bypassList] - Domains to bypass proxy
     * @returns {Promise<Object>} Updated proxy settings
     * @throws {Error} If update fails
     */
    async updateSettings(settings) {
        try {
            return await this.service.updateSettings(settings);
        } catch (error) {
            console.error('Error updating proxy settings:', error);
            throw error;
        }
    }

    /**
     * Toggles proxy enabled/disabled state
     *
     * @async
     * @returns {Promise<boolean>} New enabled state
     * @throws {Error} If toggle fails
     */
    async toggleProxy() {
        try {
            return await this.service.toggleProxy();
        } catch (error) {
            console.error('Error toggling proxy:', error);
            throw error;
        }
    }

    /**
     * Resets proxy settings to defaults
     *
     * @async
     * @returns {Promise<Object>} Default proxy settings
     * @throws {Error} If reset fails
     */
    async resetToDefaults() {
        try {
            return await this.service.resetToDefaults();
        } catch (error) {
            console.error('Error resetting proxy settings:', error);
            throw error;
        }
    }

    /**
     * Tests proxy connection
     *
     * Validates settings and attempts to connect through the proxy.
     * Requires proxy to be enabled with valid host and port.
     *
     * @async
     * @returns {Promise<Object>} Test result object with success status and message
     * @throws {Error} If proxy is disabled, invalid, or connection fails
     */
    async testConnection() {
        try {
            const settings = await this.service.getSettings();

            if (!settings.enabled) {
                throw new Error('Proxy is not enabled');
            }

            if (!settings.host || !settings.port) {
                throw new Error('Proxy host and port are required');
            }

            // Validate settings before testing
            const validationErrors = this.service.validateSettings(settings);
            if (validationErrors.length > 0) {
                throw new Error(validationErrors.join('; '));
            }

            // Use the IPC to test connection (will be handled in main process)
            const result = await window.electronAPI.proxySettings.test();

            return result;
        } catch (error) {
            console.error('Error testing proxy connection:', error);
            throw error;
        }
    }

    /**
     * Checks if proxy is enabled
     *
     * @async
     * @returns {Promise<boolean>} True if proxy is enabled, false otherwise or on error
     */
    async isEnabled() {
        try {
            return await this.service.isEnabled();
        } catch (error) {
            console.error('Error checking proxy enabled status:', error);
            return false;
        }
    }

    /**
     * Validates proxy settings
     *
     * Checks for required fields, valid port numbers, and correct protocol values.
     *
     * @param {Object} settings - The proxy settings to validate
     * @returns {Array<string>} Array of validation error messages, empty if valid
     */
    validateSettings(settings) {
        return this.service.validateSettings(settings);
    }

    /**
     * Adds a domain to the proxy bypass list
     *
     * @async
     * @param {string} domain - The domain to bypass proxy for
     * @returns {Promise<Object>} Updated proxy settings
     * @throws {Error} If adding fails
     */
    async addBypassDomain(domain) {
        try {
            return await this.service.addBypassDomain(domain);
        } catch (error) {
            console.error('Error adding bypass domain:', error);
            throw error;
        }
    }

    /**
     * Removes a domain from the proxy bypass list
     *
     * @async
     * @param {string} domain - The domain to remove from bypass list
     * @returns {Promise<Object>} Updated proxy settings
     * @throws {Error} If removal fails
     */
    async removeBypassDomain(domain) {
        try {
            return await this.service.removeBypassDomain(domain);
        } catch (error) {
            console.error('Error removing bypass domain:', error);
            throw error;
        }
    }

    /**
     * Gets axios proxy configuration for a specific URL
     *
     * Returns proxy config if enabled and URL is not in bypass list.
     *
     * @async
     * @param {string} url - The URL to get proxy config for
     * @returns {Promise<Object|null>} Axios proxy config object, or null if not applicable
     */
    async getAxiosProxyConfig(url) {
        try {
            return await this.service.getAxiosProxyConfig(url);
        } catch (error) {
            console.error('Error getting axios proxy config:', error);
            return null;
        }
    }
}
