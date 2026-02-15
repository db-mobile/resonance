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
import { oneDarkHighlightStyle } from '@codemirror/theme-one-dark';

// Light theme syntax highlighting style for JavaScript
const lightHighlightStyle = HighlightStyle.define([
    { tag: tags.keyword, color: '#6d28d9' },
    { tag: tags.string, color: '#15803d' },
    { tag: tags.number, color: '#1d4ed8' },
    { tag: tags.bool, color: '#0369a1' },
    { tag: tags.null, color: '#0369a1' },
    { tag: tags.punctuation, color: '#0f172a' },
    { tag: tags.bracket, color: '#0f172a' },
    { tag: tags.propertyName, color: '#b91c1c' },
    { tag: tags.variableName, color: '#0f172a' },
    { tag: tags.function(tags.variableName), color: '#1d4ed8' },
    { tag: tags.comment, color: '#6b7280', fontStyle: 'italic' },
]);

/**
 * Detect if dark mode is active
 * @returns {boolean}
 */
function isDarkMode() {
    const theme = document.documentElement.getAttribute('data-theme');
    if (theme === 'dark' || theme === 'black') {
        return true;
    }
    if (theme === 'system') {
        return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
    return false;
}

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
            return [
                syntaxHighlighting(oneDarkHighlightStyle),
                baseTheme
            ];
        }
        return [
            syntaxHighlighting(lightHighlightStyle),
            baseTheme
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
            placeholder('// Extract data from response and set environment variables\nenvironment.set(\'token\', response.body.token);\nenvironment.set(\'userId\', response.body.id);'),
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
