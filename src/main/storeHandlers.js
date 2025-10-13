/**
 * Handles all electron-store IPC operations
 */
class StoreHandler {
    constructor(store) {
        this.store = store;
    }

    /**
     * Get a value from the store with proper fallback for sandboxed environments
     */
    get(key) {
        try {
            const value = this.store.get(key);

            // In Flatpak/sandboxed environments, electron-store might return undefined
            // even when defaults are configured. Provide proper fallbacks.
            if (value === undefined) {
                console.warn(`Store returned undefined for key "${key}", returning default value`);
                return this._getDefaultForKey(key);
            }

            return value;
        } catch (error) {
            console.error(`Error getting store value for key "${key}":`, error);
            return this._getDefaultForKey(key);
        }
    }

    /**
     * Get default value for a given key
     */
    _getDefaultForKey(key) {
        const defaults = {
            'collections': [],
            'collectionVariables': {},
            'modifiedRequestBodies': {},
            'persistedPathParams': {},
            'persistedQueryParams': {},
            'persistedHeaders': {},
            'persistedAuthConfigs': {},
            'collectionExpansionStates': {},
            'settings': {}
        };

        return defaults[key] !== undefined ? defaults[key] : null;
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
