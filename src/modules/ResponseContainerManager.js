
import { createLazyEditorProxy } from './editorLoader.js';
import { templateLoader } from './templateLoader.js';
import { attachCopyHandler, attachHeadersCopyHandler } from './copyHandler.js';
import { attachSaveResponseHandler } from './responseSaver.js';
import { PreviewManager } from './PreviewManager.js';

const PANEL_ROLES = [
    'response-body',
    'response-headers',
    'response-metadata',
    'response-cookies',
    'response-trailers',
    'response-performance',
    'response-scripts'
];

const TAB_SCOPED_SELECTORS = [
    '.language-selector',
    '.preview-mode-buttons',
    '.preview-mode-btn',
    '.copy-response-btn',
    '.save-response-btn',
    '.copy-headers-btn',
    '.response-body-container',
    '.response-preview-container',
    '.response-headers-display',
    '.response-metadata-display',
    '.response-cookies-display',
    '.response-trailers-display',
    '.response-performance-display',
    '.response-scripts-display'
];

export class ResponseContainerManager {
    constructor(previewRepository) {
        this.parentContainer = document.getElementById('workspace-response-container');
        this.containers = new Map();
        this.activeTabId = null;
        this.previewRepository = previewRepository;
        this.previewManager = new PreviewManager(previewRepository);
        this._scrollPinInstalled = false;
    }

    /**
     * @param {string} tabId
     * @returns {Object}
     */
    getOrCreateContainer(tabId) {
        if (this.containers.has(tabId)) {
            return this.containers.get(tabId);
        }

        const container = this._createContainer(tabId);
        this.containers.set(tabId, container);

        return container;
    }

    /** @param {string} tabId */
    showContainer(tabId) {
        this.activeTabId = tabId;

        this.getOrCreateContainer(tabId);

        this.containers.forEach((container, id) => {
            if (id === tabId) {
                container.wrapper.classList.remove('is-hidden');
            } else {
                container.wrapper.classList.add('is-hidden');
            }
        });
    }

    /** @returns {Object|null} */
    getActiveElements() {
        if (!this.activeTabId) {
            return null;
        }
        return this.getOrCreateContainer(this.activeTabId);
    }

    /** @param {string} tabId */
    removeContainer(tabId) {
        const container = this.containers.get(tabId);
        if (container) {
            if (container.editor && typeof container.editor.destroy === 'function') {
                container.editor.destroy();
            }
            if (container.headersEditor && typeof container.headersEditor.destroy === 'function') {
                container.headersEditor.destroy();
            }
            
            if (container.wrapper.parentNode) {
                container.wrapper.parentNode.removeChild(container.wrapper);
            }
        }
        this.containers.delete(tabId);

        if (this.previewManager) {
            this.previewManager.removeContainer(tabId);
        }
    }

    _createContainer(tabId) {
        const fragment = templateLoader.cloneSync(
            './src/templates/response/responseContainer.html',
            'tpl-response-container'
        );
        const wrapper = fragment.firstElementChild;
        wrapper.dataset.tabId = tabId;

        for (const role of PANEL_ROLES) {
            wrapper.querySelector(`[data-role="${role}"]`).id = `${role}-${tabId}`;
        }
        wrapper.querySelectorAll(TAB_SCOPED_SELECTORS.join(', ')).forEach((el) => {
            el.dataset.tabId = tabId;
        });

        this.parentContainer.appendChild(wrapper);

        const bodyContainer = wrapper.querySelector('.response-body-container');
        const languageSelector = wrapper.querySelector('.language-selector');
        const previewContainer = wrapper.querySelector('.response-preview-container');
        const codeBtn = wrapper.querySelector('.preview-mode-btn[data-mode="code"]');
        const previewBtn = wrapper.querySelector('.preview-mode-btn[data-mode="preview"]');

        const editor = createLazyEditorProxy('response', bodyContainer);

        const headersContainer = wrapper.querySelector('.response-headers-display');
        const headersEditor = createLazyEditorProxy('response', headersContainer);
        headersEditor.setContent('', 'application/json');

        const mainContentArea = document.getElementById('main-content-area');
        if (mainContentArea && !this._scrollPinInstalled) {
            this._scrollPinInstalled = true;
            mainContentArea.addEventListener('scroll', () => {
                if (mainContentArea.scrollTop !== 0) {
                    mainContentArea.scrollTop = 0;
                }
            });
        }

        if (this.previewManager && previewContainer && codeBtn && previewBtn) {
            this.previewManager.initializeForTab(tabId, previewContainer, bodyContainer, editor, codeBtn, previewBtn);
        }

        editor.onLanguageChange((lang) => {
            if (languageSelector) {
                languageSelector.value = lang || 'text';
            }
            if (this.previewManager) {
                this.previewManager.updateButtonState(tabId, lang);
            }
        });

        if (languageSelector) {
            languageSelector.addEventListener('change', (e) => {
                const selectedLang = e.target.value;
                if (editor) {
                    editor.setLanguage(selectedLang);
                }
            });
        }

        const copyBtn = wrapper.querySelector('.copy-response-btn');
        if (copyBtn) {
            attachCopyHandler(copyBtn, tabId);
        }
        attachSaveResponseHandler(wrapper.querySelector('.save-response-btn'), tabId);
        attachHeadersCopyHandler(wrapper.querySelector('.copy-headers-btn'), tabId);

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
            previewManager: this.previewManager,
            renderedResponse: null
        };
    }
}
