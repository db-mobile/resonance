import { HistoryService } from '../services/HistoryService.js';
import { ConfirmDialog } from './ConfirmDialog.js';

export class HistoryRenderer {
    constructor(electronAPI, onHistorySelect) {
        this.service = new HistoryService(electronAPI);
        this.onHistorySelect = onHistorySelect;
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
        if (!this.container) return;

        if (historyItems.length === 0) {
            this.container.innerHTML = `
                <div class="history-empty">
                    <svg class="history-empty-icon" fill="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z"/>
                    </svg>
                    <p class="history-empty-text" data-i18n="history.empty">No request history</p>
                    <p class="history-empty-subtext" data-i18n="history.empty_subtext">Send a request to see it here</p>
                </div>
            `;
            return;
        }

        const historyHTML = historyItems.map(entry => this.renderHistoryItem(entry)).join('');
        this.container.innerHTML = historyHTML;

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

        const statusBadge = entry.response?.status
            ? `<span class="history-item-status" style="color: ${statusColor}">${entry.response.status}</span>`
            : '<span class="history-item-status history-item-error">Error</span>';

        return `
            <div class="history-item" data-history-id="${entry.id}">
                <div class="history-item-header">
                    <span class="history-item-method" style="color: ${methodColor}">${entry.request.method}</span>
                    ${statusBadge}
                    <span class="history-item-time">${timestamp}</span>
                </div>
                <div class="history-item-url" title="${entry.request.url}">${url}</div>
                <button class="history-item-delete" title="Delete from history" aria-label="Delete from history">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="3 6 5 6 21 6"></polyline>
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                    </svg>
                </button>
            </div>
        `;
    }

    async handleDeleteEntry(id) {
        await this.service.deleteHistoryEntry(id);
        await this.render();
    }

    async refresh() {
        await this.render();
    }
}
