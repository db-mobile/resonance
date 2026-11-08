/**
 * @fileoverview Modal dialog asking for the name of a response example
 * @module ui/ExampleNameDialog
 */

import { TextInputDialog } from './TextInputDialog.js';

/** @augments */
export class ExampleNameDialog extends TextInputDialog {
    constructor() {
        super({
            prefix: 'example-name',
            templatePath: './src/templates/dialogs/exampleNameDialog.html',
            templateId: 'tpl-example-name-dialog',
            defaults: { title: 'Save as example', label: 'Example name:', confirmText: 'Save' },
            parseValue: (text) => text.trim() || undefined
        });
    }

    /**
     * @param {string} suggestedName
     * @param {Object} [options={}]
     * @param {string} [options.title]
     * @param {string} [options.label]
     * @param {string} [options.confirmText]
     * @returns {Promise<string|null>}
     */
    show(suggestedName, options = {}) {
        return super.show(suggestedName, options);
    }
}
