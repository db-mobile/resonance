/**
 * @fileoverview Controller for coordinating client certificate operations between UI and services
 * @module controllers/CertificateController
 */

export class CertificateController {
    /** @param {CertificateService} certificateService */
    constructor(certificateService) {
        this.service = certificateService;
    }

    /** @returns {Promise<void>} */
    async initialize() {
        try {
            await this.service.getItems();
        } catch (error) {
            void error;
        }
    }

    /** @returns {Promise<Array<Object>>} */
    async getItems() {
        return this.service.getItems();
    }

    /**
     * @param {Array<Object>} items
     * @returns {Promise<Array<Object>>}
     */
    async saveItems(items) {
        return this.service.saveItems(items);
    }

    /**
     * @param {string} requestHost
     * @returns {{certPath: string, keyPath: string, caPath: string}|null}
     */
    getForHost(requestHost) {
        return this.service.getForHost(requestHost);
    }

    /**
     * @param {Object} entry
     * @returns {Array<string>}
     */
    validateEntry(entry) {
        return this.service.validateEntry(entry);
    }
}
