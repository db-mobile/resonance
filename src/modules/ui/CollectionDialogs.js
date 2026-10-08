/**
 * @fileoverview Collection-specific modal dialogs
 * @module ui/CollectionDialogs
 */

import { app } from '../appContext.js';
import { templateLoader } from '../templateLoader.js';
import { DocGeneratorService } from '../services/DocGeneratorService.js';
import { getProtocol } from '../protocols/protocolRegistry.js';
import { BaseModal } from './BaseModal.js';
import { normalizeKeyValueRows } from '../utils/keyValueRows.js';
import { fileNameFromPath } from '../utils/fileName.js';
import { translate } from '../utils/translate.js';
import { normalizeMqttData } from '../mqtt/mqttFields.js';

const NEW_DIALOGS_TEMPLATE = './src/templates/collections/newDialogs.html';
const DOC_OPTIONS_TEMPLATE = './src/templates/docs/docOptionsDialog.html';
const COLLECTION_OVERLAY_CLASS = 'new-request-dialog-overlay';

/**
 * @param {string} templateId
 * @param {string} size
 * @returns {{templatePath: string, templateId: string, overlayClass: string, dialogClass: string}}
 */
const collectionDialog = (templateId, size) => ({
    templatePath: NEW_DIALOGS_TEMPLATE,
    templateId,
    overlayClass: COLLECTION_OVERLAY_CLASS,
    dialogClass: `new-request-dialog modal-dialog modal-dialog--${size}`
});

/** @type {ReadonlyArray<string>} */
const PLACEHOLDER_REQUEST_NAMES = Object.freeze(['New Request', 'New WebSocket', 'New gRPC']);

export class CollectionDialogs {
    /**
     * @param {Object} options
     * @param {Object} options.backendAPI
     * @param {CollectionService} options.collectionService
     * @param {CollectionRepository} options.collectionRepository
     */
    constructor({ backendAPI, collectionService, collectionRepository }) {
        this.backendAPI = backendAPI;
        this.collectionService = collectionService;
        this.collectionRepository = collectionRepository;
    }

    /**
     * @param {{templatePath: string, templateId: string, overlayClass: string, dialogClass: string}} config
     * @param {function(*): void} resolve
     * @param {function(Error): void} [reject]
     * @returns {{dialog: HTMLElement, finish: function(*): void, fail: function(Error): void}}
     */
    _mountDialog(config, resolve, reject = null) {
        const modal = new BaseModal();
        const dialog = modal.mount({ ...config, closeOnOverlayClick: false });

        if (app.i18n && app.i18n.updateUI) {
            app.i18n.updateUI(dialog);
        }

        let settled = false;

        const teardown = () => {
            settled = true;
            modal.destroy();
        };

        const finish = (result) => {
            if (settled) {
                return;
            }
            teardown();
            resolve(result);
        };

        const fail = (error) => {
            if (settled) {
                return;
            }
            teardown();
            reject?.(error);
        };

        modal.onDismiss = () => finish(null);

        return { dialog, finish, fail };
    }

    async showNewCollectionDialog() {
        const defaultStoragePath = await this.backendAPI.collections.getPath().catch(() => '');

        return new Promise((resolve) => {
            const { dialog, finish } = this._mountDialog(collectionDialog('tpl-new-collection-dialog', 'md'), resolve);

            const form = dialog.querySelector('#new-collection-form');
            const nameInput = dialog.querySelector('#collection-name');
            const locationInput = dialog.querySelector('#collection-location');
            const locationBtn = dialog.querySelector('#collection-location-btn');
            const cancelBtn = dialog.querySelector('#cancel-btn');
            const closeBtn = dialog.querySelector('#new-collection-close-btn');
            let selectedStoragePath = defaultStoragePath;

            locationInput.value = selectedStoragePath;

            nameInput.focus();

            cancelBtn.addEventListener('click', () => finish(null));
            closeBtn.addEventListener('click', () => finish(null));

            locationBtn.addEventListener('click', async () => {
                const pickedPath = await this.backendAPI.collections.pickDirectory().catch(() => null);
                if (pickedPath) {
                    selectedStoragePath = pickedPath;
                    locationInput.value = pickedPath;
                }
            });

            form.addEventListener('submit', (e) => {
                e.preventDefault();
                const name = nameInput.value.trim();

                if (name) {
                    finish({
                        name,
                        storageParentPath: selectedStoragePath || null
                    });
                }
            });
        });
    }

