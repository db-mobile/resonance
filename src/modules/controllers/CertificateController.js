/**
 * @fileoverview Controller for coordinating client certificate operations between UI and services
 * @module controllers/CertificateController
 */

/**
 * Controller for coordinating client certificate operations between UI and services
 *
 * @class
 * @classdesc Mediates between the settings UI and the {@link CertificateService},
 * handling the host-keyed client-certificate list (mTLS + custom CA trust) and
 * exposing synchronous per-host resolution for the request path. Mirrors
 * {@link ProxyController}.
 */
export class CertificateController {
    /**
     * Creates a CertificateController instance
     *
     * @param {CertificateService} certificateService - The certificate service
     */
    constructor(certificateService) {
        this.service = certificateService;
    }

    /**
     * Initializes the controller and warms the in-memory cache so per-host
     * resolution is available before the first request is sent.
     *
     * @async
     * @returns {Promise<void>}
     */
    async initialize() {
        try {
            await this.service.getItems();
        } catch (error) {
            void error;
        }
    }

    /**
     * Gets all certificate entries (also refreshes the resolution cache)
     *
     * @async
     * @returns {Promise<Array<Object>>} Certificate entries
     */
    async getItems() {
        return this.service.getItems();
    }

    /**
     * Saves the full certificate list
     *
     * @async
     * @param {Array<Object>} items - Certificate entries to persist
     * @returns {Promise<Array<Object>>} The validated, saved entries
     * @throws {Error} If validation fails
     */
    async saveItems(items) {
        return this.service.saveItems(items);
    }

    /**
     * Resolves the certificate configuration for a request host, if any.
     *
     * @param {string} requestHost - The host (or `host:port`) of the request
     * @returns {{certPath: string, keyPath: string, caPath: string}|null}
     */
    getForHost(requestHost) {
        return this.service.getForHost(requestHost);
    }

    /**
     * Validates a single certificate entry
     *
     * @param {Object} entry - The entry to validate
     * @returns {Array<string>} Validation error messages, empty if valid
     */
    validateEntry(entry) {
        return this.service.validateEntry(entry);
    }
}
