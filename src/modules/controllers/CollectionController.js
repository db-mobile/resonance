/**
 * @fileoverview Controller for coordinating collection operations between UI and services
 * @module controllers/CollectionController
 */

import { CollectionRepository } from '../storage/CollectionRepository.js';
import { VariableRepository } from '../storage/VariableRepository.js';
import { SchemaProcessor } from '../schema/SchemaProcessor.js';
import { VariableProcessor } from '../variables/VariableProcessor.js';
import { CollectionService } from '../services/CollectionService.js';
import { VariableService } from '../services/VariableService.js';
import { CollectionRenderer } from '../ui/CollectionRenderer.js';
import { ContextMenu } from '../ui/ContextMenu.js';
import { RenameDialog } from '../ui/RenameDialog.js';
import { ConfirmDialog } from '../ui/ConfirmDialog.js';
import { VariableManager } from '../ui/VariableManager.js';
import { CurlImportDialog } from '../ui/CurlImportDialog.js';
import { templateLoader } from '../templateLoader.js';
import { StatusDisplayAdapter } from '../interfaces/IStatusDisplay.js';
import { setRequestBodyContent, getRequestBodyContent } from '../requestBodyHelper.js';

/**
 * Controller for coordinating collection operations between UI and services
 *
 * @class
 * @classdesc Mediates between UI components and collection/variable services,
 * handling user interactions such as loading collections, managing endpoints,
 * context menus, and variable operations. Coordinates with workspace tabs
 * for endpoint loading and state management.
 */
export class CollectionController {
    /**
     * Creates a CollectionController instance
     *
     * @param {Object} backendAPI - The backend IPC API bridge for storage operations
     * @param {Function} updateStatusDisplay - Callback function to update status display UI
     */
    constructor(backendAPI, updateStatusDisplay) {
        this.backendAPI = backendAPI;
        this.repository = new CollectionRepository(backendAPI);
        this.variableRepository = new VariableRepository(backendAPI);
        this.schemaProcessor = new SchemaProcessor();
        this.variableProcessor = new VariableProcessor();
        this.statusDisplay = new StatusDisplayAdapter(updateStatusDisplay);
        
        this.service = new CollectionService(this.repository, this.schemaProcessor, this.statusDisplay);
        this.variableService = new VariableService(this.variableRepository, this.variableProcessor, this.statusDisplay);
        
        this.renderer = new CollectionRenderer('collections-list', this.repository);
        this.contextMenu = new ContextMenu();
        this.renameDialog = new RenameDialog();
        this.confirmDialog = new ConfirmDialog();
        this.variableManager = new VariableManager();
        this.curlImportDialog = new CurlImportDialog();
        
        this.handleEndpointClick = this.handleEndpointClick.bind(this);
        this.handleContextMenu = this.handleContextMenu.bind(this);
        this.handleEndpointContextMenu = this.handleEndpointContextMenu.bind(this);
        this.handleEmptySpaceContextMenu = this.handleEmptySpaceContextMenu.bind(this);
        this.handleRename = this.handleRename.bind(this);
        this.handleDelete = this.handleDelete.bind(this);
        this.handleDeleteRequest = this.handleDeleteRequest.bind(this);
        this.handleVariables = this.handleVariables.bind(this);
        this.handleNewRequest = this.handleNewRequest.bind(this);
        this.handleNewCollection = this.handleNewCollection.bind(this);
        this.handleNewRequestInEmptySpace = this.handleNewRequestInEmptySpace.bind(this);
        this.handleExportOpenApiJson = this.handleExportOpenApiJson.bind(this);
        this.handleExportOpenApiYaml = this.handleExportOpenApiYaml.bind(this);
        this.handleImportCurl = this.handleImportCurl.bind(this);
    }

    /**
     * Loads all collections from storage and renders them in the UI
     *
     * @async
     * @returns {Promise<Array<Object>>} Array of collection objects, or empty array on error
     */
    async loadCollections() {
        try {
            const collections = await this.service.loadCollections();
            await this.renderCollections(collections);
            return collections;
        } catch (error) {
            return [];
        }
    }

    /**
     * Loads all collections from storage and renders them preserving folder expansion state
     *
     * @async
     * @returns {Promise<Array<Object>>} Array of collection objects, or empty array on error
     */
    async loadCollectionsWithExpansionState() {
        try {
            const collections = await this.service.loadCollections();
            await this.renderCollections(collections, true); // Preserve expansion state
            return collections;
        } catch (error) {
            return [];
        }
    }

    /**
     * Renders collections in the UI with optional expansion state preservation
     *
     * @async
     * @param {Array<Object>} collections - Array of collection objects to render
     * @param {boolean} [preserveExpansionState=false] - Whether to preserve folder expansion state
     * @returns {Promise<void>}
     */
    async renderCollections(collections, preserveExpansionState = false) {
        const eventHandlers = {
            onEndpointClick: this.handleEndpointClick,
            onContextMenu: this.handleContextMenu,
            onEndpointContextMenu: this.handleEndpointContextMenu,
            onEmptySpaceContextMenu: this.handleEmptySpaceContextMenu
        };

        await this.renderer.renderCollections(collections, eventHandlers, preserveExpansionState);
    }

