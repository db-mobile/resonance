import { EditorView, lineNumbers, keymap } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { json } from '@codemirror/lang-json';
import { history, defaultKeymap, historyKeymap } from '@codemirror/commands';
import { searchKeymap, highlightSelectionMatches, search } from '@codemirror/search';
import { createThemedHighlighting } from './editorTheme.js';

/**
 * RequestBodyEditor - Manages CodeMirror editor for request body input
 * Provides syntax highlighting for JSON with line numbers and editing capability
 */
export class RequestBodyEditor {
    constructor(containerElement, options = {}) {
        this.container = containerElement;
        this.view = null;
        this.changeCallback = null;
        this.language = options.language === 'plain' ? 'plain' : 'json';
        this._themed = null;
        this.init();
    }

    /**
     * Get theme extensions based on current color scheme
     * @returns {Array} Array of theme extensions
     */
    getThemeExtensions() {
        return [this._themed.extension];
    }

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

    /**
     * Initialize the CodeMirror editor
     */
    init() {
        this._themed = createThemedHighlighting();
        const extensions = [
            lineNumbers(),
            history(),
            keymap.of([...defaultKeymap, ...historyKeymap]),
            EditorView.editable.of(true), // Editable
            EditorView.lineWrapping,
            ...this.getSearchExtensions(),
            EditorView.updateListener.of((update) => {
                // Call change callback if content changed
                if (update.docChanged && this.changeCallback) {
                    this.changeCallback(this.getContent());
                }
            }),
            ...this.getThemeExtensions()
        ];

        if (this.language === 'json') {
            extensions.splice(5, 0, json());
        }

        const state = EditorState.create({
            doc: '',
            extensions
        });

        this.view = new EditorView({
            state,
            parent: this.container
        });
        this._themed.attach(this.view);
    }

    /**
     * Set content in the editor
     * @param {string} content - The content to set
     */
    setContent(content) {
        const transaction = this.view.state.update({
            changes: {
                from: 0,
                to: this.view.state.doc.length,
                insert: content
            }
        });
        this.view.dispatch(transaction);
    }

    /**
     * Get the current editor content
     * @returns {string}
     */
    getContent() {
        return this.view.state.doc.toString();
    }

    /**
     * Clear the editor content
     */
    clear() {
        this.setContent('');
    }

    /**
     * Set a callback to be called when content changes
     * @param {function} callback - Function to call with new content
     */
    onChange(callback) {
        this.changeCallback = callback;
    }

    /**
     * Format the JSON content
     * @returns {boolean} - True if formatting succeeded, false otherwise
     */
    formatJSON() {
        if (this.language !== 'json') {
            return true;
        }
        try {
            const content = this.getContent().trim();
            if (!content) {
                return true; // Empty content is valid
            }
            const parsed = JSON.parse(content);
            const formatted = JSON.stringify(parsed, null, 2);
            this.setContent(formatted);
            return true;
        } catch {
            // Invalid JSON, don't format
            return false;
        }
    }

    /**
     * Focus the editor
     */
    focus() {
        this.view.focus();
    }

    /**
     * Destroy the editor instance
     */
    destroy() {
        this._themed?.dispose();
        this._themed = null;
        if (this.view) {
            this.view.destroy();
            this.view = null;
        }
    }
}
