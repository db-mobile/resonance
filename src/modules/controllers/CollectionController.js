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
import { StatusDisplayAdapter } from '../interfaces/IStatusDisplay.js';

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
     * @param {Object} electronAPI - The Electron IPC API bridge for storage operations
     * @param {Function} updateStatusDisplay - Callback function to update status display UI
     */
    constructor(electronAPI, updateStatusDisplay) {
        this.repository = new CollectionRepository(electronAPI);
        this.variableRepository = new VariableRepository(electronAPI);
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
            console.error('Error in loadCollections:', error);
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
            console.error('Error in loadCollectionsWithExpansionState:', error);
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
                const persistedAuthConfig = await this.repository.getPersistedAuthConfig(collection.id, endpoint.id);
                const persistedPathParams = await this.repository.getPersistedPathParams(collection.id, endpoint.id);
                const persistedQueryParams = await this.repository.getPersistedQueryParams(collection.id, endpoint.id);
                const persistedHeaders = await this.repository.getPersistedHeaders(collection.id, endpoint.id);
                const persistedBody = await this.repository.getModifiedRequestBody(collection.id, endpoint.id);

                const endpointData = {
                    ...endpoint,
                    collectionId: collection.id,
                    collectionBaseUrl: collection.baseUrl,
                    collectionDefaultHeaders: collection.defaultHeaders,
                    path: endpoint.path,
                    method: endpoint.method,
                    requestBodyString: requestBodyString,  // Pass the generated string
                    persistedAuthConfig: persistedAuthConfig,  // Pass persisted data if available
                    persistedPathParams: persistedPathParams,
                    persistedQueryParams: persistedQueryParams,
                    persistedHeaders: persistedHeaders,
                    persistedBody: persistedBody
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
            console.error('Error loading endpoint:', error);
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
                icon: ContextMenu.createNewRequestIcon(),
                onClick: () => this.handleNewRequest(collection)
            },
            {
                label: 'Manage Variables',
                translationKey: 'context_menu.manage_variables',
                icon: ContextMenu.createVariableIcon(),
                onClick: () => this.handleVariables(collection)
            },
            {
                label: 'Export as OpenAPI (JSON)',
                translationKey: 'context_menu.export_openapi_json',
                icon: ContextMenu.createExportIcon(),
                onClick: () => this.handleExportOpenApiJson(collection)
            },
            {
                label: 'Export as OpenAPI (YAML)',
                translationKey: 'context_menu.export_openapi_yaml',
                icon: ContextMenu.createExportIcon(),
                onClick: () => this.handleExportOpenApiYaml(collection)
            },
            {
                label: 'Rename Collection',
                translationKey: 'context_menu.rename_collection',
                icon: ContextMenu.createRenameIcon(),
                onClick: () => this.handleRename(collection)
            },
            {
                label: 'Delete Collection',
                translationKey: 'context_menu.delete_collection',
                icon: ContextMenu.createDeleteIcon(),
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
                icon: ContextMenu.createDeleteIcon(),
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
                icon: ContextMenu.createNewRequestIcon(),
                onClick: () => this.handleNewCollection()
            },
            {
                label: 'New Request',
                translationKey: 'context_menu.new_request',
                icon: ContextMenu.createNewRequestIcon(),
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
            console.error('Error renaming collection:', error);
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
            console.error('Error managing variables:', error);
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
            console.error('Error creating new request:', error);
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
            console.error('Error creating new collection:', error);
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
            console.error('Error creating new request and collection:', error);
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
            const dialog = document.createElement('div');
            dialog.className = 'new-request-dialog-overlay';
            dialog.innerHTML = `
                <div class="new-request-dialog">
                    <h3 data-i18n="new_collection.title">Create New Collection</h3>
                    <form id="new-collection-form">
                        <div class="form-group">
                            <label for="collection-name" data-i18n="new_collection.name_label">Collection Name:</label>
                            <input type="text" id="collection-name" data-i18n-placeholder="new_collection.name_placeholder" placeholder="My Collection" required>
                        </div>
                        <div class="form-buttons">
                            <button type="button" id="cancel-btn" data-i18n="new_collection.cancel">Cancel</button>
                            <button type="submit" id="create-btn" data-i18n="new_collection.create">Create</button>
                        </div>
                    </form>
                </div>
            `;

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
            const dialog = document.createElement('div');
            dialog.className = 'new-request-dialog-overlay';
            dialog.innerHTML = `
                <div class="new-request-dialog">
                    <h3 data-i18n="new_request.title">Create New Request</h3>
                    <form id="new-request-form">
                        <div class="form-group">
                            <label for="request-name" data-i18n="new_request.name_label">Request Name:</label>
                            <input type="text" id="request-name" data-i18n-placeholder="new_request.name_placeholder" placeholder="My Request" required>
                        </div>
                        <div class="form-group">
                            <label for="request-method" data-i18n="new_request.method_label">Method:</label>
                            <select id="request-method" required>
                                <option value="GET">GET</option>
                                <option value="POST">POST</option>
                                <option value="PUT">PUT</option>
                                <option value="DELETE">DELETE</option>
                                <option value="PATCH">PATCH</option>
                            </select>
                        </div>
                        <div class="form-group">
                            <label for="request-path" data-i18n="new_request.path_label">Path:</label>
                            <input type="text" id="request-path" data-i18n-placeholder="new_request.path_placeholder" placeholder="/api/endpoint" required>
                        </div>
                        <div class="form-buttons">
                            <button type="button" id="cancel-btn" data-i18n="new_request.cancel">Cancel</button>
                            <button type="submit" id="create-btn" data-i18n="new_request.create">Create</button>
                        </div>
                    </form>
                </div>
            `;

            document.body.appendChild(dialog);

            if (window.i18n && window.i18n.updateUI) {
                window.i18n.updateUI();
            }

            const form = dialog.querySelector('#new-request-form');
            const nameInput = dialog.querySelector('#request-name');
            const methodSelect = dialog.querySelector('#request-method');
            const pathInput = dialog.querySelector('#request-path');
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
                const method = methodSelect.value;
                const path = pathInput.value.trim();

                if (name && method && path) {
                    cleanup();
                    resolve({
                        name,
                        method,
                        path: path.startsWith('/') ? path : `/${  path}`
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
                console.error('Error deleting collection:', error);
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
            console.error('Error exporting collection as OpenAPI JSON:', error);
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
            console.error('Error exporting collection as OpenAPI YAML:', error);
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
                    formElements.bodyInput.value = '';
                    this.service.clearKeyValueList(formElements.pathParamsList);
                    this.service.clearKeyValueList(formElements.headersList);
                    this.service.clearKeyValueList(formElements.queryParamsList);
                    window.currentEndpoint = null;

                    await this.repository.clearLastSelectedRequest();

                    this.renderer.clearActiveEndpoint();
                }

                await this.loadCollectionsWithExpansionState();
            } catch (error) {
                console.error('Error deleting request:', error);
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
            const collection = await window.electronAPI.collections.importOpenApiFile();

            if (collection) {
                await this.loadCollections();
                return collection;
            }
                this.statusDisplay.update('Import cancelled', null);
                return null;

        } catch (error) {
            console.error('Error importing collection:', error);
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
            const result = await window.electronAPI.collections.importPostmanCollection();

            if (result) {
                await this.loadCollections();
                this.statusDisplay.update('Postman collection imported successfully', null);
                return result.collection;
            }
                this.statusDisplay.update('Import cancelled', null);
                return null;

        } catch (error) {
            console.error('Error importing Postman collection:', error);
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
            const environment = await window.electronAPI.collections.importPostmanEnvironment();

            if (environment) {
                if (window.environmentController) {
                    await window.environmentController.createEnvironment(
                        environment.name,
                        environment.variables
                    );
                    this.statusDisplay.update('Postman environment imported successfully', null);
                } else {
                    console.warn('Environment controller not available, environment data returned without creating');
                }
                return environment;
            }
                this.statusDisplay.update('Import cancelled', null);
                return null;

        } catch (error) {
            console.error('Error importing Postman environment:', error);
            this.statusDisplay.update(`Import error: ${error.message}`, null);
            throw error;
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

            if (formElements.bodyInput && formElements.bodyInput.value) {
                formElements.bodyInput.value = await this.variableService.processTemplate(
                    formElements.bodyInput.value, 
                    collectionId
                );
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
            console.error('Error processing form variables:', error);
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
            if (formElements.bodyInput && formElements.bodyInput.value) {
                formElements.bodyInput.value = await this.variableService.processTemplate(
                    formElements.bodyInput.value, 
                    collectionId
                );
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
            console.error('Error processing form variables (except URL):', error);
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
                console.warn('Last selected collection not found, clearing saved selection');
                await this.repository.clearLastSelectedRequest();
                return;
            }

            let endpoint = null;
            if (collection.endpoints) {
                endpoint = collection.endpoints.find(ep => ep.id === lastSelected.endpointId);
            }

            if (!endpoint && collection.folders) {
                for (const folder of collection.folders) {
                    if (folder.endpoints) {
                        endpoint = folder.endpoints.find(ep => ep.id === lastSelected.endpointId);
                        if (endpoint) {break;}
                    }
                }
            }

            if (!endpoint) {
                console.warn('Last selected endpoint not found, clearing saved selection');
                await this.repository.clearLastSelectedRequest();
                return;
            }

            const formElements = this.getFormElements();
            await this.service.loadEndpointIntoForm(collection, endpoint, formElements);

            this.renderer.setActiveEndpoint(collection.id, endpoint.id);
        } catch (error) {
            console.error('Error restoring last selected request:', error);
        }
    }
}