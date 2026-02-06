/**
 * @fileoverview UI renderer for request history sidebar
 * @module ui/HistoryRenderer
 */

import { HistoryService } from '../services/HistoryService.js';
import { ConfirmDialog } from './ConfirmDialog.js';
import { templateLoader } from '../templateLoader.js';

/**
 * History sidebar UI renderer
 *
 * @class
 * @classdesc Renders the request history list with search, filtering, and replay functionality.
 * Displays timestamps, HTTP methods, URLs, and status codes with color coding.
 * Provides delete and clear-all operations with confirmation dialogs.
 */
export class HistoryRenderer {
    /**
     * Creates a HistoryRenderer instance
     *
     * @param {Object} backendAPI - Backend IPC API bridge
     * @param {Function} onHistorySelect - Callback when history item is selected for replay
     */
    constructor(backendAPI, onHistorySelect) {
        this.service = new HistoryService(backendAPI);
        this.onHistorySelect = onHistorySelect;
        this.historyRepository = this.service.repository;
        this.historyItems = [];
        this.container = document.getElementById('history-list');
        this.searchInput = document.getElementById('history-search-input');
        this.clearAllBtn = document.getElementById('clear-all-history-btn');
        this.confirmDialog = new ConfirmDialog();
    }

    async init() {
        this.setupEventListeners();
        await this.render();
    }

    setupEventListeners() {
        if (this.searchInput) {
            this.searchInput.addEventListener('input', async (e) => {
                await this.handleSearch(e.target.value);
            });
        }

        if (this.clearAllBtn) {
            this.clearAllBtn.addEventListener('click', async () => {
                await this.handleClearAll();
            });
        }
    }

    async handleSearch(searchTerm) {
        const results = await this.service.searchHistory(searchTerm);
        this.renderHistoryList(results);
    }

    async handleClearAll() {
        const confirmMessage = window.i18n ?
            window.i18n.t('history.confirm_clear') || 'Are you sure you want to clear all request history?\n\nThis action cannot be undone.' :
            'Are you sure you want to clear all request history?\n\nThis action cannot be undone.';

        const title = window.i18n ?
            window.i18n.t('history.clear_all_title') || 'Clear All History' :
            'Clear All History';

        const confirmText = window.i18n ?
            window.i18n.t('common.delete') || 'Clear' :
            'Clear';

        const cancelText = window.i18n ?
            window.i18n.t('common.cancel') || 'Cancel' :
            'Cancel';

        const confirmed = await this.confirmDialog.show(confirmMessage, {
            title,
            confirmText,
            cancelText,
            dangerous: true
        });

        if (confirmed) {
            await this.service.clearAllHistory();
            await this.render();
        }
    }

    async render() {
        const history = await this.service.getAllHistory();
        this.renderHistoryList(history);
    }

    renderHistoryList(historyItems) {
        if (!this.container) {return;}

        if (historyItems.length === 0) {
            const fragment = templateLoader.cloneSync(
                './src/templates/history/historyRenderer.html',
                'tpl-history-empty'
            );
            this.container.innerHTML = '';
            this.container.appendChild(fragment);
            return;
        }

        this.container.innerHTML = '';

        historyItems.forEach(entry => {
            const el = this.renderHistoryItem(entry);
            this.container.appendChild(el);
        });

        // Attach event listeners to history items
        historyItems.forEach(entry => {
            const element = this.container.querySelector(`[data-history-id="${entry.id}"]`);
            if (element) {
                element.addEventListener('click', () => {
                    if (this.onHistorySelect) {
                        this.onHistorySelect(entry);
                    }
                });

                const deleteBtn = element.querySelector('.history-item-delete');
                if (deleteBtn) {
                    deleteBtn.addEventListener('click', async (e) => {
                        e.stopPropagation();
                        await this.handleDeleteEntry(entry.id);
                    });
                }
            }
        });
    }

    renderHistoryItem(entry) {
        const statusColor = this.service.getStatusColor(entry.response?.status);
        const methodColor = this.service.getMethodColor(entry.request.method);
        const timestamp = this.service.formatTimestamp(entry.timestamp);
        const url = this.service.truncateUrl(entry.request.url, 60);

        const fragment = templateLoader.cloneSync(
            './src/templates/history/historyRenderer.html',
            'tpl-history-item'
        );
        const itemEl = fragment.firstElementChild;
        itemEl.dataset.historyId = entry.id;

        const methodEl = itemEl.querySelector('[data-role="method"]');
        const statusSlotEl = itemEl.querySelector('[data-role="status-slot"]');
        const timeEl = itemEl.querySelector('[data-role="time"]');
        const urlEl = itemEl.querySelector('[data-role="url"]');

        if (methodEl) {
            methodEl.textContent = entry.request.method;
            methodEl.style.setProperty('--history-method-color', methodColor);
        }
        if (timeEl) {timeEl.textContent = timestamp;}
        if (urlEl) {
            urlEl.textContent = url;
            urlEl.title = entry.request.url;
        }

        if (statusSlotEl) {
            if (entry.response?.status) {
                const statusFragment = templateLoader.cloneSync(
                    './src/templates/history/historyRenderer.html',
                    'tpl-history-status-badge'
                );
                const statusEl = statusFragment.firstElementChild;
                statusEl.textContent = entry.response.status;
                statusEl.style.setProperty('--history-status-color', statusColor);
                statusSlotEl.appendChild(statusEl);
            } else {
                const statusFragment = templateLoader.cloneSync(
                    './src/templates/history/historyRenderer.html',
                    'tpl-history-status-error'
                );
                statusSlotEl.appendChild(statusFragment);
            }
        }

        return itemEl;
    }

    async handleDeleteEntry(id) {
        await this.service.deleteHistoryEntry(id);
        await this.render();
    }

    async refresh() {
        await this.render();
    }
}
