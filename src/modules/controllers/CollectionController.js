/**
 * Main controller for collection management
 * Follows Facade pattern - provides simple interface to complex subsystem
 * Follows Single Responsibility Principle - only coordinates between components
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
import { VariableManager } from '../ui/VariableManager.js';
import { StatusDisplayAdapter } from '../interfaces/IStatusDisplay.js';

export class CollectionController {
    constructor(electronAPI, updateStatusDisplay) {
        // Initialize dependencies following Dependency Injection pattern
        this.repository = new CollectionRepository(electronAPI);
        this.variableRepository = new VariableRepository(electronAPI);
        this.schemaProcessor = new SchemaProcessor();
        this.variableProcessor = new VariableProcessor();
        this.statusDisplay = new StatusDisplayAdapter(updateStatusDisplay);
        
        // Services
        this.service = new CollectionService(this.repository, this.schemaProcessor, this.statusDisplay);
        this.variableService = new VariableService(this.variableRepository, this.variableProcessor, this.statusDisplay);
        
        // UI components
        this.renderer = new CollectionRenderer('collections-list', this.repository);
        this.contextMenu = new ContextMenu();
        this.renameDialog = new RenameDialog();
        this.variableManager = new VariableManager();
        
        // Bind methods to preserve context
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
    }

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

    async renderCollections(collections, preserveExpansionState = false) {
        const eventHandlers = {
            onEndpointClick: this.handleEndpointClick,
            onContextMenu: this.handleContextMenu,
            onEndpointContextMenu: this.handleEndpointContextMenu,
            onEmptySpaceContextMenu: this.handleEmptySpaceContextMenu
        };

        await this.renderer.renderCollections(collections, eventHandlers, preserveExpansionState);
    }

    async handleEndpointClick(collection, endpoint) {
        try {
            const formElements = this.getFormElements();
            await this.service.loadEndpointIntoForm(collection, endpoint, formElements);
            
            // Process variables in form elements after loading, but skip URL to show template
            await this.processFormVariablesExceptUrl(collection.id, formElements);
        } catch (error) {
            console.error('Error loading endpoint:', error);
        }
    }

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

    async handleVariables(collection) {
        try {
            const currentVariables = await this.variableService.getVariablesForCollection(collection.id);
            const newVariables = await this.variableManager.show(collection.name, currentVariables);
            
            if (newVariables !== null) {
                await this.variableService.setMultipleVariables(collection.id, newVariables);
                
                // Refresh form if we have an active endpoint to show updated variables
                if (window.currentEndpoint && window.currentEndpoint.collectionId === collection.id) {
                    const formElements = this.getFormElements();
                    await this.processFormVariablesExceptUrl(collection.id, formElements);
                }
            }
        } catch (error) {
            console.error('Error managing variables:', error);
        }
    }

    async handleNewRequest(collection) {
        try {
            const requestData = await this.showNewRequestDialog();
            if (requestData) {
                await this.service.addRequestToCollection(collection.id, requestData);
                await this.loadCollectionsWithExpansionState(); // Refresh display preserving state
            }
        } catch (error) {
            console.error('Error creating new request:', error);
        }
    }

    async handleNewCollection() {
        try {
            const collectionName = await this.showNewCollectionDialog();
            if (collectionName) {
                await this.service.createCollection(collectionName);
                await this.loadCollections(); // Refresh display
            }
        } catch (error) {
            console.error('Error creating new collection:', error);
        }
    }

    async handleNewRequestInEmptySpace() {
        try {
            const requestData = await this.showNewRequestDialog();
            if (requestData) {
                // First, ask for collection name
                const collectionName = await this.showNewCollectionDialog();
                if (collectionName) {
                    // Create the collection
                    const newCollection = await this.service.createCollection(collectionName);
                    // Add the request to the new collection
                    await this.service.addRequestToCollection(newCollection.id, requestData);
                    await this.loadCollections(); // Refresh display
                }
            }
        } catch (error) {
            console.error('Error creating new request and collection:', error);
        }
    }

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

            // Trigger translation for the dialog
            if (window.i18n && window.i18n.updateUI) {
                window.i18n.updateUI();
            }

            const form = dialog.querySelector('#new-collection-form');
            const nameInput = dialog.querySelector('#collection-name');
            const cancelBtn = dialog.querySelector('#cancel-btn');

            // Focus on name input
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

            // Close on overlay click
            dialog.addEventListener('click', (e) => {
                if (e.target === dialog) {
                    cleanup();
                    resolve(null);
                }
            });

            // Close on escape key
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

            // Trigger translation for the dialog
            if (window.i18n && window.i18n.updateUI) {
                window.i18n.updateUI();
            }

            const form = dialog.querySelector('#new-request-form');
            const nameInput = dialog.querySelector('#request-name');
            const methodSelect = dialog.querySelector('#request-method');
            const pathInput = dialog.querySelector('#request-path');
            const cancelBtn = dialog.querySelector('#cancel-btn');

            // Focus on name input
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
                        path: path.startsWith('/') ? path : '/' + path
                    });
                }
            });

            // Close on overlay click
            dialog.addEventListener('click', (e) => {
                if (e.target === dialog) {
                    cleanup();
                    resolve(null);
                }
            });

            // Close on escape key
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

    async handleDelete(collection) {
        // Get translated confirmation message
        const confirmMessage = window.i18n ?
            window.i18n.t('collection.confirm_delete', { name: collection.name }) :
            `Are you sure you want to delete the collection "${collection.name}"?\n\nThis action cannot be undone.`;

        const confirmed = confirm(confirmMessage);

        if (confirmed) {
            try {
                await this.service.deleteCollection(collection.id);
                await this.variableService.cleanupCollectionVariables(collection.id);
                await this.loadCollections(); // Refresh display
            } catch (error) {
                console.error('Error deleting collection:', error);
            }
        }
    }

    async handleDeleteRequest(collection, endpoint) {
        // Get translated confirmation message
        const confirmMessage = window.i18n ?
            window.i18n.t('endpoint.confirm_delete', { name: endpoint.name || endpoint.path }) :
            `Are you sure you want to delete the request "${endpoint.name || endpoint.path}"?\n\nThis action cannot be undone.`;

        const confirmed = confirm(confirmMessage);

        if (confirmed) {
            try {
                await this.service.deleteRequestFromCollection(collection.id, endpoint.id);

                // Clear the form if the deleted endpoint was currently loaded
                if (window.currentEndpoint &&
                    window.currentEndpoint.collectionId === collection.id &&
                    window.currentEndpoint.endpointId === endpoint.id) {
                    const formElements = this.getFormElements();
                    formElements.urlInput.value = '';
                    formElements.methodSelect.value = 'GET';
                    formElements.bodyInput.value = '';
                    this.service.clearKeyValueList(formElements.headersList);
                    this.service.clearKeyValueList(formElements.queryParamsList);
                    window.currentEndpoint = null;
                }

                await this.loadCollectionsWithExpansionState(); // Refresh display preserving state
            } catch (error) {
                console.error('Error deleting request:', error);
            }
        }
    }

    async importOpenApiFile() {
        try {
            const collection = await window.electronAPI.collections.importOpenApiFile();
            
            if (collection) {
                await this.loadCollections(); // Refresh the collections display
                return collection;
            } else {
                this.statusDisplay.update('Import cancelled', null);
                return null;
            }
        } catch (error) {
            console.error('Error importing collection:', error);
            this.statusDisplay.update(`Import error: ${error.message}`, null);
            throw error;
        }
    }

    async saveRequestBodyModification(collectionId, endpointId) {
        const bodyInput = document.getElementById('body-input');
        if (bodyInput) {
            await this.service.saveRequestBodyModification(collectionId, endpointId, bodyInput);
        }
    }

    initializeBodyTracking() {
        const bodyInput = document.getElementById('body-input');
        if (bodyInput) {
            // Save body modifications when user navigates away or sends request
            bodyInput.addEventListener('blur', async () => {
                if (window.currentEndpoint) {
                    await this.saveRequestBodyModification(
                        window.currentEndpoint.collectionId, 
                        window.currentEndpoint.endpointId
                    );
                }
            });

            // Auto-save periodically during typing (debounced)
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
                }, 2000); // Save 2 seconds after user stops typing
            });
        }
    }

    async processFormVariables(collectionId, formElements) {
        try {
            // Process URL
            if (formElements.urlInput && formElements.urlInput.value) {
                formElements.urlInput.value = await this.variableService.processTemplate(
                    formElements.urlInput.value, 
                    collectionId
                );
            }

            // Process body
            if (formElements.bodyInput && formElements.bodyInput.value) {
                formElements.bodyInput.value = await this.variableService.processTemplate(
                    formElements.bodyInput.value, 
                    collectionId
                );
            }

            // Process headers
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

            // Process query params
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

    async processFormVariablesExceptUrl(collectionId, formElements) {
        try {
            // Process body
            if (formElements.bodyInput && formElements.bodyInput.value) {
                formElements.bodyInput.value = await this.variableService.processTemplate(
                    formElements.bodyInput.value, 
                    collectionId
                );
            }

            // Process headers
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

            // Process query params
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

    getFormElements() {
        return {
            urlInput: document.getElementById('url-input'),
            methodSelect: document.getElementById('method-select'),
            bodyInput: document.getElementById('body-input'),
            headersList: document.getElementById('headers-list'),
            queryParamsList: document.getElementById('query-params-list')
        };
    }

    // Get variables for current collection (useful for API requests)
    async getCurrentCollectionVariables() {
        if (window.currentEndpoint) {
            return await this.variableService.getVariablesForCollection(window.currentEndpoint.collectionId);
        }
        return {};
    }

    // Process request object before sending API request
    async processRequestForVariables(request) {
        if (window.currentEndpoint) {
            return await this.variableService.processRequest(request, window.currentEndpoint.collectionId);
        }
        return request;
    }
}