    /**
     * Handles user click on an endpoint in the collection tree
     *
     * Loads endpoint data into the current workspace tab or fallback form.
     * Persists the selection and updates UI state.
     *
     * @async
     * @param {Object} collection - The parent collection object
     * @param {Object} endpoint - The endpoint object to load
     * @returns {Promise<void>}
     */
    async handleEndpointClick(collection, endpoint) {
        try {
            // Use workspace tab controller to load endpoint into current tab
            if (window.workspaceTabController) {
                // Set the OpenAPI spec for schema processor
                this.schemaProcessor.setOpenApiSpec(collection._openApiSpec);

                // Generate request body string if needed
                let requestBodyString = '';
                if (endpoint.requestBody) {
                    requestBodyString = this.service.generateRequestBody(endpoint.requestBody);
                }

                // Load all persisted data if available
                const isGrpc = endpoint.protocol === 'grpc';

                const persistedUrl = isGrpc ? null : await this.repository.getPersistedUrl(collection.id, endpoint.id);
                const persistedAuthConfig = isGrpc ? null : await this.repository.getPersistedAuthConfig(collection.id, endpoint.id);
                const persistedPathParams = isGrpc ? [] : await this.repository.getPersistedPathParams(collection.id, endpoint.id);
                const persistedQueryParams = isGrpc ? [] : await this.repository.getPersistedQueryParams(collection.id, endpoint.id);
                const persistedHeaders = isGrpc ? [] : await this.repository.getPersistedHeaders(collection.id, endpoint.id);
                const persistedBody = isGrpc ? null : await this.repository.getModifiedRequestBody(collection.id, endpoint.id);
                const grpcData = isGrpc ? await this.repository.getGrpcData(collection.id, endpoint.id) : null;

                const endpointData = {
                    ...endpoint,
                    collectionId: collection.id,
                    protocol: isGrpc ? 'grpc' : 'http',
                    collectionBaseUrl: collection.baseUrl,
                    collectionDefaultHeaders: collection.defaultHeaders,
                    path: endpoint.path,
                    method: endpoint.method,
                    requestBodyString: requestBodyString,  // Pass the generated string
                    persistedUrl: persistedUrl,  // Pass persisted URL if available
                    persistedAuthConfig: persistedAuthConfig,  // Pass persisted data if available
                    persistedPathParams: persistedPathParams,
                    persistedQueryParams: persistedQueryParams,
                    persistedHeaders: persistedHeaders,
                    persistedBody: persistedBody,
                    grpcData: grpcData
                };
                await window.workspaceTabController.loadEndpoint(endpointData, false);
            } else {
                // Fallback to old behavior if workspace tabs not available
                const formElements = this.getFormElements();
                await this.service.loadEndpointIntoForm(collection, endpoint, formElements);
            }

            await this.repository.saveLastSelectedRequest(collection.id, endpoint.id);

            if (this.renderer && typeof this.renderer.setActiveEndpoint === 'function') {
                this.renderer.setActiveEndpoint(collection.id, endpoint.id);
            }
        } catch (error) {
            void error;
        }
    }

    /**
     * Handles right-click context menu on a collection
     *
     * Displays context menu with options: New Request, Manage Variables,
     * Export options, Rename Collection, and Delete Collection.
     *
     * @param {Event} event - The context menu event
     * @param {Object} collection - The collection object
     * @returns {void}
     */
    handleContextMenu(event, collection) {
        const menuItems = [
            {
                label: 'New Request',
                translationKey: 'context_menu.new_request',
                iconClass: ContextMenu.createNewRequestIcon(),
                onClick: () => this.handleNewRequest(collection)
            },
            {
                label: 'Import cURL',
                translationKey: 'context_menu.import_curl',
                iconClass: ContextMenu.createImportIcon(),
                onClick: () => this.handleImportCurl(collection)
            },
            {
                label: 'Manage Variables',
                translationKey: 'context_menu.manage_variables',
                iconClass: ContextMenu.createVariableIcon(),
                onClick: () => this.handleVariables(collection)
            },
            {
                label: 'Export as OpenAPI (JSON)',
                translationKey: 'context_menu.export_openapi_json',
                iconClass: ContextMenu.createExportIcon(),
                onClick: () => this.handleExportOpenApiJson(collection)
            },
            {
                label: 'Export as OpenAPI (YAML)',
                translationKey: 'context_menu.export_openapi_yaml',
                iconClass: ContextMenu.createExportIcon(),
                onClick: () => this.handleExportOpenApiYaml(collection)
            },
            {
                label: 'Export as Postman',
                translationKey: 'context_menu.export_postman',
                iconClass: ContextMenu.createExportIcon(),
                onClick: () => this.handleExportPostman(collection)
            },
            {
                label: 'Rename Collection',
                translationKey: 'context_menu.rename_collection',
                iconClass: ContextMenu.createRenameIcon(),
                onClick: () => this.handleRename(collection)
            },
            {
                label: 'Delete Collection',
                translationKey: 'context_menu.delete_collection',
                iconClass: ContextMenu.createDeleteIcon(),
                className: 'context-menu-delete',
                onClick: () => this.handleDelete(collection)
            }
        ];

        this.contextMenu.show(event, menuItems);
    }

    /**
     * Handles right-click context menu on an endpoint
     *
     * Displays context menu with delete option.
     *
     * @param {Event} event - The context menu event
     * @param {Object} collection - The parent collection object
     * @param {Object} endpoint - The endpoint object
     * @returns {void}
     */
    handleEndpointContextMenu(event, collection, endpoint) {
        const menuItems = [
            {
                label: 'Delete Request',
                translationKey: 'context_menu.delete_request',
                iconClass: ContextMenu.createDeleteIcon(),
                className: 'context-menu-delete',
                onClick: () => this.handleDeleteRequest(collection, endpoint)
            }
        ];

        this.contextMenu.show(event, menuItems);
    }

