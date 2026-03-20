/**
 * @fileoverview Script Editor using CodeMirror for JavaScript code editing
 * @module scriptEditor
 */

import { EditorView, lineNumbers, placeholder, keymap } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { javascript } from '@codemirror/lang-javascript';
import { syntaxHighlighting, HighlightStyle } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { history, defaultKeymap, historyKeymap } from '@codemirror/commands';
import { searchKeymap, highlightSelectionMatches, search } from '@codemirror/search';
import { isDarkMode, darkHighlighting } from './editorTheme.js';

// Light theme syntax highlighting style for JavaScript
const lightHighlightStyle = HighlightStyle.define([
    { tag: tags.keyword, color: '#8b5cf6' },
    { tag: tags.string, color: '#22c55e' },
    { tag: tags.number, color: '#3b82f6' },
    { tag: tags.bool, color: '#0ea5e9' },
    { tag: tags.null, color: '#0ea5e9' },
    { tag: tags.punctuation, color: '#64748b' },
    { tag: tags.bracket, color: '#64748b' },
    { tag: tags.propertyName, color: '#ef4444' },
    { tag: tags.variableName, color: '#f97316' },
    { tag: tags.function(tags.variableName), color: '#3b82f6' },
    { tag: tags.comment, color: '#94a3b8', fontStyle: 'italic' },
]);

/**
 * ScriptEditor - CodeMirror editor for JavaScript code editing
 */
export class ScriptEditor {
    constructor(containerElement) {
        this.container = containerElement;
        this.view = null;
        this.changeCallback = null;
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
        if (this.view) {
            this.view.destroy();
            this.view = null;
        }
    }
}
