import { EditorView } from '@codemirror/view';
import { json } from '@codemirror/lang-json';
import { BaseCodeEditor } from './editors/BaseCodeEditor.js';

export class RequestBodyEditor extends BaseCodeEditor {
    /** @returns {Array} */
    getExtensions() {
        const extensions = [EditorView.editable.of(true)];

        if (this.language === 'json') {
            extensions.push(json());
        }

        return [...extensions, ...this.getSearchExtensions()];
    }

    /** @returns {string} */
    get language() {
        return this.options.language === 'plain' ? 'plain' : 'json';
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
}
