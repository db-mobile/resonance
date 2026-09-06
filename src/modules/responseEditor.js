import { EditorView, lineNumbers, keymap } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { json } from '@codemirror/lang-json';
import { xml } from '@codemirror/lang-xml';
import { html } from '@codemirror/lang-html';
import { searchKeymap, highlightSelectionMatches, search, openSearchPanel } from '@codemirror/search';
import { createThemedHighlighting } from './editorTheme.js';

export class ResponseEditor {
    constructor(containerElement) {
        this.container = containerElement;
        this.view = null;
        this.currentLanguage = null;
        this.currentContentType = null;
        this.manualLanguageOverride = null;
        this.languageChangeCallback = null;
        this._themed = null;
        this.init();
    }

    /** @returns {Array} */
    getThemeExtensions() {
        return [this._themed.extension];
    }

    /** @returns {Array} */
    getSearchExtensions() {
        return [
            search(),
            highlightSelectionMatches(),
            keymap.of(searchKeymap)
        ];
    }

    init() {
        this._themed = createThemedHighlighting();
        const state = EditorState.create({
            doc: '',
            extensions: [
                lineNumbers(),
                EditorState.readOnly.of(true),
                EditorView.editable.of(false),
                EditorView.contentAttributes.of({ tabindex: '0' }),
                EditorView.lineWrapping,
                ...this.getThemeExtensions(),
                ...this.getSearchExtensions()
            ]
        });

        this.view = new EditorView({
            state,
            parent: this.container
        });
        this._themed.attach(this.view);
    }

    /**
     * @param {string} contentType
     * @returns {object|null}
     */
    detectLanguageFromContentType(contentType) {
        if (!contentType) {return null;}

        const lowerContentType = contentType.toLowerCase();

        if (lowerContentType.includes('application/json') ||
            lowerContentType.includes('application/ld+json') ||
            lowerContentType.includes('application/vnd.api+json')) {
            return { extension: json(), type: 'json' };
        }

        if (lowerContentType.includes('application/xml') ||
            lowerContentType.includes('text/xml') ||
            lowerContentType.includes('application/rss+xml') ||
            lowerContentType.includes('application/atom+xml')) {
            return { extension: xml(), type: 'xml' };
        }

        if (lowerContentType.includes('text/html') ||
            lowerContentType.includes('application/xhtml+xml')) {
            return { extension: html(), type: 'html' };
        }

        if (lowerContentType.includes('text/plain')) {
            return { type: 'text' };
        }

        return null;
    }

    /**
     * @param {string} content
     * @returns {object|null}
     */
    detectLanguage(content) {
        const trimmed = content.trim();

        if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
            try {
                JSON.parse(trimmed);
                return { extension: json(), type: 'json' };
            } catch {
            }
        }

        if (trimmed.startsWith('<?xml') || trimmed.match(/^<[^>]+>/)) {
            if (trimmed.toLowerCase().includes('<!doctype html') ||
                trimmed.toLowerCase().includes('<html')) {
                return { extension: html(), type: 'html' };
            }
            return { extension: xml(), type: 'xml' };
        }

        return null;
    }

    /**
     * @param {string} languageType
     * @returns {object|null}
     */
    getLanguageExtension(languageType) {
        switch (languageType) {
            case 'json':
                return { extension: json(), type: 'json' };
            case 'xml':
                return { extension: xml(), type: 'xml' };
            case 'html':
                return { extension: html(), type: 'html' };
            case 'text':
            default:
                return null;
        }
    }

    /** @param {function} callback */
    onLanguageChange(callback) {
        this.languageChangeCallback = callback;
    }

    /** @param {string} languageType */
    setLanguage(languageType) {
        this.manualLanguageOverride = languageType;
        const content = this.getContent();
        this._updateEditorWithLanguage(content, languageType);
    }

    /**
     * @param {string} content
     * @param {string|null} languageType
     */
    _updateEditorWithLanguage(content, languageType) {
        const extensions = [
            lineNumbers(),
            EditorState.readOnly.of(true),
            EditorView.editable.of(false),
            EditorView.contentAttributes.of({ tabindex: '0' }),
            EditorView.lineWrapping,
            ...this.getThemeExtensions(),
            ...this.getSearchExtensions()
        ];

        if (languageType && languageType !== 'text') {
            const language = this.getLanguageExtension(languageType);
            if (language) {
                extensions.push(language.extension);
            }
        }

        this.currentLanguage = languageType;

        this.view.setState(EditorState.create({
            doc: content,
            extensions
        }));

        if (this.languageChangeCallback) {
            this.languageChangeCallback(languageType);
        }
    }

    /**
     * @param {string} content
     * @param {string|null} contentType
     * @param {string} [languageHint]
     */
    setContent(content, contentType = null, languageHint = undefined) {
        this.currentContentType = contentType;

        if (this.manualLanguageOverride !== null) {
            this._updateEditorWithLanguage(content, this.manualLanguageOverride);
            return;
        }

        if (languageHint !== undefined && languageHint !== null) {
            this._updateEditorWithLanguage(content, languageHint);
            return;
        }

        let detectedLanguage = null;
        if (contentType) {
            detectedLanguage = this.detectLanguageFromContentType(contentType);
        }

        if (!detectedLanguage) {
            detectedLanguage = this.detectLanguage(content);
        }

        const languageType = detectedLanguage ? detectedLanguage.type : null;
        this._updateEditorWithLanguage(content, languageType);
    }

    clearLanguageOverride() {
        this.manualLanguageOverride = null;
        const content = this.getContent();
        this.setContent(content, this.currentContentType);
    }

    clear() {
        this.setContent('');
    }

    /** @returns {string} */
    getContent() {
        return this.view.state.doc.toString();
    }

    destroy() {
        this._themed?.dispose();
        this._themed = null;
        if (this.view) {
            this.view.destroy();
            this.view = null;
        }
    }

    openSearch() {
        if (this.view) {
            this.view.focus();
            openSearchPanel(this.view);
        }
    }
}
