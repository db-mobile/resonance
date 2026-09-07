/**
 * @fileoverview UI component for rendering OpenAPI collections in a hierarchical tree structure
 * @module ui/CollectionRenderer
 */

import { app } from '../appContext.js';
import { templateLoader } from '../templateLoader.js';
import { flattenRequests, rootRequests, topLevelFolders } from '../collections/collectionTree.js';

export class CollectionRenderer {
    /**
     * @param {string} containerId
     * @param {Object} [repository=null]
     */
    constructor(containerId, repository = null) {
        this.container = document.getElementById(containerId);
        if (!this.container) {
            throw new Error(`Container with id '${containerId}' not found`);
        }
        this.repository = repository;
        this.emptySpaceContextMenuHandler = null;
        this._lastRenderArgs = null;
    }

    /** @returns {void} */
    renderEmptyState(actions = {}) {
        const fragment = templateLoader.cloneSync(
            './src/templates/collections/collectionRenderer.html',
            'tpl-collections-empty'
        );
        this.container.innerHTML = '';
        this.container.appendChild(fragment);
        this.container.querySelectorAll('[data-action]').forEach((btn) => {
            const handler = actions[btn.dataset.action];
            if (handler) {
                btn.addEventListener('click', handler);
            }
        });
    }

    renderSearchEmptyState() {
        const fragment = templateLoader.cloneSync(
            './src/templates/collections/collectionRenderer.html',
            'tpl-collections-search-empty'
        );
        this.container.innerHTML = '';
        this.container.appendChild(fragment);
    }