    async showNewRequestDialog() {
        return new Promise((resolve) => {
            const { dialog, finish } = this._mountDialog(collectionDialog('tpl-new-request-dialog', 'sm'), resolve);

            const form = dialog.querySelector('#new-request-form');
            const nameInput = dialog.querySelector('#request-name');
            const protocolSelect = dialog.querySelector('#request-protocol');
            const methodSelect = dialog.querySelector('#request-method');
            const methodGroup = methodSelect.closest('.form-group');
            const pathInput = dialog.querySelector('#request-path');
            const grpcTargetGroup = dialog.querySelector('#grpc-target-group');
            const grpcTargetInput = dialog.querySelector('#grpc-target');
            const pathLabel = dialog.querySelector('label[for="request-path"]');
            const cancelBtn = dialog.querySelector('#cancel-btn');
            const closeBtn = dialog.querySelector('#new-request-close-btn');

            nameInput.focus();

            cancelBtn.addEventListener('click', () => finish(null));
            closeBtn.addEventListener('click', () => finish(null));

            const updateProtocolUI = () => {
                const descriptor = getProtocol(protocolSelect.value);

                methodGroup?.classList.toggle('is-hidden', !descriptor.needsMethod);
                pathInput.parentElement.classList.toggle('is-hidden', descriptor.needsTarget);
                grpcTargetGroup.classList.toggle('is-hidden', !descriptor.needsTarget);

                if (pathLabel) {
                    pathLabel.textContent = descriptor.urlBased ? 'URL:' : 'Path:';
                }
                pathInput.placeholder = descriptor.pathPlaceholder;

                methodSelect.required = descriptor.needsMethod;
                pathInput.required = !descriptor.needsTarget;
                grpcTargetInput.required = descriptor.needsTarget;
            };

            protocolSelect.addEventListener('change', updateProtocolUI);
            updateProtocolUI();

            form.addEventListener('submit', (e) => {
                e.preventDefault();
                const name = nameInput.value.trim();
                const protocol = protocolSelect.value;

                const descriptor = getProtocol(protocol);

                if (!name) {
                    return;
                }

                if (descriptor.needsTarget) {
                    const target = grpcTargetInput.value.trim();
                    if (target) {
                        finish({
                            name,
                            protocol: descriptor.id,
                            target,
                            fullMethod: '',
                            requestJson: '{}'
                        });
                    }
                    return;
                }

                const entered = pathInput.value.trim();
                if (!entered) {
                    return;
                }

                if (descriptor.urlBased) {
                    finish({
                        name,
                        protocol: descriptor.id,
                        url: entered,
                        method: descriptor.needsMethod ? methodSelect.value : undefined
                    });
                    return;
                }

                if (descriptor.needsMethod && !methodSelect.value) {
                    return;
                }

                finish({
                    name,
                    protocol: descriptor.id,
                    method: methodSelect.value,
                    path: entered.startsWith('/') ? entered : `/${  entered}`
                });
            });
        });
    }

    /**
     * @param {Object} requestData
     * @returns {string}
     */
    _suggestRequestName(requestData) {
        if (requestData.name && !PLACEHOLDER_REQUEST_NAMES.includes(requestData.name)) {
            return requestData.name;
        }
        if (!requestData.url || !requestData.url.trim()) {
            return '';
        }
        try {
            const segments = new URL(requestData.url).pathname.split('/').filter(s => s);
            if (segments.length > 0) {
                return `${requestData.method || 'GET'} /${segments[segments.length - 1]}`;
            }
        } catch {
        }
        return '';
    }

