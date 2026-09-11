/**
 * @fileoverview Shared lifecycle for the CodeMirror-backed editor wrappers.
 * @module editors/BaseCodeEditor
 */

import { EditorView, lineNumbers, keymap } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { history, defaultKeymap, historyKeymap } from '@codemirror/commands';
import { searchKeymap, highlightSelectionMatches, search } from '@codemirror/search';
import { createThemedHighlighting, baseEditorTheme } from '../editorTheme.js';

export class BaseCodeEditor {
    /**
     * @param {HTMLElement} containerElement
     * @param {Object} [options]
     */
    constructor(containerElement, options = {}) {
        this.container = containerElement;
        this.options = options;
        this.view = null;
        this.changeCallback = null;
        this._suppressChange = false;
        this._themed = null;
        this.init();
    }

    /** @returns {Array} */
    getKeymaps() {
        return [...defaultKeymap, ...historyKeymap];
    }

    /** @returns {Array} */
    getThemeExtensions() {
        return [this._themed.extension, baseEditorTheme];
    }

    /** @returns {Array} */
    getSearchExtensions() {
        return [
            search(),
            highlightSelectionMatches(),
            keymap.of(searchKeymap)
        ];
    }

    /** @returns {Array} */
    getBaseExtensions() {
        return [
            lineNumbers(),
            history(),
            keymap.of(this.getKeymaps()),
            EditorView.lineWrapping
        ];
    }

    /** @returns {Array} */
    getExtensions() {
        return [];
    }

    /** @returns {void} */
    handleDocChanged() {
        if (this.changeCallback && !this._suppressChange) {
            this.changeCallback(this.getContent());
        }
    }

    /** @returns {Array} */
    buildExtensions() {
        return [
            ...this.getBaseExtensions(),
            ...this.getExtensions(),
            EditorView.updateListener.of((update) => {
                if (update.docChanged) {
                    this.handleDocChanged();
                }
            }),
            ...this.getThemeExtensions()
        ];
    }

    init() {
        this._themed = createThemedHighlighting();

        const state = EditorState.create({
            doc: '',
            extensions: this.buildExtensions()
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
        if (!this.view) {
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

    /** @returns {string} */
    getContent() {
        return this.view ? this.view.state.doc.toString() : '';
    }

    /** @param {{emitChange?: boolean}} [options] */
    clear(options) {
        this.setContent('', options);
    }

    focus() {
        if (this.view) {
            this.view.focus();
        }
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
