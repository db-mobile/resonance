import { EditorView } from '@codemirror/view';
import { json } from '@codemirror/lang-json';
import { BaseCodeEditor } from './editors/BaseCodeEditor.js';
import { formatJsonBody } from './utils/formatJson.js';
import { toast } from './ui/Toast.js';

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

    /** @returns {Array} */
    getKeymaps() {
        return [
            { key: 'Shift-Alt-f', run: () => { this.formatJSONWithFeedback(); return true; } },
            ...super.getKeymaps()
        ];
    }

    /** @returns {Error|null} */
    formatJSON() {
        if (this.language !== 'json') {
            return null;
        }
        const content = this.getContent();
        const result = formatJsonBody(content);
        if (!result.ok) {
            return result.error;
        }
        if (result.text !== content) {
            this.setContent(result.text);
        }
        return null;
    }

    formatJSONWithFeedback() {
        const error = this.formatJSON();
        if (error) {
            toast.error(`Cannot format invalid JSON: ${error.message}`);
        }
    }
}
