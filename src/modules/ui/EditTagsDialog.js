/**
 * @fileoverview Modal dialog for editing a request's tags as a comma-separated list
 * @module ui/EditTagsDialog
 */

import { TextInputDialog } from './TextInputDialog.js';
import { parseTagInput, formatTagInput } from '../utils/requestTags.js';

/** @augments */
export class EditTagsDialog extends TextInputDialog {
    constructor() {
        super({
            prefix: 'edit-tags',
            templatePath: './src/templates/dialogs/editTagsDialog.html',
            templateId: 'tpl-edit-tags-dialog',
            defaults: { title: 'Edit Tags', label: 'Tags (comma-separated):', confirmText: 'Save' },
            parseValue: parseTagInput
        });
    }

    /**
     * @param {Array<string>} currentTags
     * @param {Object} [options={}]
     * @param {string} [options.title='Edit Tags']
     * @param {string} [options.label='Tags (comma-separated):']
     * @param {string} [options.confirmText='Save']
     * @returns {Promise<Array<string>|null>}
     */
    show(currentTags, options = {}) {
        return super.show(formatTagInput(currentTags), options);
    }
}
