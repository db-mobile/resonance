/**
 * @fileoverview Controller for coordinating collection operations between UI and services
 * @module controllers/CollectionController
 */

import { getCurrentEndpoint, setCurrentEndpoint } from '../state/currentEndpoint.js';
import { debounce } from '../utils/debounce.js';
import { registerPendingSave, cancelPendingSaves } from '../state/pendingSaves.js';
import { app } from '../appContext.js';
import { ContextMenu } from '../ui/ContextMenu.js';
import { toast } from '../ui/Toast.js';
import { ChangeEmitter } from '../services/ChangeEmitter.js';
import { flattenRequests, requestsInFolder, folderChainForRequest, folderOutline, endpointKey } from '../collections/collectionTree.js';
import { isRunnable } from '../utils/runnableRequests.js';
import { translate, translateCount } from '../utils/translate.js';
import { normalizeTags } from '../utils/requestTags.js';

export class CollectionController {
    /**
     * @param {Object} deps
     * @param {Object} deps.backendAPI
     * @param {Object} deps.repository
     * @param {Object} deps.service
     * @param {Object} deps.variableService
     * @param {Object} deps.renderer
     * @param {Object} deps.endpointLoaderService
     * @param {Object} deps.importExportService
     * @param {Object} deps.requestPersistenceService
     * @param {Object} deps.collectionDialogs
     * @param {Object} deps.contextMenu
     * @param {Object} deps.renameDialog
     * @param {Object} deps.confirmDialog
     * @param {Object} deps.moveRequestDialog
     * @param {Object} deps.editTagsDialog
     * @param {Object} deps.variableManager
     * @param {Object} deps.collectionAuthDialog
     * @param {import('../requestFormReader.js').RequestFormReader} deps.formReader
     * @param {HTMLElement|null} [deps.searchInput]
     */
    constructor({
        backendAPI,
        repository,
        service,
        variableService,
        renderer,
        endpointLoaderService,
        importExportService,
        requestPersistenceService,
        collectionDialogs,
        contextMenu,
        renameDialog,
        confirmDialog,
        moveRequestDialog,
        editTagsDialog,
        variableManager,
        collectionAuthDialog,
        formReader,
        searchInput = null
    }) {
        this.backendAPI = backendAPI;
        this.repository = repository;
        this.service = service;
        this.variableService = variableService;
        this.renderer = renderer;
        this.endpointLoaderService = endpointLoaderService;
        this.importExportService = importExportService;
        this.requestPersistenceService = requestPersistenceService;
        this.collectionDialogs = collectionDialogs;
        this.contextMenu = contextMenu;
        this.renameDialog = renameDialog;
        this.confirmDialog = confirmDialog;
        this.moveRequestDialog = moveRequestDialog;
        this.editTagsDialog = editTagsDialog;
        this.variableManager = variableManager;
        this.collectionAuthDialog = collectionAuthDialog;
        this.formReader = formReader;
        this.collectionsSearchInput = searchInput;
        this._debouncedSaveBody = null;
        this._inFlightBodySave = null;
        this._pinnedRequests = null;
        this._debouncedSearch = null;
        this.allCollections = [];
        this.searchQuery = '';
        this._collectionEvents = new ChangeEmitter();

        this.handleEndpointClick = this.handleEndpointClick.bind(this);
        this.handleContextMenu = this.handleContextMenu.bind(this);
        this.handleFolderContextMenu = this.handleFolderContextMenu.bind(this);
        this.handleEndpointContextMenu = this.handleEndpointContextMenu.bind(this);
        this.handleEmptySpaceContextMenu = this.handleEmptySpaceContextMenu.bind(this);
        this.handleNewCollection = this.handleNewCollection.bind(this);
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
            const branchChanged = this.allCollections.some(collection =>
                (collection.gitBranch ?? null) !== (branches[collection.id] ?? null)
            );
            if (branchChanged) {
                await this.loadCollectionsWithExpansionState();
                return;
            }
            this.renderer.updateGitBadges(branches);
        } catch (error) {
            return;
        } finally {
            this.gitRefreshInFlight = false;
        }
    }

    /**
     * @param {Function} listener
     * @returns {Function}
     */
    onCollectionsLoaded(listener) {
        this._collectionEvents.add(listener);
        return () => this._collectionEvents.remove(listener);
    }

    /** @returns {Promise<void>} */
    async _refreshLoadErrors() {
        const errors = await this.repository.getLoadErrors();
        const signature = errors.map(error => `${error.path}\n${error.message}`).sort().join('\n');
        const changed = signature !== this._loadErrorSignature;
        this._loadErrorSignature = signature;
        this.loadErrors = errors;
        if (changed && errors.length > 0) {
            toast.warning(translateCount('sidebar.load_errors.toast', errors.length, {
                one: '1 collection could not be loaded',
                other: '{{count}} collections could not be loaded'
            }));
        }
    }

    /** @returns {Promise<Array<Object>>} */
    async loadCollections() {
        return this._reload(false);
    }

    /** @returns {Promise<Array<Object>>} */
    async getCollections() {
        if (this.allCollections && this.allCollections.length > 0) {
            return this.allCollections;
        }
        return this.loadCollections();
    }

    /** @returns {Promise<Array<Object>>} */
    async loadCollectionsWithExpansionState() {
        return this._reload(true);
    }

    /**
     * @param {boolean} preserveExpansionState
     * @returns {Promise<Array<Object>>}
     */
    async _reload(preserveExpansionState) {
        try {
            this.allCollections = await this.service.loadCollections();
            await this._refreshLoadErrors();
            await this.renderCollections(this.allCollections, preserveExpansionState);
            this._collectionEvents.emit(this.allCollections);
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
        this.renderer.renderLoadErrors(isSearching ? [] : (this.loadErrors ?? []), {
            onLocate: (error) => this.handleLocateMissingCollection(error),
            onRemove: (error) => this.handleRemoveMissingCollection(error),
            onRetry: () => this.loadCollectionsWithExpansionState()
        });
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
        const tags = normalizeTags(endpoint.tags);
        if (query.startsWith('tag:')) {
            const wanted = query.slice(4).trim();
            return wanted !== '' && tags.some(tag => tag.toLowerCase() === wanted);
        }
        return [
            endpoint.name,
            endpoint.path,
            endpoint.method,
            endpoint.summary,
            endpoint.description,
            ...tags
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
                label: 'New Folder',
                translationKey: 'context_menu.new_folder',
                iconClass: 'icon-folder',
                onClick: () => this.handleNewFolder(collection, null)
            },
            {
                label: 'Run Collection',
                translationKey: 'context_menu.run_collection',
                iconClass: 'icon-play',
                onClick: () => this.handleRunRequests(collection, flattenRequests(collection), collection.name)
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
            {
                label: 'Show in File Manager',
                translationKey: 'context_menu.show_in_file_manager',
                iconClass: 'icon-folder',
                onClick: () => this.handleReveal(collection)
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
        const isPinned = !!pinned[endpointKey(collection.id, endpoint.id)];
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
                label: 'Edit Tags…',
                translationKey: 'context_menu.edit_tags',
                iconClass: ContextMenu.createRenameIcon(),
                onClick: () => this.handleEditTags(collection, endpoint)
            },
            {
                label: 'Duplicate Request',
                translationKey: 'context_menu.duplicate_request',
                iconClass: 'icon-copy',
                onClick: () => this.handleDuplicateRequest(collection, endpoint)
            },
            ...(folderOutline(collection).length > 0 ? [{
                label: 'Move to Folder…',
                translationKey: 'context_menu.move_request',
                iconClass: 'icon-folder',
                onClick: () => this.handleMoveRequest(collection, endpoint)
            }] : []),
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
        const key = endpointKey(collection.id, endpoint.id);
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
        } catch {}
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
        } catch {}
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
        } catch {}
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
                label: 'New Request',
                translationKey: 'context_menu.new_request',
                iconClass: ContextMenu.createNewRequestIcon(),
                onClick: () => this.handleNewRequest(collection, folder.id)
            },
            {
                label: 'New Subfolder',
                translationKey: 'context_menu.new_subfolder',
                iconClass: 'icon-folder',
                onClick: () => this.handleNewFolder(collection, folder.id)
            },
            {
                label: 'Rename Folder',
                translationKey: 'context_menu.rename_folder',
                iconClass: ContextMenu.createRenameIcon(),
                onClick: () => this.handleRenameFolder(collection, folder)
            },
            {
                label: 'Run Folder',
                translationKey: 'context_menu.run_folder',
                iconClass: 'icon-play',
                onClick: () => this.handleRunRequests(
                    collection,
                    requestsInFolder(collection, folder.id),
                    `${collection.name} / ${folder.name}`
                )
            },
            {
                label: 'Edit Auth',
                translationKey: 'context_menu.edit_auth',
                iconClass: 'icon-lock',
                onClick: () => this.handleFolderAuth(collection, folder)
            },
            {
                label: 'Delete Folder',
                translationKey: 'context_menu.delete_folder',
                iconClass: ContextMenu.createDeleteIcon(),
                className: 'context-menu-delete',
                onClick: () => this.handleDeleteFolder(collection, folder)
            }
        ]);
    }

    /**
     * @param {Error} error
     * @returns {void}
     */
    _toastFolderError(error) {
        toast.error(translate('folder.error', 'Folder action failed: {{message}}', { message: error.message }));
    }

    /**
     * @param {Object} collection
     * @param {string|null} parentFolderId
     * @returns {Promise<void>}
     */
    async handleNewFolder(collection, parentFolderId) {
        const name = await this.renameDialog.show('', {
            title: translate('folder.new_title', 'New Folder'),
            label: translate('folder.name_label', 'Folder Name:'),
            confirmText: translate('common.create', 'Create')
        });
        if (!name) {
            return;
        }
        try {
            await this.service.createFolder(collection.id, parentFolderId, name);
            await this.loadCollectionsWithExpansionState();
        } catch (error) {
            this._toastFolderError(error);
        }
    }

    /**
     * @param {Object} collection
     * @param {Object} folder
     * @returns {Promise<void>}
     */
    async handleRenameFolder(collection, folder) {
        const name = await this.renameDialog.show(folder.name, {
            title: translate('folder.rename_title', 'Rename Folder'),
            label: translate('folder.name_label', 'Folder Name:'),
            confirmText: translate('common.rename', 'Rename')
        });
        if (!name || name === folder.name) {
            return;
        }
        try {
            await this.service.renameFolder(collection.id, folder.id, name);
            await this.loadCollectionsWithExpansionState();
        } catch (error) {
            this._toastFolderError(error);
        }
    }

    /**
     * @param {Object} collection
     * @param {Object} folder
     * @returns {Promise<void>}
     */
    async handleDeleteFolder(collection, folder) {
        const count = requestsInFolder(collection, folder.id).length;
        const confirmed = await this.confirmDialog.show(
            translate(
                'folder.confirm_delete',
                'Delete the folder "{{name}}" and the {{count}} request(s) in it?\n\nThis cannot be undone.',
                { name: folder.name, count }
            ),
            {
                title: translate('folder.delete_title', 'Delete Folder'),
                confirmText: translate('common.delete', 'Delete'),
                cancelText: translate('common.cancel', 'Cancel'),
                dangerous: true
            }
        );
        if (!confirmed) {
            return;
        }
        try {
            const removed = await this.service.deleteFolder(collection.id, folder.id);
            await this._resetIfCurrentEndpoint(collection.id, removed);
            await this.loadCollectionsWithExpansionState();
        } catch (error) {
            this._toastFolderError(error);
        }
    }

    /**
     * @param {Object} collection
     * @param {Object} endpoint
     * @returns {Promise<void>}
     */
    async handleDuplicateRequest(collection, endpoint) {
        try {
            const baseName = endpoint.name || endpoint.path;
            const copyName = translate('endpoint.copy_name', '{{name}} (copy)', { name: baseName });
            await this.service.duplicateRequest(collection.id, endpoint.id, copyName);
            await this.loadCollectionsWithExpansionState();
        } catch (error) {
            toast.error(translate('endpoint.duplicate_error', 'Could not duplicate the request: {{message}}', { message: error.message }));
        }
    }

    /**
     * @param {Object} collection
     * @param {Object} endpoint
     * @returns {Promise<void>}
     */
    async handleMoveRequest(collection, endpoint) {
        const currentFolderId = folderChainForRequest(collection, endpoint.id).at(-1)?.id ?? null;
        const target = await this.moveRequestDialog.show({
            folders: folderOutline(collection),
            currentFolderId,
            rootLabel: translate('move_request.root', '(Collection root)')
        });
        if (target === undefined || target === currentFolderId) {
            return;
        }
        try {
            await this.service.moveRequestToFolder(collection.id, endpoint.id, target);
            await this.loadCollectionsWithExpansionState();
        } catch (error) {
            toast.error(translate('move_request.error', 'Could not move the request: {{message}}', { message: error.message }));
        }
    }

    /**
     * @param {string} collectionId
     * @param {Array<string>} endpointIds
     * @returns {Promise<void>}
     */
    async _resetIfCurrentEndpoint(collectionId, endpointIds) {
        const current = getCurrentEndpoint();
        if (!current || current.collectionId !== collectionId || !endpointIds.includes(current.endpointId)) {
            return;
        }
        cancelPendingSaves();
        this.formReader.clear();
        setCurrentEndpoint(null);
        await this.repository.clearLastSelectedRequest();
        this.renderer.clearActiveEndpoint();
    }

    /**
     * @param {Object} collection
     * @param {Object[]} endpoints
     * @param {string} name
     * @returns {Promise<void>}
     */
    async handleRunRequests(collection, endpoints, name) {
        const runnable = endpoints.filter(isRunnable);
        if (runnable.length === 0) {
            toast.info(translate('runner.nothing_runnable', 'There are no HTTP or GraphQL requests to run here'));
            return;
        }
        try {
            await app.workspaceTabController?.createRunnerTab({
                name,
                requests: runnable.map(endpoint => ({ collection, endpoint }))
            });
        } catch (error) {
            toast.error(translate('runner.run_error', 'Runner error: {{message}}', { message: error.message }));
        }
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
        } catch {}
    }

    /** @returns {Promise<Object|null>} */
    async describeInheritedAuth() {
        const current = getCurrentEndpoint();
        if (!current?.collectionId) {
            return null;
        }
        return this.service.getInheritedAuthInfo(current.collectionId, current.endpointId);
    }

    /**
     * @param {string} collectionId
     * @param {string|null} [folderId]
     * @returns {Promise<void>}
     */
    async openAuthEditor(collectionId, folderId = null) {
        const collection = await this.repository.getById(collectionId);
        if (!collection) {
            return;
        }
        const folder = folderId
            ? (collection.folders || []).find((entry) => entry.id === folderId)
            : null;
        if (folder) {
            await this.handleFolderAuth(collection, folder);
        } else {
            await this.handleCollectionAuth(collection);
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
     * @param {string|null} [folderId]
     * @returns {Promise<void>}
     */
    async handleNewRequest(collection, folderId = null) {
        try {
            const requestData = await this.showNewRequestDialog();
            if (requestData) {
                await this.service.addRequestToCollection(collection.id, folderId ? { ...requestData, folderId } : requestData);
                await this.loadCollectionsWithExpansionState();
            }
        } catch {}
    }

    /** @returns {Promise<void>} */
    async handleNewCollection() {
        try {
            const collectionOptions = await this.showNewCollectionDialog();
            if (collectionOptions) {
                await this.service.createCollection(collectionOptions);
                await this.loadCollections();
            }
        } catch {}
    }

    /** @returns {Promise<void>} */
    async handleNewRequestInEmptySpace() {
        try {
            const requestData = await this.showNewRequestDialog();
            if (!requestData) {
                return;
            }
            const collectionOptions = await this.showNewCollectionDialog();
            if (!collectionOptions) {
                return;
            }
            const newCollection = await this.service.createCollection(collectionOptions);
            await this.service.addRequestToCollection(newCollection.id, requestData);
            await this.loadCollections();
        } catch {}
    }

    /** @returns {Promise<string|null>} */
    async showNewCollectionDialog() {
        return this.collectionDialogs.showNewCollectionDialog();
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
        const confirmed = await this.confirmDialog.show(
            translate(
                'collection.confirm_close',
                'Remove "{{name}}" from the list?\n\nThe folder and its files stay on disk, and stored credentials are kept. You can open it again later.',
                { name: collection.name }
            ),
            {
                title: translate('collection.close_title', 'Close Collection'),
                confirmText: translate('common.close', 'Close'),
                cancelText: translate('common.cancel', 'Cancel')
            }
        );

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
        await app.workspaceTabController?.closeTabsForCollection(collectionId);
    }

    /**
     * @param {{id: string, path: string}} error
     * @returns {Promise<void>}
     */
    async handleRemoveMissingCollection(error) {
        try {
            await this.service.closeCollection(error.id);
            await this.closeTabsForCollection(error.id);
            await this.loadCollectionsWithExpansionState();
            toast.success(translate('sidebar.load_errors.removed_toast', 'Removed from the list. The folder was not touched.'));
        } catch (err) {
            toast.error(err.message || String(err));
        }
    }

    /**
     * @param {{id: string, path: string}} error
     * @returns {Promise<void>}
     */
    async handleLocateMissingCollection(error) {
        const path = await this.backendAPI.collections.pickDirectory(false).catch(() => null);
        if (!path) {
            return;
        }
        try {
            const collection = await this.service.relocateCollection(error.id, path);
            await this.loadCollectionsWithExpansionState();
            toast.success(translate('sidebar.load_errors.relocated_toast', 'Found "{{name}}" in its new location', {
                name: collection?.name || error.id
            }));
        } catch (err) {
            toast.error(typeof err === 'string' ? err : (err.message || String(err)));
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
    async handleReveal(collection) {
        try {
            await this.service.revealCollection(collection.id);
        } catch (error) {
            toast.error(translate('collection.reveal_failed', 'Could not show the collection folder: {{message}}', { message: error.message }));
        }
    }

    /**
     * @param {Object} collection
     * @returns {Promise<void>}
     */
    async handleDelete(collection) {
        const confirmed = await this.confirmDialog.show(
            translate(
                'collection.confirm_delete',
                'Are you sure you want to delete the collection "{{name}}"?\n\nThis action cannot be undone.',
                { name: collection.name }
            ),
            {
                title: translate('collection.delete_title', 'Delete Collection'),
                confirmText: translate('common.delete', 'Delete'),
                cancelText: translate('common.cancel', 'Cancel'),
                dangerous: true
            }
        );

        if (!confirmed) {
            return;
        }

        try {
            await app.runnerBookkeeping?.forgetCollection(collection.id);
            await this.service.deleteCollection(collection.id);
            await this.variableService.cleanupCollectionVariables(collection.id);
            await this.loadCollections();
            toast.success(`Collection "${collection.name}" deleted`);
        } catch (error) {
            toast.error(`Failed to delete collection: ${error.message}`);
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
            const title = translate('endpoint.rename_title', 'Rename Request');

            const label = translate('endpoint.rename_label', 'Request Name:');

            const confirmText = translate('common.rename', 'Rename');

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

            await app.workspaceTabController?.renameTabsForEndpoint(collection.id, endpoint.id, newName);
        } catch {}
    }

    /**
     * @param {Object} collection
     * @param {Object} endpoint
     * @returns {Promise<void>}
     */
    async handleEditTags(collection, endpoint) {
        try {
            const current = normalizeTags(endpoint.tags);
            const tags = await this.editTagsDialog.show(current, {
                title: translate('endpoint.tags_title', 'Edit Tags'),
                label: translate('endpoint.tags_label', 'Tags (comma-separated):'),
                confirmText: translate('common.save', 'Save')
            });
            if (!tags || tags.join('\u0000') === current.join('\u0000')) {
                return;
            }
            await this.service.setRequestTags(collection.id, endpoint.id, tags);
            await this.loadCollectionsWithExpansionState();
        } catch {}
    }

    /**
     * @param {Object} collection
     * @param {Object} endpoint
     * @returns {Promise<void>}
     */
    async handleDeleteRequest(collection, endpoint) {
        const confirmed = await this.confirmDialog.show(
            translate(
                'endpoint.confirm_delete',
                'Are you sure you want to delete the request "{{name}}"?\n\nThis action cannot be undone.',
                { name: endpoint.name || endpoint.path }
            ),
            {
                title: translate('endpoint.delete_title', 'Delete Request'),
                confirmText: translate('common.delete', 'Delete'),
                cancelText: translate('common.cancel', 'Cancel'),
                dangerous: true
            }
        );

        if (!confirmed) {
            return;
        }

        try {
            await this.service.deleteRequestFromCollection(collection.id, endpoint.id);
            await this._resetIfCurrentEndpoint(collection.id, [endpoint.id]);

            await this.loadCollectionsWithExpansionState();
        } catch {}
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

    /**
     * @param {HTMLElement|null} bodyInput
     * @returns {void}
     */
    initializeBodyTracking(bodyInput) {
        if (!bodyInput) {
            return;
        }
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

    /** @returns {Promise<void>} */
    async flushPendingBodySave() {
        if (this._debouncedSaveBody) {
            await this._debouncedSaveBody.flush();
        }
        await this._inFlightBodySave;
    }

}
