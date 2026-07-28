/**
 * @fileoverview Modal dialog listing all supported dynamic variables
 * @module ui/DynamicVariablesReferenceDialog
 */

import { BaseModal } from './BaseModal.js';

/**
 * Read-only reference dialog for the `{{$...}}` dynamic variable syntax.
 *
 * @class
 * @classdesc Shows the grouped cheat sheet of dynamic variables on top of the
 * variable/environment manager dialogs. Escape closes only this dialog, because
 * the shared stack in {@link module:ui/modalEscape} dispatches to the topmost.
 * @augments BaseModal
 */
export class DynamicVariablesReferenceDialog extends BaseModal {

    /**
     * Builds and displays the reference dialog.
     *
     * @returns {void}
     */
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
