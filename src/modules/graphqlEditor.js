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
 * @param {string} text
 * @returns {HTMLElement}
 */
function createPlaceholderElement(text) {
    const el = document.createElement('div');
    el.textContent = text;
    el.style.cssText = 'display:block; height:0; overflow:visible; white-space:pre;';
    return el;
}

export class GraphQLEditor {
    constructor(containerElement) {
        this.container = containerElement;
        this.view = null;
        this.changeCallback = null;
        this._themed = null;
        this.init();
    }

    /** @returns {Array} */
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

    destroy() {
        this._themed?.dispose();
        this._themed = null;
        if (this.view) {
            this.view.destroy();
            this.view = null;
        }
    }

    /** @param {Function} callback */
    onChange(callback) {
        this.changeCallback = callback;
    }

    /** @param {string} content */
    setContent(content) {
        this.view.dispatch({
            changes: {
                from: 0,
                to: this.view.state.doc.length,
                insert: content || ''
            }
        });
    }

    /** @returns {string} */
    getContent() {
        return this.view.state.doc.toString();
    }

    /** @returns {Array<{name: string|null, type: string}>|null} */
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

    clear() {
        this.setContent('');
    }

    focus() {
        this.view.focus();
    }

    /** @param {import('graphql').GraphQLSchema} schema */
    setSchema(schema) {
        if (this.view) {
            updateSchema(this.view, schema);
        }
    }

    clearSchema() {
        if (this.view) {
            updateSchema(this.view, undefined);
        }
    }

    /** @returns {Error|null} */
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
