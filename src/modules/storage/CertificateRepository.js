/**
 * @fileoverview Repository for managing client certificate (mTLS) configuration persistence
 * @module storage/CertificateRepository
 */

/**
 * Repository for managing client certificate configuration persistence
 *
 * @class
 * @classdesc Handles CRUD operations for the host-keyed client-certificate list
 * used for mutual TLS and custom CA trust. Only filesystem paths are stored
 * (never certificate bytes), keeping the persisted store git-friendly. Implements
 * defensive programming with auto-initialization and sanitization for packaged
 * app compatibility, mirroring {@link ProxyRepository}.
 */
export class CertificateRepository {
    /**
     * Creates a CertificateRepository instance
     *
     * @param {Object} backendAPI - The backend IPC API bridge
     */
    constructor(backendAPI) {
        this.backendAPI = backendAPI;
        this.CERT_KEY = 'clientCertificates';
    }

    /**
     * Retrieves the certificate list with validation and initialization
     *
     * Automatically initializes storage with an empty list if undefined (packaged
     * app first run). Validates structure and sanitizes each entry.
     *
     * @async
     * @returns {Promise<{items: Array<Object>}>} Certificate configuration
     * @throws {Error} If storage access fails
     */
    async getCertificates() {
        try {
            const data = await this.backendAPI.store.get(this.CERT_KEY);

            if (!data || typeof data !== 'object' || !Array.isArray(data.items)) {
                const defaultData = this._getDefault();
                await this.backendAPI.store.set(this.CERT_KEY, defaultData);
                return defaultData;
            }

            return {
                items: data.items
                    .map(entry => this._sanitizeEntry(entry))
                    .filter(entry => entry !== null)
            };
        } catch (error) {
            throw new Error(`Failed to load client certificates: ${error.message}`);
        }
    }

    /**
     * Saves the certificate list with validation and sanitization
     *
     * @async
     * @param {{items: Array<Object>}} settings - Certificate configuration to save
     * @returns {Promise<{items: Array<Object>}>} The validated and saved configuration
     * @throws {Error} If the format is invalid or save fails
     */
    async saveCertificates(settings) {
        try {
            if (!settings || typeof settings !== 'object' || !Array.isArray(settings.items)) {
                throw new Error('Invalid client certificate format');
            }

            const validated = {
                items: settings.items
                    .map(entry => this._sanitizeEntry(entry))
                    .filter(entry => entry !== null)
            };

            await this.backendAPI.store.set(this.CERT_KEY, validated);
            return validated;
        } catch (error) {
            throw new Error(`Failed to save client certificates: ${error.message}`);
        }
    }

    /**
     * Sanitizes a single certificate entry, returning null if it has no usable host
     *
     * @private
     * @param {Object} entry - The certificate entry to sanitize
     * @returns {Object|null} Sanitized entry, or null when invalid
     */
    _sanitizeEntry(entry) {
        if (!entry || typeof entry !== 'object') {
            return null;
        }

        const host = typeof entry.host === 'string' ? entry.host.trim() : '';
        if (host === '') {
            return null;
        }

        return {
            host,
            certPath: typeof entry.certPath === 'string' ? entry.certPath.trim() : '',
            keyPath: typeof entry.keyPath === 'string' ? entry.keyPath.trim() : '',
            caPath: typeof entry.caPath === 'string' ? entry.caPath.trim() : '',
            enabled: entry.enabled !== false
        };
    }

    /**
     * Creates the default (empty) certificate configuration
     *
     * @private
     * @returns {{items: Array<Object>}} Default configuration
     */
    _getDefault() {
        return { items: [] };
    }
}
