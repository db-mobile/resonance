/**
 * @fileoverview GraphQL Editor using CodeMirror for GraphQL queries
 * @module graphqlEditor
 */

import { EditorView, lineNumbers, placeholder, keymap } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { graphql } from 'cm6-graphql';
import { history, defaultKeymap, historyKeymap } from '@codemirror/commands';
import { createThemedHighlighting } from './editorTheme.js';

/**
 * GraphQLEditor - CodeMirror editor for GraphQL queries
 */
export class GraphQLEditor {
    constructor(containerElement) {
        this.container = containerElement;
        this.view = null;
        this.changeCallback = null;
        this._themed = null;
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

        return [this._themed.extension, baseTheme];
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
            EditorView.lineWrapping,
            graphql(),
            placeholder('query {\n  user(id: 1) {\n    name\n    email\n  }\n}'),
            EditorView.updateListener.of((update) => {
                // Call change callback if content changed
                if (update.docChanged && this.changeCallback) {
                    this.changeCallback(this.getContent());
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
        this._themed.attach(this.view);
    }

    /**
     * Tear down theme listeners. Call when the editor is no longer used.
     */
    destroy() {
        this._themed?.dispose();
        this._themed = null;
        if (this.view) {
            this.view.destroy();
            this.view = null;
        }
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
     * @param {string} content - GraphQL query to set
     */
    setContent(content) {
        this.view.dispatch({
            changes: {
                from: 0,
                to: this.view.state.doc.length,
                insert: content || ''
            }
        });
    }

    /**
     * Get current editor content
     * @returns {string}
     */
    getContent() {
        return this.view.state.doc.toString();
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
        this.view.focus();
    }

    /**
     * Format the GraphQL query
     */
    formatQuery() {
        try {
            const content = this.getContent().trim();
            if (!content) {
                return;
            }

            // Basic formatting: add proper indentation
            // This is a simple implementation - for production use a proper GraphQL formatter
            const lines = content.split('\n');
            let indent = 0;
            const formatted = lines.map(line => {
                const trimmed = line.trim();
                if (trimmed.endsWith('}')) {
                    indent = Math.max(0, indent - 1);
                }
                const result = '  '.repeat(indent) + trimmed;
                if (trimmed.endsWith('{')) {
                    indent++;
                }
                return result;
            }).join('\n');

            this.setContent(formatted);
        } catch (error) {
            void error;
        }
    }
}
