export class HistoryRepository {
    constructor(electronAPI) {
        this.electronAPI = electronAPI;
        this.HISTORY_KEY = 'requestHistory';
        this.MAX_HISTORY_ITEMS = 100; // Limit history to prevent excessive storage
    }

    async _getArrayFromStore(key, defaultValue = []) {
        try {
            let data = await this.electronAPI.store.get(key);

            if (!Array.isArray(data)) {
                console.warn(`Store data for key "${key}" is invalid or undefined, initializing with default value`);
                data = defaultValue;
                await this.electronAPI.store.set(key, data);
            }

            return data;
        } catch (error) {
            console.error(`Error getting data from store for key "${key}":`, error);
            return defaultValue;
        }
    }

    async getAll() {
        try {
            const history = await this._getArrayFromStore(this.HISTORY_KEY);
            // Return sorted by timestamp descending (newest first)
            return history.sort((a, b) => b.timestamp - a.timestamp);
        } catch (error) {
            console.error('Error loading history:', error);
            throw new Error(`Failed to load history: ${error.message}`);
        }
    }

    async add(historyEntry) {
        try {
            let history = await this._getArrayFromStore(this.HISTORY_KEY);

            if (!Array.isArray(history)) {
                console.warn('History is not an array in add(), reinitializing');
                history = [];
            }

            // Add new entry at the beginning
            history.unshift(historyEntry);

            // Limit history size
            if (history.length > this.MAX_HISTORY_ITEMS) {
                history = history.slice(0, this.MAX_HISTORY_ITEMS);
            }

            await this.electronAPI.store.set(this.HISTORY_KEY, history);
            return historyEntry;
        } catch (error) {
            console.error('Error adding history entry:', error);
            throw new Error(`Failed to add history entry: ${error.message}`);
        }
    }

    async getById(id) {
        try {
            const history = await this.getAll();
            return history.find(entry => entry.id === id);
        } catch (error) {
            console.error('Error getting history entry by id:', error);
            return null;
        }
    }

    async delete(id) {
        try {
            const history = await this._getArrayFromStore(this.HISTORY_KEY);
            const updatedHistory = history.filter(entry => entry.id !== id);
            await this.electronAPI.store.set(this.HISTORY_KEY, updatedHistory);
            return true;
        } catch (error) {
            console.error('Error deleting history entry:', error);
            throw new Error(`Failed to delete history entry: ${error.message}`);
        }
    }

    async clear() {
        try {
            await this.electronAPI.store.set(this.HISTORY_KEY, []);
            return true;
        } catch (error) {
            console.error('Error clearing history:', error);
            throw new Error(`Failed to clear history: ${error.message}`);
        }
    }

    async getByCollection(collectionId) {
        try {
            const history = await this.getAll();
            return history.filter(entry =>
                entry.request.collectionId === collectionId
            );
        } catch (error) {
            console.error('Error getting history by collection:', error);
            return [];
        }
    }

    async search(searchTerm) {
        try {
            const history = await this.getAll();
            const lowerSearchTerm = searchTerm.toLowerCase();

            return history.filter(entry => {
                const urlMatch = entry.request.url.toLowerCase().includes(lowerSearchTerm);
                const methodMatch = entry.request.method.toLowerCase().includes(lowerSearchTerm);
                const statusMatch = entry.response?.status?.toString().includes(lowerSearchTerm);

                return urlMatch || methodMatch || statusMatch;
            });
        } catch (error) {
            console.error('Error searching history:', error);
            return [];
        }
    }
}
