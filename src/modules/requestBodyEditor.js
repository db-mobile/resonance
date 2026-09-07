import { EditorView, lineNumbers, keymap } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { json } from '@codemirror/lang-json';
import { history, defaultKeymap, historyKeymap } from '@codemirror/commands';
import { searchKeymap, highlightSelectionMatches, search } from '@codemirror/search';
import { createThemedHighlighting } from './editorTheme.js';

export class RequestBodyEditor {
    constructor(containerElement, options = {}) {
        this.container = containerElement;
        this.view = null;
        this.changeCallback = null;
        this.language = options.language === 'plain' ? 'plain' : 'json';
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
            EditorView.editable.of(true),
            EditorView.lineWrapping,
            ...this.getSearchExtensions(),
            EditorView.updateListener.of((update) => {
                if (update.docChanged && this.changeCallback) {
                    this.changeCallback(this.getContent());
                }
            }),
            ...this.getThemeExtensions()
        ];

        if (this.language === 'json') {
            extensions.splice(5, 0, json());
        }

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

    /** @param {string} content */
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

    /** @returns {string} */
    getContent() {
        return this.view.state.doc.toString();
    }

    clear() {
        this.setContent('');
    }

    /** @param {function} callback */
    onChange(callback) {
        this.changeCallback = callback;
    }

    /** @returns {boolean} */
    formatJSON() {
        if (this.language !== 'json') {
            return true;
        }
        try {
            const content = this.getContent().trim();
            if (!content) {
                return true;
            }
            const parsed = JSON.parse(content);
            const formatted = JSON.stringify(parsed, null, 2);
            this.setContent(formatted);
            return true;
        } catch {
            return false;
        }
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
