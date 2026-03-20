import { EditorView, lineNumbers, keymap } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { json } from '@codemirror/lang-json';
import { xml } from '@codemirror/lang-xml';
import { html } from '@codemirror/lang-html';
import { syntaxHighlighting, HighlightStyle } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { searchKeymap, highlightSelectionMatches, search, openSearchPanel } from '@codemirror/search';
import { isDarkMode, darkHighlighting } from './editorTheme.js';

// Light theme syntax highlighting style
const lightHighlightStyle = HighlightStyle.define([
    { tag: tags.keyword, color: '#b91c1c' },
    { tag: tags.atom, color: '#0369a1' },
    { tag: tags.bool, color: '#0369a1' },
    { tag: tags.null, color: '#0369a1' },
    { tag: tags.number, color: '#1d4ed8' },
    { tag: tags.string, color: '#15803d' },
    { tag: tags.propertyName, color: '#6d28d9' },
    { tag: tags.comment, color: '#475569', fontStyle: 'italic' },
    { tag: tags.operator, color: '#b91c1c' },
    { tag: tags.punctuation, color: '#0f172a' },
    { tag: tags.bracket, color: '#0f172a' },
    { tag: tags.tagName, color: '#15803d' },
    { tag: tags.attributeName, color: '#6d28d9' },
    { tag: tags.attributeValue, color: '#1e3a8a' },
]);

/**
 * ResponseEditor - Manages CodeMirror editor for response display
 * Provides syntax highlighting for JSON, XML, and HTML with line numbers
 */
export class ResponseEditor {
    constructor(containerElement) {
        this.container = containerElement;
        this.view = null;
        this.currentLanguage = null;
        this.currentContentType = null;
        this.manualLanguageOverride = null;
        this.languageChangeCallback = null;
        this.init();
    }

    /**
     * Get theme extensions based on current color scheme
     * @returns {Array} Array of theme extensions
     */
    getThemeExtensions() {
        if (isDarkMode()) {
            return [darkHighlighting];
        }
        return [syntaxHighlighting(lightHighlightStyle)];
    }

    /**
     * Initialize the CodeMirror editor
     */
    /**
     * Get search extensions for Ctrl+F functionality
     * @returns {Array} Array of search extensions
     */
    getSearchExtensions() {
        return [
            search(),
            highlightSelectionMatches(),
            keymap.of(searchKeymap)
        ];
    }

    init() {
        const state = EditorState.create({
            doc: '',
            extensions: [
                lineNumbers(),
                EditorView.editable.of(false), // Read-only
                EditorView.contentAttributes.of({ tabindex: '0' }), // Make focusable for keyboard events
                EditorView.lineWrapping,
                ...this.getThemeExtensions(),
                ...this.getSearchExtensions()
            ]
        });

        this.view = new EditorView({
            state,
            parent: this.container
        });
    }

    /**
     * Detect language from Content-Type header
     * @param {string} contentType - The Content-Type header value
     * @returns {object|null} - Language extension or null
     */
    detectLanguageFromContentType(contentType) {
        if (!contentType) {return null;}

        const lowerContentType = contentType.toLowerCase();

        // JSON types
        if (lowerContentType.includes('application/json') ||
            lowerContentType.includes('application/ld+json') ||
            lowerContentType.includes('application/vnd.api+json')) {
            return { extension: json(), type: 'json' };
        }

        // XML types
        if (lowerContentType.includes('application/xml') ||
            lowerContentType.includes('text/xml') ||
            lowerContentType.includes('application/rss+xml') ||
            lowerContentType.includes('application/atom+xml')) {
            return { extension: xml(), type: 'xml' };
        }

        // HTML types
        if (lowerContentType.includes('text/html') ||
            lowerContentType.includes('application/xhtml+xml')) {
            return { extension: html(), type: 'html' };
        }

        return null;
    }

