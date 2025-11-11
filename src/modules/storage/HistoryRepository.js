/**
 * @fileoverview Repository for managing request history persistence
 * @module storage/HistoryRepository
 */

/**
 * Repository for managing request history persistence
 *
 * @class
 * @classdesc Handles CRUD operations for request/response history in electron-store.
 * Maintains a limited history of API requests with timestamps, supporting replay
 * and search functionality. Implements defensive programming with validation and
 * auto-initialization for packaged app compatibility.
 */
export class HistoryRepository {
    /**
     * Creates a HistoryRepository instance
     *
     * @param {Object} electronAPI - The Electron IPC API bridge from preload script
     */
    constructor(electronAPI) {
        this.electronAPI = electronAPI;
        this.HISTORY_KEY = 'requestHistory';
        this.MAX_HISTORY_ITEMS = 100; // Limit history to prevent excessive storage
    }

    /**
     * Safely retrieves an array from electron-store with fallback handling
     *
     * Implements defensive programming to handle packaged app environments where
     * store may return undefined on first run. Automatically initializes with
     * default value if data is invalid or missing.
     *
     * @private
     * @async
     * @param {string} key - The store key to retrieve
     * @param {Array} [defaultValue=[]] - Default value to use if data is invalid
     * @returns {Promise<Array>} The stored array or default value
     */
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

    /**
     * Retrieves all history entries sorted by timestamp
     *
     * Returns entries sorted by timestamp descending (newest first).
     *
     * @async
     * @returns {Promise<Array<Object>>} Array of history entry objects
     * @throws {Error} If storage access fails
     */
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

    /**
     * Adds a new history entry
     *
     * Automatically limits history size to MAX_HISTORY_ITEMS by removing oldest entries.
     * New entries are added at the beginning of the array.
     *
     * @async
     * @param {Object} historyEntry - The history entry object to add
     * @param {string} historyEntry.id - Unique entry ID
     * @param {number} historyEntry.timestamp - Request timestamp
     * @param {Object} historyEntry.request - Request data
     * @param {Object} historyEntry.response - Response data
     * @returns {Promise<Object>} The added history entry
     * @throws {Error} If save operation fails
     */
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

    /**
     * Retrieves a history entry by ID
     *
     * @async
     * @param {string} id - The history entry ID
     * @returns {Promise<Object|null>} The history entry object or null if not found
     */
    async getById(id) {
        try {
            const history = await this.getAll();
            return history.find(entry => entry.id === id);
        } catch (error) {
            console.error('Error getting history entry by id:', error);
            return null;
        }
    }

    /**
     * Deletes a history entry by ID
     *
     * @async
     * @param {string} id - The history entry ID to delete
     * @returns {Promise<boolean>} True if deletion succeeded
     * @throws {Error} If delete operation fails
     */
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

    /**
     * Clears all history entries
     *
     * @async
     * @returns {Promise<boolean>} True if clear succeeded
     * @throws {Error} If clear operation fails
     */
    async clear() {
        try {
            await this.electronAPI.store.set(this.HISTORY_KEY, []);
            return true;
        } catch (error) {
            console.error('Error clearing history:', error);
            throw new Error(`Failed to clear history: ${error.message}`);
        }
    }

    /**
     * Retrieves history entries for a specific collection
     *
     * @async
     * @param {string} collectionId - The collection ID
     * @returns {Promise<Array<Object>>} Array of history entries for the collection
     */
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

    /**
     * Searches history entries by URL, method, or status code
     *
     * Performs case-insensitive search across request URL, HTTP method, and response status.
     *
     * @async
     * @param {string} searchTerm - The search term
     * @returns {Promise<Array<Object>>} Array of matching history entries
     */
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
