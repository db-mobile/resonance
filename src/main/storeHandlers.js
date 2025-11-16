/**
 * @fileoverview Electron store handler with fallback support for packaged apps
 * @module main/storeHandlers
 */

/**
 * Handles electron-store operations with defensive fallback handling
 *
 * @class
 * @classdesc Provides safe access to electron-store with automatic fallback to
 * default values when store returns undefined (common in packaged apps on first run).
 * Implements defensive programming patterns for robust data persistence.
 */
class StoreHandler {
    /**
     * Creates a StoreHandler instance
     *
     * @param {Store} store - The electron-store instance
     */
    constructor(store) {
        /** @type {Store} The electron-store instance */
        this.store = store;
    }

    /**
     * Retrieves a value from the store with fallback handling
     *
     * If the store returns undefined (common in sandboxed/packaged environments),
     * automatically returns a default value for the key.
     *
     * @param {string} key - The store key to retrieve
     * @returns {*} The stored value or default value for the key
     */
    get(key) {
        try {
            const value = this.store.get(key);

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
     * Returns the default value for a given store key
     *
     * @private
     * @param {string} key - The store key
     * @returns {*} The default value for the key, or null if no default exists
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
            'lastSelectedRequest': null,
            'settings': {}
        };

        return defaults[key] !== undefined ? defaults[key] : null;
    }

    /**
     * Sets a value in the store
     *
     * @param {string} key - The store key
     * @param {*} value - The value to store
     * @returns {void}
     */
    set(key, value) {
        this.store.set(key, value);
    }

    /**
     * Retrieves application settings
     *
     * @returns {Object} The settings object, or empty object if not found
     */
    getSettings() {
        return this.store.get('settings', {});
    }

    /**
     * Updates application settings
     *
     * @param {Object} settings - The settings object to store
     * @returns {void}
     */
    setSettings(settings) {
        this.store.set('settings', settings);
    }
}

export default StoreHandler;
