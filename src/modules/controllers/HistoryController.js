import { HistoryService } from '../services/HistoryService.js';
import { HistoryRenderer } from '../ui/HistoryRenderer.js';

export class HistoryController {
    constructor(electronAPI) {
        this.service = new HistoryService(electronAPI);
        this.renderer = new HistoryRenderer(electronAPI, this.handleHistorySelect.bind(this));
    }

    async init() {
        await this.renderer.init();
    }

    async addHistoryEntry(requestConfig, result, currentEndpoint = null) {
        try {
            await this.service.createHistoryEntry(requestConfig, result, currentEndpoint);
            await this.renderer.refresh();
        } catch (error) {
            console.error('Error adding history entry:', error);
        }
    }

    async handleHistorySelect(historyEntry) {
        try {
            // Load the historical request into the form
            const urlInput = document.getElementById('url-input');
            const methodSelect = document.getElementById('method-select');
            const bodyInput = document.getElementById('body-input');
            const headersList = document.getElementById('headers-list');
            const queryParamsList = document.getElementById('query-params-list');
            const pathParamsList = document.getElementById('path-params-list');

            // Set basic request info
            if (urlInput) {
                // Extract URL without query params
                const urlObj = new URL(historyEntry.request.url);
                urlInput.value = `${urlObj.origin}${urlObj.pathname}`;
            }

            if (methodSelect) {
                methodSelect.value = historyEntry.request.method;
            }

            // Set body if present
            if (bodyInput && historyEntry.request.body) {
                bodyInput.value = JSON.stringify(historyEntry.request.body, null, 2);
            } else if (bodyInput) {
                bodyInput.value = '';
            }

            // Clear existing key-value lists
            this.clearKeyValueList(headersList);
            this.clearKeyValueList(queryParamsList);
            this.clearKeyValueList(pathParamsList);

            // Populate headers
            if (historyEntry.request.headers && Object.keys(historyEntry.request.headers).length > 0) {
                this.populateKeyValueList(headersList, historyEntry.request.headers);
            } else {
                this.addKeyValueRow(headersList, 'Content-Type', 'application/json');
            }

            // Extract and populate query params from URL
            const urlObj = new URL(historyEntry.request.url);
            const queryParams = {};
            urlObj.searchParams.forEach((value, key) => {
                queryParams[key] = value;
            });

            if (Object.keys(queryParams).length > 0) {
                this.populateKeyValueList(queryParamsList, queryParams);
            } else {
                this.addKeyValueRow(queryParamsList);
            }

            // Add initial path params row if empty
            if (pathParamsList && pathParamsList.children.length === 0) {
                this.addKeyValueRow(pathParamsList);
            }

            // Switch to the request section if in history view
            this.showRequestSection();

            // Clear current endpoint association since this is from history
            window.currentEndpoint = null;

        } catch (error) {
            console.error('Error loading history entry:', error);
        }
    }

    clearKeyValueList(listElement) {
        if (!listElement) return;
        listElement.innerHTML = '';
    }

    populateKeyValueList(listElement, data) {
        if (!listElement || !data) return;

        Object.entries(data).forEach(([key, value]) => {
            this.addKeyValueRow(listElement, key, value);
        });
    }

    addKeyValueRow(listElement, key = '', value = '') {
        if (!listElement) return;

        const row = document.createElement('div');
        row.className = 'key-value-row';
        row.innerHTML = `
            <input type="text" class="key-input" placeholder="Key" value="${this.escapeHtml(key)}">
            <input type="text" class="value-input" placeholder="Value" value="${this.escapeHtml(value)}">
            <button type="button" class="remove-btn" aria-label="Remove">×</button>
        `;

        listElement.appendChild(row);

        // Add remove button handler
        const removeBtn = row.querySelector('.remove-btn');
        if (removeBtn) {
            removeBtn.addEventListener('click', () => {
                row.remove();
                if (listElement.children.length === 0) {
                    this.addKeyValueRow(listElement);
                }
            });
        }

        // Add input handlers for auto-adding new rows
        const keyInput = row.querySelector('.key-input');
        const valueInput = row.querySelector('.value-input');

        const handleInput = () => {
            if (keyInput.value || valueInput.value) {
                const isLastRow = !row.nextElementSibling;
                if (isLastRow) {
                    this.addKeyValueRow(listElement);
                }
            }
        };

        if (keyInput) keyInput.addEventListener('input', handleInput);
        if (valueInput) valueInput.addEventListener('input', handleInput);
    }

    escapeHtml(text) {
        const map = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;'
        };
        return String(text).replace(/[&<>"']/g, m => map[m]);
    }

    showRequestSection() {
        // This is a placeholder for switching UI views
        // Implementation depends on how the history panel is integrated
        // Could involve tab switching or panel toggling
    }

    async refresh() {
        await this.renderer.refresh();
    }
}
