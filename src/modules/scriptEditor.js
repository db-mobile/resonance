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

/**
 * ScriptEditor - CodeMirror editor for JavaScript code editing
 */
export class ScriptEditor {
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
            EditorView.lineWrapping,
            javascript(),
            ...this.getSearchExtensions(),
            placeholder('// Write your script here...'),
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

    /**
     * Register a callback for content changes
     * @param {Function} callback - Called when content changes
     */
    onChange(callback) {
        this.changeCallback = callback;
    }

    /**
     * Set editor content
     * @param {string} content - JavaScript code to set
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
     * Destroy the editor
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
