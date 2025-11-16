/**
 * @fileoverview UI component for rendering OpenAPI collections in a hierarchical tree structure
 * @module ui/CollectionRenderer
 */

/**
 * UI component for rendering and managing collection tree display
 *
 * @class
 * @classdesc Renders OpenAPI collections in a hierarchical tree with folders, endpoints,
 * and manages expansion states, active selections, and user interactions. Supports
 * persistence of expansion state across sessions.
 */
export class CollectionRenderer {
    /**
     * Creates a CollectionRenderer instance
     *
     * @param {string} containerId - DOM element ID where collections will be rendered
     * @param {Object} [repository=null] - Repository for persisting expansion states
     * @throws {Error} If container element is not found
     */
    constructor(containerId, repository = null) {
        this.container = document.getElementById(containerId);
        if (!this.container) {
            throw new Error(`Container with id '${containerId}' not found`);
        }
        this.repository = repository;
        this.emptySpaceContextMenuHandler = null;
    }

    /**
     * Renders empty state when no collections are imported
     *
     * Displays a placeholder message with icon encouraging users to import
     * OpenAPI collections. Updates i18n translations if available.
     *
     * @returns {void}
     */
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

    /**
     * Renders collections list with folders and endpoints
     *
     * Creates DOM elements for each collection, attaches event handlers, and manages
     * expansion state. Can preserve current expansion state or load from storage.
     *
     * @async
     * @param {Array<Object>} collections - Array of collection objects to render
     * @param {Object} [eventHandlers={}] - Event handler callbacks
     * @param {Function} [eventHandlers.onEndpointClick] - Called when endpoint is clicked
     * @param {Function} [eventHandlers.onEndpointContextMenu] - Called on endpoint right-click
     * @param {Function} [eventHandlers.onContextMenu] - Called on collection right-click
     * @param {Function} [eventHandlers.onEmptySpaceContextMenu] - Called on empty area right-click
     * @param {boolean} [preserveExpansionState=false] - Whether to preserve current expansion state
     * @returns {Promise<void>}
     */
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

    /**
     * Creates DOM element for a collection
     *
     * Builds the complete collection element including header and endpoints container.
     * Attaches click and context menu event listeners.
     *
     * @param {Object} collection - Collection object to render
     * @param {string} collection.id - Unique collection identifier
     * @param {string} collection.name - Collection display name
     * @param {Array} collection.endpoints - Array of endpoint objects
     * @param {Array} [collection.folders] - Optional array of folder objects
     * @param {Object} eventHandlers - Event handler callbacks
     * @returns {HTMLDivElement} The created collection element
     */
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

    /**
     * Creates header element for a collection
     *
     * @param {Object} collection - Collection object
     * @param {string} collection.name - Collection name to display
     * @returns {HTMLDivElement} Collection header element
     */
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

    /**
     * Creates container element for endpoints or folders
     *
     * Renders either folders (if present) or endpoints directly. Supports
     * nested folder structure for organizing endpoints.
     *
     * @param {Object} collection - Collection object
     * @param {Array} [collection.folders] - Optional array of folder objects
     * @param {Array} collection.endpoints - Array of endpoint objects
     * @param {Object} eventHandlers - Event handler callbacks
     * @returns {HTMLDivElement} Container element with endpoints or folders
     */
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

    /**
     * Creates DOM element for a folder
     *
     * Builds folder element with header, toggle, and nested endpoints. Supports
     * expansion/collapse with state persistence.
     *
     * @param {Object} folder - Folder object to render
     * @param {string} folder.id - Unique folder identifier
     * @param {string} folder.name - Folder display name
     * @param {Array} folder.endpoints - Array of endpoint objects in this folder
     * @param {Object} collection - Parent collection object
     * @param {Object} eventHandlers - Event handler callbacks
     * @returns {HTMLDivElement} The created folder element
     */
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

    /**
     * Creates DOM element for an endpoint
     *
     * Builds endpoint element with HTTP method badge and path. Attaches click
     * and context menu event handlers.
     *
     * @param {Object} endpoint - Endpoint object to render
     * @param {string} endpoint.id - Unique endpoint identifier
     * @param {string} endpoint.method - HTTP method (GET, POST, etc.)
     * @param {string} endpoint.path - Endpoint URL path
     * @param {Object} collection - Parent collection object
     * @param {Object} eventHandlers - Event handler callbacks
     * @returns {HTMLDivElement} The created endpoint element
     */
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

    /**
     * Attaches event listeners to collection element
     *
     * Handles collection expansion/collapse and context menu. Ensures only one
     * collection is expanded at a time (accordion behavior).
     *
     * @param {HTMLDivElement} collectionDiv - Collection container element
     * @param {HTMLDivElement} headerDiv - Collection header element
     * @param {Object} collection - Collection object
     * @param {Object} eventHandlers - Event handler callbacks
     * @returns {void}
     */
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

    /**
     * Gets current expansion state of all collections and folders
     *
     * Captures which collections and folders are currently expanded for persistence.
     *
     * @returns {Object} State object mapping collection IDs to expansion states
     * @returns {Object.expanded} boolean - Whether collection is expanded
     * @returns {Object.folders} Object - Map of folder IDs to expansion states
     */
    getExpansionState() {
        const state = {};
        const collectionElements = this.container.querySelectorAll('.collection-item');
        collectionElements.forEach(element => {
            const {collectionId} = element.dataset;
            if (collectionId) {
                state[collectionId] = {
                    expanded: element.classList.contains('expanded'),
                    folders: {}
                };
                
                const folderElements = element.querySelectorAll('.folder-item');
                folderElements.forEach(folderElement => {
                    const {folderId} = folderElement.dataset;
                    if (folderId) {
                        state[collectionId].folders[folderId] = folderElement.classList.contains('expanded');
                    }
                });
            }
        });
        return state;
    }

    /**
     * Restores expansion state from saved state object
     *
     * Applies expansion state to collections and folders based on saved preferences.
     *
     * @param {Object} expansionState - State object from getExpansionState()
     * @returns {void}
     */
    restoreExpansionState(expansionState) {
        const collectionElements = this.container.querySelectorAll('.collection-item');
        collectionElements.forEach(element => {
            const {collectionId} = element.dataset;
            const state = expansionState[collectionId];
            
            if (state && state.expanded) {
                element.classList.add('expanded');
                
                const folderElements = element.querySelectorAll('.folder-item');
                folderElements.forEach(folderElement => {
                    const {folderId} = folderElement.dataset;
                    if (folderId && state.folders[folderId]) {
                        folderElement.classList.add('expanded');
                    }
                });
            }
        });
    }

    /**
     * Saves current expansion state to repository
     *
     * Persists expansion state for restoration on next render. Silently fails
     * if repository is not available.
     *
     * @async
     * @returns {Promise<void>}
     */
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

    /**
     * Loads expansion state from repository and applies it
     *
     * Retrieves saved expansion state and restores it to the UI. Silently fails
     * if repository is not available.
     *
     * @async
     * @returns {Promise<void>}
     */
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

    /**
     * Sets an endpoint as active (highlighted)
     *
     * Removes active state from all endpoints and applies it to the specified one.
     *
     * @param {string} collectionId - Collection ID containing the endpoint
     * @param {string} endpointId - Endpoint ID to mark as active
     * @returns {void}
     */
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

    /**
     * Clears active state from all endpoints
     *
     * Removes highlighting from any currently active endpoint.
     *
     * @returns {void}
     */
    clearActiveEndpoint() {
        const allEndpoints = this.container.querySelectorAll('.endpoint-item');
        allEndpoints.forEach(endpoint => endpoint.classList.remove('active'));
    }
}