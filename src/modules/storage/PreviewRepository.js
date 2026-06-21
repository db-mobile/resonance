/**
 * PreviewRepository
 *
 * Manages persistence of preview mode preferences per workspace tab.
 * Follows pattern from WorkspaceTabRepository.js
 */
export class PreviewRepository {
    /**
     * Creates a PreviewRepository instance
     * @param {Object} backendAPI - The backend IPC API bridge
     */
    constructor(backendAPI) {
        this.backendAPI = backendAPI;
        this.storageKey = 'previewModes';
    }

    /**
     * Get preview mode state for a tab
     * @param {string} tabId - Workspace tab ID
     * @returns {boolean}
     */
    getPreviewMode(tabId) {
        try {
            const modes = this.backendAPI.store.get(this.storageKey);
            if (!modes || typeof modes !== 'object') {
                return false;
            }
            return Boolean(modes[tabId]);
        } catch (error) {
            void error;
            return false;
        }
    }

    /**
     * Set preview mode state for a tab
     * @param {string} tabId - Workspace tab ID
     * @param {boolean} isPreviewMode - Preview mode enabled
     */
    setPreviewMode(tabId, isPreviewMode) {
        try {
            const existingModes = this.backendAPI.store.get(this.storageKey);
            const modes = {};

            if (existingModes && typeof existingModes === 'object') {
                Object.keys(existingModes).forEach(key => {
                    if (typeof existingModes[key] === 'boolean') {
                        modes[key] = existingModes[key];
                    }
                });
            }

            modes[tabId] = Boolean(isPreviewMode);

            this.backendAPI.store.set(this.storageKey, modes);
        } catch (error) {
            void error;
        }
    }

    /**
     * Remove preview mode state for a tab
     * @param {string} tabId - Workspace tab ID
     */
    removePreviewMode(tabId) {
        try {
            const existingModes = this.backendAPI.store.get(this.storageKey);
            const modes = {};

            if (existingModes && typeof existingModes === 'object') {
                Object.keys(existingModes).forEach(key => {
                    if (key !== tabId && typeof existingModes[key] === 'boolean') {
                        modes[key] = existingModes[key];
                    }
                });
            }

            this.backendAPI.store.set(this.storageKey, modes);
        } catch (error) {
            void error;
        }
    }

    /**
     * Clear all preview modes
     */
    clearAll() {
        try {
            this.backendAPI.store.set(this.storageKey, {});
        } catch (error) {
            void error;
        }
    }
}
