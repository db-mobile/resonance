class StoreHandler {
    constructor(store) {
        this.store = store;
    }

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

    set(key, value) {
        this.store.set(key, value);
    }

    getSettings() {
        return this.store.get('settings', {});
    }

    setSettings(settings) {
        this.store.set('settings', settings);
    }
}

export default StoreHandler;
