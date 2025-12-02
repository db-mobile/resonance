/**
 * @fileoverview Controller for coordinating request history operations between UI and services
 * @module controllers/HistoryController
 */

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
     * @param {Object} electronAPI - The Electron IPC API bridge for storage operations
     */
    constructor(electronAPI) {
        this.service = new HistoryService(electronAPI);
        this.renderer = new HistoryRenderer(electronAPI, this.handleHistorySelect.bind(this));
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
     * @returns {Promise<void>}
     */
    async addHistoryEntry(requestConfig, result, currentEndpoint = null) {
        try {
            await this.service.createHistoryEntry(requestConfig, result, currentEndpoint);
            await this.renderer.refresh();
        } catch (error) {
            console.error('Error adding history entry:', error);
        }
    }

    /**
     * Handles user selection of a history entry
     *
     * Loads the historical request data into the form UI for replay.
     * Populates URL, method, headers, query params, and body from history.
     * Clears current endpoint association since this is from history.
     *
     * @async
     * @param {Object} historyEntry - The history entry object
     * @param {Object} historyEntry.request - The request data
     * @param {string} historyEntry.request.url - Request URL
     * @param {string} historyEntry.request.method - HTTP method
     * @param {Object} [historyEntry.request.headers] - Request headers
     * @param {Object} [historyEntry.request.body] - Request body
     * @returns {Promise<void>}
     */
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

    /**
     * Clears all rows from a key-value list element
     *
     * @param {HTMLElement} listElement - The list container element
     * @returns {void}
     */
    clearKeyValueList(listElement) {
        if (!listElement) {return;}
        listElement.innerHTML = '';
    }

    /**
     * Populates a key-value list with data
     *
     * @param {HTMLElement} listElement - The list container element
     * @param {Object} data - Key-value pairs to populate
     * @returns {void}
     */
    populateKeyValueList(listElement, data) {
        if (!listElement || !data) {return;}

        Object.entries(data).forEach(([key, value]) => {
            this.addKeyValueRow(listElement, key, value);
        });
    }

    /**
     * Adds a key-value row to a list element
     *
     * Creates a row with key and value inputs, remove button, and auto-add behavior.
     * Preserves special characters like template variables in values.
     *
     * @param {HTMLElement} listElement - The list container element
     * @param {string} [key=''] - Initial key value
     * @param {string} [value=''] - Initial value
     * @returns {void}
     */
    addKeyValueRow(listElement, key = '', value = '') {
        if (!listElement) {return;}

        const row = document.createElement('div');
        row.className = 'key-value-row';
        row.innerHTML = `
            <input type="text" class="key-input" placeholder="Key">
            <input type="text" class="value-input" placeholder="Value">
            <button type="button" class="btn btn-danger btn-xs" aria-label="Remove">×</button>
        `;

        listElement.appendChild(row);

        // Add remove button handler
        const removeBtn = row.querySelector('.btn-danger');
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

        // Set values directly via .value property (not via innerHTML) to preserve special characters like {{ }}
        if (keyInput) {keyInput.value = key;}
        if (valueInput) {valueInput.value = value;}

        const handleInput = () => {
            if (keyInput.value || valueInput.value) {
                const isLastRow = !row.nextElementSibling;
                if (isLastRow) {
                    this.addKeyValueRow(listElement);
                }
            }
        };

        if (keyInput) {keyInput.addEventListener('input', handleInput);}
        if (valueInput) {valueInput.addEventListener('input', handleInput);}
    }

    /**
     * Escapes HTML special characters in text
     *
     * @param {string} text - Text to escape
     * @returns {string} HTML-safe escaped text
     */
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

    /**
     * Shows the request section in the UI
     *
     * Placeholder method for switching UI views from history to request section.
     * Implementation depends on how the history panel is integrated.
     *
     * @returns {void}
     */
    showRequestSection() {
        // This is a placeholder for switching UI views
        // Implementation depends on how the history panel is integrated
        // Could involve tab switching or panel toggling
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
