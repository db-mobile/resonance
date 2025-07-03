/**
 * Responsible for rendering collection UI elements
 * Follows Single Responsibility Principle - only handles UI rendering
 */
export class CollectionRenderer {
    constructor(containerId, repository = null) {
        this.container = document.getElementById(containerId);
        if (!this.container) {
            throw new Error(`Container with id '${containerId}' not found`);
        }
        this.repository = repository;
    }

    renderEmptyState() {
        this.container.innerHTML = `
            <div class="collections-empty">
                <svg class="collections-empty-icon" fill="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <path d="M12 2L13.09 7.26L18 6L16.74 11.09L22 12L16.74 12.91L18 18L13.09 16.74L12 22L10.91 16.74L6 18L7.26 12.91L2 12L7.26 11.09L6 6L10.91 7.26L12 2Z"/>
                </svg>
                <p class="collections-empty-text" data-i18n="sidebar.empty.title">No collections imported yet</p>
                <p class="collections-empty-subtext" data-i18n="sidebar.empty.subtitle">Import an OpenAPI collection to get started</p>
            </div>
        `;
    }

    async renderCollections(collections, eventHandlers = {}, preserveExpansionState = false) {
        if (collections.length === 0) {
            this.renderEmptyState();
            // Trigger translation for empty state
            if (window.i18n && window.i18n.updateUI) {
                window.i18n.updateUI();
            }
            return;
        }

        // Store current expansion state if needed
        let expansionState = {};
        if (preserveExpansionState) {
            expansionState = this.getExpansionState();
        }

        this.container.innerHTML = '';
        collections.forEach(collection => {
            const collectionElement = this.createCollectionElement(collection, eventHandlers);
            this.container.appendChild(collectionElement);
        });

        // Restore expansion state
        if (preserveExpansionState) {
            // Use in-memory state for re-renders
            this.restoreExpansionState(expansionState);
        } else {
            // Load from persistent storage for initial renders
            await this.loadAndRestoreExpansionState();
        }
        
        // Trigger translation for newly rendered collections
        if (window.i18n && window.i18n.updateUI) {
            window.i18n.updateUI();
        }
    }

    createCollectionElement(collection, eventHandlers) {
        const div = document.createElement('div');
        div.className = 'collection-item';
        div.dataset.collectionId = collection.id;

        const headerDiv = this.createCollectionHeader(collection);
        const endpointsDiv = this.createEndpointsContainer(collection, eventHandlers);

        div.appendChild(headerDiv);
        div.appendChild(endpointsDiv);

        this.attachCollectionEventListeners(div, headerDiv, collection, eventHandlers);

        return div;
    }

    createCollectionHeader(collection) {
        const headerDiv = document.createElement('div');
        headerDiv.className = 'collection-header';

        const nameDiv = document.createElement('div');
        nameDiv.className = 'collection-name';
        nameDiv.textContent = collection.name;

        const toggleDiv = document.createElement('div');
        toggleDiv.className = 'collection-toggle';
        toggleDiv.innerHTML = '▼';

        headerDiv.appendChild(nameDiv);
        headerDiv.appendChild(toggleDiv);

        return headerDiv;
    }

    createEndpointsContainer(collection, eventHandlers) {
        const endpointsDiv = document.createElement('div');
        endpointsDiv.className = 'collection-endpoints';

        // Check if collection has folder structure
        if (collection.folders && collection.folders.length > 0) {
            collection.folders.forEach(folder => {
                const folderDiv = this.createFolderElement(folder, collection, eventHandlers);
                endpointsDiv.appendChild(folderDiv);
            });
        } else {
            // Fallback to flat endpoint structure
            collection.endpoints.forEach(endpoint => {
                const endpointDiv = this.createEndpointElement(endpoint, collection, eventHandlers);
                endpointsDiv.appendChild(endpointDiv);
            });
        }

        return endpointsDiv;
    }

