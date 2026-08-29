/**
 * PreviewRepository
 *
 * Manages persistence of preview mode preferences per workspace tab. The store
 * is hydrated once into an in-memory cache so the accessors stay synchronous
 * for the render-path consumers; writes flow through an ordered write chain.
 */
export class PreviewRepository {
    /**
     * Creates a PreviewRepository instance
     * @param {Object} backendAPI - The backend IPC API bridge
     */
    constructor(backendAPI) {
        this.backendAPI = backendAPI;
        this.storageKey = 'previewModes';
        this._modes = null;
        this._writeChain = Promise.resolve();
    }

    /**
     * Hydrates the in-memory cache from the store.
     * @returns {Promise<void>}
     */
    async load() {
        try {
            const stored = await this.backendAPI.store.get(this.storageKey);
            const modes = {};
            if (stored && typeof stored === 'object') {
                Object.keys(stored).forEach(key => {
                    if (typeof stored[key] === 'boolean') {
                        modes[key] = stored[key];
                    }
                });
            }
            this._modes = modes;
        } catch (error) {
            void error;
            this._modes = {};
        }
    }

    /**
     * Persists the current cache through the ordered write chain.
     * @private
     * @returns {void}
     */
    _persist() {
        const snapshot = { ...this._modes };
        this._writeChain = this._writeChain
            .catch(() => { })
            .then(() => this.backendAPI.store.set(this.storageKey, snapshot));
        this._writeChain.catch(() => { });
    }

    /**
     * Get preview mode state for a tab
     * @param {string} tabId - Workspace tab ID
     * @returns {boolean}
     */
    getPreviewMode(tabId) {
        return Boolean((this._modes || {})[tabId]);
    }

    /**
     * Set preview mode state for a tab
     * @param {string} tabId - Workspace tab ID
     * @param {boolean} isPreviewMode - Preview mode enabled
     */
    setPreviewMode(tabId, isPreviewMode) {
        if (!this._modes) {
            this._modes = {};
        }
        this._modes[tabId] = Boolean(isPreviewMode);
        this._persist();
    }

    /**
     * Remove preview mode state for a tab
     * @param {string} tabId - Workspace tab ID
     */
    removePreviewMode(tabId) {
        if (!this._modes) {
            this._modes = {};
        }
        delete this._modes[tabId];
        this._persist();
    }

    /**
     * Clear all preview modes
     */
    clearAll() {
        this._modes = {};
        this._persist();
    }
}
