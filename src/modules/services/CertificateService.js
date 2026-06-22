/**
 * @fileoverview Service for managing client certificate (mTLS) configuration business logic
 * @module services/CertificateService
 */

/**
 * Service for managing client certificate configuration business logic
 *
 * @class
 * @classdesc Provides high-level operations over the host-keyed client-certificate
 * list used for mutual TLS and custom CA trust. Resolves the certificate that
 * applies to a given request host (exact `host:port` match preferred over a bare
 * `host` match) and maintains an in-memory cache so resolution at request time is
 * synchronous and cheap. Implements the observer pattern for change notifications,
 * mirroring {@link ProxyService}.
 *
 * Event types emitted:
 * - 'certificates-updated': When the certificate list is modified
 */
export class CertificateService {
    /**
     * Creates a CertificateService instance
     *
     * @param {CertificateRepository} certificateRepository - Data access layer
     */
    constructor(certificateRepository) {
        this.repository = certificateRepository;
        this.listeners = new Set();
        /** @type {Array<Object>|null} Cached entries for synchronous host lookups */
        this._cache = null;
    }

    /**
     * Registers a listener for certificate configuration changes
     *
     * @param {Function} callback - The callback invoked with an event object
     * @returns {void}
     */
    addChangeListener(callback) {
        this.listeners.add(callback);
    }

    /**
     * Removes a change listener
     *
     * @param {Function} callback - The callback to remove
     * @returns {void}
     */
    removeChangeListener(callback) {
        this.listeners.delete(callback);
    }

    /**
     * Notifies all listeners of a certificate configuration change
     *
     * @private
     * @param {Object} event - Event object with a `type` field
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

    /**
     * Gets all certificate entries, refreshing the in-memory cache
     *
     * @async
     * @returns {Promise<Array<Object>>} The list of certificate entries
     */
    async getItems() {
        const { items } = await this.repository.getCertificates();
        this._cache = items;
        return items;
    }

    /**
     * Saves the full certificate list.
     *
     * Persistence is lenient (sanitized entries are stored even if mid-edit) so
     * the settings UI can autosave on every keystroke without losing data;
     * per-entry validity is surfaced inline via {@link validateEntry} and also
     * enforced by the backend at request time. The repository drops entries with
     * an empty host.
     *
     * @async
     * @param {Array<Object>} items - Certificate entries to persist
     * @returns {Promise<Array<Object>>} The sanitized, saved entries
     * @fires CertificateService#certificates-updated
     */
    async saveItems(items) {
        const saved = await this.repository.saveCertificates({ items });
        this._cache = saved.items;

        this._notifyListeners({ type: 'certificates-updated', items: saved.items });
        return saved.items;
    }

    /**
     * Resolves the certificate configuration that applies to a request host.
     *
     * Prefers an enabled entry whose host exactly matches `host:port`, then falls
     * back to an enabled entry matching the bare hostname. Returns only the path
     * fields needed by the backend, or null when nothing matches.
     *
     * @param {string} requestHost - The host (or `host:port`) of the request
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
     * Whether an entry has any usable certificate material (client cert or CA)
     *
     * @private
     * @param {Object} entry - Certificate entry
     * @returns {boolean}
     */
    _hasMaterial(entry) {
        return Boolean((entry.certPath && entry.keyPath) || entry.caPath);
    }

    /**
     * Validates a single certificate entry
     *
     * @param {Object} entry - Certificate entry to validate
     * @returns {Array<string>} Array of error messages (empty if valid)
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
