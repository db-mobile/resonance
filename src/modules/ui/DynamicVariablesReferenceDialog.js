/**
 * @fileoverview Modal dialog listing all supported dynamic variables
 * @module ui/DynamicVariablesReferenceDialog
 */

import { BaseModal } from './BaseModal.js';

/** @augments */
export class DynamicVariablesReferenceDialog extends BaseModal {

    /** @returns {void} */
    show() {
        const dialog = this.mount({
            overlayClass: 'var-reference-overlay',
            dialogClass: 'var-reference-dialog modal-dialog modal-dialog--var-reference',
            templatePath: './src/templates/variables/dynamicVariablesReference.html',
            templateId: 'tpl-dynamic-variables-reference'
        });

        dialog.querySelector('#var-reference-close-btn').addEventListener('click', () => this.destroy());
    }
}
