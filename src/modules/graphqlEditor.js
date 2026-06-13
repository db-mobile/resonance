/**
 * @fileoverview GraphQL Editor using CodeMirror for GraphQL queries
 * @module graphqlEditor
 */

import { EditorView, lineNumbers, placeholder, keymap } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { graphql, updateSchema } from 'cm6-graphql';
import { parse, print } from 'graphql';
import { history, defaultKeymap, historyKeymap } from '@codemirror/commands';
import { autocompletion, completionKeymap } from '@codemirror/autocomplete';
import { createThemedHighlighting } from './editorTheme.js';

/**
 * Build a placeholder element for a multi-line example query. CodeMirror renders a
 * multi-line string placeholder inside the (single) empty first line, which inflates
 * that line's height and makes the caret span the whole example. Rendering it as a
 * zero-height, overflow-visible block keeps the example visible while leaving the
 * caret at the normal single-line height.
 * @param {string} text - Multi-line placeholder text
 * @returns {HTMLElement}
 */
function createPlaceholderElement(text) {
    const el = document.createElement('div');
    el.textContent = text;
    el.style.cssText = 'display:block; height:0; overflow:visible; white-space:pre;';
    return el;
}

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
            autocompletion(),
            keymap.of([...defaultKeymap, ...historyKeymap, ...completionKeymap]),
            EditorView.lineWrapping,
            graphql(),
            placeholder(createPlaceholderElement('query {\n  user(id: 1) {\n    name\n    email\n  }\n}')),
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
     * Parse the document and return its operation definitions.
     * @returns {Array<{name: string|null, type: string}>|null}
     *   One entry per operation (in document order); `null` if the document
     *   cannot be parsed, `[]` if it is empty.
     */
    getOperations() {
        const content = this.getContent().trim();
        if (!content) {
            return [];
        }
        try {
            return parse(content).definitions
                .filter(def => def.kind === 'OperationDefinition')
                .map(def => ({ name: def.name ? def.name.value : null, type: def.operation }));
        } catch (_error) {
            return null;
        }
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
     * Apply a GraphQL schema to the editor for autocomplete, validation and hover docs.
     * @param {import('graphql').GraphQLSchema} schema - Schema built via buildClientSchema()
     */
    setSchema(schema) {
        if (this.view) {
            updateSchema(this.view, schema);
        }
    }

    /**
     * Remove any schema previously applied to the editor.
     */
    clearSchema() {
        if (this.view) {
            updateSchema(this.view, undefined);
        }
    }

    /**
     * Format the GraphQL query by parsing it into an AST and pretty-printing.
     * Returns the parse error (if any) so callers can surface invalid syntax;
     * the document is left untouched when it cannot be parsed.
     * @returns {Error|null} The parse error, or null if formatting succeeded.
     */
    formatQuery() {
        const content = this.getContent().trim();
        if (!content) {
            return null;
        }

        try {
            this.setContent(print(parse(content)));
            return null;
        } catch (error) {
            return error;
        }
    }
}
