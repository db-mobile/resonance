/**
 * @fileoverview Schema Editor using CodeMirror for JSON Schema editing
 * @module schemaEditor
 */

import { EditorView, lineNumbers, placeholder, keymap } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { json } from '@codemirror/lang-json';
import { history, defaultKeymap, historyKeymap } from '@codemirror/commands';
import { createThemedHighlighting } from './editorTheme.js';
import { debounce } from './utils/debounce.js';

export class SchemaEditor {
    constructor(containerElement, options = {}) {
        this.container = containerElement;
        this.view = null;
        this.changeCallback = options.onChange || null;
        this._debouncedChange = debounce(() => {
            if (this.changeCallback) {
                this.changeCallback(this.getContent());
            }
        }, 500);
        this._suppressChange = false;
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
            keymap.of([...defaultKeymap, ...historyKeymap]),
            EditorView.lineWrapping,
            json(),
            placeholder('{\n  "type": "object",\n  "properties": {}\n}'),
            EditorView.updateListener.of((update) => {
                if (update.docChanged && !this._suppressChange) {
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
        this._themed.attach(this.view);
    }

    _handleChange() {
        this._debouncedChange();
    }

    /** @param {Function} callback */
    onChange(callback) {
        this.changeCallback = callback;
    }

    /**
     * @param {string} content
     * @param {{emitChange?: boolean}} [options]
     */
    setContent(content, { emitChange = true } = {}) {
        if (!this.view) {
            return;
        }

        const currentContent = this.getContent();
        if (currentContent === content) {
            return;
        }

        this._suppressChange = !emitChange;
        try {
            this.view.dispatch({
                changes: {
                    from: 0,
                    to: this.view.state.doc.length,
                    insert: content || ''
                }
            });
        } finally {
            this._suppressChange = false;
        }
    }

    /**
     * @param {Object|null} schema
     * @param {{emitChange?: boolean}} [options]
     */
    setSchema(schema, options) {
        if (schema === null || schema === undefined) {
            this.setContent('', options);
        } else {
            try {
                this.setContent(JSON.stringify(schema, null, 2), options);
            } catch {
                this.setContent('', options);
            }
        }
    }

    /** @returns {Object|null} */
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

    /** @returns {boolean} */
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

    /** @returns {string} */
    getContent() {
        return this.view ? this.view.state.doc.toString() : '';
    }

    clear() {
        this.setContent('');
    }

    focus() {
        if (this.view) {
            this.view.focus();
        }
    }

    destroy() {
        this._debouncedChange.cancel();
        this._themed?.dispose();
        this._themed = null;
        if (this.view) {
            this.view.destroy();
            this.view = null;
        }
    }
}
