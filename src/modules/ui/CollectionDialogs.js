/**
 * @fileoverview Collection-specific modal dialogs
 * @module ui/CollectionDialogs
 */

import { templateLoader } from '../templateLoader.js';
import { DocGeneratorService } from '../services/DocGeneratorService.js';

/**
 * Collection dialog helper for creating and configuring collection-related modals.
 */
export class CollectionDialogs {
    /**
     * @param {Object} options - Dialog dependencies
     * @param {Object} options.backendAPI - Backend IPC API
     * @param {CollectionService} options.collectionService - Collection service
     * @param {CollectionRepository} options.collectionRepository - Collection repository
     */
    constructor({ backendAPI, collectionService, collectionRepository }) {
        this.backendAPI = backendAPI;
        this.collectionService = collectionService;
        this.collectionRepository = collectionRepository;
    }

    async showNewCollectionDialog(initialName = '') {
        const defaultStoragePath = await this.backendAPI.collections.getPath().catch(() => '');

        return new Promise((resolve) => {
            const fragment = templateLoader.cloneSync(
                './src/templates/collections/newDialogs.html',
                'tpl-new-collection-dialog'
            );
            const dialog = fragment.firstElementChild;

            document.body.appendChild(dialog);

            if (window.i18n && window.i18n.updateUI) {
                window.i18n.updateUI();
            }

            const form = dialog.querySelector('#new-collection-form');
            const nameInput = dialog.querySelector('#collection-name');
            const locationInput = dialog.querySelector('#collection-location');
            const locationBtn = dialog.querySelector('#collection-location-btn');
            const cancelBtn = dialog.querySelector('#cancel-btn');
            let selectedStoragePath = defaultStoragePath;
            let resolved = false;

            nameInput.value = initialName;
            locationInput.value = selectedStoragePath;

            nameInput.focus();

            const keydownController = new AbortController();

            const finish = (result) => {
                if (resolved) {
                    return;
                }
                resolved = true;
                keydownController.abort();
                dialog.remove();
                resolve(result);
            };

            cancelBtn.addEventListener('click', () => {
                finish(null);
            });

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

            dialog.addEventListener('click', (e) => {
                if (e.target === dialog) {
                    finish(null);
                }
            });

            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') {
                    finish(null);
                }
            }, { signal: keydownController.signal });
        });
    }

    async showNewRequestDialog() {
        return new Promise((resolve) => {
            const fragment = templateLoader.cloneSync(
                './src/templates/collections/newDialogs.html',
                'tpl-new-request-dialog'
            );
            const dialog = fragment.firstElementChild;

            document.body.appendChild(dialog);

            if (window.i18n && window.i18n.updateUI) {
                window.i18n.updateUI();
            }

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
            let resolved = false;

            nameInput.focus();

            const keydownController = new AbortController();

            const finish = (result) => {
                if (resolved) {
                    return;
                }
                resolved = true;
                keydownController.abort();
                dialog.remove();
                resolve(result);
            };

            cancelBtn.addEventListener('click', () => {
                finish(null);
            });

            const updateProtocolUI = () => {
                const isGrpc = protocolSelect.value === 'grpc';
                const isWebSocket = protocolSelect.value === 'websocket';
                methodGroup?.classList.toggle('is-hidden', isGrpc || isWebSocket);
                pathInput.parentElement.classList.toggle('is-hidden', isGrpc);
                grpcTargetGroup.classList.toggle('is-hidden', !isGrpc);
                if (pathLabel) {
                    pathLabel.textContent = isWebSocket ? 'URL:' : 'Path:';
                }
                pathInput.placeholder = isWebSocket ? 'wss://echo.websocket.events' : '/api/endpoint';

                if (isGrpc) {
                    methodSelect.required = false;
                    pathInput.required = false;
                    grpcTargetInput.required = true;
                } else {
                    methodSelect.required = !isWebSocket;
                    pathInput.required = true;
                    grpcTargetInput.required = false;
                }
            };

            protocolSelect.addEventListener('change', updateProtocolUI);
            updateProtocolUI();

            form.addEventListener('submit', (e) => {
                e.preventDefault();
                const name = nameInput.value.trim();
                const protocol = protocolSelect.value;

                if (protocol === 'grpc') {
                    const target = grpcTargetInput.value.trim();
                    if (name && target) {
                        finish({
                            name,
                            protocol: 'grpc',
                            target,
                            fullMethod: '',
                            requestJson: '{}'
                        });
                    }
                } else if (protocol === 'websocket') {
                    const url = pathInput.value.trim();
                    if (name && url) {
                        finish({
                            name,
                            protocol: 'websocket',
                            url
                        });
                    }
                } else {
                    const method = methodSelect.value;
                    const path = pathInput.value.trim();
                    if (name && method && path) {
                        finish({
                            name,
                            protocol: 'http',
                            method,
                            path: path.startsWith('/') ? path : `/${  path}`
                        });
                    }
                }
            });

            dialog.addEventListener('click', (e) => {
                if (e.target === dialog) {
                    finish(null);
                }
            });

            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') {
                    finish(null);
                }
            }, { signal: keydownController.signal });
        });
    }

    async showSaveToCollectionDialog(requestData) {
        const collections = await this.collectionRepository.getAll();
        const defaultStoragePath = await this.backendAPI.collections.getPath().catch(() => '');

        return new Promise((resolve) => {
            const fragment = templateLoader.cloneSync(
                './src/templates/collections/newDialogs.html',
                'tpl-save-to-collection-dialog'
            );
            const dialog = fragment.firstElementChild;

            document.body.appendChild(dialog);

            if (window.i18n && window.i18n.updateUI) {
                window.i18n.updateUI();
            }

            const form = dialog.querySelector('#save-to-collection-form');
            const nameInput = dialog.querySelector('#save-request-name');
            const collectionSelect = dialog.querySelector('#save-collection-select');
            const newCollectionGroup = dialog.querySelector('#new-collection-name-group');
            const newCollectionInput = dialog.querySelector('#new-collection-name-input');
            const newCollectionLocationGroup = dialog.querySelector('#new-collection-location-group');
            const newCollectionLocationInput = dialog.querySelector('#new-collection-location-input');
            const newCollectionLocationBtn = dialog.querySelector('#new-collection-location-btn');
            const cancelBtn = dialog.querySelector('#cancel-btn');
            let newCollectionStoragePath = defaultStoragePath;
            let resolved = false;

            newCollectionLocationInput.value = newCollectionStoragePath;

            if (requestData.name && requestData.name !== 'New Request' &&
                requestData.name !== 'New WebSocket' && requestData.name !== 'New gRPC') {
                nameInput.value = requestData.name;
            } else if (requestData.url && requestData.url.trim()) {
                try {
                    const urlObj = new URL(requestData.url);
                    const path = urlObj.pathname;
                    const segments = path.split('/').filter(s => s);
                    if (segments.length > 0) {
                        const endpoint = `/${segments[segments.length - 1]}`;
                        nameInput.value = `${requestData.method || 'GET'} ${endpoint}`;
                    }
                } catch {
                    // URL parsing failed, leave empty for user to fill.
                }
            }

            collections.forEach(collection => {
                const option = document.createElement('option');
                option.value = collection.id;
                option.textContent = collection.name;
                collectionSelect.appendChild(option);
            });

            const newCollectionOption = document.createElement('option');
            newCollectionOption.value = '__new__';
            newCollectionOption.textContent = window.i18n?.t('save_to_collection.create_new') || '+ Create new collection';
            collectionSelect.appendChild(newCollectionOption);

            nameInput.focus();

            const keydownController = new AbortController();

            const finish = (result) => {
                if (resolved) {
                    return;
                }
                resolved = true;
                keydownController.abort();
                dialog.remove();
                resolve(result);
            };

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

            cancelBtn.addEventListener('click', () => {
                finish(null);
            });

            form.addEventListener('submit', async (e) => {
                e.preventDefault();
                const name = nameInput.value.trim();
                const selectedCollectionId = collectionSelect.value;

                if (!name || !selectedCollectionId) {
                    return;
                }

                try {
                    let targetCollectionId = selectedCollectionId;

                    if (selectedCollectionId === '__new__') {
                        const newCollectionName = newCollectionInput.value.trim();
                        if (!newCollectionName) {
                            newCollectionInput.focus();
                            return;
                        }
                        const newCollection = await this.collectionService.createCollection({
                            name: newCollectionName,
                            storageParentPath: newCollectionStoragePath || null
                        });
                        targetCollectionId = newCollection.id;
                    }

                    const endpointData = {
                        name,
                        protocol: requestData.protocol || 'http',
                        method: requestData.method || 'GET',
                        path: requestData.url || '/'
                    };

                    if (requestData.protocol === 'grpc' && requestData.grpc) {
                        endpointData.target = requestData.grpc.target;
                        endpointData.fullMethod = requestData.grpc.fullMethod;
                        endpointData.requestJson = requestData.grpc.requestJson;
                    }

                    if (requestData.protocol === 'websocket') {
                        endpointData.url = requestData.url;
                    }

                    const newEndpoint = await this.collectionService.addRequestToCollection(targetCollectionId, endpointData);

                    if (requestData.pathParams && Object.keys(requestData.pathParams).length > 0) {
                        const pathParamsArray = Object.entries(requestData.pathParams).map(([key, value]) => ({ key, value }));
                        await this.collectionRepository.savePersistedPathParams(targetCollectionId, newEndpoint.id, pathParamsArray);
                    }

                    if (requestData.queryParams && Object.keys(requestData.queryParams).length > 0) {
                        const queryParamsArray = Object.entries(requestData.queryParams).map(([key, value]) => ({ key, value }));
                        await this.collectionRepository.savePersistedQueryParams(targetCollectionId, newEndpoint.id, queryParamsArray);
                    }

                    if (requestData.headers && Object.keys(requestData.headers).length > 0) {
                        const headersArray = Object.entries(requestData.headers).map(([key, value]) => ({ key, value }));
                        await this.collectionRepository.savePersistedHeaders(targetCollectionId, newEndpoint.id, headersArray);
                    }

                    if (requestData.body?.content) {
                        await this.collectionRepository.saveModifiedRequestBody(targetCollectionId, newEndpoint.id, requestData.body.content);
                    }

                    if (requestData.authType && requestData.authType !== 'none') {
                        await this.collectionRepository.savePersistedAuthConfig(targetCollectionId, newEndpoint.id, {
                            type: requestData.authType,
                            config: requestData.authConfig || {}
                        });
                    }

                    if (requestData.url) {
                        await this.collectionRepository.savePersistedUrl(targetCollectionId, newEndpoint.id, requestData.url);
                    }

                    finish({
                        collectionId: targetCollectionId,
                        endpointId: newEndpoint.id,
                        name
                    });
                } catch (error) {
                    finish(null);
                }
            });

            dialog.addEventListener('click', (e) => {
                if (e.target === dialog) {
                    finish(null);
                }
            });

            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') {
                    finish(null);
                }
            }, { signal: keydownController.signal });
        });
    }

    async showDocOptionsDialog() {
        return new Promise((resolve) => {
            const fragment = templateLoader.cloneSync(
                './src/templates/docs/docOptionsDialog.html',
                'tpl-doc-options-dialog'
            );
            const dialog = fragment.firstElementChild;

            document.body.appendChild(dialog);

            if (window.i18n && window.i18n.updateUI) {
                window.i18n.updateUI();
            }

            const form = dialog.querySelector('#doc-options-form');
            const formatSelect = dialog.querySelector('#doc-format');
            const includeExamplesCheckbox = dialog.querySelector('#doc-include-examples');
            const languageCheckboxesContainer = dialog.querySelector('#language-checkboxes');
            const cancelBtn = dialog.querySelector('#cancel-btn');
            let resolved = false;

            const languages = DocGeneratorService.getAvailableLanguages();
            const defaultLanguages = DocGeneratorService.DEFAULT_LANGUAGES;

            languages.forEach(lang => {
                const checkboxFragment = templateLoader.cloneSync(
                    './src/templates/docs/docOptionsDialog.html',
                    'tpl-language-checkbox'
                );
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

            const keydownController = new AbortController();

            const finish = (result) => {
                if (resolved) {
                    return;
                }
                resolved = true;
                keydownController.abort();
                dialog.remove();
                resolve(result);
            };

            cancelBtn.addEventListener('click', () => {
                finish(null);
            });

            form.addEventListener('submit', (e) => {
                e.preventDefault();

                const selectedLanguages = [];
                languageCheckboxesContainer.querySelectorAll('input[type="checkbox"]:checked').forEach(cb => {
                    selectedLanguages.push(cb.dataset.langId);
                });

                finish({
                    format: formatSelect.value,
                    includeExamples: includeExamplesCheckbox.checked,
                    languages: selectedLanguages
                });
            });

            dialog.addEventListener('click', (e) => {
                if (e.target === dialog) {
                    finish(null);
                }
            });

            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') {
                    finish(null);
                }
            }, { signal: keydownController.signal });
        });
    }

    async showCollectionImportDialog({ importKind }) {
        const defaultStoragePath = await this.backendAPI.collections.getPath().catch(() => '');

        return new Promise((resolve) => {
            const fragment = templateLoader.cloneSync(
                './src/templates/collections/newDialogs.html',
                'tpl-import-collection-dialog'
            );
            const dialog = fragment.firstElementChild;

            document.body.appendChild(dialog);

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
            let dialogClosed = false;
            const keydownController = new AbortController();

            if (window.i18n && window.i18n.updateUI) {
                window.i18n.updateUI(dialog);
            }

            const t = (key, fallback) => (window.i18n && window.i18n.t) ? window.i18n.t(key) : fallback;
            if (importKind === 'openapi') {
                titleElement.textContent = t('import_dialog.title_openapi', 'Import OpenAPI Collection');
                subtitleElement.textContent = t('import_dialog.subtitle_openapi', 'Choose an OpenAPI file and where the collection should be stored.');
            } else if (importKind === 'postman') {
                titleElement.textContent = t('import_dialog.title_postman', 'Import Postman Collection');
                subtitleElement.textContent = t('import_dialog.subtitle_postman', 'Choose a Postman file and where the collection should be stored.');
            }

            const setError = (message = '') => {
                if (!message) {
                    errorMessage.classList.add('is-hidden');
                    errorMessage.textContent = '';
                    return;
                }
                errorMessage.textContent = message;
                errorMessage.classList.remove('is-hidden');
            };

            const fileNameFromPath = (path) => path.split(/[/\\]/).filter(Boolean).pop() || path;
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

            const closeDialog = async (result = null) => {
                if (dialogClosed) {
                    return;
                }
                dialogClosed = true;
                keydownController.abort();
                dialog.remove();
                resolve(result);
            };

            const escapeHandler = (e) => {
                if (e.key === 'Escape') {
                    void closeDialog(null);
                }
            };

            closeBtn.addEventListener('click', () => {
                void closeDialog(null);
            });

            cancelBtn.addEventListener('click', () => {
                void closeDialog(null);
            });

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

                void closeDialog({
                    filePath: selectedFilePath,
                    storageParentPath: selectedStoragePath || null
                });
            });

            dialog.addEventListener('click', (e) => {
                if (e.target === dialog) {
                    void closeDialog(null);
                }
            });

            document.addEventListener('keydown', escapeHandler, {
                signal: keydownController.signal
            });
        });
    }
}
