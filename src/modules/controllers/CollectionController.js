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

export class CollectionController {
    /**
     * @param {Object} backendAPI
     * @param {Function} updateStatusDisplay
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

    /** @returns {void} */
    initializeGitBranchRefresh() {
        window.addEventListener('focus', this.refreshGitBranches);
    }

    /** @returns {Promise<void>} */
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

    /** @returns {Promise<Array<Object>>} */
    async loadCollections() {
        try {
            this.allCollections = await this.service.loadCollections();
            await this.renderCollections(this.allCollections);
            return this.allCollections;
        } catch (error) {
            return [];
        }
    }

    /** @returns {Promise<Array<Object>>} */
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
     * @param {Array<Object>} collections
     * @param {boolean} [preserveExpansionState=false]
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

    /** @returns {Promise<Object>} */
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
     * @param {Array} folders
     * @param {string} query
     * @returns {Array}
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
     * @param {Object} collection
     * @param {Object} endpoint
     * @returns {Promise<void>}
     */
    async handleEndpointClick(collection, endpoint) {
        await this.endpointLoaderService.handleEndpointClick(collection, endpoint);
    }

    /**
     * @param {Event} event
     * @param {Object} collection
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
     * @param {Event} event
     * @param {Object} collection
     * @param {Object} endpoint
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
     * @param {Event} event
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
     * @param {Object} collection
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
     * @param {Object} collection
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
     * @param {Object} collection
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
     * @param {Event} event
     * @param {Object} collection
     * @param {Object} folder
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
     * @param {Object} collection
     * @param {Object} folder
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

    /** @returns {void} */
    refreshInheritHint() {
        if (app.authManager?.getAuthConfig()?.type === 'inherit') {
            app.authManager.renderAuthFields('inherit');
        }
    }

    /**
     * @param {Object} collection
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

    /** @returns {Promise<void>} */
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

    /** @returns {Promise<void>} */
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

    /** @returns {Promise<string|null>} */
    async showNewCollectionDialog(initialName = '') {
        return this.collectionDialogs.showNewCollectionDialog(initialName);
    }

    /** @returns {Promise<Object|null>} */
    async showNewRequestDialog() {
        return this.collectionDialogs.showNewRequestDialog();
    }

    /**
     * @param {Object} requestData
     * @returns {Promise<{collectionId: string, endpointId: string}|null>}
     */
    async showSaveToCollectionDialog(requestData) {
        const result = await this.collectionDialogs.showSaveToCollectionDialog(requestData);
        if (result) {
            await this.loadCollectionsWithExpansionState();
        }
        return result;
    }

    /**
     * @param {Object} collection
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
            await this.service.closeCollection(collection.id);
            await this.closeTabsForCollection(collection.id);
            await this.loadCollections();
            toast.success(`Collection "${collection.name}" closed`);
        } catch (error) {
            toast.error(`Failed to close collection: ${error.message}`);
        }
    }

    /**
     * @param {string} collectionId
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

    /** @returns {Promise<void>} */
    async handleOpenExisting() {
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
     * @param {Object} collection
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
     * @param {Object} collection
     * @returns {Promise<void>}
     */
    async handleExportOpenApiJson(collection) {
        await this.importExportService.handleExportOpenApiJson(collection);
    }

    /**
     * @param {Object} collection
     * @returns {Promise<void>}
     */
    async handleExportOpenApiYaml(collection) {
        await this.importExportService.handleExportOpenApiYaml(collection);
    }

    async handleExportPostman(collection) {
        await this.importExportService.handleExportPostman(collection);
    }

    /**
     * @param {Object} collection
     * @returns {Promise<void>}
     */
    async handleGenerateDocumentation(collection) {
        await this.importExportService.handleGenerateDocumentation(collection);
    }

    /**
     * @param {Object} collection
     * @param {Object} endpoint
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
     * @param {Object} collection
     * @param {Object} endpoint
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

    /** @returns {Promise<Object|null>} */
    async importCollectionFile() {
        return this.importExportService.importCollectionFile();
    }

    /** @returns {Promise<Object|null>} */
    async importPostmanEnvironment() {
        return this.importExportService.importPostmanEnvironment();
    }

    /**
     * @param {Object|null} collection
     * @returns {Promise<void>}
     */
    async handleImportCurl(collection) {
        await this.importExportService.handleImportCurl(collection);
    }

    /**
     * @param {string} collectionId
     * @param {string} endpointId
     * @returns {Promise<void>}
     */
    async saveRequestBodyModification(collectionId, endpointId) {
        await this.requestPersistenceService.saveRequestBodyModification(collectionId, endpointId);
    }

    /**
     * @param {string} collectionId
     * @param {string} endpointId
     * @returns {Promise<void>}
     */
    async saveAllRequestModifications(collectionId, endpointId) {
        await this.requestPersistenceService.saveAllRequestModifications(collectionId, endpointId);
    }

    /** @returns {void} */
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

    /** @returns {Promise<void>} */
    async flushPendingBodySave() {
        if (this._debouncedSaveBody) {
            await this._debouncedSaveBody.flush();
        }
        await this._inFlightBodySave;
    }

    /**
     * @param {string} collectionId
     * @param {Object} formElements
     * @returns {Promise<void>}
     */
    async processFormVariables(collectionId, formElements) {
        await this.variableApplicationService.processFormVariables(collectionId, formElements, {
            includeUrl: true
        });
    }

    /** @returns {Object} */
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