    /**
     * Handles right-click context menu on empty space in collections panel
     *
     * Displays context menu with options: New Collection and New Request.
     *
     * @param {Event} event - The context menu event
     * @returns {void}
     */
    handleEmptySpaceContextMenu(event) {
        const menuItems = [
            {
                label: 'New Collection',
                translationKey: 'context_menu.new_collection',
                iconClass: ContextMenu.createNewRequestIcon(),
                onClick: () => this.handleNewCollection()
            },
            {
                label: 'New Request',
                translationKey: 'context_menu.new_request',
                iconClass: ContextMenu.createNewRequestIcon(),
                onClick: () => this.handleNewRequestInEmptySpace()
            },
            {
                label: 'Import cURL',
                translationKey: 'context_menu.import_curl',
                iconClass: ContextMenu.createImportIcon(),
                onClick: () => this.handleImportCurl(null)
            }
        ];

        this.contextMenu.show(event, menuItems);
    }

    /**
     * Handles collection rename operation
     *
     * Shows rename dialog and updates collection name if confirmed.
     *
     * @async
     * @param {Object} collection - The collection to rename
     * @returns {Promise<void>}
     */
    async handleRename(collection) {
        try {
            const newName = await this.renameDialog.show(collection.name);
            if (newName && newName !== collection.name) {
                await this.service.renameCollection(collection.id, newName);
                await this.loadCollections(); // Refresh display
            }
        } catch (error) {
            void error;
        }
    }

    /**
     * Handles variable management for a collection
     *
     * Opens variable manager dialog and saves changes if confirmed.
     * Variable substitution occurs at request time, not in the form.
     *
     * @async
     * @param {Object} collection - The collection whose variables to manage
     * @returns {Promise<void>}
     */
    async handleVariables(collection) {
        try {
            const currentVariables = await this.variableService.getVariablesForCollection(collection.id);
            const newVariables = await this.variableManager.show(collection.name, currentVariables);
            
            if (newVariables !== null) {
                await this.variableService.setMultipleVariables(collection.id, newVariables);

                // Don't substitute variables in the form - they should stay as {{...}} placeholders
                // Variable substitution happens at request time in apiHandler.js
                // if (window.currentEndpoint && window.currentEndpoint.collectionId === collection.id) {
                //     const formElements = this.getFormElements();
                //     await this.processFormVariablesExceptUrl(collection.id, formElements);
                // }
            }
        } catch (error) {
            void error;
        }
    }

    /**
     * Handles creation of a new request in an existing collection
     *
     * Shows new request dialog and adds request to collection if confirmed.
     *
     * @async
     * @param {Object} collection - The collection to add the request to
     * @returns {Promise<void>}
     */
    async handleNewRequest(collection) {
        try {
            const requestData = await this.showNewRequestDialog();
            if (requestData) {
                await this.service.addRequestToCollection(collection.id, requestData);
                await this.loadCollectionsWithExpansionState();
            }
        } catch (error) {
            void error;
        }
    }

    /**
     * Handles creation of a new empty collection
     *
     * Shows new collection dialog and creates collection if confirmed.
     *
     * @async
     * @returns {Promise<void>}
     */
    async handleNewCollection() {
        try {
            const collectionName = await this.showNewCollectionDialog();
            if (collectionName) {
                await this.service.createCollection(collectionName);
                await this.loadCollections();
            }
        } catch (error) {
            void error;
        }
    }

    /**
     * Handles creation of a new request with a new collection
     *
     * Shows both request and collection dialogs, creates both if confirmed.
     *
     * @async
     * @returns {Promise<void>}
     */
    async handleNewRequestInEmptySpace() {
        try {
            const requestData = await this.showNewRequestDialog();
            if (requestData) {
                const collectionName = await this.showNewCollectionDialog();
                if (collectionName) {
                    const newCollection = await this.service.createCollection(collectionName);
                    await this.service.addRequestToCollection(newCollection.id, requestData);
                    await this.loadCollections();
                }
            }
        } catch (error) {
            void error;
        }
    }

