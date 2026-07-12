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
 * variable/environment manager dialogs. Escape is handled in the capture phase
 * and stopped, so it closes only this dialog and not the manager beneath it.
 * @augments BaseModal
 */
export class DynamicVariablesReferenceDialog extends BaseModal {
    constructor() {
        super();
        /** @type {((e: KeyboardEvent) => void)|null} Capture-phase Escape handler. */
        this._escapeCaptureHandler = null;
    }

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
            templateId: 'tpl-dynamic-variables-reference',
            closeOnEscape: false
        });

        dialog.querySelector('#var-reference-close-btn').addEventListener('click', () => this.destroy());

        this._escapeCaptureHandler = (e) => {
            if (e.key === 'Escape') {
                e.stopPropagation();
                this.destroy();
            }
        };
        document.addEventListener('keydown', this._escapeCaptureHandler, true);
    }

    /**
     * Tears down the dialog and the capture-phase Escape listener.
     *
     * @protected
     * @returns {void}
     */
    destroy() {
        if (this._escapeCaptureHandler) {
            document.removeEventListener('keydown', this._escapeCaptureHandler, true);
            this._escapeCaptureHandler = null;
        }
        super.destroy();
    }
}
