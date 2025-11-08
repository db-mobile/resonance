/**
 * ResponseContainerManager
 *
 * Manages separate response display areas for each workspace tab.
 * Each workspace tab gets its own complete response display (Body, Headers, Cookies, Performance).
 */

import { ResponseEditor } from './responseEditor.bundle.js';

export class ResponseContainerManager {
    constructor() {
        this.parentContainer = document.getElementById('workspace-response-container');
        this.containers = new Map(); // Map of tabId -> container elements + ResponseEditor instances
        this.activeTabId = null;
    }

    /**
     * Get or create response container for a workspace tab
     * @param {string} tabId - Workspace tab ID
     * @returns {Object} Container elements
     */
    getOrCreateContainer(tabId) {
        if (this.containers.has(tabId)) {
            return this.containers.get(tabId);
        }

        const container = this._createContainer(tabId);
        this.containers.set(tabId, container);

        return container;
    }

    /**
     * Show container for specific workspace tab, hide others
     * @param {string} tabId - Workspace tab ID to show
     */
    showContainer(tabId) {
        this.activeTabId = tabId;

        // Ensure container exists
        this.getOrCreateContainer(tabId);

        this.containers.forEach((container, id) => {
            if (id === tabId) {
                container.wrapper.style.display = 'block';
            } else {
                container.wrapper.style.display = 'none';
            }
        });
    }

    /**
     * Get DOM elements for currently active workspace tab
     * @returns {Object|null} DOM elements
     */
    getActiveElements() {
        if (!this.activeTabId) {
            return null;
        }
        return this.getOrCreateContainer(this.activeTabId);
    }

    /**
     * Remove container for a workspace tab
     * @param {string} tabId - Workspace tab ID
     */
    removeContainer(tabId) {
        const container = this.containers.get(tabId);
        if (container && container.wrapper.parentNode) {
            container.wrapper.parentNode.removeChild(container.wrapper);
        }
        this.containers.delete(tabId);
    }

    /**
     * Create a new response container for a workspace tab
     * @private
     */
    _createContainer(tabId) {
        const wrapper = document.createElement('div');
        wrapper.className = 'workspace-tab-response';
        wrapper.dataset.tabId = tabId;
        wrapper.style.display = 'none';
        wrapper.style.height = '100%';

        wrapper.innerHTML = `
            <div id="response-body-${tabId}" class="tab-content active" role="tabpanel">
                <div class="response-body-toolbar">
                    <div class="language-selector-container">
                        <select class="language-selector" data-tab-id="${tabId}" aria-label="Syntax Highlighting Language" title="Syntax Highlighting">
                            <option value="auto">Auto</option>
                            <option value="json">JSON</option>
                            <option value="xml">XML</option>
                            <option value="html">HTML</option>
                            <option value="text">Plain Text</option>
                        </select>
                        <svg class="select-arrow" width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="2 4 6 8 10 4"></polyline>
                        </svg>
                    </div>
                    <button class="copy-response-btn" data-tab-id="${tabId}" aria-label="Copy Response" title="Copy Response Body">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                        </svg>
                    </button>
                </div>
                <div class="response-body-container" data-tab-id="${tabId}" aria-live="polite"></div>
            </div>

            <div id="response-headers-${tabId}" class="tab-content" role="tabpanel">
                <pre class="response-headers-display" data-tab-id="${tabId}" aria-live="polite"></pre>
            </div>

            <div id="response-cookies-${tabId}" class="tab-content" role="tabpanel">
                <div class="response-cookies-display" data-tab-id="${tabId}" aria-live="polite"></div>
            </div>

            <div id="response-performance-${tabId}" class="tab-content" role="tabpanel">
                <div class="response-performance-display" data-tab-id="${tabId}" aria-live="polite">
                    <p class="no-data">Send a request to see performance metrics</p>
                </div>
            </div>
        `;

        this.parentContainer.appendChild(wrapper);

        const bodyContainer = wrapper.querySelector('.response-body-container');
        const languageSelector = wrapper.querySelector('.language-selector');

        // Create ResponseEditor instance for this tab
        const editor = new ResponseEditor(bodyContainer);

        // Set up callback to update dropdown when language changes
        editor.onLanguageChange = (lang) => {
            if (languageSelector) {
                languageSelector.value = lang;
            }
        };

        // Set up language selector change handler
        if (languageSelector) {
            languageSelector.addEventListener('change', (e) => {
                const selectedLang = e.target.value;
                if (editor) {
                    editor.setLanguage(selectedLang);
                }
            });
        }

        return {
            wrapper,
            tabId,
            bodyContainer,
            headersDisplay: wrapper.querySelector('.response-headers-display'),
            cookiesDisplay: wrapper.querySelector('.response-cookies-display'),
            performanceDisplay: wrapper.querySelector('.response-performance-display'),
            languageSelector,
            copyBtn: wrapper.querySelector('.copy-response-btn'),
            editor // Include editor instance
        };
    }
}
