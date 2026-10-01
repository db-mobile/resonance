/**
 * @fileoverview Controller for coordinating proxy operations between UI and services
 * @module controllers/ProxyController
 */

export class ProxyController {
    /** @param {ProxyService} proxyService */
    constructor(proxyService) {
        this.service = proxyService;
    }

    /** @returns {Promise<Object>} */
    async getSettings() {
        return this.service.getSettings();
    }

    /**
     * @param {Object} settings
     * @param {boolean} [settings.enabled]
     * @param {string} [settings.host]
     * @param {number} [settings.port]
     * @param {string} [settings.protocol]
     * @param {string} [settings.username]
     * @param {string} [settings.password]
     * @param {Array<string>} [settings.bypassList]
     * @returns {Promise<Object>}
     */
    async updateSettings(settings) {
        return this.service.updateSettings(settings);
    }

    /** @returns {Promise<Object>} */
    async testConnection() {
        const settings = await this.service.getSettings();

        if (!settings.enabled) {
            throw new Error('Proxy is not enabled');
        }

        if (!settings.host || !settings.port) {
            throw new Error('Proxy host and port are required');
        }

        const validationErrors = this.service.validateSettings(settings);
        if (validationErrors.length > 0) {
            throw new Error(validationErrors.join('; '));
        }

        return window.backendAPI.proxySettings.test();
    }
}