    createFolderElement(folder, collection, eventHandlers) {
        const folderDiv = document.createElement('div');
        folderDiv.className = 'folder-item';
        folderDiv.dataset.folderId = folder.id;

        const folderHeader = document.createElement('div');
        folderHeader.className = 'folder-header';

        const folderName = document.createElement('div');
        folderName.className = 'folder-name';
        folderName.textContent = folder.name;

        const folderToggle = document.createElement('div');
        folderToggle.className = 'folder-toggle';
        folderToggle.innerHTML = '▼';

        folderHeader.appendChild(folderName);
        folderHeader.appendChild(folderToggle);

        const folderEndpoints = document.createElement('div');
        folderEndpoints.className = 'folder-endpoints';

        folder.endpoints.forEach(endpoint => {
            const endpointDiv = this.createEndpointElement(endpoint, collection, eventHandlers);
            folderEndpoints.appendChild(endpointDiv);
        });

        folderDiv.appendChild(folderHeader);
        folderDiv.appendChild(folderEndpoints);

        // Add folder toggle functionality
        folderHeader.addEventListener('click', async (e) => {
            e.stopPropagation();
            folderDiv.classList.toggle('expanded');
            // Save expansion state to storage
            await this.saveExpansionState();
        });

        return folderDiv;
    }

    createEndpointElement(endpoint, collection, eventHandlers) {
        const endpointDiv = document.createElement('div');
        endpointDiv.className = 'endpoint-item';
        endpointDiv.dataset.endpointId = endpoint.id;
        endpointDiv.dataset.collectionId = collection.id;

        const methodSpan = document.createElement('span');
        methodSpan.className = `endpoint-method ${endpoint.method.toLowerCase()}`;
        methodSpan.textContent = endpoint.method;

        const pathSpan = document.createElement('span');
        pathSpan.className = 'endpoint-path';
        pathSpan.textContent = endpoint.path;

        endpointDiv.appendChild(methodSpan);
        endpointDiv.appendChild(pathSpan);

        if (eventHandlers.onEndpointClick) {
            endpointDiv.addEventListener('click', (e) => {
                e.stopPropagation();
                eventHandlers.onEndpointClick(collection, endpoint);
            });
        }

        return endpointDiv;
    }

    attachCollectionEventListeners(collectionDiv, headerDiv, collection, eventHandlers) {
        // Toggle expansion
        headerDiv.addEventListener('click', async (e) => {
            if (e.target.closest('.context-menu')) {
                return;
            }
            
            // Close all other expanded collections first
            const allCollections = document.querySelectorAll('.collection-item');
            allCollections.forEach(item => {
                if (item !== collectionDiv) {
                    item.classList.remove('expanded');
                }
            });
            
            // Toggle this collection
            collectionDiv.classList.toggle('expanded');
            
            // Save expansion state to storage
            await this.saveExpansionState();
        });

        // Context menu
        if (eventHandlers.onContextMenu) {
            collectionDiv.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                e.stopPropagation();
                eventHandlers.onContextMenu(e, collection);
            });
        }
    }

    getExpansionState() {
        const state = {};
        const collectionElements = this.container.querySelectorAll('.collection-item');
        collectionElements.forEach(element => {
            const collectionId = element.dataset.collectionId;
            if (collectionId) {
                state[collectionId] = {
                    expanded: element.classList.contains('expanded'),
                    folders: {}
                };
                
                // Also store folder expansion states
                const folderElements = element.querySelectorAll('.folder-item');
                folderElements.forEach(folderElement => {
                    const folderId = folderElement.dataset.folderId;
                    if (folderId) {
                        state[collectionId].folders[folderId] = folderElement.classList.contains('expanded');
                    }
                });
            }
        });
        return state;
    }

    restoreExpansionState(expansionState) {
        const collectionElements = this.container.querySelectorAll('.collection-item');
        collectionElements.forEach(element => {
            const collectionId = element.dataset.collectionId;
            const state = expansionState[collectionId];
            
            if (state && state.expanded) {
                element.classList.add('expanded');
                
                // Restore folder expansion states
                const folderElements = element.querySelectorAll('.folder-item');
                folderElements.forEach(folderElement => {
                    const folderId = folderElement.dataset.folderId;
                    if (folderId && state.folders[folderId]) {
                        folderElement.classList.add('expanded');
                    }
                });
            }
        });
    }

    async saveExpansionState() {
        if (!this.repository) {
            return;
        }
        
        try {
            const currentState = this.getExpansionState();
            await this.repository.saveCollectionExpansionStates(currentState);
        } catch (error) {
            console.error('Error saving expansion state:', error);
        }
    }

    async loadAndRestoreExpansionState() {
        if (!this.repository) {
            return;
        }
        
        try {
            const savedState = await this.repository.getCollectionExpansionStates();
            this.restoreExpansionState(savedState);
        } catch (error) {
            console.error('Error loading expansion state:', error);
        }
    }
}