    /**
     * @param {string} name
     * @param {Object} requestData
     * @param {string} address
     * @returns {Object}
     */
    _buildEndpointData(name, requestData, address) {
        const descriptor = getProtocol(requestData.protocol);

        const endpointData = {
            name,
            protocol: descriptor.id,
            method: requestData.method || 'GET',
            path: address || '/'
        };

        if (descriptor.urlBased) {
            endpointData.url = address;
        }

        if (descriptor.needsTarget && requestData.grpc) {
            endpointData.target = requestData.grpc.target;
            endpointData.fullMethod = requestData.grpc.fullMethod;
            endpointData.requestJson = requestData.grpc.requestJson;
        }

        if (descriptor.createSidecars.includes('graphqlData')) {
            endpointData.query = requestData.query || '';
            endpointData.variables = requestData.variables || '';
            endpointData.operationName = requestData.operationName || null;
        }

        if (descriptor.createSidecars.includes('mqttData')) {
            const { password: _password, ...mqttData } = normalizeMqttData(requestData);
            Object.assign(endpointData, mqttData);
        }

        return endpointData;
    }

    /**
     * @param {string} collectionId
     * @param {string} endpointId
     * @param {Object} requestData
     * @param {string} address
     * @returns {Promise<void>}
     */
    async _persistRequestSidecars(collectionId, endpointId, requestData, address) {
        if (requestData.pathParams && Object.keys(requestData.pathParams).length > 0) {
            const pathParamsArray = Object.entries(requestData.pathParams).map(([key, value]) => ({ key, value }));
            await this.collectionRepository.savePersistedPathParams(collectionId, endpointId, pathParamsArray);
        }

        const queryParamsArray = normalizeKeyValueRows(requestData.queryParams);
        if (queryParamsArray.length > 0) {
            await this.collectionRepository.savePersistedQueryParams(collectionId, endpointId, queryParamsArray);
        }

        const headersArray = normalizeKeyValueRows(requestData.headers);
        if (headersArray.length > 0) {
            await this.collectionRepository.savePersistedHeaders(collectionId, endpointId, headersArray);
        }

        if (requestData.body?.content) {
            await this.collectionRepository.saveModifiedRequestBody(collectionId, endpointId, requestData.body.content);
        }

        if (requestData.authType && requestData.authType !== 'none') {
            await this.collectionRepository.savePersistedAuthConfig(collectionId, endpointId, {
                type: requestData.authType,
                config: requestData.authConfig || {}
            });
        }

        if (address) {
            await this.collectionRepository.savePersistedUrl(collectionId, endpointId, address);
        }
    }

