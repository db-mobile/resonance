/**
 * @fileoverview JSON Editor using CodeMirror for editable JSON content
 * @module jsonEditor
 */

import { placeholder } from '@codemirror/view';
import { json } from '@codemirror/lang-json';
import { BaseCodeEditor } from './editors/BaseCodeEditor.js';

export class JSONEditor extends BaseCodeEditor {
    /** @returns {Array} */
    getExtensions() {
        return [
            json(),
            placeholder('{"userId": 123, "limit": 10}')
        ];
    }
}
