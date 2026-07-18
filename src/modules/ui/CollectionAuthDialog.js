/**
 * @fileoverview Modal dialog for editing a collection's auth configuration,
 * inherited by endpoints whose auth type is "Inherit from Parent".
 * @module ui/CollectionAuthDialog
 */

import { BaseModal } from './BaseModal.js';

/**
 * Collection-scoped auth editor.
 *
 * Mounts a second, ID-prefixed AuthManager instance inside the dialog, so the
 * full auth field set (including interactive OAuth2 token fetching) works
 * without colliding with the request Authorization tab. AuthManager is loaded
 * dynamically at open time to keep ipcBridge out of this module's import
 * graph (collectionManager's boot-time auto-init depends on that ordering).
 *
 * @class
 * @augments BaseModal
 */
export class CollectionAuthDialog extends BaseModal {
    constructor() {
        super();
        /** @type {Function|null} Pending promise resolver. */
        this.resolve = null;
        /** @type {AuthManager|null} Dialog-scoped auth manager instance. */
        this.dialogAuth = null;
    }

    /**
     * Shows the dialog for a collection, or for a folder when
     * `options.folder` is set (folder scope adds an "Inherit from Collection"
     * type that removes the folder override).
     *
     * @param {Object} collection - The collection ({id, name, ...})
     * @param {Object} repository - CollectionRepository for load/merge of secrets
     * @param {Object} [options] - Scope options
     * @param {Object} [options.folder] - Folder ({id, name}) to edit instead of the collection
     * @returns {Promise<Object|null>} The edited `{type, config}`, or null on cancel
     */
    show(collection, repository, options = {}) {
        return new Promise((resolve) => {
            this.resolve = resolve;
            this._createDialog(collection, repository, options.folder || null);
        });
    }

    /**
     * Builds the dialog, mounts the scoped AuthManager, and loads the
     * current auth config for the chosen scope.
     *
     * @private
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
     * Resolves the pending promise and tears down.
     *
     * @private
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

    /**
     * Escape / backdrop click cancels the dialog.
     *
     * @protected
     * @returns {void}
     */
    onDismiss() {
        this._settle(null);
    }
}
