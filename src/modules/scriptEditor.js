/**
 * @fileoverview Script Editor using CodeMirror for JavaScript code editing
 * @module scriptEditor
 */

import { placeholder } from '@codemirror/view';
import { javascript } from '@codemirror/lang-javascript';
import { BaseCodeEditor } from './editors/BaseCodeEditor.js';

export class ScriptEditor extends BaseCodeEditor {
    /** @returns {Array} */
    getExtensions() {
        return [
            javascript(),
            ...this.getSearchExtensions(),
            placeholder('// Write your script here...')
        ];
    }
}