    async showSaveToCollectionDialog(requestData) {
        const collections = await this.collectionRepository.getAll();
        const defaultStoragePath = await this.backendAPI.collections.getPath().catch(() => '');

        return new Promise((resolve, reject) => {
            const { dialog, finish, fail } = this._mountDialog(collectionDialog('tpl-save-to-collection-dialog', 'sm'), resolve, reject);

            const form = dialog.querySelector('#save-to-collection-form');
            const nameInput = dialog.querySelector('#save-request-name');
            const collectionSelect = dialog.querySelector('#save-collection-select');
            const newCollectionGroup = dialog.querySelector('#new-collection-name-group');
            const newCollectionInput = dialog.querySelector('#new-collection-name-input');
            const newCollectionLocationGroup = dialog.querySelector('#new-collection-location-group');
            const newCollectionLocationInput = dialog.querySelector('#new-collection-location-input');
            const newCollectionLocationBtn = dialog.querySelector('#new-collection-location-btn');
            const cancelBtn = dialog.querySelector('#cancel-btn');
            const closeBtn = dialog.querySelector('#save-to-collection-close-btn');
            let newCollectionStoragePath = defaultStoragePath;

            newCollectionLocationInput.value = newCollectionStoragePath;

            const suggestedName = this._suggestRequestName(requestData);
            if (suggestedName) {
                nameInput.value = suggestedName;
            }

            collections.forEach(collection => {
                const option = document.createElement('option');
                option.value = collection.id;
                option.textContent = collection.name;
                collectionSelect.appendChild(option);
            });

            const newCollectionOption = document.createElement('option');
            newCollectionOption.value = '__new__';
            newCollectionOption.textContent = translate('save_to_collection.create_new', '+ Create new collection');
            collectionSelect.appendChild(newCollectionOption);

            nameInput.focus();

            collectionSelect.addEventListener('change', () => {
                const isNewCollection = collectionSelect.value === '__new__';
                newCollectionGroup.classList.toggle('is-hidden', !isNewCollection);
                newCollectionLocationGroup.classList.toggle('is-hidden', !isNewCollection);
                newCollectionInput.required = isNewCollection;
                if (isNewCollection) {
                    newCollectionInput.focus();
                }
            });

            newCollectionLocationBtn.addEventListener('click', async () => {
                const pickedPath = await this.backendAPI.collections.pickDirectory().catch(() => null);
                if (pickedPath) {
                    newCollectionStoragePath = pickedPath;
                    newCollectionLocationInput.value = pickedPath;
                }
            });

            cancelBtn.addEventListener('click', () => finish(null));
            closeBtn.addEventListener('click', () => finish(null));

            const saveBtn = form.querySelector('#save-btn');
            let submitting = false;

            form.addEventListener('submit', async (e) => {
                e.preventDefault();
                if (submitting) {
                    return;
                }
                const name = nameInput.value.trim();
                const selectedCollectionId = collectionSelect.value;

                if (!name || !selectedCollectionId) {
                    return;
                }

                submitting = true;
                saveBtn.disabled = true;
                try {
                    let targetCollectionId = selectedCollectionId;

                    if (selectedCollectionId === '__new__') {
                        const newCollectionName = newCollectionInput.value.trim();
                        if (!newCollectionName) {
                            newCollectionInput.focus();
                            submitting = false;
                            saveBtn.disabled = false;
                            return;
                        }
                        const newCollection = await this.collectionService.createCollection({
                            name: newCollectionName,
                            storageParentPath: newCollectionStoragePath || null
                        });
                        targetCollectionId = newCollection.id;
                    }

                    const address = requestData.url || requestData.broker || '';
                    const endpointData = this._buildEndpointData(name, requestData, address);
                    const newEndpoint = await this.collectionService.addRequestToCollection(targetCollectionId, endpointData);
                    await this._persistRequestSidecars(targetCollectionId, newEndpoint.id, requestData, address);

                    const targetCollection = collections.find(entry => entry.id === targetCollectionId);

                    finish({
                        collectionId: targetCollectionId,
                        endpointId: newEndpoint.id,
                        name,
                        collectionName: targetCollection?.name
                            || (selectedCollectionId === '__new__' ? newCollectionInput.value.trim() : '')
                    });
                } catch (error) {
                    fail(error);
                }
            });
        });
    }

    async showDocOptionsDialog() {
        return new Promise((resolve) => {
            const { dialog, finish } = this._mountDialog({
                templatePath: DOC_OPTIONS_TEMPLATE,
                templateId: 'tpl-doc-options-dialog',
                overlayClass: 'doc-options-overlay',
                dialogClass: 'modal-dialog modal-dialog--docs'
            }, resolve);

            const form = dialog.querySelector('#doc-options-form');
            const formatSelect = dialog.querySelector('#doc-format');
            const includeExamplesCheckbox = dialog.querySelector('#doc-include-examples');
            const languageCheckboxesContainer = dialog.querySelector('#language-checkboxes');
            const closeBtn = dialog.querySelector('#cancel-btn');
            const cancelBtn = dialog.querySelector('#doc-options-cancel-btn');

            const languages = DocGeneratorService.getAvailableLanguages();
            const defaultLanguages = DocGeneratorService.DEFAULT_LANGUAGES;

            languages.forEach(lang => {
                const checkboxFragment = templateLoader.cloneSync(DOC_OPTIONS_TEMPLATE, 'tpl-language-checkbox');
                const label = checkboxFragment.firstElementChild;
                const checkbox = label.querySelector('input[type="checkbox"]');
                const nameSpan = label.querySelector('.doc-language-name');
                const descSpan = label.querySelector('.doc-language-desc');

                checkbox.dataset.langId = lang.id;
                checkbox.checked = defaultLanguages.includes(lang.id);
                nameSpan.textContent = lang.name;
                descSpan.textContent = lang.description ? `(${lang.description})` : '';

                languageCheckboxesContainer.appendChild(label);
            });

            closeBtn.addEventListener('click', () => finish(null));
            cancelBtn.addEventListener('click', () => finish(null));

            form.addEventListener('submit', (e) => {
                e.preventDefault();

                const selectedLanguages = Array.from(
                    languageCheckboxesContainer.querySelectorAll('input[type="checkbox"]:checked'),
                    cb => cb.dataset.langId
                );

                finish({
                    format: formatSelect.value,
                    includeExamples: includeExamplesCheckbox.checked,
                    languages: selectedLanguages
                });
            });
        });
    }

