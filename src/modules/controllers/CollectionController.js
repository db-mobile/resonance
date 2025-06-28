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
        this.renderer = new CollectionRenderer('collections-list');
        this.contextMenu = new ContextMenu();
        this.renameDialog = new RenameDialog();
        this.variableManager = new VariableManager();
        
        // Bind methods to preserve context
        this.handleEndpointClick = this.handleEndpointClick.bind(this);
        this.handleContextMenu = this.handleContextMenu.bind(this);
        this.handleRename = this.handleRename.bind(this);
        this.handleDelete = this.handleDelete.bind(this);
        this.handleVariables = this.handleVariables.bind(this);
    }

    async loadCollections() {
        try {
            const collections = await this.service.loadCollections();
            this.renderCollections(collections);
            return collections;
        } catch (error) {
            console.error('Error in loadCollections:', error);
            return [];
        }
    }

    renderCollections(collections) {
        const eventHandlers = {
            onEndpointClick: this.handleEndpointClick,
            onContextMenu: this.handleContextMenu
        };
        
        this.renderer.renderCollections(collections, eventHandlers);
    }

    async handleEndpointClick(collection, endpoint) {
        try {
            const formElements = this.getFormElements();
            await this.service.loadEndpointIntoForm(collection, endpoint, formElements);
            
            // Process variables in form elements after loading
            await this.processFormVariables(collection.id, formElements);
        } catch (error) {
            console.error('Error loading endpoint:', error);
        }
    }

    handleContextMenu(event, collection) {
        const menuItems = [
            {
                label: 'Manage Variables',
                icon: ContextMenu.createVariableIcon(),
                onClick: () => this.handleVariables(collection)
            },
            {
                label: 'Rename Collection',
                icon: ContextMenu.createRenameIcon(),
                onClick: () => this.handleRename(collection)
            },
            {
                label: 'Delete Collection',
                icon: ContextMenu.createDeleteIcon(),
                className: 'context-menu-delete',
                onClick: () => this.handleDelete(collection)
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
                    await this.processFormVariables(collection.id, formElements);
                }
            }
        } catch (error) {
            console.error('Error managing variables:', error);
        }
    }

    async handleDelete(collection) {
        const confirmed = confirm(`Are you sure you want to delete the collection "${collection.name}"?\n\nThis action cannot be undone.`);
        
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