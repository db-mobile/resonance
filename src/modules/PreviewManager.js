import { PreviewRenderer } from './ui/PreviewRenderer.js';

export class PreviewManager {
    constructor(previewRepository) {
        this.previewRepository = previewRepository;
        this.containers = new Map();
    }

    /**
     * @param {string} tabId
     * @param {HTMLElement} previewContainer
     * @param {HTMLElement} codeContainer
     * @param {ResponseEditor} responseEditor
     * @param {HTMLElement} codeBtn
     * @param {HTMLElement} previewBtn
     */
    initializeForTab(tabId, previewContainer, codeContainer, responseEditor, codeBtn, previewBtn) {
        const renderer = new PreviewRenderer(previewContainer);

        this.containers.set(tabId, {
            previewContainer,
            codeContainer,
            editor: responseEditor,
            codeBtn,
            previewBtn,
            renderer
        });

        codeContainer.classList.remove('is-hidden');
        previewContainer.classList.add('is-hidden');

        codeBtn.addEventListener('click', () => {
            this.showCode(tabId);
        });

        previewBtn.addEventListener('click', () => {
            this.showPreview(tabId);
        });

        const isPreviewMode = this.previewRepository.getPreviewMode(tabId);
        if (isPreviewMode) {
            this._updateButtonState(tabId, true);
        }
    }

    /** @param {string} tabId */
    showCode(tabId) {
        const container = this.containers.get(tabId);
        if (!container) {
            return;
        }

        container.previewContainer.classList.add('is-hidden');
        container.codeContainer.classList.remove('is-hidden');

        this._updateButtonState(tabId, false);

        this.previewRepository.setPreviewMode(tabId, false);
    }

    /** @param {string} tabId */
    showPreview(tabId) {
        const container = this.containers.get(tabId);
        if (!container) {
            return;
        }

        if (!this.isPreviewable(container.editor.currentLanguage)) {
            return;
        }

        container.codeContainer.classList.add('is-hidden');
        container.previewContainer.classList.remove('is-hidden');

        const content = container.editor.getContent();
        const language = container.editor.currentLanguage;
        container.renderer.render(content, language);

        this._updateButtonState(tabId, true);

        this.previewRepository.setPreviewMode(tabId, true);
    }

    /** @param {string} tabId */
    togglePreview(tabId) {
        const currentMode = this.previewRepository.getPreviewMode(tabId);
        if (currentMode) {
            this.showCode(tabId);
        } else {
            this.showPreview(tabId);
        }
    }

    _updateButtonState(tabId, isPreviewMode) {
        const container = this.containers.get(tabId);
        if (!container) {
            return;
        }

        if (isPreviewMode) {
            container.codeBtn.classList.remove('active');
            container.previewBtn.classList.add('active');
        } else {
            container.codeBtn.classList.add('active');
            container.previewBtn.classList.remove('active');
        }
    }

    /**
     * @param {string} contentType
     * @returns {boolean}
     */
    isPreviewable(contentType) {
        return contentType === 'json' || contentType === 'html' || contentType === 'xml';
    }

    /**
     * @param {string} tabId
     * @param {string} content
     * @param {string} contentType
     */
    updatePreview(tabId, content, contentType) {
        const container = this.containers.get(tabId);
        if (!container) {
            return;
        }

        if (this.isPreviewMode(tabId)) {
            container.renderer.render(content, contentType);
        }
    }

    /**
     * @param {string} tabId
     * @param {string} content
     * @param {string} contentType
     */
    refreshPreviewContent(tabId, content, contentType) {
        const container = this.containers.get(tabId);
        if (!container) {
            return;
        }

        if (!this.isPreviewMode(tabId)) {
            return;
        }

        container.renderer.render(content, contentType);
    }

    /** @param {string} tabId */
    clearPreview(tabId) {
        const container = this.containers.get(tabId);
        if (container) {
            container.renderer.clear();
        }
    }

    /**
     * @param {string} tabId
     * @returns {boolean}
     */
    isPreviewMode(tabId) {
        return this.previewRepository.getPreviewMode(tabId);
    }

    /**
     * @param {string} tabId
     * @param {string} contentType
     */
    updateButtonState(tabId, contentType) {
        const container = this.containers.get(tabId);
        if (!container) {
            return;
        }

        const isPreviewable = this.isPreviewable(contentType);

        container.previewBtn.disabled = !isPreviewable;

        container.codeBtn.disabled = false;

        if (!isPreviewable && this.isPreviewMode(tabId)) {
            this.showCode(tabId);
        }
    }

    /** @param {string} tabId */
    removeContainer(tabId) {
        const container = this.containers.get(tabId);
        if (container) {
            if (container.renderer) {
                container.renderer.clear();
            }
            container.codeBtn = null;
            container.previewBtn = null;
            container.editor = null;
            container.renderer = null;
        }
        this.containers.delete(tabId);
        this.previewRepository.removePreviewMode(tabId);
    }
}