    /**
     * @param {Array<Object>} collections
     * @param {Object} [eventHandlers={}]
     * @param {Function} [eventHandlers.onEndpointClick]
     * @param {Function} [eventHandlers.onEndpointContextMenu]
     * @param {Function} [eventHandlers.onContextMenu]
     * @param {Function} [eventHandlers.onEmptySpaceContextMenu]
     * @param {boolean} [preserveExpansionState=false]
     * @param {Object} [options={}]
     * @param {boolean} [options.showSearchEmptyState=false]
     * @param {boolean} [options.forceExpandAll=false]
     * @returns {Promise<void>}
     */
    async renderCollections(collections, eventHandlers = {}, preserveExpansionState = false, options = {}, pinnedRequests = {}) {
        if (this.emptySpaceContextMenuHandler) {
            this.container.removeEventListener('contextmenu', this.emptySpaceContextMenuHandler);
            this.emptySpaceContextMenuHandler = null;
        }

        if (collections.length === 0) {
            if (options.showSearchEmptyState) {
                this.renderSearchEmptyState();
            } else {
                this.renderEmptyState(eventHandlers.onEmptyStateActions ?? {});
            }
            if (app.i18n && app.i18n.updateUI) {
                app.i18n.updateUI();
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
        this._lastRenderArgs = { collections, eventHandlers, pinnedRequests };

        const pinnedSection = this.createPinnedSection(collections, pinnedRequests, eventHandlers);
        if (pinnedSection) {
            this.container.appendChild(pinnedSection);
        }

        collections.forEach(collection => {
            const collectionElement = this.createCollectionElement(collection, eventHandlers, pinnedRequests);
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

        if (options.expandSearchResults) {
            this.expandSearchResults(collections);
        } else if (preserveExpansionState) {
            this.restoreExpansionState(expansionState);
        } else {
            await this.loadAndRestoreExpansionState();
        }

        if (activeCollectionId && activeEndpointId) {
            this.setActiveEndpoint(activeCollectionId, activeEndpointId);
        }

        if (app.i18n && app.i18n.updateUI) {
            app.i18n.updateUI();
        }
    }

    expandSearchResults(collections) {
        collections.forEach(collection => {
            if (collection.__searchExpand) {
                const collectionElement = this.container.querySelector(`.collection-item[data-collection-id="${collection.id}"]`);
                collectionElement?.classList.add('expanded');
            }

            this.expandMatchingFolders(collection, collection.folders);
        });
    }

    /**
     * @param {Object} collection
     * @param {Array} folders
     */
    expandMatchingFolders(collection, folders) {
        (folders || []).forEach(folder => {
            if (folder.__searchExpand) {
                const folderElement = this.container.querySelector(
                    `.collection-item[data-collection-id="${collection.id}"] .folder-item[data-folder-id="${folder.id}"]`
                );
                folderElement?.classList.add('expanded');
            }

            this.expandMatchingFolders(collection, folder.folders);
        });
    }

    /**
     * @param {Object} collection
     * @param {string} collection.id
     * @param {string} collection.name
     * @param {Array} collection.endpoints
     * @param {Array} [collection.folders]
     * @param {Object} eventHandlers
     * @returns {HTMLDivElement}
     */
    createPinnedSection(collections, pinnedRequests, eventHandlers) {
        const pinnedKeys = Object.keys(pinnedRequests);
        if (pinnedKeys.length === 0) {
            return null;
        }

        const pinnedEntries = [];
        collections.forEach(collection => {
            flattenRequests(collection).forEach(endpoint => {
                if (pinnedRequests[`${collection.id}_${endpoint.id}`]) {
                    pinnedEntries.push({ collection, endpoint });
                }
            });
        });

        if (pinnedEntries.length === 0) {
            return null;
        }

        const section = document.createElement('div');
        section.className = 'pinned-section expanded';

        const header = document.createElement('div');
        header.className = 'pinned-section-header';

        const toggle = document.createElement('span');
        toggle.className = 'pinned-section-toggle';
        toggle.textContent = '▶';

        const label = document.createElement('span');
        label.textContent = (app.i18n && app.i18n.t('sidebar.pinned')) || 'Pinned';

        header.appendChild(toggle);
        header.appendChild(label);

        const endpointsDiv = document.createElement('div');
        endpointsDiv.className = 'pinned-section-endpoints';

        pinnedEntries.forEach(({ collection, endpoint }) => {
            const endpointDiv = this.createEndpointElement(endpoint, collection, eventHandlers, true);
            endpointsDiv.appendChild(endpointDiv);
        });

        header.addEventListener('click', () => {
            section.classList.toggle('expanded');
        });

        section.appendChild(header);
        section.appendChild(endpointsDiv);

        return section;
    }

    createCollectionElement(collection, eventHandlers, pinnedRequests = {}) {
        const div = document.createElement('div');
        div.className = 'collection-item';
        div.dataset.collectionId = collection.id;

        const headerDiv = this.createCollectionHeader(collection);
        const endpointsDiv = this.createEndpointsContainer(collection, eventHandlers, pinnedRequests);

        div.appendChild(headerDiv);
        div.appendChild(endpointsDiv);

        this.attachCollectionEventListeners(div, headerDiv, collection, eventHandlers);

        return div;
    }

    /**
     * @param {Object} collection
     * @param {string} collection.name
     * @param {string} [collection.gitBranch]
     * @returns {HTMLDivElement}
     */
    createCollectionHeader(collection) {
        const headerDiv = document.createElement('div');
        headerDiv.className = 'collection-header u-flex u-items-center';

        const nameDiv = document.createElement('div');
        nameDiv.className = 'collection-name';
        nameDiv.textContent = collection.name;

        const toggleDiv = document.createElement('div');
        toggleDiv.className = 'collection-toggle';
        toggleDiv.textContent = '▶';

        headerDiv.appendChild(toggleDiv);
        headerDiv.appendChild(nameDiv);

        if (collection.gitBranch) {
            headerDiv.appendChild(this.createGitBadge(collection.gitBranch));
        }

        return headerDiv;
    }

    /**
     * @param {string} branch
     * @returns {HTMLSpanElement}
     */
    createGitBadge(branch) {
        const badge = document.createElement('span');
        badge.className = 'badge neutral collection-git-badge';
        badge.title = branch;

        const icon = document.createElement('span');
        icon.className = 'icon icon-12 icon-branch';

        const label = document.createElement('span');
        label.className = 'collection-git-branch';
        label.textContent = branch;

        badge.appendChild(icon);
        badge.appendChild(label);

        return badge;
    }

    /**
     * @param {Object} branchesById
     * @returns {void}
     */
    updateGitBadges(branchesById = {}) {
        const items = this.container.querySelectorAll('.collection-item[data-collection-id]');

        items.forEach(item => {
            const header = item.querySelector('.collection-header');
            if (!header) {
                return;
            }

            const branch = branchesById[item.dataset.collectionId];
            const badge = header.querySelector('.collection-git-badge');

            if (!branch) {
                badge?.remove();
                return;
            }

            if (!badge) {
                header.appendChild(this.createGitBadge(branch));
                return;
            }

            badge.title = branch;
            badge.querySelector('.collection-git-branch').textContent = branch;
        });
    }

    /**
     * @param {string} collectionId
     * @param {string} endpointId
     * @param {boolean} isPinned
     * @param {Object} pinnedRequests
     * @returns {void}
     */
    updatePinnedState(collectionId, endpointId, isPinned, pinnedRequests) {
        const selector = `.endpoint-item[data-collection-id="${collectionId}"][data-endpoint-id="${endpointId}"] .endpoint-pin-btn`;
        this.container.querySelectorAll(selector).forEach(pinBtn => {
            pinBtn.classList.toggle('is-pinned', isPinned);
            pinBtn.title = isPinned ? 'Unpin request' : 'Pin request';
        });

        const existingSection = this.container.querySelector('.pinned-section');
        const { collections, eventHandlers } = this._lastRenderArgs || {};
        if (!collections) {
            return;
        }

        const newSection = this.createPinnedSection(collections, pinnedRequests, eventHandlers || {});
        if (existingSection && newSection) {
            existingSection.replaceWith(newSection);
        } else if (existingSection) {
            existingSection.remove();
        } else if (newSection) {
            this.container.prepend(newSection);
        }
        this._lastRenderArgs.pinnedRequests = pinnedRequests;
    }

    /**
     * @param {Object} collection
     * @param {Object} eventHandlers
     * @param {Object} [pinnedRequests]
     * @returns {HTMLDivElement}
     */
    createEndpointsContainer(collection, eventHandlers, pinnedRequests = {}) {
        const endpointsDiv = document.createElement('div');
        endpointsDiv.className = 'collection-endpoints';

        rootRequests(collection).forEach(endpoint => {
            const isPinned = !!pinnedRequests[`${collection.id}_${endpoint.id}`];
            const endpointDiv = this.createEndpointElement(endpoint, collection, eventHandlers, isPinned);
            endpointsDiv.appendChild(endpointDiv);
        });

        topLevelFolders(collection).forEach(folder => {
            const folderDiv = this.createFolderElement(folder, collection, eventHandlers, pinnedRequests);
            endpointsDiv.appendChild(folderDiv);
        });

        return endpointsDiv;
    }

    /**
     * @param {Object} folder
     * @param {string} folder.id
     * @param {string} folder.name
     * @param {Array} folder.endpoints
     * @param {Array} [folder.folders]
     * @param {Object} collection
     * @param {Object} eventHandlers
     * @param {Object} [pinnedRequests]
     * @returns {HTMLDivElement}
     */
    createFolderElement(folder, collection, eventHandlers, pinnedRequests = {}) {
        const folderDiv = document.createElement('div');
        folderDiv.className = 'folder-item';
        folderDiv.dataset.folderId = folder.id;

        const folderHeader = document.createElement('div');
        folderHeader.className = 'folder-header u-flex u-items-center';

        const folderName = document.createElement('div');
        folderName.className = 'folder-name';
        folderName.textContent = folder.name;

        const folderToggle = document.createElement('div');
        folderToggle.className = 'folder-toggle';
        folderToggle.textContent = '▶';

        folderHeader.appendChild(folderToggle);
        folderHeader.appendChild(folderName);

        if (eventHandlers.onFolderContextMenu) {
            folderHeader.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                e.stopPropagation();
                eventHandlers.onFolderContextMenu(e, collection, folder);
            });
        }

        const folderEndpoints = document.createElement('div');
        folderEndpoints.className = 'folder-endpoints';

        (folder.endpoints || []).forEach(endpoint => {
            const isPinned = !!pinnedRequests[`${collection.id}_${endpoint.id}`];
            const endpointDiv = this.createEndpointElement(endpoint, collection, eventHandlers, isPinned);
            folderEndpoints.appendChild(endpointDiv);
        });

        (folder.folders || []).forEach(child => {
            const childDiv = this.createFolderElement(child, collection, eventHandlers, pinnedRequests);
            folderEndpoints.appendChild(childDiv);
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
     * @param {Object} endpoint
     * @param {string} endpoint.id
     * @param {string} endpoint.method
     * @param {string} endpoint.path
     * @param {Object} collection
     * @param {Object} eventHandlers
     * @returns {HTMLDivElement}
     */
    createEndpointElement(endpoint, collection, eventHandlers, isPinned = false) {
        const endpointDiv = document.createElement('div');
        endpointDiv.className = 'endpoint-item u-flex u-items-center';
        endpointDiv.dataset.endpointId = endpoint.id;
        endpointDiv.dataset.collectionId = collection.id;

        const methodSpan = document.createElement('span');
        methodSpan.className = 'method-pill';
        methodSpan.dataset.method = endpoint.method.toUpperCase();
        methodSpan.textContent = endpoint.method;

        const pathSpan = document.createElement('span');
        pathSpan.className = 'endpoint-path';
        const displayName = endpoint.name || endpoint.path.replace(/^\{\{baseUrl\}\}/, '').split('?')[0] || 'Unnamed Request';
        pathSpan.textContent = displayName;

        const pinBtn = document.createElement('span');
        pinBtn.className = `icon icon-14 icon-star endpoint-pin-btn${isPinned ? ' is-pinned' : ''}`;
        pinBtn.title = isPinned ? 'Unpin request' : 'Pin request';
        pinBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (eventHandlers.onTogglePinned) {
                eventHandlers.onTogglePinned(collection, endpoint);
            }
        });

        endpointDiv.appendChild(methodSpan);
        endpointDiv.appendChild(pathSpan);
        endpointDiv.appendChild(pinBtn);

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
     * @param {HTMLDivElement} collectionDiv
     * @param {HTMLDivElement} headerDiv
     * @param {Object} collection
     * @param {Object} eventHandlers
     * @returns {void}
     */
    attachCollectionEventListeners(collectionDiv, headerDiv, collection, eventHandlers) {
        headerDiv.addEventListener('click', async (e) => {
            if (e.target.closest('.context-menu')) {
                return;
            }

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

    /** @returns {Object} */
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
     * @param {Object} expansionState
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

    /** @returns {Promise<void>} */
    async saveExpansionState() {
        if (!this.repository) {
            return;
        }
        
        try {
            const currentState = this.getExpansionState();
            await this.repository.saveCollectionExpansionStates(currentState);
        } catch (error) {
            void error;
        }
    }

    /** @returns {Promise<void>} */
    async loadAndRestoreExpansionState() {
        if (!this.repository) {
            return;
        }

        try {
            const savedState = await this.repository.getCollectionExpansionStates();
            this.restoreExpansionState(savedState);
        } catch (error) {
            void error;
        }
    }

    /**
     * @param {string} collectionId
     * @param {string} endpointId
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

    /** @returns {void} */
    clearActiveEndpoint() {
        const allEndpoints = this.container.querySelectorAll('.endpoint-item');
        allEndpoints.forEach(endpoint => endpoint.classList.remove('active'));
    }
}
