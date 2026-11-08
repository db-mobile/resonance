/**
 * @fileoverview JSON Editor using CodeMirror for editable JSON content
 * @module jsonEditor
 */

import { placeholder } from '@codemirror/view';
import { json } from '@codemirror/lang-json';
import { autocompletion, completionKeymap } from '@codemirror/autocomplete';
import { BaseCodeEditor } from './editors/BaseCodeEditor.js';
import { variableSupport } from './editors/variableExtension.js';
import { app } from './appContext.js';

export class JSONEditor extends BaseCodeEditor {
    /** @returns {Array} */
    getKeymaps() {
        return [...completionKeymap, ...super.getKeymaps()];
    }

    /** @returns {Array} */
    getExtensions() {
        return [
            json(),
            autocompletion(),
            ...variableSupport(() => app.variableContext),
            placeholder('{"userId": 123, "limit": 10}')
        ];
    }
}
