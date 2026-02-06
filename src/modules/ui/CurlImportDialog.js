/**
 * @fileoverview Modal dialog for importing cURL commands into collections
 * @module ui/CurlImportDialog
 */

import { templateLoader } from '../templateLoader.js';
import { CurlParser } from '../CurlParser.js';

/**
 * Dialog for importing cURL commands
 *
 * @class
 * @classdesc Provides a modal dialog for pasting cURL commands and importing
 * them into new or existing collections. Includes real-time parsing preview
 * and collection selection.
 */
export class CurlImportDialog {
    /**
     * Creates a CurlImportDialog instance
     */
    constructor() {
        this.overlay = null;
        this.onConfirm = null;
        this.onCancel = null;
        this.parsedRequest = null;
    }

    /**
     * Shows the cURL import dialog
     *
     * @param {Array<Object>} collections - Available collections for import target
     * @param {Object} [options={}] - Dialog options
     * @param {string} [options.targetCollectionId] - Pre-selected collection ID
     * @returns {Promise<Object|null>} Resolves to import result or null if cancelled
     */
    show(collections, options = {}) {
        return new Promise((resolve) => {
            this.onConfirm = resolve;
            this.onCancel = () => resolve(null);

            this.createDialog(collections, options);
        });
    }

    /**
     * Creates and displays the dialog DOM elements
     *
     * @private
     * @param {Array<Object>} collections - Available collections
     * @param {Object} options - Dialog options
     */
    createDialog(collections, options) {
        this.overlay = document.createElement('div');
        this.overlay.className = 'curl-import-dialog-overlay modal-overlay';

        const dialog = document.createElement('div');
        dialog.className = 'curl-import-dialog modal-dialog modal-dialog--lg';

        const fragment = templateLoader.cloneSync(
            './src/templates/curl/curlImportDialog.html',
            'tpl-curl-import-dialog'
        );
        dialog.appendChild(fragment);

        this.overlay.appendChild(dialog);
        document.body.appendChild(this.overlay);

        if (window.i18n && window.i18n.updateUI) {
            window.i18n.updateUI();
        }

        this.populateCollections(dialog, collections, options.targetCollectionId);
        this.setupEventListeners(dialog, collections);
        this.focusInput(dialog);
    }

    /**
     * Populates the collection dropdown
     *
     * @private
     * @param {HTMLElement} dialog - Dialog element
     * @param {Array<Object>} collections - Available collections
     * @param {string} [targetCollectionId] - Pre-selected collection ID
     */
    populateCollections(dialog, collections, targetCollectionId) {
        const select = dialog.querySelector('#curl-import-collection');
        if (!select) {
            return;
        }

        select.innerHTML = '';

        const newCollectionOption = document.createElement('option');
        newCollectionOption.value = '__new__';
        newCollectionOption.textContent = window.i18n ? 
            window.i18n.t('curl_import.new_collection') : 
            'Create New Collection';
        select.appendChild(newCollectionOption);

        collections.forEach(collection => {
            const option = document.createElement('option');
            option.value = collection.id;
            option.textContent = collection.name;
            select.appendChild(option);
        });

        if (targetCollectionId) {
            select.value = targetCollectionId;
        }

        this.updateNewCollectionVisibility(dialog);
    }

    /**
     * Updates visibility of new collection name field
     *
     * @private
     * @param {HTMLElement} dialog - Dialog element
     */
    updateNewCollectionVisibility(dialog) {
        const select = dialog.querySelector('#curl-import-collection');
        const newCollectionGroup = dialog.querySelector('#new-collection-group');
        
        if (select && newCollectionGroup) {
            newCollectionGroup.classList.toggle('is-hidden', select.value !== '__new__');
        }
    }

    /**
     * Attaches event listeners for dialog interactions
     *
     * @private
     * @param {HTMLElement} dialog - Dialog element
     * @param {Array<Object>} collections - Available collections
     */
    setupEventListeners(dialog, collections) {
        const curlInput = dialog.querySelector('#curl-input');
        const collectionSelect = dialog.querySelector('#curl-import-collection');
        const cancelBtn = dialog.querySelector('#curl-import-cancel-btn');
        const importBtn = dialog.querySelector('#curl-import-confirm-btn');
        const closeBtn = dialog.querySelector('#curl-import-close-btn');

        if (collectionSelect) {
            collectionSelect.addEventListener('change', () => {
                this.updateNewCollectionVisibility(dialog);
            });
        }

        if (curlInput) {
            curlInput.addEventListener('input', () => {
                this.updatePreview(dialog);
            });

            curlInput.addEventListener('paste', () => {
                setTimeout(() => this.updatePreview(dialog), 0);
            });
        }

        if (cancelBtn) {
            cancelBtn.addEventListener('click', () => this.close());
        }

        if (closeBtn) {
            closeBtn.addEventListener('click', () => this.close());
        }

        if (importBtn) {
            importBtn.addEventListener('click', () => this.handleImport(dialog, collections));
        }

        this.overlay.addEventListener('click', (e) => {
            if (e.target === this.overlay) {
                this.close();
            }
        });

        const escapeHandler = (e) => {
            if (e.key === 'Escape') {
                this.close();
                document.removeEventListener('keydown', escapeHandler);
            }
        };
        document.addEventListener('keydown', escapeHandler);
    }

