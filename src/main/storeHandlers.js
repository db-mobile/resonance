/**
 * Handles all electron-store IPC operations
 */
class StoreHandler {
    constructor(store) {
        this.store = store;
    }

    /**
     * Get a value from the store
     */
    get(key) {
        return this.store.get(key);
    }

    /**
     * Set a value in the store
     */
    set(key, value) {
        this.store.set(key, value);
    }

    /**
     * Get all settings
     */
    getSettings() {
        return this.store.get('settings', {});
    }

    /**
     * Set settings
     */
    setSettings(settings) {
        this.store.set('settings', settings);
    }
}

export default StoreHandler;
