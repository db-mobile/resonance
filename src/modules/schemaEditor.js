/**
 * @fileoverview Schema Editor using CodeMirror for JSON Schema editing
 * @module schemaEditor
 */

import { placeholder } from '@codemirror/view';
import { json } from '@codemirror/lang-json';
import { BaseCodeEditor } from './editors/BaseCodeEditor.js';
import { debounce } from './utils/debounce.js';

export class SchemaEditor extends BaseCodeEditor {
    /**
     * @param {HTMLElement} containerElement
     * @param {{onChange?: Function}} [options]
     */
    constructor(containerElement, options = {}) {
        super(containerElement, options);
        this.changeCallback = options.onChange || null;
        this._debouncedChange = debounce(() => {
            if (this.changeCallback) {
                this.changeCallback(this.getContent());
            }
        }, 500);
    }

    /** @returns {Array} */
    getExtensions() {
        return [
            json(),
            placeholder('{\n  "type": "object",\n  "properties": {}\n}')
        ];
    }

    /** @returns {void} */
    handleDocChanged() {
        if (this._suppressChange) {
            return;
        }
        this._debouncedChange?.();
    }

    /**
     * @param {string} content
     * @param {{emitChange?: boolean}} [options]
     */
    setContent(content, options) {
        if (!this.view) {
            return;
        }

        if (this.getContent() === content) {
            return;
        }

        super.setContent(content, options);
    }

    /**
     * @param {Object|null} schema
     * @param {{emitChange?: boolean}} [options]
     */
    setSchema(schema, options) {
        if (schema === null || schema === undefined) {
            this.setContent('', options);
        } else {
            try {
                this.setContent(JSON.stringify(schema, null, 2), options);
            } catch {
                this.setContent('', options);
            }
        }
    }

    /** @returns {Object|null} */
    getSchema() {
        const value = this.getContent().trim();
        if (!value) {
            return null;
        }

        try {
            return JSON.parse(value);
        } catch {
            return null;
        }
    }

    /** @returns {boolean} */
    isValidJson() {
        const value = this.getContent().trim();
        if (!value) {
            return true;
        }

        try {
            JSON.parse(value);
            return true;
        } catch {
            return false;
        }
    }

    clear() {
        this.setContent('');
    }

    destroy() {
        this._debouncedChange?.cancel();
        super.destroy();
    }
}
