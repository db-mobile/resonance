/**
 * @fileoverview Controller for coordinating request history operations between UI and services
 * @module controllers/HistoryController
 */

import { app } from '../appContext.js';
import { HistoryService } from '../services/HistoryService.js';
import { HistoryRenderer } from '../ui/HistoryRenderer.js';

/**
 * Controller for coordinating request history operations between UI and services
 *
 * @class
 * @classdesc Mediates between the HistoryRenderer UI component and HistoryService,
 * handling user interactions for viewing and replaying historical requests.
 * Manages history entry creation and restoration of request data to the form.
 */
export class HistoryController {
    /**
     * Creates a HistoryController instance
     *
     * @param {Object} backendAPI - The backend IPC API bridge for storage operations
     */
    constructor(backendAPI) {
        this.service = new HistoryService(backendAPI);
        this.repository = this.service.repository;
        this.renderer = new HistoryRenderer(backendAPI, this.handleHistorySelect.bind(this));
    }

    /**
     * Initializes the history UI renderer
     *
     * @async
     * @returns {Promise<void>}
     */
    async init() {
        await this.renderer.init();
    }

    /**
     * Adds a new entry to request history
     *
     * Records the request configuration and response for later replay.
     * Refreshes the history UI after adding.
     *
     * @async
     * @param {Object} requestConfig - The request configuration object
     * @param {Object} result - The response result object
     * @param {Object|null} [currentEndpoint=null] - Optional current endpoint context
     * @param {string} [environmentName=null] - Active environment name
     * @param {Object} [sensitive={}] - Extra credential locations to redact ({ headerNames, queryNames })
     * @returns {Promise<void>}
     */
    async addHistoryEntry(requestConfig, result, currentEndpoint = null, environmentName = null, sensitive = {}) {
        try {
            await this.service.createHistoryEntry(requestConfig, result, currentEndpoint, environmentName, sensitive);
            await this.renderer.refresh();
        } catch (error) {
            void error;
        }
    }

    /**
     * Handles user selection of a history entry
     *
     * Opens the entry in the workspace, which always means a tab of the entry's
     * own protocol: the shared request form only shows the fields of the current
     * protocol, so writing an HTTP entry into a gRPC tab would go unseen.
     * Clicking the same entry again focuses the tab it already opened.
     *
     * Credentials were redacted when the entry was stored, so they come back as
     * `[redacted]` and must be re-entered before resending.
     *
     * @async
     * @param {Object} historyEntry - The history entry object
     * @param {Object} historyEntry.request - The request data
     * @returns {Promise<void>}
     */
    async handleHistorySelect(historyEntry) {
        try {
            if (!app.workspaceTabController) {
                return;
            }

            await app.workspaceTabController.loadHistoryEntry(historyEntry);
        } catch (error) {
            void error;
        }
    }

    /**
     * Refreshes the history UI
     *
     * Reloads history entries from storage and updates the display.
     *
     * @async
     * @returns {Promise<void>}
     */
    async refresh() {
        await this.renderer.refresh();
    }
}
