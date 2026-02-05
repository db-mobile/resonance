/**
 * ResponseContainerManager
 *
 * Manages separate response display areas for each workspace tab.
 * Each workspace tab gets its own complete response display (Body, Headers, Cookies, Performance).
 */

import { ResponseEditor } from './responseEditor.bundle.js';
import { templateLoader } from './templateLoader.js';
import { attachCopyHandler, attachHeadersCopyHandler } from './copyHandler.js';
import { PreviewManager } from './PreviewManager.js';

export class ResponseContainerManager {
    constructor(previewRepository) {
        this.parentContainer = document.getElementById('workspace-response-container');
        this.containers = new Map(); // Map of tabId -> container elements + ResponseEditor instances
        this.activeTabId = null;
        this.previewRepository = previewRepository;
        this.previewManager = new PreviewManager(previewRepository);
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
                container.wrapper.classList.remove('is-hidden');
            } else {
                container.wrapper.classList.add('is-hidden');
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

        // Clean up preview manager
        if (this.previewManager) {
            this.previewManager.removeContainer(tabId);
        }
    }

    /**
     * Create a new response container for a workspace tab
     * @private
     */
    _createContainer(tabId) {
        const fragment = templateLoader.cloneSync(
            './src/templates/response/responseContainer.html',
            'tpl-response-container'
        );
        const wrapper = fragment.firstElementChild;
        wrapper.dataset.tabId = tabId;

        // Set tab-specific IDs and data-tab-id attributes
        const bodyPanel = wrapper.querySelector('[data-role="response-body"]');
        bodyPanel.id = `response-body-${tabId}`;
        wrapper.querySelector('[data-role="response-headers"]').id = `response-headers-${tabId}`;
        wrapper.querySelector('[data-role="response-metadata"]').id = `response-metadata-${tabId}`;
        wrapper.querySelector('[data-role="response-cookies"]').id = `response-cookies-${tabId}`;
        wrapper.querySelector('[data-role="response-trailers"]').id = `response-trailers-${tabId}`;
        wrapper.querySelector('[data-role="response-performance"]').id = `response-performance-${tabId}`;
        wrapper.querySelector('[data-role="response-scripts"]').id = `response-scripts-${tabId}`;

        // Set data-tab-id on interactive elements
        wrapper.querySelector('.language-selector').dataset.tabId = tabId;
        wrapper.querySelector('.preview-mode-buttons').dataset.tabId = tabId;
        wrapper.querySelectorAll('.preview-mode-btn').forEach(btn => btn.dataset.tabId = tabId);
        wrapper.querySelector('.copy-response-btn').dataset.tabId = tabId;
        const headersCopyBtn = wrapper.querySelector('.copy-headers-btn');
        if (headersCopyBtn) { headersCopyBtn.dataset.tabId = tabId; }
        wrapper.querySelector('.response-body-container').dataset.tabId = tabId;
        wrapper.querySelector('.response-preview-container').dataset.tabId = tabId;
        wrapper.querySelector('.response-headers-display').dataset.tabId = tabId;
        wrapper.querySelector('.response-metadata-display').dataset.tabId = tabId;
        wrapper.querySelector('.response-cookies-display').dataset.tabId = tabId;
        wrapper.querySelector('.response-trailers-display').dataset.tabId = tabId;
        wrapper.querySelector('.response-performance-display').dataset.tabId = tabId;
        wrapper.querySelector('.response-scripts-display').dataset.tabId = tabId;

        this.parentContainer.appendChild(wrapper);

        const bodyContainer = wrapper.querySelector('.response-body-container');
        const languageSelector = wrapper.querySelector('.language-selector');
        const previewContainer = wrapper.querySelector('.response-preview-container');
        const codeBtn = wrapper.querySelector('.preview-mode-btn[data-mode="code"]');
        const previewBtn = wrapper.querySelector('.preview-mode-btn[data-mode="preview"]');

        // Create ResponseEditor instance for this tab
        const editor = new ResponseEditor(bodyContainer);

        // Create ResponseEditor instance for headers tab (JSON display)
        const headersContainer = wrapper.querySelector('.response-headers-display');
        const headersEditor = new ResponseEditor(headersContainer);
        headersEditor.setContent('', 'application/json');

        // Initialize PreviewManager for this tab
        if (this.previewManager && previewContainer && codeBtn && previewBtn) {
            this.previewManager.initializeForTab(tabId, previewContainer, bodyContainer, editor, codeBtn, previewBtn);
        }

        // Set up callback to update dropdown when language changes
        editor.onLanguageChange((lang) => {
            if (languageSelector) {
                languageSelector.value = lang;
            }
            // Update preview button state based on new language
            if (this.previewManager) {
                this.previewManager.updateButtonState(tabId, lang);
            }
        });

        // Set up language selector change handler
        if (languageSelector) {
            languageSelector.addEventListener('change', (e) => {
                const selectedLang = e.target.value;
                if (editor) {
                    editor.setLanguage(selectedLang);
                }
            });
        }

        // Get the copy button and attach handler
        const copyBtn = wrapper.querySelector('.copy-response-btn');
        if (copyBtn) {
            attachCopyHandler(copyBtn, tabId);
        }

        // Get the headers copy button and attach handler
        const copyHeadersBtn = wrapper.querySelector('.copy-headers-btn');
        if (copyHeadersBtn) {
            attachHeadersCopyHandler(copyHeadersBtn, tabId);
        }

        return {
            wrapper,
            tabId,
            bodyContainer,
            headersDisplay: headersContainer,
            headersEditor,
            metadataDisplay: wrapper.querySelector('.response-metadata-display'),
            cookiesDisplay: wrapper.querySelector('.response-cookies-display'),
            trailersDisplay: wrapper.querySelector('.response-trailers-display'),
            performanceDisplay: wrapper.querySelector('.response-performance-display'),
            scriptsDisplay: wrapper.querySelector('.response-scripts-display'),
            languageSelector,
            copyBtn,
            editor,
            previewContainer,
            codeBtn,
            previewBtn,
            previewManager: this.previewManager
        };
    }
}