    async showCollectionImportDialog({ importKind }) {
        const defaultStoragePath = await this.backendAPI.collections.getPath().catch(() => '');

        return new Promise((resolve) => {
            const { dialog, finish } = this._mountDialog(collectionDialog('tpl-import-collection-dialog', 'import'), resolve);

            const titleElement = dialog.querySelector('#import-collection-title');
            const subtitleElement = dialog.querySelector('#import-collection-subtitle');
            const form = dialog.querySelector('#import-collection-form');
            const sourceFileCard = dialog.querySelector('#import-source-card');
            const sourceFileInput = dialog.querySelector('#import-source-file');
            const sourceFileMeta = dialog.querySelector('#import-source-meta');
            const sourceFileBtn = dialog.querySelector('#import-source-file-btn');
            const destinationCard = dialog.querySelector('#import-destination-card');
            const destinationFolderInput = dialog.querySelector('#import-destination-folder');
            const destinationFolderMeta = dialog.querySelector('#import-destination-meta');
            const destinationFolderBtn = dialog.querySelector('#import-destination-folder-btn');
            const closeBtn = dialog.querySelector('#import-collection-close-btn');
            const cancelBtn = dialog.querySelector('#cancel-btn');
            const errorMessage = dialog.querySelector('#import-dialog-error');

            let selectedFilePath = '';
            let selectedStoragePath = defaultStoragePath;

            const t = (key, fallback) => (app.i18n && app.i18n.t) ? app.i18n.t(key) : fallback;
            titleElement.textContent = t('import_dialog.title_collection', 'Import Collection');
            subtitleElement.textContent = t('import_dialog.subtitle_collection', 'Choose an OpenAPI/Swagger, Postman, Insomnia, or HAR file — the format is detected automatically.');

            const setError = (message = '') => {
                if (!message) {
                    errorMessage.classList.add('is-hidden');
                    errorMessage.textContent = '';
                    return;
                }
                errorMessage.textContent = message;
                errorMessage.classList.remove('is-hidden');
            };

            const setSourceFile = (path) => {
                selectedFilePath = path;
                sourceFileInput.textContent = path ? fileNameFromPath(path) : t('import_dialog.no_file_selected', 'No file selected');
                sourceFileInput.title = path || '';
                sourceFileMeta.textContent = path || t('import_dialog.supported_formats', 'Supported formats depend on the import type.');
                sourceFileCard.classList.toggle('is-selected', Boolean(path));
            };

            const setDestinationFolder = (path) => {
                selectedStoragePath = path;
                destinationFolderInput.textContent = path || t('import_dialog.default_storage', 'Default app storage');
                destinationFolderInput.title = path || '';
                destinationFolderMeta.textContent = t('import_dialog.destination_meta', 'Choose the parent folder for the imported collection.');
                destinationCard.classList.toggle('is-selected', Boolean(path));
            };

            setSourceFile('');
            setDestinationFolder(selectedStoragePath);

            closeBtn.addEventListener('click', () => finish(null));
            cancelBtn.addEventListener('click', () => finish(null));

            sourceFileBtn.addEventListener('click', async () => {
                const filePath = await this.backendAPI.collections.pickImportFile(importKind).catch(() => null);
                if (filePath) {
                    setSourceFile(filePath);
                    setError('');
                }
            });

            destinationFolderBtn.addEventListener('click', async () => {
                const folderPath = await this.backendAPI.collections.pickDirectory().catch(() => null);
                if (folderPath) {
                    setDestinationFolder(folderPath);
                    setError('');
                }
            });

            sourceFileCard.addEventListener('click', (event) => {
                if (event.target.closest('button')) {
                    return;
                }
                sourceFileBtn.click();
            });

            form.addEventListener('submit', (e) => {
                e.preventDefault();
                if (!selectedFilePath) {
                    setError(t('import_dialog.error_no_file', 'Choose an import file before continuing.'));
                    sourceFileBtn.focus();
                    return;
                }

                finish({
                    filePath: selectedFilePath,
                    storageParentPath: selectedStoragePath || null
                });
            });
        });
    }
}
