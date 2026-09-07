/**
 * @fileoverview Service for managing client certificate (mTLS) configuration business logic
 * @module services/CertificateService
 */

export class CertificateService {
    /** @param {CertificateRepository} certificateRepository */
    constructor(certificateRepository) {
        this.repository = certificateRepository;
        this.listeners = new Set();
        /** @type {Array<Object>|null} */
        this._cache = null;
    }

    /**
     * @param {Function} callback
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

    /** @returns {Promise<Array<Object>>} */
    async getItems() {
        const { items } = await this.repository.getCertificates();
        this._cache = items;
        return items;
    }

    /**
     * @param {Array<Object>} items
     * @returns {Promise<Array<Object>>}
     */
    async saveItems(items) {
        const saved = await this.repository.saveCertificates({ items });
        this._cache = saved.items;

        this._notifyListeners({ type: 'certificates-updated', items: saved.items });
        return saved.items;
    }

    /**
     * @param {string} requestHost
     * @returns {{certPath: string, keyPath: string, caPath: string}|null}
     */
    getForHost(requestHost) {
        if (!requestHost || !Array.isArray(this._cache)) {
            return null;
        }

        const hostPort = requestHost.trim().toLowerCase();
        const bareHost = hostPort.split(':')[0];

        const enabled = this._cache.filter(
            entry => entry.enabled !== false && this._hasMaterial(entry)
        );

        const exact = enabled.find(entry => entry.host.trim().toLowerCase() === hostPort);
        const match =
            exact || enabled.find(entry => entry.host.trim().toLowerCase() === bareHost);

        if (!match) {
            return null;
        }

        return {
            certPath: match.certPath || '',
            keyPath: match.keyPath || '',
            caPath: match.caPath || ''
        };
    }

    /**
     * @param {Object} entry
     * @returns {boolean}
     */
    _hasMaterial(entry) {
        return Boolean((entry.certPath && entry.keyPath) || entry.caPath);
    }

    /**
     * @param {Object} entry
     * @returns {Array<string>}
     */
    validateEntry(entry) {
        const errors = [];

        if (!entry || typeof entry !== 'object') {
            errors.push('Invalid entry format');
            return errors;
        }

        if (typeof entry.host !== 'string' || entry.host.trim() === '') {
            errors.push('Host is required');
        }

        const hasCert = typeof entry.certPath === 'string' && entry.certPath.trim() !== '';
        const hasKey = typeof entry.keyPath === 'string' && entry.keyPath.trim() !== '';
        if (hasCert !== hasKey) {
            errors.push('Client certificate requires both a certificate and a key file');
        }

        return errors;
    }
}