    /**
     * Detect content type and return appropriate language extension
     * @param {string} content - The response content
     * @returns {object|null} - Language extension or null
     */
    detectLanguage(content) {
        const trimmed = content.trim();

        // Try to detect JSON
        if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
            try {
                JSON.parse(trimmed);
                return { extension: json(), type: 'json' };
            } catch {
                // Not valid JSON
            }
        }

        // Detect XML
        if (trimmed.startsWith('<?xml') || trimmed.match(/^<[^>]+>/)) {
            // Check if it's HTML
            if (trimmed.toLowerCase().includes('<!doctype html') ||
                trimmed.toLowerCase().includes('<html')) {
                return { extension: html(), type: 'html' };
            }
            return { extension: xml(), type: 'xml' };
        }

        // Default to no highlighting
        return null;
    }

    /**
     * Get language extension by type name
     * @param {string} languageType - Language type ('json', 'xml', 'html', 'text')
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

    /**
     * Set a callback to be called when language changes
     * @param {function} callback - Function to call with language type
     */
    onLanguageChange(callback) {
        this.languageChangeCallback = callback;
    }

    /**
     * Manually set the language for syntax highlighting
     * @param {string} languageType - Language type ('json', 'xml', 'html', 'text')
     */
    setLanguage(languageType) {
        this.manualLanguageOverride = languageType;
        const content = this.getContent();
        this._updateEditorWithLanguage(content, languageType);
    }

    /**
     * Internal method to update editor with specific language
     * @param {string} content - The content to display
     * @param {string|null} languageType - Language type to use
     * @private
     */
    _updateEditorWithLanguage(content, languageType) {
        // Build extensions array
        const extensions = [
            lineNumbers(),
            EditorView.editable.of(false),
            EditorView.contentAttributes.of({ tabindex: '0' }), // Make focusable for keyboard events
            EditorView.lineWrapping,
            ...this.getThemeExtensions(),
            ...this.getSearchExtensions()
        ];

        // Add language extension if specified
        if (languageType && languageType !== 'text') {
            const language = this.getLanguageExtension(languageType);
            if (language) {
                extensions.push(language.extension);
            }
        }

        this.currentLanguage = languageType;

        // Update the editor state
        this.view.setState(EditorState.create({
            doc: content,
            extensions
        }));

        // Notify callback if registered
        if (this.languageChangeCallback) {
            this.languageChangeCallback(languageType);
        }
    }

    /**
     * Update editor content with syntax highlighting
     * @param {string} content - The content to display
     * @param {string|null} contentType - Optional Content-Type header
     */
    setContent(content, contentType = null) {
        this.currentContentType = contentType;

        // If manual override is set, use it
        if (this.manualLanguageOverride !== null) {
            this._updateEditorWithLanguage(content, this.manualLanguageOverride);
            return;
        }

        // Try to detect from content-type first
        let detectedLanguage = null;
        if (contentType) {
            detectedLanguage = this.detectLanguageFromContentType(contentType);
        }

        // Fall back to content-based detection if no content-type or not recognized
        if (!detectedLanguage) {
            detectedLanguage = this.detectLanguage(content);
        }

        const languageType = detectedLanguage ? detectedLanguage.type : null;
        this._updateEditorWithLanguage(content, languageType);
    }

    /**
     * Clear manual language override and redetect from content
     */
    clearLanguageOverride() {
        this.manualLanguageOverride = null;
        const content = this.getContent();
        this.setContent(content, this.currentContentType);
    }

    /**
     * Clear the editor content
     */
    clear() {
        this.setContent('');
    }

    /**
     * Get the current editor content
     * @returns {string}
     */
    getContent() {
        return this.view.state.doc.toString();
    }

    /**
     * Destroy the editor instance
     */
    destroy() {
        if (this.view) {
            this.view.destroy();
            this.view = null;
        }
    }

    /**
     * Open the search panel (Ctrl+F functionality)
     */
    openSearch() {
        if (this.view) {
            this.view.focus();
            openSearchPanel(this.view);
        }
    }
}
