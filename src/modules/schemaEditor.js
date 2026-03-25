/**
 * @fileoverview Schema Editor using CodeMirror for JSON Schema editing
 * @module schemaEditor
 */

import { EditorView, lineNumbers, placeholder, keymap } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { json } from '@codemirror/lang-json';
import { syntaxHighlighting, HighlightStyle } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { history, defaultKeymap, historyKeymap } from '@codemirror/commands';
import { isDarkMode, darkHighlighting } from './editorTheme.js';

// Light theme syntax highlighting style for JSON Schema
const lightHighlightStyle = HighlightStyle.define([
    { tag: tags.propertyName, color: '#6d28d9' },
    { tag: tags.string, color: '#15803d' },
    { tag: tags.number, color: '#1d4ed8' },
    { tag: tags.bool, color: '#0369a1' },
    { tag: tags.null, color: '#0369a1' },
    { tag: tags.punctuation, color: '#0f172a' },
    { tag: tags.bracket, color: '#0f172a' },
]);

/**
 * SchemaEditor - CodeMirror editor for JSON Schema content
 */
export class SchemaEditor {
    constructor(containerElement, options = {}) {
        this.container = containerElement;
        this.view = null;
        this.changeCallback = options.onChange || null;
        this._debounceTimer = null;
        this.init();
    }

    /**
     * Get theme extensions based on current color scheme
     * @returns {Array} Array of theme extensions
     */
    getThemeExtensions() {
        const baseTheme = EditorView.theme({
            '&': {
                height: '100%',
                fontSize: '13px',
                backgroundColor: 'var(--bg-primary)'
            },
            '.cm-scroller': {
                fontFamily: '"Fira Code", "Courier New", monospace',
                overflow: 'auto'
            },
            '.cm-gutters': {
                backgroundColor: 'var(--bg-secondary)',
                color: 'var(--text-secondary)',
                border: 'none',
                paddingRight: '8px'
            },
            '.cm-content': {
                color: 'var(--text-primary)',
                caretColor: 'var(--text-primary)',
                padding: '4px 0'
            },
            '.cm-line': {
                padding: '0 8px'
            },
            '.cm-placeholder': {
                color: 'var(--text-tertiary)',
                fontStyle: 'italic'
            },
            '.cm-activeLine': {
                backgroundColor: 'var(--bg-secondary)'
            },
            '.cm-activeLineGutter': {
                backgroundColor: 'var(--bg-secondary)'
            }
        });

        if (isDarkMode()) {
            return [darkHighlighting, baseTheme];
        }
        return [syntaxHighlighting(lightHighlightStyle), baseTheme];
    }

    /**
     * Initialize the CodeMirror editor
     */
    init() {
        const extensions = [
            lineNumbers(),
            history(),
            keymap.of([...defaultKeymap, ...historyKeymap]),
            EditorView.lineWrapping,
            json(),
            placeholder('{\n  "type": "object",\n  "properties": {}\n}'),
            EditorView.updateListener.of((update) => {
                if (update.docChanged) {
                    this._handleChange();
                }
            }),
            ...this.getThemeExtensions()
        ];

        const state = EditorState.create({
            doc: '',
            extensions
        });

        this.view = new EditorView({
            state,
            parent: this.container
        });
    }

    /**
     * Handle content changes with debouncing
     * @private
     */
    _handleChange() {
        if (this._debounceTimer) {
            clearTimeout(this._debounceTimer);
        }
        this._debounceTimer = setTimeout(() => {
            if (this.changeCallback) {
                this.changeCallback(this.getContent());
            }
        }, 500);
    }

    /**
     * Register a callback for content changes
     * @param {Function} callback - Called when content changes
     */
    onChange(callback) {
        this.changeCallback = callback;
    }

    /**
     * Set editor content
     * @param {string} content - JSON string to set
     */
    setContent(content) {
        if (!this.view) {
            return;
        }
        
        const currentContent = this.getContent();
        if (currentContent === content) {
            return;
        }

        this.view.dispatch({
            changes: {
                from: 0,
                to: this.view.state.doc.length,
                insert: content || ''
            }
        });
    }

    /**
     * Sets the schema as a formatted JSON object
     * @param {Object|null} schema - Schema object to set
     */
    setSchema(schema) {
        if (schema === null || schema === undefined) {
            this.setContent('');
        } else {
            try {
                this.setContent(JSON.stringify(schema, null, 2));
            } catch {
                this.setContent('');
            }
        }
    }

    /**
     * Gets the schema as a parsed JSON object
     * @returns {Object|null} Parsed schema or null if invalid
     */
    getSchema() {
        const value = this.getContent().trim();
        if (!value) {
            return null;
        }

        try {
            return JSON.parse(value);
        } catch {
            return null;
        }
    }

    /**
     * Checks if the current content is valid JSON
     * @returns {boolean} True if valid JSON
     */
    isValidJson() {
        const value = this.getContent().trim();
        if (!value) {
            return true;
        }

        try {
            JSON.parse(value);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Get current editor content
     * @returns {string}
     */
    getContent() {
        return this.view ? this.view.state.doc.toString() : '';
    }

    /**
     * Clear editor content
     */
    clear() {
        this.setContent('');
    }

    /**
     * Focus the editor
     */
    focus() {
        if (this.view) {
            this.view.focus();
        }
    }

    /**
     * Destroy the editor instance
     */
    destroy() {
        if (this._debounceTimer) {
            clearTimeout(this._debounceTimer);
        }
        if (this.view) {
            this.view.destroy();
            this.view = null;
        }
    }
}
