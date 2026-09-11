/**
 * @fileoverview GraphQL Editor using CodeMirror for GraphQL queries
 * @module graphqlEditor
 */

import { placeholder } from '@codemirror/view';
import { graphql, updateSchema } from 'cm6-graphql';
import { parse, print } from 'graphql';
import { defaultKeymap, historyKeymap } from '@codemirror/commands';
import { autocompletion, completionKeymap } from '@codemirror/autocomplete';
import { BaseCodeEditor } from './editors/BaseCodeEditor.js';

/**
 * @param {string} text
 * @returns {HTMLElement}
 */
function createPlaceholderElement(text) {
    const el = document.createElement('div');
    el.textContent = text;
    el.style.cssText = 'display:block; height:0; overflow:visible; white-space:pre;';
    return el;
}

export class GraphQLEditor extends BaseCodeEditor {
    /** @returns {Array} */
    getKeymaps() {
        return [...defaultKeymap, ...historyKeymap, ...completionKeymap];
    }

    /** @returns {Array} */
    getExtensions() {
        return [
            autocompletion(),
            graphql(),
            placeholder(createPlaceholderElement('query {\n  user(id: 1) {\n    name\n    email\n  }\n}'))
        ];
    }

    /** @returns {Array<{name: string|null, type: string}>|null} */
    getOperations() {
        const content = this.getContent().trim();
        if (!content) {
            return [];
        }
        try {
            return parse(content).definitions
                .filter(def => def.kind === 'OperationDefinition')
                .map(def => ({ name: def.name ? def.name.value : null, type: def.operation }));
        } catch (_error) {
            return null;
        }
    }

    /** @param {import('graphql').GraphQLSchema} schema */
    setSchema(schema) {
        if (this.view) {
            updateSchema(this.view, schema);
        }
    }

    clearSchema() {
        if (this.view) {
            updateSchema(this.view, undefined);
        }
    }

    /** @returns {Error|null} */
    formatQuery() {
        const content = this.getContent().trim();
        if (!content) {
            return null;
        }

        try {
            this.setContent(print(parse(content)));
            return null;
        } catch (error) {
            return error;
        }
    }
}
