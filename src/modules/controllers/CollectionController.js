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
import { toast } from '../ui/Toast.js';
import { templateLoader } from '../templateLoader.js';
import { StatusDisplayAdapter } from '../interfaces/IStatusDisplay.js';
import { setRequestBodyContent, getRequestBodyContent } from '../requestBodyHelper.js';
import { DocGeneratorService } from '../services/DocGeneratorService.js';

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
        this.collectionsSearchInput = document.getElementById('collections-search-input');
        this.allCollections = [];
        this.searchQuery = '';
        
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
        this.handleCollectionsSearch = this.handleCollectionsSearch.bind(this);
        this.handleGenerateDocumentation = this.handleGenerateDocumentation.bind(this);
        this.handleTogglePinned = this.handleTogglePinned.bind(this);

        this.docGeneratorService = new DocGeneratorService(this.repository);

        this.initializeCollectionsSearch();
    }

    /**
     * Loads all collections from storage and renders them in the UI
     *
     * @async
     * @returns {Promise<Array<Object>>} Array of collection objects, or empty array on error
     */
    async loadCollections() {
        try {
            this.allCollections = await this.service.loadCollections();
            await this.renderCollections(this.allCollections);
            return this.allCollections;
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
            this.allCollections = await this.service.loadCollections();
            await this.renderCollections(this.allCollections, true); // Preserve expansion state
            return this.allCollections;
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
        const filteredCollections = this.filterCollections(collections, this.searchQuery);
        const isSearching = this.searchQuery.length > 0;
        const pinnedRequests = await this.repository.getPinnedRequests();
        const eventHandlers = {
            onEndpointClick: this.handleEndpointClick,
            onContextMenu: this.handleContextMenu,
            onEndpointContextMenu: this.handleEndpointContextMenu,
            onEmptySpaceContextMenu: this.handleEmptySpaceContextMenu,
            onTogglePinned: this.handleTogglePinned
        };

        await this.renderer.renderCollections(filteredCollections, eventHandlers, preserveExpansionState && !isSearching, {
            showSearchEmptyState: isSearching && this.allCollections.length > 0,
            expandSearchResults: isSearching
        }, pinnedRequests);
    }

    initializeCollectionsSearch() {
        if (!this.collectionsSearchInput) {
            return;
        }

        this.collectionsSearchInput.addEventListener('input', this.handleCollectionsSearch);
    }

    async handleCollectionsSearch() {
        this.searchQuery = this.collectionsSearchInput.value.trim().toLowerCase();
        await this.renderCollections(this.allCollections, true);
    }

    filterCollections(collections, query) {
        if (!query) {
            return collections;
        }

        return collections.reduce((filteredCollections, collection) => {
            const filteredCollection = { ...collection };
            const hasCollectionNameMatch = this.matchesSearchQuery(collection.name, query);
            let hasNestedRequestMatch = false;

            if (Array.isArray(collection.folders) && collection.folders.length > 0) {
                filteredCollection.folders = collection.folders.reduce((filteredFolders, folder) => {
                    const matchingEndpoints = (folder.endpoints || []).filter(endpoint => this.endpointMatchesQuery(endpoint, query));
                    const hasFolderNameMatch = this.matchesSearchQuery(folder.name, query);

                    if (hasFolderNameMatch) {
                        filteredFolders.push({
                            ...folder,
                            __searchExpand: matchingEndpoints.length > 0
                        });
                    } else if (matchingEndpoints.length > 0) {
                        filteredFolders.push({
                            ...folder,
                            endpoints: matchingEndpoints,
                            __searchExpand: true
                        });
                        hasNestedRequestMatch = true;
                    }

                    if (matchingEndpoints.length > 0) {
                        hasNestedRequestMatch = true;
                    }

                    return filteredFolders;
                }, []);
            } else {
                filteredCollection.endpoints = (collection.endpoints || []).filter(endpoint => this.endpointMatchesQuery(endpoint, query));
                hasNestedRequestMatch = filteredCollection.endpoints.length > 0;
            }

            const hasMatchingFolders = Array.isArray(filteredCollection.folders) && filteredCollection.folders.length > 0;
            const hasMatchingEndpoints = Array.isArray(filteredCollection.endpoints) && filteredCollection.endpoints.length > 0;

            if (hasCollectionNameMatch || hasMatchingFolders || hasMatchingEndpoints) {
                filteredCollection.__searchExpand = hasNestedRequestMatch;
                filteredCollections.push(filteredCollection);
            }

            return filteredCollections;
        }, []);
    }

    endpointMatchesQuery(endpoint, query) {
        return [
            endpoint.name,
            endpoint.path,
            endpoint.method,
            endpoint.summary,
            endpoint.description
        ].some(value => this.matchesSearchQuery(value, query));
    }

    matchesSearchQuery(value, query) {
        return typeof value === 'string' && value.toLowerCase().includes(query);
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

                // Load all persisted data in a single IPC call (instead of 7 separate calls)
                const isGrpc = endpoint.protocol === 'grpc';
                const isWebSocket = endpoint.protocol === 'websocket';

                const persistedData = await this.repository.getAllPersistedEndpointData(collection.id, endpoint.id);
                
                const persistedUrl = isGrpc ? null : persistedData.url;
                const persistedAuthConfig = (isGrpc || isWebSocket) ? null : persistedData.authConfig;
                const persistedPathParams = (isGrpc || isWebSocket) ? [] : persistedData.pathParams;
                const persistedQueryParams = isGrpc ? [] : persistedData.queryParams;
                const persistedHeaders = isGrpc ? [] : persistedData.headers;
                const persistedBody = isGrpc ? null : persistedData.modifiedBody;
                const grpcData = isGrpc ? persistedData.grpcData : null;

                const endpointData = {
                    ...endpoint,
                    collectionId: collection.id,
                    protocol: isGrpc ? 'grpc' : (isWebSocket ? 'websocket' : 'http'),
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
                label: 'Generate Documentation',
                translationKey: 'context_menu.generate_docs',
                iconClass: ContextMenu.createDocumentIcon(),
                onClick: () => this.handleGenerateDocumentation(collection)
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
    async handleEndpointContextMenu(event, collection, endpoint) {
        const pinned = await this.repository.getPinnedRequests();
        const isPinned = !!pinned[`${collection.id}_${endpoint.id}`];
        const menuItems = [
            {
                label: isPinned ? 'Unpin Request' : 'Pin Request',
                translationKey: isPinned ? 'context_menu.unpin_request' : 'context_menu.pin_request',
                iconClass: 'icon-star',
                onClick: () => this.handleTogglePinned(collection, endpoint)
            },
            {
                label: 'Rename Request',
                translationKey: 'context_menu.rename_request',
                iconClass: ContextMenu.createRenameIcon(),
                onClick: () => this.handleRenameRequest(collection, endpoint)
            },
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

    async handleTogglePinned(collection, endpoint) {
        await this.repository.togglePinnedRequest(collection.id, endpoint.id);
        await this.loadCollectionsWithExpansionState();
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
            const collectionOptions = await this.showNewCollectionDialog();
            if (collectionOptions) {
                await this.service.createCollection(collectionOptions);
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
                const collectionOptions = await this.showNewCollectionDialog();
                if (collectionOptions) {
                    const newCollection = await this.service.createCollection(collectionOptions);
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

            nameInput.value = initialName;
            locationInput.value = selectedStoragePath;

            nameInput.focus();

            const cleanup = () => {
                dialog.remove();
            };

            cancelBtn.addEventListener('click', () => {
                cleanup();
                resolve(null);
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
                    cleanup();
                    resolve({
                        name,
                        storageParentPath: selectedStoragePath || null
                    });
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
            const methodGroup = methodSelect.closest('.form-group');
            const pathInput = dialog.querySelector('#request-path');
            const grpcTargetGroup = dialog.querySelector('#grpc-target-group');
            const grpcTargetInput = dialog.querySelector('#grpc-target');
            const pathLabel = dialog.querySelector('label[for="request-path"]');
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
                        cleanup();
                        resolve({
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
                        cleanup();
                        resolve({
                            name,
                            protocol: 'websocket',
                            url
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
     * Shows dialog for saving current request to a collection
     *
     * Allows saving to an existing collection or creating a new one.
     *
     * @async
     * @param {Object} requestData - Current request data from the active tab
     * @returns {Promise<{collectionId: string, endpointId: string}|null>} Collection and endpoint IDs if saved, null if cancelled
     */
    async showSaveToCollectionDialog(requestData) {
        const collections = await this.repository.getAll();
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

            newCollectionLocationInput.value = newCollectionStoragePath;

            // Pre-fill request name from tab name or generate from URL
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
                    // URL parsing failed, leave empty for user to fill
                }
            }

            // Populate collection dropdown
            collections.forEach(collection => {
                const option = document.createElement('option');
                option.value = collection.id;
                option.textContent = collection.name;
                collectionSelect.appendChild(option);
            });

            // Add "Create new collection" option
            const newCollectionOption = document.createElement('option');
            newCollectionOption.value = '__new__';
            newCollectionOption.textContent = window.i18n?.t('save_to_collection.create_new') || '+ Create new collection';
            collectionSelect.appendChild(newCollectionOption);

            nameInput.focus();

            const cleanup = () => {
                dialog.remove();
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
                cleanup();
                resolve(null);
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

                    // Create new collection if selected
                    if (selectedCollectionId === '__new__') {
                        const newCollectionName = newCollectionInput.value.trim();
                        if (!newCollectionName) {
                            newCollectionInput.focus();
                            return;
                        }
                        const newCollection = await this.service.createCollection({
                            name: newCollectionName,
                            storageParentPath: newCollectionStoragePath || null
                        });
                        targetCollectionId = newCollection.id;
                    }

                    // Prepare request data for saving
                    const endpointData = {
                        name,
                        protocol: requestData.protocol || 'http',
                        method: requestData.method || 'GET',
                        path: requestData.url || '/'
                    };

                    // Handle gRPC
                    if (requestData.protocol === 'grpc' && requestData.grpc) {
                        endpointData.target = requestData.grpc.target;
                        endpointData.fullMethod = requestData.grpc.fullMethod;
                        endpointData.requestJson = requestData.grpc.requestJson;
                    }

                    // Handle WebSocket
                    if (requestData.protocol === 'websocket') {
                        endpointData.url = requestData.url;
                    }

                    // Add endpoint to collection
                    const newEndpoint = await this.service.addRequestToCollection(targetCollectionId, endpointData);

                    // Save additional request data (headers, body, params, auth)
                    if (requestData.pathParams && Object.keys(requestData.pathParams).length > 0) {
                        const pathParamsArray = Object.entries(requestData.pathParams).map(([key, value]) => ({ key, value }));
                        await this.repository.savePersistedPathParams(targetCollectionId, newEndpoint.id, pathParamsArray);
                    }

                    if (requestData.queryParams && Object.keys(requestData.queryParams).length > 0) {
                        const queryParamsArray = Object.entries(requestData.queryParams).map(([key, value]) => ({ key, value }));
                        await this.repository.savePersistedQueryParams(targetCollectionId, newEndpoint.id, queryParamsArray);
                    }

                    if (requestData.headers && Object.keys(requestData.headers).length > 0) {
                        const headersArray = Object.entries(requestData.headers).map(([key, value]) => ({ key, value }));
                        await this.repository.savePersistedHeaders(targetCollectionId, newEndpoint.id, headersArray);
                    }

                    if (requestData.body?.content) {
                        await this.repository.saveModifiedRequestBody(targetCollectionId, newEndpoint.id, requestData.body.content);
                    }

                    if (requestData.authType && requestData.authType !== 'none') {
                        await this.repository.savePersistedAuthConfig(targetCollectionId, newEndpoint.id, {
                            type: requestData.authType,
                            config: requestData.authConfig || {}
                        });
                    }

                    // Save URL
                    if (requestData.url) {
                        await this.repository.savePersistedUrl(targetCollectionId, newEndpoint.id, requestData.url);
                    }

                    // Refresh collections display
                    await this.loadCollectionsWithExpansionState();


                    cleanup();
                    resolve({
                        collectionId: targetCollectionId,
                        endpointId: newEndpoint.id,
                        name: name
                    });
                } catch (error) {
                    this.statusDisplay.update(`Error saving request: ${error.message}`, null);
                    cleanup();
                    resolve(null);
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
                toast.success(`Collection "${collection.name}" deleted`);
            } catch (error) {
                toast.error(`Failed to delete collection: ${error.message}`);
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
     * Handles documentation generation for a collection
     *
     * Shows options dialog and generates documentation in selected format.
     *
     * @async
     * @param {Object} collection - The collection to generate documentation for
     * @returns {Promise<void>}
     */
    async handleGenerateDocumentation(collection) {
        try {
            // Check if collection has any HTTP endpoints
            if (!this.docGeneratorService.hasHttpEndpoints(collection)) {
                toast.error(window.i18n?.t('docs.no_http_endpoints') || 'This collection has no HTTP requests to document');
                return;
            }

            const options = await this._showDocOptionsDialog();
            if (!options) {
                return;
            }

            this.statusDisplay.update('Generating documentation...', null);

            let content;
            let fileExtension;
            let mimeType;

            if (options.format === 'html') {
                content = await this.docGeneratorService.generateHtml(collection, {
                    includePersistedData: options.includeExamples,
                    languages: options.languages
                });
                fileExtension = 'html';
                mimeType = 'text/html';
            } else {
                content = await this.docGeneratorService.generateMarkdown(collection, {
                    includePersistedData: options.includeExamples,
                    languages: options.languages
                });
                fileExtension = 'md';
                mimeType = 'text/markdown';
            }

            const defaultFileName = `${collection.name.replace(/[^a-zA-Z0-9]/g, '_')}_docs.${fileExtension}`;

            const result = await this.backendAPI.docs.save(defaultFileName, content, mimeType);

            if (result && result.success) {
                toast.success(window.i18n?.t('docs.success') || 'Documentation generated successfully');
            } else if (result && !result.cancelled) {
                toast.error(window.i18n?.t('docs.error') || 'Failed to generate documentation');
            }

            this.statusDisplay.update('', null);
        } catch (error) {
            this.statusDisplay.update('', null);
            toast.error(`Documentation generation failed: ${error.message}`);
        }
    }

    /**
     * Shows the documentation options dialog
     *
     * @private
     * @async
     * @returns {Promise<Object|null>} Options object or null if cancelled
     */
    async _showDocOptionsDialog() {
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

            // Populate language checkboxes
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

            const cleanup = () => {
                dialog.remove();
            };

            cancelBtn.addEventListener('click', () => {
                cleanup();
                resolve(null);
            });

            form.addEventListener('submit', (e) => {
                e.preventDefault();

                const selectedLanguages = [];
                languageCheckboxesContainer.querySelectorAll('input[type="checkbox"]:checked').forEach(cb => {
                    selectedLanguages.push(cb.dataset.langId);
                });

                cleanup();
                resolve({
                    format: formatSelect.value,
                    includeExamples: includeExamplesCheckbox.checked,
                    languages: selectedLanguages
                });
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
     * Handles request rename operation
     *
     * Shows rename dialog and updates request name if confirmed.
     *
     * @async
     * @param {Object} collection - The parent collection
     * @param {Object} endpoint - The request/endpoint to rename
     * @returns {Promise<void>}
     */
    async handleRenameRequest(collection, endpoint) {
        try {
            const title = window.i18n ?
                window.i18n.t('endpoint.rename_title') || 'Rename Request' :
                'Rename Request';

            const label = window.i18n ?
                window.i18n.t('endpoint.rename_label') || 'Request Name:' :
                'Request Name:';

            const confirmText = window.i18n ?
                window.i18n.t('common.rename') || 'Rename' :
                'Rename';

            const currentName = endpoint.name || endpoint.path;
            const newName = await this.renameDialog.show(currentName, {
                title,
                label,
                confirmText
            });

            if (!newName || newName === currentName) {
                return;
            }
            await this.service.renameRequest(collection.id, endpoint.id, newName);
            await this.loadCollectionsWithExpansionState();

            // Update any open tabs that reference this endpoint
            if (!window.workspaceTabController) {
                return;
            }
            const tabs = await window.workspaceTabController.service.getAllTabs();
            const matchingTabs = tabs.filter(tab => 
                tab.endpoint && 
                tab.endpoint.collectionId === collection.id && 
                tab.endpoint.endpointId === endpoint.id
            );
            for (const tab of matchingTabs) {
                await window.workspaceTabController.service.updateTab(tab.id, { name: newName });
                window.workspaceTabController.tabBar.updateTab(tab.id, { name: newName });
            }
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
            const importOptions = await this.showCollectionImportDialog({
                importKind: 'openapi',
                title: 'Import OpenAPI Collection'
            });
            if (!importOptions) {
                this.statusDisplay.update('Import cancelled', null);
                return null;
            }

            const collection = await window.backendAPI.collections.importOpenApiFile(
                importOptions.filePath,
                importOptions.storageParentPath
            );

            if (collection) {
                await this.loadCollections();
                
                // Extract and save response schemas from OpenAPI endpoints
                await this._saveResponseSchemasFromImport(collection);
                
                toast.success(`Imported "${collection.name}"`);
                return collection;
            }
                this.statusDisplay.update('Import cancelled', null);
                return null;

        } catch (error) {
            const errorMessage = typeof error === 'string' ? error : (error.message || 'Unknown error');
            toast.error(`Import failed: ${errorMessage}`);
            throw error;
        }
    }

    /**
     * Extracts and saves response schemas from imported OpenAPI endpoints
     * @private
     * @param {Object} collection - The imported collection
     */
    async _saveResponseSchemasFromImport(collection) {
        if (!collection) {
            return;
        }

        // Collect all endpoints from root and folders
        const allEndpoints = [
            ...(collection.endpoints || []),
            ...(collection.folders || []).flatMap(folder => folder.endpoints || [])
        ];

        // Process each endpoint
        for (const endpoint of allEndpoints) {
            await this._saveEndpointResponseSchema(collection.id, endpoint);
        }
    }

    /**
     * Saves response schema for a single endpoint if available
     * @private
     * @param {string} collectionId - Collection ID
     * @param {Object} endpoint - Endpoint object
     */
    async _saveEndpointResponseSchema(collectionId, endpoint) {
        if (!endpoint.responses) {
            return;
        }

        const responseSchema = this._extractResponseSchema(endpoint.responses);
        if (!responseSchema) {
            return;
        }

        try {
            await this.repository.saveResponseSchema(collectionId, endpoint.id, responseSchema);
        } catch (error) {
            console.error(`Failed to save response schema for ${endpoint.name}:`, error);
        }
    }

    /**
     * Extracts JSON Schema from OpenAPI response object
     * @private
     * @param {Object} responses - OpenAPI responses object
     * @returns {Object|null} JSON Schema or null
     */
    _extractResponseSchema(responses) {
        // Priority: 200, 201, 202, default
        const statusCodes = ['200', '201', '202', 'default'];
        
        for (const code of statusCodes) {
            const response = responses[code];
            if (response) {
                // OpenAPI 3.x format: content -> application/json -> schema
                if (response.content && response.content['application/json'] && response.content['application/json'].schema) {
                    return response.content['application/json'].schema;
                }
                // OpenAPI 2.x format: schema directly on response
                if (response.schema) {
                    return response.schema;
                }
            }
        }
        
        return null;
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
            const importOptions = await this.showCollectionImportDialog({
                importKind: 'postman',
                title: 'Import Postman Collection'
            });
            if (!importOptions) {
                this.statusDisplay.update('Import cancelled', null);
                return null;
            }

            const collection = await window.backendAPI.collections.importPostmanCollection(
                importOptions.filePath,
                importOptions.storageParentPath
            );

            if (collection) {
                await this.loadCollections();
                toast.success(`Imported "${collection.name}"`);
                return collection;
            }
                this.statusDisplay.update('Import cancelled', null);
                return null;

        } catch (error) {
            const errorMessage = typeof error === 'string' ? error : (error.message || 'Unknown error');
            toast.error(`Import failed: ${errorMessage}`);
            throw error;
        }
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

            // Apply i18n translations to the dialog
            if (window.i18n && window.i18n.updateUI) {
                window.i18n.updateUI(dialog);
            }

            // Set dynamic title and subtitle based on import type
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
                destinationFolderMeta.textContent = path
                    ? t('import_dialog.destination_meta', 'Choose the parent folder for the imported collection.')
                    : t('import_dialog.destination_meta', 'Choose the parent folder for the imported collection.');
                destinationCard.classList.toggle('is-selected', Boolean(path));
            };

            setSourceFile('');
            setDestinationFolder(selectedStoragePath);

            const cleanup = async () => {
                if (dialogClosed) {
                    return;
                }
                dialogClosed = true;
                keydownController.abort();
                dialog.remove();
            };

            const closeDialog = async (result = null) => {
                await cleanup();
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
                targetCollection = await this.service.createCollection({
                    name: result.newCollectionName,
                    storageParentPath: result.newCollectionLocation
                });
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
            toast.success(`Imported cURL as "${result.endpoint.name}"`);

        } catch (error) {
            toast.error(`cURL import failed: ${error.message}`);
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
            const isWebSocket = endpoint && endpoint.protocol === 'websocket';

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

                return;
            }

            if (isWebSocket) {
                const urlInput = document.getElementById('url-input');
                const queryParamsList = document.getElementById('query-params-list');
                const headersList = document.getElementById('headers-list');
                const bodyInput = document.getElementById('body-input');

                if (urlInput && urlInput.value) {
                    await this.repository.savePersistedUrl(collectionId, endpointId, urlInput.value);
                }

                if (queryParamsList) {
                    const queryParams = parseKeyValuePairs(queryParamsList);
                    const queryParamsArray = Object.entries(queryParams).map(([key, value]) => ({ key, value }));
                    await this.repository.savePersistedQueryParams(collectionId, endpointId, queryParamsArray);
                }

                if (headersList) {
                    const headers = parseKeyValuePairs(headersList);
                    const headersArray = Object.entries(headers).map(([key, value]) => ({ key, value }));
                    await this.repository.savePersistedHeaders(collectionId, endpointId, headersArray);
                }

                if (bodyInput) {
                    await this.service.saveRequestBodyModification(collectionId, endpointId, bodyInput);
                }

                await this.loadCollectionsWithExpansionState();
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