    /**
     * Updates the preview section with parsed cURL data
     *
     * @private
     * @param {HTMLElement} dialog - Dialog element
     */
    updatePreview(dialog) {
        const curlInput = dialog.querySelector('#curl-input');
        const previewSection = dialog.querySelector('#curl-preview-section');
        const previewMethod = dialog.querySelector('#preview-method');
        const previewUrl = dialog.querySelector('#preview-url');
        const previewHeaders = dialog.querySelector('#preview-headers');
        const previewBody = dialog.querySelector('#preview-body');
        const errorMessage = dialog.querySelector('#curl-error-message');
        const importBtn = dialog.querySelector('#curl-import-confirm-btn');

        const curlCommand = curlInput?.value?.trim();

        if (!curlCommand) {
            previewSection?.classList.add('is-hidden');
            errorMessage?.classList.add('is-hidden');
            if (importBtn) {
                importBtn.disabled = true;
            }
            this.parsedRequest = null;
            return;
        }

        try {
            this.parsedRequest = CurlParser.parse(curlCommand);
            
            if (previewMethod) {
                previewMethod.textContent = this.parsedRequest.method;
                previewMethod.dataset.method = this.parsedRequest.method.toLowerCase();
            }
            
            if (previewUrl) {
                let displayUrl = this.parsedRequest.url;
                if (Object.keys(this.parsedRequest.queryParams).length > 0) {
                    const params = Object.entries(this.parsedRequest.queryParams)
                        .map(([k, v]) => `${k}=${v}`)
                        .join('&');
                    displayUrl = `${displayUrl}?${params}`;
                }
                previewUrl.textContent = displayUrl;
            }

            if (previewHeaders) {
                const headerCount = Object.keys(this.parsedRequest.headers).length;
                previewHeaders.textContent = headerCount > 0 ? 
                    `${headerCount} header${headerCount !== 1 ? 's' : ''}` : 
                    'No headers';
            }

            if (previewBody) {
                if (this.parsedRequest.body) {
                    let bodyPreview = this.parsedRequest.body;
                    if (bodyPreview.length > 100) {
                        bodyPreview = `${bodyPreview.substring(0, 100)}...`;
                    }
                    previewBody.textContent = bodyPreview;
                    previewBody.parentElement?.classList.remove('is-hidden');
                } else {
                    previewBody.parentElement?.classList.add('is-hidden');
                }
            }

            previewSection?.classList.remove('is-hidden');
            errorMessage?.classList.add('is-hidden');
            if (importBtn) {
                importBtn.disabled = false;
            }

        } catch (error) {
            previewSection?.classList.add('is-hidden');
            if (errorMessage) {
                errorMessage.textContent = error.message;
                errorMessage.classList.remove('is-hidden');
            }
            if (importBtn) {
                importBtn.disabled = true;
            }
            this.parsedRequest = null;
        }
    }

    /**
     * Handles the import action
     *
     * @private
     * @param {HTMLElement} dialog - Dialog element
     * @param {Array<Object>} collections - Available collections
     */
    handleImport(dialog, _collections) {
        if (!this.parsedRequest) {
            return;
        }

        const collectionSelect = dialog.querySelector('#curl-import-collection');
        const newCollectionInput = dialog.querySelector('#new-collection-name');
        const requestNameInput = dialog.querySelector('#curl-request-name');

        const collectionId = collectionSelect?.value;
        const isNewCollection = collectionId === '__new__';
        const newCollectionName = newCollectionInput?.value?.trim();
        const requestName = requestNameInput?.value?.trim() || this.parsedRequest.name;

        if (isNewCollection && !newCollectionName) {
            if (newCollectionInput) {
                newCollectionInput.focus();
            }
            return;
        }

        const endpoint = CurlParser.toEndpoint(this.parsedRequest);
        endpoint.name = requestName;

        const result = {
            endpoint,
            collectionId: isNewCollection ? null : collectionId,
            newCollectionName: isNewCollection ? newCollectionName : null,
            auth: this.parsedRequest.auth
        };

        if (this.onConfirm) {
            this.onConfirm(result);
        }
        this.cleanup();
    }

    /**
     * Focuses the cURL input field
     *
     * @private
     * @param {HTMLElement} dialog - Dialog element
     */
    focusInput(dialog) {
        const curlInput = dialog.querySelector('#curl-input');
        if (curlInput) {
            curlInput.focus();
        }
    }

    /**
     * Handles cancel action
     *
     * @private
     */
    close() {
        if (this.onCancel) {
            this.onCancel();
        }
        this.cleanup();
    }

    /**
     * Removes dialog from DOM and cleans up
     *
     * @private
     */
    cleanup() {
        if (this.overlay) {
            this.overlay.remove();
            this.overlay = null;
        }
        this.onConfirm = null;
        this.onCancel = null;
        this.parsedRequest = null;
    }
}
