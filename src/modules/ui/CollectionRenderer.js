export class CollectionRenderer {
    constructor(containerId, repository = null) {
        this.container = document.getElementById(containerId);
        if (!this.container) {
            throw new Error(`Container with id '${containerId}' not found`);
        }
        this.repository = repository;
        this.emptySpaceContextMenuHandler = null;
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
        if (this.emptySpaceContextMenuHandler) {
            this.container.removeEventListener('contextmenu', this.emptySpaceContextMenuHandler);
            this.emptySpaceContextMenuHandler = null;
        }

        if (collections.length === 0) {
            this.renderEmptyState();
            if (window.i18n && window.i18n.updateUI) {
                window.i18n.updateUI();
            }
            if (eventHandlers.onEmptySpaceContextMenu) {
                this.emptySpaceContextMenuHandler = (e) => {
                    e.preventDefault();
                    eventHandlers.onEmptySpaceContextMenu(e);
                };
                this.container.addEventListener('contextmenu', this.emptySpaceContextMenuHandler);
            }
            return;
        }

        let expansionState = {};
        if (preserveExpansionState) {
            expansionState = this.getExpansionState();
        }

        const activeEndpoint = this.container.querySelector('.endpoint-item.active');
        let activeCollectionId = null;
        let activeEndpointId = null;
        if (activeEndpoint) {
            activeCollectionId = activeEndpoint.dataset.collectionId;
            activeEndpointId = activeEndpoint.dataset.endpointId;
        }

        this.container.innerHTML = '';
        collections.forEach(collection => {
            const collectionElement = this.createCollectionElement(collection, eventHandlers);
            this.container.appendChild(collectionElement);
        });

        if (eventHandlers.onEmptySpaceContextMenu) {
            this.emptySpaceContextMenuHandler = (e) => {
                if (e.target === this.container) {
                    e.preventDefault();
                    eventHandlers.onEmptySpaceContextMenu(e);
                }
            };
            this.container.addEventListener('contextmenu', this.emptySpaceContextMenuHandler);
        }

        if (preserveExpansionState) {
            this.restoreExpansionState(expansionState);
        } else {
            await this.loadAndRestoreExpansionState();
        }

        if (activeCollectionId && activeEndpointId) {
            this.setActiveEndpoint(activeCollectionId, activeEndpointId);
        }

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

        if (collection.folders && collection.folders.length > 0) {
            collection.folders.forEach(folder => {
                const folderDiv = this.createFolderElement(folder, collection, eventHandlers);
                endpointsDiv.appendChild(folderDiv);
            });
        } else {
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

        folderHeader.addEventListener('click', async (e) => {
            e.stopPropagation();
            folderDiv.classList.toggle('expanded');
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

        if (eventHandlers.onEndpointContextMenu) {
            endpointDiv.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                e.stopPropagation();
                eventHandlers.onEndpointContextMenu(e, collection, endpoint);
            });
        }

        return endpointDiv;
    }

    attachCollectionEventListeners(collectionDiv, headerDiv, collection, eventHandlers) {
        headerDiv.addEventListener('click', async (e) => {
            if (e.target.closest('.context-menu')) {
                return;
            }
            
            const allCollections = document.querySelectorAll('.collection-item');
            allCollections.forEach(item => {
                if (item !== collectionDiv) {
                    item.classList.remove('expanded');
                }
            });
            
            collectionDiv.classList.toggle('expanded');
            
            await this.saveExpansionState();
        });

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

    setActiveEndpoint(collectionId, endpointId) {
        const allEndpoints = this.container.querySelectorAll('.endpoint-item');
        allEndpoints.forEach(endpoint => endpoint.classList.remove('active'));

        const activeEndpoint = this.container.querySelector(
            `.endpoint-item[data-endpoint-id="${endpointId}"][data-collection-id="${collectionId}"]`
        );

        if (activeEndpoint) {
            activeEndpoint.classList.add('active');
        }
    }

    clearActiveEndpoint() {
        const allEndpoints = this.container.querySelectorAll('.endpoint-item');
        allEndpoints.forEach(endpoint => endpoint.classList.remove('active'));
    }
}