/**
 * @fileoverview Script Editor using CodeMirror for JavaScript code editing
 * @module scriptEditor
 */

import { EditorView, lineNumbers, placeholder, keymap } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { javascript } from '@codemirror/lang-javascript';
import { history, defaultKeymap, historyKeymap } from '@codemirror/commands';
import { searchKeymap, highlightSelectionMatches, search } from '@codemirror/search';
import { createThemedHighlighting } from './editorTheme.js';

export class ScriptEditor {
    constructor(containerElement) {
        this.container = containerElement;
        this.view = null;
        this.changeCallback = null;
        this._suppressChange = false;
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
        const extensions = [
            lineNumbers(),
            history(),
            keymap.of([...defaultKeymap, ...historyKeymap]),
            EditorView.lineWrapping,
            javascript(),
            ...this.getSearchExtensions(),
            placeholder('// Write your script here...'),
            EditorView.updateListener.of((update) => {
                if (update.docChanged && this.changeCallback && !this._suppressChange) {
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

    /** @param {Function} callback */
    onChange(callback) {
        this.changeCallback = callback;
    }

    /**
     * @param {string} content
     * @param {{emitChange?: boolean}} [options]
     */
    setContent(content, { emitChange = true } = {}) {
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

    /** @returns {string} */
    getContent() {
        return this.view.state.doc.toString();
    }

    /** @param {{emitChange?: boolean}} [options] */
    clear(options) {
        this.setContent('', options);
    }

    focus() {
        this.view.focus();
    }

    destroy() {
        this._themed?.dispose();
        this._themed = null;
        if (this.view) {
            this.view.destroy();
            this.view = null;
        }
    }
}
