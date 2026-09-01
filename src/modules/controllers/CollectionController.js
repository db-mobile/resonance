/**
 * @fileoverview Controller for coordinating collection operations between UI and services
 * @module controllers/CollectionController
 */

import { getCurrentEndpoint, setCurrentEndpoint } from '../state/currentEndpoint.js';
import { debounce } from '../utils/debounce.js';
import { registerPendingSave, cancelPendingSaves } from '../state/pendingSaves.js';
import { app } from '../appContext.js';
import { CollectionRepository } from '../storage/CollectionRepository.js';
import { VariableRepository } from '../storage/VariableRepository.js';
import { SchemaProcessor } from '../schema/SchemaProcessor.js';
import { VariableProcessor } from '../variables/VariableProcessor.js';
import { CollectionService } from '../services/CollectionService.js';
import { CollectionEndpointLoaderService } from '../services/CollectionEndpointLoaderService.js';
import { CollectionImportExportService } from '../services/CollectionImportExportService.js';
import { CollectionRequestPersistenceService } from '../services/CollectionRequestPersistenceService.js';
import { CollectionVariableApplicationService } from '../services/CollectionVariableApplicationService.js';
import { VariableService } from '../services/VariableService.js';
import { CollectionRenderer } from '../ui/CollectionRenderer.js';
import { ContextMenu } from '../ui/ContextMenu.js';
import { RenameDialog } from '../ui/RenameDialog.js';
import { ConfirmDialog } from '../ui/ConfirmDialog.js';
import { VariableManager } from '../ui/VariableManager.js';
import { CurlImportDialog } from '../ui/CurlImportDialog.js';
import { CollectionDialogs } from '../ui/CollectionDialogs.js';
import { CollectionAuthDialog } from '../ui/CollectionAuthDialog.js';
import { toast } from '../ui/Toast.js';
import { StatusDisplayAdapter } from '../interfaces/IStatusDisplay.js';
import { setRequestBodyContent } from '../requestBodyHelper.js';
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
        this.repository = new CollectionRepository(backendAPI, app.secretStore);
        this.variableRepository = new VariableRepository(backendAPI, app.secretStore);
        this.schemaProcessor = new SchemaProcessor();
        this.variableProcessor = new VariableProcessor();
        this.statusDisplay = new StatusDisplayAdapter(updateStatusDisplay);
        this._debouncedSaveBody = null;
        this._inFlightBodySave = null;
        this._pinnedRequests = null;
        this._debouncedSearch = null;
        
        this.service = new CollectionService(this.repository, this.schemaProcessor, this.statusDisplay);
        this.variableService = new VariableService(this.variableRepository, this.variableProcessor, this.statusDisplay);
        
        this.renderer = new CollectionRenderer('collections-list', this.repository);
        this.contextMenu = new ContextMenu();
        this.renameDialog = new RenameDialog();
        this.confirmDialog = new ConfirmDialog();
        this.variableManager = new VariableManager();
        this.collectionAuthDialog = new CollectionAuthDialog();
        this.curlImportDialog = new CurlImportDialog();
        this.collectionDialogs = new CollectionDialogs({
            backendAPI,
            collectionService: this.service,
            collectionRepository: this.repository
        });
        this.endpointLoaderService = new CollectionEndpointLoaderService({
            repository: this.repository,
            collectionService: this.service,
            schemaProcessor: this.schemaProcessor,
            getFormElements: () => this.getFormElements(),
            setActiveEndpoint: (collectionId, endpointId) => {
                if (this.renderer && typeof this.renderer.setActiveEndpoint === 'function') {
                    this.renderer.setActiveEndpoint(collectionId, endpointId);
                }
            }
        });
        this.docGeneratorService = new DocGeneratorService(this.repository);
        this.importExportService = new CollectionImportExportService({
            backendAPI,
            repository: this.repository,
            collectionService: this.service,
            docGeneratorService: this.docGeneratorService,
            statusDisplay: this.statusDisplay,
            collectionDialogs: this.collectionDialogs,
            curlImportDialog: this.curlImportDialog,
            refreshCollections: (preserveExpansionState = false) => preserveExpansionState
                ? this.loadCollectionsWithExpansionState()
                : this.loadCollections()
        });
        this.variableApplicationService = new CollectionVariableApplicationService({
            variableService: this.variableService
        });
        this.requestPersistenceService = new CollectionRequestPersistenceService({
            repository: this.repository,
            collectionService: this.service,
            statusDisplay: this.statusDisplay,
            refreshCollections: () => this.loadCollectionsWithExpansionState()
        });
        this.collectionsSearchInput = document.getElementById('collections-search-input');
        this.allCollections = [];
        this.searchQuery = '';
        
        this.handleEndpointClick = this.handleEndpointClick.bind(this);
        this.handleContextMenu = this.handleContextMenu.bind(this);
        this.handleFolderContextMenu = this.handleFolderContextMenu.bind(this);
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

        this.gitRefreshInFlight = false;
        this.refreshGitBranches = this.refreshGitBranches.bind(this);

        this.initializeCollectionsSearch();
        this.initializeGitBranchRefresh();
    }

    /**
     * Re-reads Git branches whenever the window regains focus.
     *
     * A `git checkout` happens in a terminal, so the app only ever learns about
     * it on the way back in. Focus is the cheapest signal for that, and avoids
     * keeping a filesystem watcher alive per collection.
     *
     * @returns {void}
     */
    initializeGitBranchRefresh() {
        window.addEventListener('focus', this.refreshGitBranches);
    }

    /**
     * Updates the branch shown for every collection.
     *
     * Failures are swallowed: the badge is decoration, and a collection whose
     * directory has gone missing must not put an error in front of the user.
     *
     * @async
     * @returns {Promise<void>}
     */
    async refreshGitBranches() {
        if (this.gitRefreshInFlight) {
            return;
        }
        this.gitRefreshInFlight = true;

        try {
            const branches = await this.repository.gitBranches();
            this.allCollections.forEach(collection => {
                collection.gitBranch = branches[collection.id] ?? null;
            });
            this.renderer.updateGitBadges(branches);
        } catch (error) {
            return;
        } finally {
            this.gitRefreshInFlight = false;
        }
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
            await this.renderCollections(this.allCollections, true);
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
        const pinnedRequests = await this._getPinnedRequestsCached();
        const eventHandlers = {
            onEmptyStateActions: {
                'new-collection': this.handleNewCollection,
                'import-collection': () => this.importCollectionFile(),
                'import-curl': () => this.handleImportCurl(null),
                'open-existing': () => this.handleOpenExisting()
            },
            onEndpointClick: this.handleEndpointClick,
            onContextMenu: this.handleContextMenu,
            onFolderContextMenu: this.handleFolderContextMenu,
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

        this._debouncedSearch = debounce(() => this.handleCollectionsSearch(), 200);
        this.collectionsSearchInput.addEventListener('input', () => this._debouncedSearch());
    }

    async handleCollectionsSearch() {
        this.searchQuery = this.collectionsSearchInput.value.trim().toLowerCase();
        await this.renderCollections(this.allCollections, true);
    }

    /**
     * Returns the pinned-request map, reading the store only on the first call.
     * @private
     * @returns {Promise<Object>} Pinned requests keyed `${collectionId}_${endpointId}`
     */
    async _getPinnedRequestsCached() {
        if (!this._pinnedRequests) {
            this._pinnedRequests = await this.repository.getPinnedRequests();
        }
        return this._pinnedRequests;
    }

    filterCollections(collections, query) {
        if (!query) {
            return collections;
        }

        return collections.reduce((filteredCollections, collection) => {
            const hasCollectionNameMatch = this.matchesSearchQuery(collection.name, query);

            const endpoints = (collection.endpoints || []).filter(endpoint =>
                this.endpointMatchesQuery(endpoint, query)
            );
            const folders = this.filterFolders(collection.folders, query);

            const hasNestedRequestMatch =
                endpoints.length > 0 || folders.some(folder => folder.__searchExpand);

            if (!hasCollectionNameMatch && endpoints.length === 0 && folders.length === 0) {
                return filteredCollections;
            }

            filteredCollections.push({
                ...collection,
                endpoints,
                folders,
                __searchExpand: hasNestedRequestMatch
            });

            return filteredCollections;
        }, []);
    }

    /**
     * Filters a folder tree to the branches that match, at any depth.
     *
     * A folder is kept when its own name matches (with all its contents) or
     * when something inside it matches (narrowed to the matches).
     *
     * @param {Array} folders - Folders to filter
     * @param {string} query - The search query
     * @returns {Array} The matching folders, marked for auto-expansion
     */
    filterFolders(folders, query) {
        return (folders || []).reduce((kept, folder) => {
            const matchingEndpoints = (folder.endpoints || []).filter(endpoint =>
                this.endpointMatchesQuery(endpoint, query)
            );
            const matchingFolders = this.filterFolders(folder.folders, query);
            const hasNameMatch = this.matchesSearchQuery(folder.name, query);
            const hasDescendantMatch = matchingEndpoints.length > 0 || matchingFolders.length > 0;

            if (hasNameMatch) {
                kept.push({ ...folder, __searchExpand: hasDescendantMatch });
            } else if (hasDescendantMatch) {
                kept.push({
                    ...folder,
                    endpoints: matchingEndpoints,
                    folders: matchingFolders,
                    __searchExpand: true
                });
            }

            return kept;
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
        await this.endpointLoaderService.handleEndpointClick(collection, endpoint);
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
                label: 'Edit Auth',
                translationKey: 'context_menu.edit_auth',
                iconClass: 'icon-lock',
                onClick: () => this.handleCollectionAuth(collection)
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
            // A collection opened in place lives in a directory the app does
            // not own, so it is closed rather than deleted. The backend
            // refuses to delete one either way; omitting the item here just
            // keeps the destructive option off a user's git checkout.
            collection.linked
                ? {
                    label: 'Close Collection',
                    translationKey: 'context_menu.close_collection',
                    iconClass: ContextMenu.createDeleteIcon(),
                    onClick: () => this.handleClose(collection)
                }
                : {
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
        const pinned = await this._getPinnedRequestsCached();
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
        const isPinned = await this.repository.togglePinnedRequest(collection.id, endpoint.id);

        const pinned = await this._getPinnedRequestsCached();
        const key = `${collection.id}_${endpoint.id}`;
        if (isPinned) {
            pinned[key] = true;
        } else {
            delete pinned[key];
        }

        this.renderer.updatePinnedState(collection.id, endpoint.id, isPinned, pinned);
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
                await this.loadCollections();
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
            const currentEntries = await this.variableService.getCollectionVariableEntries(collection.id);
            const result = await this.variableManager.show(collection.name, currentEntries);

            if (result !== null) {
                await this.variableService.setMultipleVariables(collection.id, result.variables, result.secretKeys);
            }
        } catch (error) {
            void error;
        }
    }

    /**
     * Opens the collection auth dialog and persists the edited config.
     * Endpoints whose auth type is "Inherit from Parent" pick the new
     * value up at send time; the open Authorization tab hint is re-rendered.
     *
     * @async
     * @param {Object} collection - The collection whose auth to edit
     * @returns {Promise<void>}
     */
    async handleCollectionAuth(collection) {
        try {
            const result = await this.collectionAuthDialog.show(collection, this.repository);
            if (result !== null) {
                await this.repository.saveCollectionAuthConfig(collection.id, result);
                this.refreshInheritHint();
            }
        } catch (error) {
            void error;
        }
    }

    /**
     * Handles right-click context menu on a folder header.
     *
     * @param {Event} event - The contextmenu event
     * @param {Object} collection - The parent collection
     * @param {Object} folder - The folder that was right-clicked
     * @returns {void}
     */
    handleFolderContextMenu(event, collection, folder) {
        this.contextMenu.show(event, [
            {
                label: 'Edit Auth',
                translationKey: 'context_menu.edit_auth',
                iconClass: 'icon-lock',
                onClick: () => this.handleFolderAuth(collection, folder)
            }
        ]);
    }

    /**
     * Opens the folder auth dialog and persists the edited config. Folder
     * auth overrides collection auth for the folder's inheriting endpoints;
     * "Inherit from Collection" removes the override.
     *
     * @async
     * @param {Object} collection - The parent collection
     * @param {Object} folder - The folder whose auth to edit
     * @returns {Promise<void>}
     */
    async handleFolderAuth(collection, folder) {
        try {
            const result = await this.collectionAuthDialog.show(collection, this.repository, { folder });
            if (result !== null) {
                await this.repository.saveFolderAuthConfig(collection.id, folder.id, result);
                this.refreshInheritHint();
            }
        } catch (error) {
            void error;
        }
    }

    /**
     * Re-renders the request tab's inherit hint after collection/folder auth
     * changes so the displayed source stays accurate.
     *
     * @private
     * @returns {void}
     */
    refreshInheritHint() {
        if (app.authManager?.getAuthConfig()?.type === 'inherit') {
            app.authManager.renderAuthFields('inherit');
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
        return this.collectionDialogs.showNewCollectionDialog(initialName);
    }

    /**
     * Shows dialog for creating a new request
     *
     * @async
     * @returns {Promise<Object|null>} Request data object with name, method, and path if confirmed, null if cancelled
     */
    async showNewRequestDialog() {
        return this.collectionDialogs.showNewRequestDialog();
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
        const result = await this.collectionDialogs.showSaveToCollectionDialog(requestData);
        if (result) {
            await this.loadCollectionsWithExpansionState();
        }
        return result;
    }

    /**
     * Removes a collection from the list, leaving its files alone.
     *
     * The counterpart to opening a collection in place: its directory belongs
     * to the user, usually a git checkout, so closing must be reversible.
     *
     * @async
     * @param {Object} collection - The collection to close
     * @returns {Promise<void>}
     */
    async handleClose(collection) {
        const confirmMessage = app.i18n ?
            app.i18n.t('collection.confirm_close', { name: collection.name }) :
            `Remove "${collection.name}" from the list?\n\nThe folder and its files stay on disk, and stored credentials are kept. You can open it again later.`;

        const title = app.i18n ?
            app.i18n.t('collection.close_title') || 'Close Collection' :
            'Close Collection';

        const confirmText = app.i18n ?
            app.i18n.t('common.close') || 'Close' :
            'Close';

        const cancelText = app.i18n ?
            app.i18n.t('common.cancel') || 'Cancel' :
            'Cancel';

        const confirmed = await this.confirmDialog.show(confirmMessage, {
            title,
            confirmText,
            cancelText
        });

        if (!confirmed) {
            return;
        }

        try {
            // Deliberately not cleanupCollectionVariables: it routes to
            // collection_save_variables, which rewrites the collection on disk
            // and would blank variables.yaml in the user's working copy.
            await this.service.closeCollection(collection.id);
            await this.closeTabsForCollection(collection.id);
            await this.loadCollections();
            toast.success(`Collection "${collection.name}" closed`);
        } catch (error) {
            toast.error(`Failed to close collection: ${error.message}`);
        }
    }

    /**
     * Closes any workspace tabs belonging to a collection.
     *
     * Without this the app restores a tab whose collection no longer resolves.
     *
     * @async
     * @param {string} collectionId - The collection whose tabs should close
     * @returns {Promise<void>}
     */
    async closeTabsForCollection(collectionId) {
        try {
            if (!app.workspaceTabController) {
                return;
            }
            const tabs = await app.workspaceTabController.service.getAllTabs();
            for (const tab of tabs.filter(tab => tab.collectionId === collectionId)) {
                await app.workspaceTabController.closeTab(tab.id);
            }
        } catch (error) {
            void error;
        }
    }

    /**
     * Opens a collection directory that already exists on disk, in place.
     *
     * @async
     * @returns {Promise<void>}
     */
    async handleOpenExisting() {
        // `false` keeps this pick out of the "last used" default: it is a
        // collection, not a parent to create new collections inside.
        const path = await this.backendAPI.collections.pickDirectory(false).catch(() => null);
        if (!path) {
            return;
        }

        try {
            const result = await this.service.openExistingCollection(path);
            await this.loadCollections();

            const opened = result.opened.length;
            if (opened > 0) {
                toast.success(
                    opened === 1
                        ? `Opened "${result.opened[0].name}"`
                        : `Opened ${opened} collections`
                );
            }

            for (const alreadyOpen of result.alreadyOpen) {
                toast.info(`"${alreadyOpen}" is already open`);
            }
            for (const failure of result.failed) {
                toast.error(failure.reason);
            }
        } catch (error) {
            const message = typeof error === 'string' ? error : (error.message || 'Unknown error');
            toast.error(message);
        }
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
        const confirmMessage = app.i18n ?
            app.i18n.t('collection.confirm_delete', { name: collection.name }) :
            `Are you sure you want to delete the collection "${collection.name}"?\n\nThis action cannot be undone.`;

        const title = app.i18n ?
            app.i18n.t('collection.delete_title') || 'Delete Collection' :
            'Delete Collection';

        const confirmText = app.i18n ?
            app.i18n.t('common.delete') || 'Delete' :
            'Delete';

        const cancelText = app.i18n ?
            app.i18n.t('common.cancel') || 'Cancel' :
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
        await this.importExportService.handleExportOpenApiJson(collection);
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
        await this.importExportService.handleExportOpenApiYaml(collection);
    }

    async handleExportPostman(collection) {
        await this.importExportService.handleExportPostman(collection);
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
        await this.importExportService.handleGenerateDocumentation(collection);
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
            const title = app.i18n ?
                app.i18n.t('endpoint.rename_title') || 'Rename Request' :
                'Rename Request';

            const label = app.i18n ?
                app.i18n.t('endpoint.rename_label') || 'Request Name:' :
                'Request Name:';

            const confirmText = app.i18n ?
                app.i18n.t('common.rename') || 'Rename' :
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

            if (!app.workspaceTabController) {
                return;
            }
            const tabs = await app.workspaceTabController.service.getAllTabs();
            const matchingTabs = tabs.filter(tab => 
                tab.endpoint && 
                tab.endpoint.collectionId === collection.id && 
                tab.endpoint.endpointId === endpoint.id
            );
            for (const tab of matchingTabs) {
                await app.workspaceTabController.service.updateTab(tab.id, { name: newName });
                app.workspaceTabController.tabBar.updateTab(tab.id, { name: newName });
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
        const confirmMessage = app.i18n ?
            app.i18n.t('endpoint.confirm_delete', { name: endpoint.name || endpoint.path }) :
            `Are you sure you want to delete the request "${endpoint.name || endpoint.path}"?\n\nThis action cannot be undone.`;

        const title = app.i18n ?
            app.i18n.t('endpoint.delete_title') || 'Delete Request' :
            'Delete Request';

        const confirmText = app.i18n ?
            app.i18n.t('common.delete') || 'Delete' :
            'Delete';

        const cancelText = app.i18n ?
            app.i18n.t('common.cancel') || 'Cancel' :
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

                if (getCurrentEndpoint() &&
                    getCurrentEndpoint().collectionId === collection.id &&
                    getCurrentEndpoint().endpointId === endpoint.id) {
                    cancelPendingSaves();
                    const formElements = this.getFormElements();
                    formElements.urlInput.value = '';
                    formElements.methodSelect.value = 'GET';
                    setRequestBodyContent('');
                    this.service.clearKeyValueList(formElements.pathParamsList);
                    this.service.clearKeyValueList(formElements.headersList);
                    this.service.clearKeyValueList(formElements.queryParamsList);
                    setCurrentEndpoint(null);

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
     * Imports a collection file of any supported format and creates a collection
     *
     * Triggers file picker dialog via IPC; the backend detects the format
     * (OpenAPI/Swagger, Postman, Insomnia, HAR) from the file's markers.
     *
     * @async
     * @returns {Promise<Object|null>} Created collection object or null if cancelled
     * @throws {Error} If import fails
     */
    async importCollectionFile() {
        return this.importExportService.importCollectionFile();
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
        return this.importExportService.importPostmanEnvironment();
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
        await this.importExportService.handleImportCurl(collection);
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
        await this.requestPersistenceService.saveRequestBodyModification(collectionId, endpointId);
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
        await this.requestPersistenceService.saveAllRequestModifications(collectionId, endpointId);
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
                if (getCurrentEndpoint()) {
                    this._debouncedSaveBody.cancel();
                    await this.saveRequestBodyModification(
                        getCurrentEndpoint().collectionId,
                        getCurrentEndpoint().endpointId
                    );
                }
            });

            this._debouncedSaveBody = debounce((collectionId, endpointId) => {
                this._inFlightBodySave = this.saveRequestBodyModification(collectionId, endpointId)
                    .catch(() => {})
                    .finally(() => {
                        this._inFlightBodySave = null;
                    });
                return this._inFlightBodySave;
            }, 2000);
            bodyInput.addEventListener('input', () => {
                if (getCurrentEndpoint()) {
                    this._debouncedSaveBody(
                        getCurrentEndpoint().collectionId,
                        getCurrentEndpoint().endpointId
                    );
                }
            });

            registerPendingSave({
                flush: () => this.flushPendingBodySave(),
                cancel: () => this._debouncedSaveBody.cancel()
            });
        }
    }

    /**
     * Flushes a pending debounced body save and waits for it to settle.
     * @returns {Promise<void>} Resolves once no body save is pending or in flight
     */
    async flushPendingBodySave() {
        if (this._debouncedSaveBody) {
            await this._debouncedSaveBody.flush();
        }
        await this._inFlightBodySave;
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
        await this.variableApplicationService.processFormVariables(collectionId, formElements, {
            includeUrl: true
        });
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

}
