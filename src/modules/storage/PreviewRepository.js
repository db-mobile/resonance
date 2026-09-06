export class PreviewRepository {
    /** @param {Object} backendAPI */
    constructor(backendAPI) {
        this.backendAPI = backendAPI;
        this.storageKey = 'previewModes';
        this._modes = null;
        this._writeChain = Promise.resolve();
    }

    /** @returns {Promise<void>} */
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

    /** @returns {void} */
    _persist() {
        const snapshot = { ...this._modes };
        this._writeChain = this._writeChain
            .catch(() => { })
            .then(() => this.backendAPI.store.set(this.storageKey, snapshot));
        this._writeChain.catch(() => { });
    }

    /**
     * @param {string} tabId
     * @returns {boolean}
     */
    getPreviewMode(tabId) {
        return Boolean((this._modes || {})[tabId]);
    }

    /**
     * @param {string} tabId
     * @param {boolean} isPreviewMode
     */
    setPreviewMode(tabId, isPreviewMode) {
        if (!this._modes) {
            this._modes = {};
        }
        this._modes[tabId] = Boolean(isPreviewMode);
        this._persist();
    }

    /** @param {string} tabId */
    removePreviewMode(tabId) {
        if (!this._modes) {
            this._modes = {};
        }
        delete this._modes[tabId];
        this._persist();
    }

    clearAll() {
        this._modes = {};
        this._persist();
    }
}
