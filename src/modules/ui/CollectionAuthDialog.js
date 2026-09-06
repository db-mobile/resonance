/**
 * @fileoverview Modal dialog for editing a collection's auth configuration,
 * @module ui/CollectionAuthDialog
 */

import { BaseModal } from './BaseModal.js';

/** @augments */
export class CollectionAuthDialog extends BaseModal {
    constructor() {
        super();
        /** @type {Function|null} */
        this.resolve = null;
        /** @type {AuthManager|null} */
        this.dialogAuth = null;
    }

    /**
     * @param {Object} collection
     * @param {Object} repository
     * @param {Object} [options]
     * @param {Object} [options.folder]
     * @returns {Promise<Object|null>}
     */
    show(collection, repository, options = {}) {
        return new Promise((resolve) => {
            this.resolve = resolve;
            this._createDialog(collection, repository, options.folder || null);
        });
    }

    /**
     * @param {Object} collection
     * @param {Object} repository
     * @param {Object|null} folder
     * @returns {Promise<void>}
     */
    async _createDialog(collection, repository, folder) {
        const { AuthManager } = await import('../authManager.js');
        const dialog = this.mount({
            overlayClass: 'collection-auth-dialog-overlay',
            dialogClass: 'collection-auth-dialog modal-dialog modal-dialog--md',
            templatePath: './src/templates/dialogs/collectionAuth.html',
            templateId: 'tpl-collection-auth-dialog'
        });

        const titleEl = dialog.querySelector('[data-role="title"]');
        if (titleEl) {
            titleEl.textContent = folder
                ? `Folder Auth — ${folder.name}`
                : `Collection Auth — ${collection.name}`;
        }

        const hintEl = dialog.querySelector('[data-role="hint"]');
        if (hintEl && folder) {
            hintEl.textContent = 'Requests in this folder whose auth type is "Inherit from Parent" use this configuration. Choose "Inherit from Collection" to fall back to the collection auth.';
        }

        const typeSelect = dialog.querySelector('#collection-auth-type-select');
        const fieldsContainer = dialog.querySelector('#collection-auth-fields');
        if (folder && typeSelect) {
            const inheritOption = document.createElement('option');
            inheritOption.value = 'inherit';
            inheritOption.textContent = 'Inherit from Collection';
            typeSelect.insertBefore(inheritOption, typeSelect.firstChild);
        }
        this.dialogAuth = new AuthManager({
            typeSelect,
            fieldsContainer,
            idPrefix: 'colauth-',
            inheritSummary: 'Falls back to the collection\'s auth configuration.'
        });

        const existing = folder
            ? await repository.getFolderAuthConfig(collection.id, folder.id)
            : await repository.getCollectionAuthConfig(collection.id);
        const fallbackType = folder ? 'inherit' : 'none';
        this.dialogAuth.loadAuthConfig(existing || { type: fallbackType, config: {} });

        dialog.querySelector('#collection-auth-close-btn')?.addEventListener('click', () => {
            this.onDismiss();
        });
        dialog.querySelector('#collection-auth-cancel-btn')?.addEventListener('click', () => {
            this.onDismiss();
        });
        dialog.querySelector('#collection-auth-save-btn')?.addEventListener('click', () => {
            const result = this.dialogAuth.getAuthConfig();
            this._settle({
                type: result?.type || 'none',
                config: result?.config || {}
            });
        });
    }

    /**
     * @param {Object|null} result
     * @returns {void}
     */
    _settle(result) {
        const { resolve } = this;
        this.resolve = null;
        this.dialogAuth = null;
        this.destroy();
        if (resolve) {
            resolve(result);
        }
    }

    /** @returns {void} */
    onDismiss() {
        this._settle(null);
    }
}
