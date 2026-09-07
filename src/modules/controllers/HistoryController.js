/**
 * @fileoverview Controller for coordinating request history operations between UI and services
 * @module controllers/HistoryController
 */

import { app } from '../appContext.js';
import { HistoryService } from '../services/HistoryService.js';
import { HistoryRenderer } from '../ui/HistoryRenderer.js';

export class HistoryController {
    /** @param {Object} backendAPI */
    constructor(backendAPI) {
        this.service = new HistoryService(backendAPI);
        this.repository = this.service.repository;
        this.renderer = new HistoryRenderer(backendAPI, this.handleHistorySelect.bind(this));
    }

    /** @returns {Promise<void>} */
    async init() {
        await this.renderer.init();
    }

    /**
     * @param {Object} requestConfig
     * @param {Object} result
     * @param {Object|null} [currentEndpoint=null]
     * @param {string} [environmentName=null]
     * @param {Object} [sensitive={}]
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
     * @param {Object} historyEntry
     * @param {Object} historyEntry.request
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

    /** @returns {Promise<void>} */
    async refresh() {
        await this.renderer.refresh();
    }
}
