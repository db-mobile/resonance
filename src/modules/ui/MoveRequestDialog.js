/**
 * @fileoverview Picker for the folder a request is moved into
 * @module ui/MoveRequestDialog
 */

import { BaseModal } from './BaseModal.js';

const ROOT_TARGET = '__root__';

export class MoveRequestDialog extends BaseModal {
    constructor() {
        super();
        /** @type {Function|null} */
        this.resolve = null;
    }

    /**
     * @param {Object} options
     * @param {Array<{id: string, name: string, depth: number}>} options.folders
     * @param {string|null} options.currentFolderId
     * @param {string} options.rootLabel
     * @returns {Promise<string|null|undefined>}
     */
    show({ folders, currentFolderId, rootLabel }) {
        return new Promise((resolve) => {
            this.resolve = resolve;
            const dialog = this.mount({
                overlayClass: 'move-request-dialog-overlay',
                dialogClass: 'move-request-dialog modal-dialog modal-dialog--sm',
                templatePath: './src/templates/dialogs/moveRequestDialog.html',
                templateId: 'tpl-move-request-dialog'
            });

            const select = dialog.querySelector('[data-role="target"]');
            select.appendChild(this._option(ROOT_TARGET, rootLabel, 0));
            for (const folder of folders) {
                select.appendChild(this._option(folder.id, folder.name, folder.depth + 1));
            }
            select.value = currentFolderId ?? ROOT_TARGET;

            dialog.querySelector('#move-request-cancel-btn').addEventListener('click', () => this.onDismiss());
            dialog.querySelector('#move-request-close-btn').addEventListener('click', () => this.onDismiss());
            dialog.querySelector('#move-request-confirm-btn').addEventListener('click', () => {
                this._settle(select.value === ROOT_TARGET ? null : select.value);
            });
            select.focus();
        });
    }

    /**
     * @param {string} value
     * @param {string} label
     * @param {number} depth
     * @returns {HTMLOptionElement}
     */
    _option(value, label, depth) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = `${' '.repeat(depth)}${label}`;
        return option;
    }

    /** @returns {void} */
    onDismiss() {
        this._settle(undefined);
    }

    /**
     * @param {string|null|undefined} value
     * @returns {void}
     */
    _settle(value) {
        if (this.resolve) {
            this.resolve(value);
            this.resolve = null;
        }
        this.destroy();
    }
}
