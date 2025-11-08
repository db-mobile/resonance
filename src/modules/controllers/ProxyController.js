/**
 * Controller for coordinating proxy operations between UI and services
 */
export class ProxyController {
    constructor(proxyService) {
        this.service = proxyService;
    }

    /**
     * Initialize controller
     */
    async initialize() {
        // Listen for proxy configuration changes from service
        this.service.addChangeListener((event) => {
            this.handleProxyChange(event);
        });
    }

    /**
     * Handle proxy configuration change events
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
     * Get current proxy settings
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
     * Update proxy settings
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
     * Toggle proxy enabled/disabled
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
     * Reset proxy settings to defaults
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
     * Test proxy connection
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
     * Check if proxy is enabled
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
     * Validate proxy settings
     */
    validateSettings(settings) {
        return this.service.validateSettings(settings);
    }

    /**
     * Add domain to bypass list
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
     * Remove domain from bypass list
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
     * Get axios proxy configuration for a URL
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