    /**
     * Shows dialog for creating a new collection
     *
     * @async
     * @returns {Promise<string|null>} Collection name if confirmed, null if cancelled
     */
    async showNewCollectionDialog() {
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
            const cancelBtn = dialog.querySelector('#cancel-btn');

            nameInput.focus();

            const cleanup = () => {
                dialog.remove();
            };

            cancelBtn.addEventListener('click', () => {
                cleanup();
                resolve(null);
            });

            form.addEventListener('submit', (e) => {
                e.preventDefault();
                const name = nameInput.value.trim();

                if (name) {
                    cleanup();
                    resolve(name);
                }
            });

            dialog.addEventListener('click', (e) => {
                if (e.target === dialog) {
                    cleanup();
                    resolve(null);
                }
            });

            const escapeHandler = (e) => {
                if (e.key === 'Escape') {
                    cleanup();
                    resolve(null);
                    document.removeEventListener('keydown', escapeHandler);
                }
            };
            document.addEventListener('keydown', escapeHandler);
        });
    }

    /**
     * Shows dialog for creating a new request
     *
     * @async
     * @returns {Promise<Object|null>} Request data object with name, method, and path if confirmed, null if cancelled
     */
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
            const pathInput = dialog.querySelector('#request-path');
            const grpcTargetGroup = dialog.querySelector('#grpc-target-group');
            const grpcTargetInput = dialog.querySelector('#grpc-target');
            const cancelBtn = dialog.querySelector('#cancel-btn');

            nameInput.focus();

            const cleanup = () => {
                dialog.remove();
            };

            cancelBtn.addEventListener('click', () => {
                cleanup();
                resolve(null);
            });

            const updateProtocolUI = () => {
                const isGrpc = protocolSelect.value === 'grpc';
                methodSelect.parentElement.classList.toggle('is-hidden', isGrpc);
                pathInput.parentElement.classList.toggle('is-hidden', isGrpc);
                grpcTargetGroup.classList.toggle('is-hidden', !isGrpc);

                if (isGrpc) {
                    methodSelect.required = false;
                    pathInput.required = false;
                    grpcTargetInput.required = true;
                } else {
                    methodSelect.required = true;
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
                        cleanup();
                        resolve({
                            name,
                            protocol: 'grpc',
                            target,
                            fullMethod: '',
                            requestJson: '{}'
                        });
                    }
                } else {
                    const method = methodSelect.value;
                    const path = pathInput.value.trim();
                    if (name && method && path) {
                        cleanup();
                        resolve({
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
                    cleanup();
                    resolve(null);
                }
            });

            const escapeHandler = (e) => {
                if (e.key === 'Escape') {
                    cleanup();
                    resolve(null);
                    document.removeEventListener('keydown', escapeHandler);
                }
            };
            document.addEventListener('keydown', escapeHandler);
        });
    }

    /**
     * Handles collection deletion with confirmation
     *
     * Shows confirmation dialog and deletes collection and its variables if confirmed.
     *
     * @async
     * @param {Object} collection - The collection to delete
     * @returns {Promise<void>}
     */
    async handleDelete(collection) {
        const confirmMessage = window.i18n ?
            window.i18n.t('collection.confirm_delete', { name: collection.name }) :
            `Are you sure you want to delete the collection "${collection.name}"?\n\nThis action cannot be undone.`;

        const title = window.i18n ?
            window.i18n.t('collection.delete_title') || 'Delete Collection' :
            'Delete Collection';

        const confirmText = window.i18n ?
            window.i18n.t('common.delete') || 'Delete' :
            'Delete';

        const cancelText = window.i18n ?
            window.i18n.t('common.cancel') || 'Cancel' :
            'Cancel';

        const confirmed = await this.confirmDialog.show(confirmMessage, {
            title,
            confirmText,
            cancelText,
            dangerous: true
        });

        if (confirmed) {
            try {
                await this.service.deleteCollection(collection.id);
                await this.variableService.cleanupCollectionVariables(collection.id);
                await this.loadCollections();
            } catch (error) {
                void error;
            }
        }
    }

    /**
     * Handles export of collection as OpenAPI JSON
     *
     * Triggers export process via service layer.
     *
     * @async
     * @param {Object} collection - The collection to export
     * @returns {Promise<void>}
     */
    async handleExportOpenApiJson(collection) {
        try {
            await this.service.exportCollectionAsOpenApi(collection.id, 'json');
        } catch (error) {
            void error;
        }
    }

    /**
     * Handles export of collection as OpenAPI YAML
     *
     * Triggers export process via service layer.
     *
     * @async
     * @param {Object} collection - The collection to export
     * @returns {Promise<void>}
     */
    async handleExportOpenApiYaml(collection) {
        try {
            await this.service.exportCollectionAsOpenApi(collection.id, 'yaml');
        } catch (error) {
            void error;
        }
    }

    async handleExportPostman(collection) {
        try {
            await this.service.exportCollectionAsPostman(collection.id);
        } catch (error) {
            void error;
        }
    }

    /**
     * Handles request deletion with confirmation
     *
     * Shows confirmation dialog and deletes request from collection if confirmed.
     * Clears form UI if the deleted request is currently active.
     *
     * @async
     * @param {Object} collection - The parent collection
     * @param {Object} endpoint - The request/endpoint to delete
     * @returns {Promise<void>}
     */
    async handleDeleteRequest(collection, endpoint) {
        const confirmMessage = window.i18n ?
            window.i18n.t('endpoint.confirm_delete', { name: endpoint.name || endpoint.path }) :
            `Are you sure you want to delete the request "${endpoint.name || endpoint.path}"?\n\nThis action cannot be undone.`;

        const title = window.i18n ?
            window.i18n.t('endpoint.delete_title') || 'Delete Request' :
            'Delete Request';

        const confirmText = window.i18n ?
            window.i18n.t('common.delete') || 'Delete' :
            'Delete';

        const cancelText = window.i18n ?
            window.i18n.t('common.cancel') || 'Cancel' :
            'Cancel';

        const confirmed = await this.confirmDialog.show(confirmMessage, {
            title,
            confirmText,
            cancelText,
            dangerous: true
        });

        if (confirmed) {
            try {
                await this.service.deleteRequestFromCollection(collection.id, endpoint.id);

                if (window.currentEndpoint &&
                    window.currentEndpoint.collectionId === collection.id &&
                    window.currentEndpoint.endpointId === endpoint.id) {
                    const formElements = this.getFormElements();
                    formElements.urlInput.value = '';
                    formElements.methodSelect.value = 'GET';
                    setRequestBodyContent('');
                    this.service.clearKeyValueList(formElements.pathParamsList);
                    this.service.clearKeyValueList(formElements.headersList);
                    this.service.clearKeyValueList(formElements.queryParamsList);
                    window.currentEndpoint = null;

                    await this.repository.clearLastSelectedRequest();

                    this.renderer.clearActiveEndpoint();
                }

                await this.loadCollectionsWithExpansionState();
            } catch (error) {
                void error;
            }
        }
    }

    /**
     * Imports an OpenAPI specification file and creates a collection
     *
     * Triggers file picker dialog via IPC and processes the selected file.
     *
     * @async
     * @returns {Promise<Object|null>} Created collection object or null if cancelled
     * @throws {Error} If import fails
     */
    async importOpenApiFile() {
        try {
            const collection = await window.backendAPI.collections.importOpenApiFile();

            if (collection) {
                await this.loadCollections();
                return collection;
            }
                this.statusDisplay.update('Import cancelled', null);
                return null;

        } catch (error) {
            this.statusDisplay.update(`Import error: ${error.message}`, null);
            throw error;
        }
    }

    /**
     * Imports a Postman collection file and creates a collection
     *
     * Triggers file picker dialog via IPC and processes the selected Postman collection file.
     * Also imports any collection variables extracted from the Postman collection.
     *
     * @async
     * @returns {Promise<Object|null>} Created collection object or null if cancelled
     * @throws {Error} If import fails
     */
    async importPostmanCollection() {
        try {
            const result = await window.backendAPI.collections.importPostmanCollection();

            if (result) {
                await this.loadCollections();
                this.statusDisplay.update('Postman collection imported successfully', null);
                return result.collection;
            }
                this.statusDisplay.update('Import cancelled', null);
                return null;

        } catch (error) {
            this.statusDisplay.update(`Import error: ${error.message}`, null);
            throw error;
        }
    }

    /**
     * Imports a Postman environment file and creates/updates an environment
     *
     * Triggers file picker dialog via IPC and processes the selected Postman environment file.
     * Creates a new environment with the imported variables or allows user to merge with existing.
     *
     * @async
     * @returns {Promise<Object|null>} Environment object with name and variables, or null if cancelled
     * @throws {Error} If import fails
     */
    async importPostmanEnvironment() {
        try {
            const environment = await window.backendAPI.collections.importPostmanEnvironment();

            if (environment) {
                if (window.environmentController) {
                    await window.environmentController.handleImportEnvironment(environment);
                }
                return environment;
            }
                this.statusDisplay.update('Import cancelled', null);
                return null;

        } catch (error) {
            this.statusDisplay.update(`Import error: ${error.message}`, null);
            throw error;
        }
    }

    /**
     * Handles cURL import from context menu
     *
     * Shows cURL import dialog and creates a new request in the specified collection.
     * If no collection is specified, allows user to create a new collection.
     *
     * @async
     * @param {Object|null} collection - Target collection or null to show collection picker
     * @returns {Promise<void>}
     */
    async handleImportCurl(collection) {
        try {
            const collections = await this.service.loadCollections();
            const targetCollectionId = collection ? collection.id : null;

            const result = await this.curlImportDialog.show(collections, {
                targetCollectionId
            });

            if (!result) {
                return;
            }

            let targetCollection;

            if (result.newCollectionName) {
                targetCollection = await this.service.createCollection(result.newCollectionName);
            } else {
                targetCollection = collections.find(c => c.id === result.collectionId);
                if (!targetCollection) {
                    this.statusDisplay.update('Collection not found', null);
                    return;
                }
            }

            const requestData = {
                name: result.endpoint.name,
                method: result.endpoint.method,
                path: result.endpoint.path,
                protocol: 'http'
            };

            const newEndpoint = await this.service.addRequestToCollection(targetCollection.id, requestData);

            if (result.endpoint.requestBody) {
                await this.repository.saveModifiedRequestBody(
                    targetCollection.id,
                    newEndpoint.id,
                    result.endpoint.requestBody.example
                );
            }

            if (Object.keys(result.endpoint.headers).length > 0) {
                const headers = Object.entries(result.endpoint.headers).map(([key, value]) => ({
                    key,
                    value
                }));
                await this.repository.savePersistedHeaders(targetCollection.id, newEndpoint.id, headers);
            }

            if (Object.keys(result.endpoint.parameters.query).length > 0) {
                const queryParams = Object.entries(result.endpoint.parameters.query).map(([key, param]) => ({
                    key,
                    value: param.example || ''
                }));
                await this.repository.savePersistedQueryParams(targetCollection.id, newEndpoint.id, queryParams);
            }

            if (result.auth) {
                await this.repository.savePersistedAuthConfig(targetCollection.id, newEndpoint.id, result.auth);
            }

            await this.loadCollections();
            this.statusDisplay.update(`Imported cURL as "${result.endpoint.name}"`, null);

        } catch (error) {
            this.statusDisplay.update(`cURL import error: ${error.message}`, null);
        }
    }

    /**
     * Saves user modifications to a request body
     *
     * @async
     * @param {string} collectionId - Collection ID
     * @param {string} endpointId - Endpoint ID
     * @returns {Promise<void>}
     */
    async saveRequestBodyModification(collectionId, endpointId) {
        const bodyInput = document.getElementById('body-input');
        if (bodyInput) {
            await this.service.saveRequestBodyModification(collectionId, endpointId, bodyInput);
        }
    }

    /**
     * Saves all request modifications (path params, query params, headers, body, auth)
     *
     * @async
     * @param {string} collectionId - Collection ID
     * @param {string} endpointId - Endpoint ID
     * @returns {Promise<void>}
     */
    async saveAllRequestModifications(collectionId, endpointId) {
        try {
            // Import parseKeyValuePairs from keyValueManager
            const { parseKeyValuePairs } = await import('../keyValueManager.js');
            const { authManager } = await import('../authManager.js');

            const collections = await this.repository.getAll();
            const collection = collections.find(c => c.id === collectionId);
            if (!collection) {
                return;
            }
            const endpointLocations = this._findAllEndpointLocations(collection, endpointId);
            const endpoint = endpointLocations.length > 0 ? endpointLocations[0].endpoint : null;
            const isGrpc = endpoint && endpoint.protocol === 'grpc';

            if (isGrpc) {
                const grpcTargetInput = document.getElementById('grpc-target-input');
                const grpcServiceSelect = document.getElementById('grpc-service-select');
                const grpcMethodSelect = document.getElementById('grpc-method-select');
                const grpcBodyInput = document.getElementById('grpc-body-input');
                const grpcMetadataList = document.getElementById('grpc-metadata-list');

                const metadata = {};
                if (grpcMetadataList) {
                    grpcMetadataList.querySelectorAll('.key-value-row').forEach(row => {
                        const key = row.querySelector('.key-input')?.value?.trim();
                        const value = row.querySelector('.value-input')?.value || '';
                        if (key) {
                            metadata[key] = value;
                        }
                    });
                }

                const grpcTlsCheckbox = document.getElementById('grpc-tls-checkbox');

                const requestJson = window.grpcBodyEditor
                    ? window.grpcBodyEditor.getContent()
                    : (grpcBodyInput?.value || '{}');

                await this.repository.saveGrpcData(collectionId, endpointId, {
                    target: grpcTargetInput?.value || '',
                    service: grpcServiceSelect?.value || '',
                    fullMethod: grpcMethodSelect?.value || endpoint.path || '',
                    requestJson: requestJson || '{}',
                    metadata,
                    useTls: grpcTlsCheckbox?.checked || false
                });

                // Update endpoint.path for display (show fullMethod)
                endpointLocations.forEach(({ endpoint: e }) => {
                    e.path = grpcMethodSelect?.value || e.path;
                });
                await this.repository.save(collections);
                await this.loadCollectionsWithExpansionState();

                this.statusDisplay.update('Request saved', null);
                return;
            }

            // Get all form elements
            const urlInput = document.getElementById('url-input');
            const pathParamsList = document.getElementById('path-params-list');
            const queryParamsList = document.getElementById('query-params-list');
            const headersList = document.getElementById('headers-list');
            const bodyInput = document.getElementById('body-input');

            // Save URL and update endpoint path in collection
            if (urlInput && urlInput.value) {
                await this.repository.savePersistedUrl(collectionId, endpointId, urlInput.value);

                // Update the endpoint's path in the collection for sidebar display
                try {
                    const path = this._normalizePath(urlInput.value);

                    // Update the endpoint in the collection
                    const collections = await this.repository.getAll();
                    const collection = collections.find(c => c.id === collectionId);

                    if (!collection) {
                        return;
                    }

                    // Find all locations where the endpoint exists (handles duplicates)
                    const foundLocations = this._findAllEndpointLocations(collection, endpointId);

                    if (foundLocations.length === 0) {
                        return;
                    }

                    // Update endpoint in ALL locations where it was found
                    foundLocations.forEach(({ endpoint }) => {
                        endpoint.path = path;
                    });

                    await this.repository.save(collections);

                    // Refresh the collection tree display
                    await this.loadCollectionsWithExpansionState();
                } catch (error) {
                    void error;
                }
            }

            // Parse all key-value pairs for saving and workspace tab update
            let pathParams = {};
            let queryParams = {};
            let headers = {};

            // Save path parameters
            if (pathParamsList) {
                pathParams = parseKeyValuePairs(pathParamsList);
                const pathParamsArray = Object.entries(pathParams).map(([key, value]) => ({ key, value }));
                await this.repository.savePersistedPathParams(collectionId, endpointId, pathParamsArray);
            }

            // Save query parameters
            if (queryParamsList) {
                queryParams = parseKeyValuePairs(queryParamsList);
                const queryParamsArray = Object.entries(queryParams).map(([key, value]) => ({ key, value }));
                await this.repository.savePersistedQueryParams(collectionId, endpointId, queryParamsArray);
            }

            // Save headers
            if (headersList) {
                headers = parseKeyValuePairs(headersList);
                const headersArray = Object.entries(headers).map(([key, value]) => ({ key, value }));
                await this.repository.savePersistedHeaders(collectionId, endpointId, headersArray);
            }

            // Save request body
            if (bodyInput) {
                await this.service.saveRequestBodyModification(collectionId, endpointId, bodyInput);
            }

            // Save auth configuration
            const authConfig = authManager.getAuthConfig();
            if (authConfig) {
                await this.repository.savePersistedAuthConfig(collectionId, endpointId, authConfig);
            }

            this.statusDisplay.update('Request saved', null);

            // Update the current workspace tab state to reflect the saved changes
            if (!window.workspaceTabController) {
                return;
            }

            const activeTab = await window.workspaceTabController.getActiveTab();
            if (!activeTab || !activeTab.request) {
                return;
            }

            // Update the tab's request data with all saved changes
            const updatedRequest = {};
            let hasChanges = false;

            // Update URL
            if (urlInput && urlInput.value && activeTab.request.url !== urlInput.value) {
                updatedRequest.url = urlInput.value;
                hasChanges = true;
            }

            // Update path params
            if (pathParamsList) {
                updatedRequest.pathParams = pathParams;
                hasChanges = true;
            }

            // Update query params
            if (queryParamsList) {
                updatedRequest.queryParams = queryParams;
                hasChanges = true;
            }

            // Update headers
            if (headersList) {
                updatedRequest.headers = headers;
                hasChanges = true;
            }

            // Update body
            if (bodyInput) {
                // Check if GraphQL mode is enabled
                const graphqlBodyManager = window.domElements?.graphqlBodyManager;
                const isGraphQLMode = graphqlBodyManager && graphqlBodyManager.isGraphQLMode();

                if (isGraphQLMode) {
                    updatedRequest.body = {
                        mode: 'graphql',
                        query: graphqlBodyManager.getGraphQLQuery(),
                        variables: graphqlBodyManager.getGraphQLVariables()
                    };
                } else {
                    updatedRequest.body = {
                        mode: 'json',
                        content: getRequestBodyContent()
                    };
                }
                hasChanges = true;
            }

            // Update auth config
            if (authConfig) {
                updatedRequest.authType = authConfig.type || 'none';
                updatedRequest.authConfig = authConfig.config || {};
                hasChanges = true;
            }

            // Update the tab in the service to persist the changes
            if (!hasChanges) {
                return;
            }

            const activeTabId = await window.workspaceTabController.service.getActiveTabId();
            if (!activeTabId) {
                return;
            }

            await window.workspaceTabController.service.updateTab(activeTabId, {
                request: updatedRequest
            });
        } catch (error) {
            this.statusDisplay.update(`Error saving request: ${error.message}`, null);
            throw error;
        }
    }

    /**
     * Initializes automatic tracking of request body changes
     *
     * Sets up event listeners to save body modifications on blur and after debounced input.
     *
     * @returns {void}
     */
    initializeBodyTracking() {
        const bodyInput = document.getElementById('body-input');
        if (bodyInput) {
            bodyInput.addEventListener('blur', async () => {
                if (window.currentEndpoint) {
                    await this.saveRequestBodyModification(
                        window.currentEndpoint.collectionId, 
                        window.currentEndpoint.endpointId
                    );
                }
            });

            let saveTimeout;
            bodyInput.addEventListener('input', () => {
                clearTimeout(saveTimeout);
                saveTimeout = setTimeout(async () => {
                    if (window.currentEndpoint) {
                        await this.saveRequestBodyModification(
                            window.currentEndpoint.collectionId, 
                            window.currentEndpoint.endpointId
                        );
                    }
                }, 2000);
            });
        }
    }

    /**
     * Processes and substitutes variables in all form elements
     *
     * Substitutes template variables in URL, body, headers, and query params.
     *
     * @async
     * @param {string} collectionId - Collection ID for variable lookup
     * @param {Object} formElements - Object containing form element references
     * @returns {Promise<void>}
     */
    async processFormVariables(collectionId, formElements) {
        try {
            if (formElements.urlInput && formElements.urlInput.value) {
                formElements.urlInput.value = await this.variableService.processTemplate(
                    formElements.urlInput.value, 
                    collectionId
                );
            }

            const currentBody = getRequestBodyContent();
            if (currentBody) {
                const processedBody = await this.variableService.processTemplate(
                    currentBody,
                    collectionId
                );
                setRequestBodyContent(processedBody);
            }

            if (formElements.headersList) {
                const headerRows = formElements.headersList.querySelectorAll('.key-value-row');
                headerRows.forEach(async (row) => {
                    const keyInput = row.querySelector('.key-input');
                    const valueInput = row.querySelector('.value-input');
                    
                    if (keyInput && keyInput.value) {
                        keyInput.value = await this.variableService.processTemplate(keyInput.value, collectionId);
                    }
                    if (valueInput && valueInput.value) {
                        valueInput.value = await this.variableService.processTemplate(valueInput.value, collectionId);
                    }
                });
            }

            if (formElements.queryParamsList) {
                const queryRows = formElements.queryParamsList.querySelectorAll('.key-value-row');
                queryRows.forEach(async (row) => {
                    const keyInput = row.querySelector('.key-input');
                    const valueInput = row.querySelector('.value-input');
                    
                    if (keyInput && keyInput.value) {
                        keyInput.value = await this.variableService.processTemplate(keyInput.value, collectionId);
                    }
                    if (valueInput && valueInput.value) {
                        valueInput.value = await this.variableService.processTemplate(valueInput.value, collectionId);
                    }
                });
            }
        } catch (error) {
            void error;
        }
    }

    /**
     * Processes and substitutes variables in form elements except URL
     *
     * Substitutes template variables in body, headers, and query params only.
     * Used when URL should remain as template for user visibility.
     *
     * @async
     * @param {string} collectionId - Collection ID for variable lookup
     * @param {Object} formElements - Object containing form element references
     * @returns {Promise<void>}
     */
    async processFormVariablesExceptUrl(collectionId, formElements) {
        try {
            const currentBody = getRequestBodyContent();
            if (currentBody) {
                const processedBody = await this.variableService.processTemplate(
                    currentBody,
                    collectionId
                );
                setRequestBodyContent(processedBody);
            }

            if (formElements.headersList) {
                const headerRows = formElements.headersList.querySelectorAll('.key-value-row');
                headerRows.forEach(async (row) => {
                    const keyInput = row.querySelector('.key-input');
                    const valueInput = row.querySelector('.value-input');
                    
                    if (keyInput && keyInput.value) {
                        keyInput.value = await this.variableService.processTemplate(keyInput.value, collectionId);
                    }
                    if (valueInput && valueInput.value) {
                        valueInput.value = await this.variableService.processTemplate(valueInput.value, collectionId);
                    }
                });
            }

            if (formElements.queryParamsList) {
                const queryRows = formElements.queryParamsList.querySelectorAll('.key-value-row');
                queryRows.forEach(async (row) => {
                    const keyInput = row.querySelector('.key-input');
                    const valueInput = row.querySelector('.value-input');
                    
                    if (keyInput && keyInput.value) {
                        keyInput.value = await this.variableService.processTemplate(keyInput.value, collectionId);
                    }
                    if (valueInput && valueInput.value) {
                        valueInput.value = await this.variableService.processTemplate(valueInput.value, collectionId);
                    }
                });
            }
        } catch (error) {
            void error;
        }
    }

    /**
     * Gets references to form elements in the UI
     *
     * @returns {Object} Object containing references to form input elements
     * @returns {HTMLInputElement} return.urlInput - URL input element
     * @returns {HTMLSelectElement} return.methodSelect - HTTP method select element
     * @returns {HTMLTextAreaElement} return.bodyInput - Request body textarea element
     * @returns {HTMLElement} return.pathParamsList - Path parameters list container
     * @returns {HTMLElement} return.headersList - Headers list container
     * @returns {HTMLElement} return.queryParamsList - Query parameters list container
     */
    getFormElements() {
        return {
            urlInput: document.getElementById('url-input'),
            methodSelect: document.getElementById('method-select'),
            bodyInput: document.getElementById('body-input'),
            pathParamsList: document.getElementById('path-params-list'),
            headersList: document.getElementById('headers-list'),
            queryParamsList: document.getElementById('query-params-list')
        };
    }

    /**
     * Gets variables for the currently loaded collection
     *
     * @async
     * @returns {Promise<Object>} Variables object for current collection, or empty object if no endpoint loaded
     */
    async getCurrentCollectionVariables() {
        if (window.currentEndpoint) {
            return this.variableService.getVariablesForCollection(window.currentEndpoint.collectionId);
        }
        return {};
    }

    /**
     * Processes a request object with variable substitution
     *
     * @async
     * @param {Object} request - Request configuration object
     * @returns {Promise<Object>} Processed request with substituted variables
     */
    async processRequestForVariables(request) {
        if (window.currentEndpoint) {
            return this.variableService.processRequest(request, window.currentEndpoint.collectionId);
        }
        return request;
    }

    /**
     * Restores the last selected request from storage
     *
     * Loads the previously selected endpoint into the form on application startup.
     * Clears saved selection if collection or endpoint no longer exists.
     *
     * @async
     * @returns {Promise<void>}
     */
    async restoreLastSelectedRequest() {
        try {
            const lastSelected = await this.repository.getLastSelectedRequest();

            if (!lastSelected || !lastSelected.collectionId || !lastSelected.endpointId) {
                return;
            }

            const collection = await this.repository.getById(lastSelected.collectionId);
            if (!collection) {
                await this.repository.clearLastSelectedRequest();
                return;
            }

            const endpoint = this._findEndpointInCollection(collection, lastSelected.endpointId);

            if (!endpoint) {
                await this.repository.clearLastSelectedRequest();
                return;
            }

            const formElements = this.getFormElements();
            await this.service.loadEndpointIntoForm(collection, endpoint, formElements);

            this.renderer.setActiveEndpoint(collection.id, endpoint.id);
        } catch (error) {
            void error;
        }
    }

    /**
     * Normalizes a URL by extracting the path component
     * Removes {{baseUrl}} variables and strips domain/query strings
     *
     * @private
     * @param {string} url - The URL to normalize
     * @returns {string} The normalized path
     */
    _normalizePath(url) {
        let path = url;

        // Remove {{baseUrl}} if present
        path = path.replace(/\{\{baseUrl\}\}/g, '');

        // If it's a full URL, extract just the pathname (without query string)
        if (path.match(/^https?:\/\//)) {
            const urlObj = new URL(path);
            path = urlObj.pathname;
        } else {
            // If it's not a full URL, remove query string if present
            const queryIndex = path.indexOf('?');
            if (queryIndex !== -1) {
                path = path.substring(0, queryIndex);
            }
        }

        return path;
    }

    /**
     * Finds all locations of an endpoint in a collection
     * Searches both top-level endpoints and endpoints within folders
     *
     * @private
     * @param {Object} collection - The collection to search
     * @param {string} endpointId - The endpoint ID to find
     * @returns {Array<Object>} Array of objects with endpoint references
     */
    _findAllEndpointLocations(collection, endpointId) {
        const foundLocations = [];

        // Search for endpoint in top-level endpoints
        const topLevelEndpoint = collection.endpoints?.find(e => e.id === endpointId);
        if (topLevelEndpoint) {
            foundLocations.push({ endpoint: topLevelEndpoint });
        }

        // Search in folders
        if (collection.folders) {
            for (const folder of collection.folders) {
                if (folder.endpoints) {
                    const folderEndpoint = folder.endpoints.find(e => e.id === endpointId);
                    if (folderEndpoint) {
                        foundLocations.push({ endpoint: folderEndpoint });
                    }
                }
            }
        }

        return foundLocations;
    }

    /**
     * Finds an endpoint in a collection (top-level or in folders)
     *
     * @private
     * @param {Object} collection - The collection to search
     * @param {string} endpointId - The endpoint ID to find
     * @returns {Object|null} The endpoint object or null if not found
     */
    _findEndpointInCollection(collection, endpointId) {
        // Search in top-level endpoints first
        if (collection.endpoints) {
            const endpoint = collection.endpoints.find(ep => ep.id === endpointId);
            if (endpoint) {
                return endpoint;
            }
        }

        // Search in folders
        if (collection.folders) {
            for (const folder of collection.folders) {
                if (folder.endpoints) {
                    const endpoint = folder.endpoints.find(ep => ep.id === endpointId);
                    if (endpoint) {
                        return endpoint;
                    }
                }
            }
        }

        return null;
    }
}