/**
 * @fileoverview Modal dialog component for renaming collections and endpoints
 * @module ui/RenameDialog
 */

import { TextInputDialog } from './TextInputDialog.js';

/** @augments */
export class RenameDialog extends TextInputDialog {
    constructor() {
        super({
            prefix: 'rename',
            templatePath: './src/templates/dialogs/renameDialog.html',
            templateId: 'tpl-rename-dialog',
            defaults: { title: 'Rename Collection', label: 'Collection Name:', confirmText: 'Rename' },
            parseValue: (text) => text.trim() || undefined
        });
    }

    /**
     * @param {string} currentName
     * @param {Object} [options={}]
     * @param {string} [options.title='Rename Collection']
     * @param {string} [options.label='Collection Name:']
     * @param {string} [options.confirmText='Rename']
     * @returns {Promise<string|null>}
     */
    show(currentName, options = {}) {
        return super.show(currentName, options);
    }
}
