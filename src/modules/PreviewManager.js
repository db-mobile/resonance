/**
 * PreviewManager
 *
 * Manages preview mode toggling and coordination between code view and preview view.
 * Follows existing pattern from authManager.js and collectionManager.js
 */
import { PreviewRenderer } from './ui/PreviewRenderer.js';

export class PreviewManager {
    constructor(previewRepository) {
        this.previewRepository = previewRepository;
        this.containers = new Map();
    }

    /**
     * Initialize preview for a workspace tab
     * @param {string} tabId - Workspace tab ID
     * @param {HTMLElement} previewContainer - Preview container element
     * @param {HTMLElement} codeContainer - Code editor container
     * @param {ResponseEditor} responseEditor - ResponseEditor instance
     * @param {HTMLElement} codeBtn - Code view button
     * @param {HTMLElement} previewBtn - Preview view button
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

    /**
     * Show code view
     * @param {string} tabId - Workspace tab ID
     */
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

    /**
     * Show preview view
     * @param {string} tabId - Workspace tab ID
     */
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

    /**
     * Toggle between code and preview mode
     * @param {string} tabId - Workspace tab ID
     */
    togglePreview(tabId) {
        const currentMode = this.previewRepository.getPreviewMode(tabId);
        if (currentMode) {
            this.showCode(tabId);
        } else {
            this.showPreview(tabId);
        }
    }

    /**
     * Update button visual state
     * @private
     */
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
     * Check if content type supports preview
     * @param {string} contentType - Content type or language
     * @returns {boolean}
     */
    isPreviewable(contentType) {
        return contentType === 'json' || contentType === 'html' || contentType === 'xml';
    }

    /**
     * Update preview content (only if currently in preview mode)
     * @param {string} tabId - Workspace tab ID
     * @param {string} content - Response content
     * @param {string} contentType - Content type or language
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
     * Refresh preview content regardless of current view mode
     * This ensures preview is always up-to-date when user switches to it
     * @param {string} tabId - Workspace tab ID
     * @param {string} content - Response content
     * @param {string} contentType - Content type or language
     */
    refreshPreviewContent(tabId, content, contentType) {
        const container = this.containers.get(tabId);
        if (!container) {
            return;
        }

        container.renderer.render(content, contentType);
    }

    /**
     * Clear preview
     * @param {string} tabId - Workspace tab ID
     */
    clearPreview(tabId) {
        const container = this.containers.get(tabId);
        if (container) {
            container.renderer.clear();
        }
    }

    /**
     * Get preview mode state
     * @param {string} tabId - Workspace tab ID
     * @returns {boolean} - True if preview mode active
     */
    isPreviewMode(tabId) {
        return this.previewRepository.getPreviewMode(tabId);
    }

    /**
     * Update button enabled/disabled state based on content type
     * @param {string} tabId - Workspace tab ID
     * @param {string} contentType - Content type or language
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

    /**
     * Remove container reference when tab is closed
     * @param {string} tabId - Workspace tab ID
     */
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
