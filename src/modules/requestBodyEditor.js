import { EditorView, lineNumbers, keymap } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { json } from '@codemirror/lang-json';
import { syntaxHighlighting, HighlightStyle } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { history, defaultKeymap, historyKeymap } from '@codemirror/commands';

// Define syntax highlighting style
const highlightStyle = HighlightStyle.define([
    { tag: tags.keyword, color: '#d73a49' },
    { tag: tags.atom, color: '#0184bc' },
    { tag: tags.bool, color: '#0184bc' },
    { tag: tags.null, color: '#0184bc' },
    { tag: tags.number, color: '#005cc5' },
    { tag: tags.string, color: '#22863a' },
    { tag: tags.propertyName, color: '#6f42c1' },
    { tag: tags.comment, color: '#6a737d', fontStyle: 'italic' },
    { tag: tags.operator, color: '#d73a49' },
    { tag: tags.punctuation, color: '#24292e' },
    { tag: tags.bracket, color: '#24292e' },
]);

/**
 * RequestBodyEditor - Manages CodeMirror editor for request body input
 * Provides syntax highlighting for JSON with line numbers and editing capability
 */
export class RequestBodyEditor {
    constructor(containerElement) {
        this.container = containerElement;
        this.view = null;
        this.changeCallback = null;
        this.init();
    }

    /**
     * Initialize the CodeMirror editor
     */
    init() {
        const state = EditorState.create({
            doc: '',
            extensions: [
                lineNumbers(),
                history(),
                keymap.of([...defaultKeymap, ...historyKeymap]),
                EditorView.editable.of(true), // Editable
                EditorView.lineWrapping,
                json(), // Always use JSON highlighting
                syntaxHighlighting(highlightStyle),
                EditorView.updateListener.of((update) => {
                    // Call change callback if content changed
                    if (update.docChanged && this.changeCallback) {
                        this.changeCallback(this.getContent());
                    }
                }),
                EditorView.theme({
                    '&': {
                        height: '100%',
                        fontSize: '13px',
                        backgroundColor: 'var(--bg-primary)',
                        border: '1px solid var(--border-color)',
                        borderRadius: '4px'
                    },
                    '&.cm-focused': {
                        outline: '2px solid var(--primary-color)',
                        outlineOffset: '1px'
                    },
                    '.cm-scroller': {
                        fontFamily: '"Fira Code", "Courier New", monospace',
                        overflow: 'auto'
                    },
                    '.cm-gutters': {
                        backgroundColor: 'var(--bg-secondary)',
                        color: 'var(--text-secondary)',
                        border: 'none',
                        borderRight: '1px solid var(--border-color)',
                        paddingRight: '8px'
                    },
                    '.cm-lineNumbers .cm-gutterElement': {
                        padding: '0 8px 0 4px',
                        minWidth: '40px'
                    },
                    '.cm-content': {
                        color: 'var(--text-primary)',
                        caretColor: 'var(--text-primary)',
                        padding: '4px 0'
                    },
                    '.cm-line': {
                        padding: '0 8px'
                    },
                    '.cm-activeLine': {
                        backgroundColor: 'var(--bg-secondary)'
                    },
                    '.cm-activeLineGutter': {
                        backgroundColor: 'var(--bg-secondary)'
                    }
                })
            ]
        });

        this.view = new EditorView({
            state,
            parent: this.container
        });
    }

    /**
     * Set content in the editor
     * @param {string} content - The content to set
     */
    setContent(content) {
        const transaction = this.view.state.update({
            changes: {
                from: 0,
                to: this.view.state.doc.length,
                insert: content
            }
        });
        this.view.dispatch(transaction);
    }

    /**
     * Get the current editor content
     * @returns {string}
     */
    getContent() {
        return this.view.state.doc.toString();
    }

    /**
     * Clear the editor content
     */
    clear() {
        this.setContent('');
    }

    /**
     * Set a callback to be called when content changes
     * @param {function} callback - Function to call with new content
     */
    onChange(callback) {
        this.changeCallback = callback;
    }

    /**
     * Format the JSON content
     * @returns {boolean} - True if formatting succeeded, false otherwise
     */
    formatJSON() {
        try {
            const content = this.getContent().trim();
            if (!content) {
                return true; // Empty content is valid
            }
            const parsed = JSON.parse(content);
            const formatted = JSON.stringify(parsed, null, 2);
            this.setContent(formatted);
            return true;
        } catch (e) {
            // Invalid JSON, don't format
            return false;
        }
    }

    /**
     * Focus the editor
     */
    focus() {
        this.view.focus();
    }

    /**
     * Destroy the editor instance
     */
    destroy() {
        if (this.view) {
            this.view.destroy();
            this.view = null;
        }
    }
}
