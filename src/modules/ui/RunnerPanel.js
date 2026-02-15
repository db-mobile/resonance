/**
 * @fileoverview UI component for the Collection Runner panel
 * @module ui/RunnerPanel
 */

import { templateLoader } from '../templateLoader.js';
import { ScriptEditor } from '../scriptEditor.bundle.js';

/**
 * UI component for the Collection Runner panel
 *
 * @class
 * @classdesc Renders and manages the runner panel UI including collection tree,
 * request selection, drag-and-drop reordering, script editing, and results display.
 */
export class RunnerPanel {
    /**
     * Creates a RunnerPanel instance
     *
     * @param {HTMLElement} container - Container element for the panel
     */
    constructor(container) {
        this.container = container;
        this.collections = [];
        this.selectedRequests = [];
        this.selectedRequestIndex = -1;
        this.results = null;
        this.isShowingResults = false;
        this.resultsData = [];
        this.selectedResultIndex = -1;

        // Script modal state
        this.scriptModal = null;
        this.scriptEditor = null;
        this.editingRequestIndex = -1;

        // Event callbacks
        this.onRequestsChange = null;
        this.onScriptChange = null;
        this.onRunnerSave = null;
        this.onRunnerLoad = null;
        this.onRun = null;
        this.onStop = null;

        // DOM references
        this.dom = {};
        this.resultsDom = {};
        this.resultsPanel = null;
        this.resultsResizer = null;

        // Resizer state
        this._isResizingResults = false;
        this._resizeStartY = 0;
        this._resizeStartHeight = 0;
    }

    /**
     * Renders the runner panel
     *
     * @param {Array<Object>} collections - Available collections
     */
    render(collections) {
        this.collections = collections;

        try {
            const fragment = templateLoader.cloneSync(
                './src/templates/runner/runnerPanel.html',
                'tpl-runner-tab-content'
            );

            this.container.innerHTML = '';
            this.container.appendChild(fragment);

            this._cacheElements();
            this._attachEventListeners();
            this._renderCollectionTree();
            this._updateRequestCount();
        } catch (error) {
            console.error('[RunnerPanel] Error rendering:', error);
        }

        if (window.i18n && window.i18n.updateUI) {
            window.i18n.updateUI();
        }
    }

    /**
     * Caches DOM element references
     *
     * @private
     */
    _cacheElements() {
        this.dom = {
            nameInput: this.container.querySelector('[data-role="runner-name"]'),
            runnerSelector: this.container.querySelector('[data-role="runner-selector"]'),
            runnerDropdown: this.container.querySelector('[data-role="runner-dropdown"]'),
            runnerList: this.container.querySelector('[data-role="runner-list"]'),
            collectionTree: this.container.querySelector('[data-role="collection-tree"]'),
            requestsList: this.container.querySelector('[data-role="requests-list"]'),
            requestCount: this.container.querySelector('[data-role="request-count"]'),
            stopOnErrorCheckbox: this.container.querySelector('[data-option="stop-on-error"]'),
            delayInput: this.container.querySelector('[data-option="delay"]'),
            runButton: this.container.querySelector('[data-action="run"]'),
            stopButton: this.container.querySelector('[data-action="stop"]')
        };
    }

    /**
     * Attaches event listeners
     *
     * @private
     */
    _attachEventListeners() {
        // Header actions - Runner selector dropdown
        this.container.querySelector('[data-action="toggle-dropdown"]')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this._toggleDropdown();
        });

        // New runner button
        this.container.querySelector('[data-action="new-runner"]')?.addEventListener('click', () => {
            this._handleNewRunner();
        });

        // Save runner button
        this.container.querySelector('[data-action="save-runner"]')?.addEventListener('click', () => {
            this._handleSave();
        });

        // Delete runner button
        this.container.querySelector('[data-action="delete-runner"]')?.addEventListener('click', () => {
            this._handleDelete();
        });

        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (!this.dom.runnerSelector?.contains(e.target) && !this.dom.runnerDropdown?.contains(e.target)) {
                this._closeDropdown();
            }
        });

        // Clear all button
        this.container.querySelector('[data-action="clear-all"]')?.addEventListener('click', () => {
            this._clearAllRequests();
        });

        // Run/Stop buttons
        this.dom.runButton?.addEventListener('click', () => {
            this._handleRun();
        });

        this.dom.stopButton?.addEventListener('click', () => {
            this._handleStop();
        });
    }

    /**
     * Renders the collection tree in the left panel
     *
     * @private
     */
    _renderCollectionTree() {
        if (!this.dom.collectionTree) {return;}

        if (!this.collections || this.collections.length === 0) {
            this.dom.collectionTree.innerHTML = `
                <div class="runner-empty-state">
                    <span class="icon icon-20 icon-spark"></span>
                    <p>No collections available</p>
                </div>
            `;
            return;
        }

        this.dom.collectionTree.innerHTML = '';

        this.collections.forEach(collection => {
            // Skip collections with no HTTP endpoints
            const endpoints = this._getAllEndpoints(collection);
            if (endpoints.length === 0) {return;}

            const collectionEl = this._createCollectionElement(collection);
            this.dom.collectionTree.appendChild(collectionEl);
        });
    }

    /**
     * Creates a collection element for the tree
     *
     * @private
     * @param {Object} collection - Collection object
     * @returns {HTMLElement} Collection element
     */
    _createCollectionElement(collection) {
        const fragment = templateLoader.cloneSync(
            './src/templates/runner/runnerPanel.html',
            'tpl-runner-collection-item'
        );

        const el = fragment.firstElementChild;
        el.dataset.collectionId = collection.id;

        const nameEl = el.querySelector('[data-role="collection-name"]');
        if (nameEl) {nameEl.textContent = collection.name;}

        const headerEl = el.querySelector('[data-role="collection-header"]');
        const endpointsContainer = el.querySelector('[data-role="endpoints-container"]');

        // Toggle expansion
        headerEl?.addEventListener('click', () => {
            el.classList.toggle('is-expanded');
            endpointsContainer?.classList.toggle('is-hidden');
        });

        // Render endpoints
        if (endpointsContainer) {
            const endpoints = this._getAllEndpoints(collection);
            endpoints.forEach(endpoint => {
                const endpointEl = this._createEndpointElement(collection, endpoint);
                endpointsContainer.appendChild(endpointEl);
            });
        }

        return el;
    }

    /**
     * Gets all HTTP endpoints from a collection (including folders), excluding gRPC
     *
     * @private
     * @param {Object} collection - Collection object
     * @returns {Array<Object>} Array of HTTP endpoints
     */
    _getAllEndpoints(collection) {
        const endpoints = [];

        if (collection.endpoints) {
            endpoints.push(...collection.endpoints.filter(e => e.protocol !== 'grpc'));
        }

        if (collection.folders) {
            collection.folders.forEach(folder => {
                if (folder.endpoints) {
                    endpoints.push(...folder.endpoints.filter(e => e.protocol !== 'grpc'));
                }
            });
        }

        return endpoints;
    }

    /**
     * Creates an endpoint element for the tree
     *
     * @private
     * @param {Object} collection - Parent collection
     * @param {Object} endpoint - Endpoint object
     * @returns {HTMLElement} Endpoint element
     */
    _createEndpointElement(collection, endpoint) {
        const fragment = templateLoader.cloneSync(
            './src/templates/runner/runnerPanel.html',
            'tpl-runner-endpoint-item'
        );

        const el = fragment.firstElementChild;
        el.dataset.collectionId = collection.id;
        el.dataset.endpointId = endpoint.id;

        const methodEl = el.querySelector('[data-role="method"]');
        if (methodEl) {
            methodEl.textContent = endpoint.method;
            methodEl.dataset.method = endpoint.method;
        }

        const nameEl = el.querySelector('[data-role="name"]');
        if (nameEl) {
            nameEl.textContent = endpoint.name || endpoint.path;
        }

        // Add button click
        const addBtn = el.querySelector('[data-action="add"]');
        addBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            this._addRequest(collection, endpoint);
        });

        // Click on item also adds
        el.addEventListener('click', () => {
            this._addRequest(collection, endpoint);
        });

        return el;
    }

    /**
     * Adds a request to the selected list
     *
     * @private
     * @param {Object} collection - Collection object
     * @param {Object} endpoint - Endpoint object
     */
    _addRequest(collection, endpoint) {
        const request = {
            collectionId: collection.id,
            endpointId: endpoint.id,
            name: endpoint.name || endpoint.path,
            method: endpoint.method,
            path: endpoint.path,
            postResponseScript: ''
        };

        this.selectedRequests.push(request);
        this._renderRequestsList();
        this._updateRequestCount();
        this._notifyRequestsChange();
    }

    /**
     * Renders the selected requests list
     *
     * @private
     */
    _renderRequestsList() {
        if (!this.dom.requestsList) {return;}

        if (this.selectedRequests.length === 0) {
            this.dom.requestsList.innerHTML = `
                <div class="runner-empty-state">
                    <span class="icon icon-20 icon-plus"></span>
                    <p>Click requests from the left panel to add them</p>
                </div>
            `;
            return;
        }

        this.dom.requestsList.innerHTML = '';

        this.selectedRequests.forEach((request, index) => {
            const el = this._createRequestItem(request, index);
            this.dom.requestsList.appendChild(el);
        });

        this._setupDragAndDrop();
    }

    /**
     * Creates a request item element
     *
     * @private
     * @param {Object} request - Request object
     * @param {number} index - Request index
     * @returns {HTMLElement} Request item element
     */
    _createRequestItem(request, index) {
        const fragment = templateLoader.cloneSync(
            './src/templates/runner/runnerPanel.html',
            'tpl-runner-request-item'
        );

        const el = fragment.firstElementChild;
        el.dataset.index = index;

        if (index === this.selectedRequestIndex) {
            el.classList.add('is-selected');
        }

        const methodEl = el.querySelector('[data-role="method"]');
        if (methodEl) {
            methodEl.textContent = request.method;
            methodEl.dataset.method = request.method;
        }

        const nameEl = el.querySelector('[data-role="name"]');
        if (nameEl) {
            nameEl.textContent = request.name;
        }

        // Edit script button
        el.querySelector('[data-action="edit-script"]')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this._selectRequest(index);
        });

        // Remove button
        el.querySelector('[data-action="remove"]')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this._removeRequest(index);
        });

        // Click to select
        el.addEventListener('click', () => {
            this._selectRequest(index);
        });

        return el;
    }

    /**
     * Sets up drag and drop for request reordering
     *
     * @private
     */
    _setupDragAndDrop() {
        const items = this.dom.requestsList.querySelectorAll('.runner-request-item');

        items.forEach(item => {
            item.addEventListener('dragstart', (e) => {
                item.classList.add('is-dragging');
                e.dataTransfer.setData('text/plain', item.dataset.index);
            });

            item.addEventListener('dragend', () => {
                item.classList.remove('is-dragging');
            });

            item.addEventListener('dragover', (e) => {
                e.preventDefault();
                const dragging = this.dom.requestsList.querySelector('.is-dragging');
                if (dragging && dragging !== item) {
                    const rect = item.getBoundingClientRect();
                    const midY = rect.top + rect.height / 2;
                    if (e.clientY < midY) {
                        item.parentNode.insertBefore(dragging, item);
                    } else {
                        item.parentNode.insertBefore(dragging, item.nextSibling);
                    }
                }
            });

            item.addEventListener('drop', (e) => {
                e.preventDefault();
                this._reorderFromDOM();
            });
        });
    }

    /**
     * Reorders requests based on current DOM order
     *
     * @private
     */
    _reorderFromDOM() {
        const items = this.dom.requestsList.querySelectorAll('.runner-request-item');
        const newOrder = [];

        items.forEach(item => {
            const index = parseInt(item.dataset.index, 10);
            newOrder.push(this.selectedRequests[index]);
        });

        this.selectedRequests = newOrder;
        this._renderRequestsList();
        this._notifyRequestsChange();
    }

    /**
     * Selects a request for script editing (opens modal)
     *
     * @private
     * @param {number} index - Request index
     */
    _selectRequest(index) {
        this.selectedRequestIndex = index;
        this._renderRequestsList();
        this._openScriptModal(index);
    }

    /**
     * Opens the script editor modal for a request
     *
     * @private
     * @param {number} index - Request index
     */
    _openScriptModal(index) {
        if (index < 0 || index >= this.selectedRequests.length) {
            return;
        }

        const request = this.selectedRequests[index];
        this.editingRequestIndex = index;

        // Create modal from template
        const fragment = templateLoader.cloneSync(
            './src/templates/runner/runnerPanel.html',
            'tpl-runner-script-modal'
        );

        this.scriptModal = fragment.firstElementChild;
        document.body.appendChild(this.scriptModal);

        // Set request info
        const methodEl = this.scriptModal.querySelector('[data-role="script-method"]');
        const pathEl = this.scriptModal.querySelector('[data-role="script-path"]');
        if (methodEl) {
            methodEl.textContent = request.method;
            methodEl.dataset.method = request.method;
        }
        if (pathEl) {
            pathEl.textContent = request.path;
        }

        // Initialize ScriptEditor (CodeMirror-based)
        const editorContainer = this.scriptModal.querySelector('[data-role="script-editor-container"]');
        if (editorContainer) {
            this.scriptEditor = new ScriptEditor(editorContainer);
            this.scriptEditor.setContent(request.postResponseScript || '');
        }

        // Attach modal event listeners
        this._attachModalEventListeners();

        // Focus editor
        setTimeout(() => {
            this.scriptEditor?.focus();
        }, 100);

        // Update i18n if available
        if (window.i18n && window.i18n.updateUI) {
            window.i18n.updateUI();
        }
    }

    /**
     * Attaches event listeners to the script modal
     *
     * @private
     */
    _attachModalEventListeners() {
        if (!this.scriptModal) {return;}

        // Close button
        this.scriptModal.querySelector('[data-action="close"]')?.addEventListener('click', () => {
            this._closeScriptModal(false);
        });

        // Cancel button
        this.scriptModal.querySelector('[data-action="cancel"]')?.addEventListener('click', () => {
            this._closeScriptModal(false);
        });

        // Save button
        this.scriptModal.querySelector('[data-action="save"]')?.addEventListener('click', () => {
            this._closeScriptModal(true);
        });

        // Close on overlay click
        this.scriptModal.querySelector('[data-role="script-modal-overlay"]')?.addEventListener('click', (e) => {
            if (e.target === e.currentTarget) {
                this._closeScriptModal(false);
            }
        });

        // Close on Escape key
        this._modalKeyHandler = (e) => {
            if (e.key === 'Escape') {
                this._closeScriptModal(false);
            } else if (e.key === 's' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                this._closeScriptModal(true);
            }
        };
        document.addEventListener('keydown', this._modalKeyHandler);
    }

    /**
     * Closes the script editor modal
     *
     * @private
     * @param {boolean} save - Whether to save the script content
     */
    _closeScriptModal(save) {
        if (save && this.scriptEditor && this.editingRequestIndex >= 0) {
            const script = this.scriptEditor.getContent();
            this.selectedRequests[this.editingRequestIndex].postResponseScript = script;

            if (this.onScriptChange) {
                this.onScriptChange(this.editingRequestIndex, script);
            }
        }

        // Cleanup
        if (this._modalKeyHandler) {
            document.removeEventListener('keydown', this._modalKeyHandler);
            this._modalKeyHandler = null;
        }

        if (this.scriptEditor) {
            this.scriptEditor.destroy();
            this.scriptEditor = null;
        }

        if (this.scriptModal) {
            this.scriptModal.remove();
            this.scriptModal = null;
        }

        this.editingRequestIndex = -1;
    }

    /**
     * Shows the script editor for the selected request (no-op, kept for compatibility)
     *
     * @private
     */
    _showScriptEditor() {
        // No-op - script editing is now done via modal
    }

    /**
     * Removes a request from the list
     *
     * @private
     * @param {number} index - Request index
     */
    _removeRequest(index) {
        this.selectedRequests.splice(index, 1);

        if (this.selectedRequestIndex === index) {
            this.selectedRequestIndex = -1;
            this._showScriptEditor();
        } else if (this.selectedRequestIndex > index) {
            this.selectedRequestIndex--;
        }

        this._renderRequestsList();
        this._updateRequestCount();
        this._notifyRequestsChange();
    }

    /**
     * Clears all selected requests
     *
     * @private
     */
    _clearAllRequests() {
        this.selectedRequests = [];
        this.selectedRequestIndex = -1;
        this._renderRequestsList();
        this._updateRequestCount();
        this._showScriptEditor();
        this._notifyRequestsChange();
    }

    /**
     * Updates the request count display
     *
     * @private
     */
    _updateRequestCount() {
        if (this.dom.requestCount) {
            const count = this.selectedRequests.length;
            this.dom.requestCount.textContent = `${count} request${count !== 1 ? 's' : ''}`;
        }
    }

    /**
     * Handles script change (no-op, kept for compatibility)
     *
     * @private
     */
    _handleScriptChange() {
        // No-op - script changes are now handled by the modal save action
    }

    /**
     * Handles save button click
     *
     * @private
     */
    _handleSave() {
        // Save current script first
        this._handleScriptChange();

        const runnerData = this.getRunnerData();

        if (this.onRunnerSave) {
            this.onRunnerSave(runnerData);
        }
    }

    /**
     * Toggles the runner dropdown
     *
     * @private
     */
    _toggleDropdown() {
        if (this.dom.runnerDropdown?.classList.contains('is-hidden')) {
            this._openDropdown();
        } else {
            this._closeDropdown();
        }
    }

    /**
     * Opens the runner dropdown and populates it
     *
     * @private
     */
    async _openDropdown() {
        if (!this.dom.runnerDropdown || !this.dom.runnerList) {return;}

        // Fetch saved runners
        if (this.onLoadRunners) {
            const runners = await this.onLoadRunners();
            this._renderDropdownList(runners || []);
        }

        this.dom.runnerDropdown.classList.remove('is-hidden');
    }

    /**
     * Closes the runner dropdown
     *
     * @private
     */
    _closeDropdown() {
        this.dom.runnerDropdown?.classList.add('is-hidden');
    }

    /**
     * Renders the dropdown list with saved runners
     *
     * @private
     * @param {Array} runners - List of saved runners
     */
    _renderDropdownList(runners) {
        if (!this.dom.runnerList) {return;}

        if (!runners || runners.length === 0) {
            this.dom.runnerList.innerHTML = '<div class="runner-dropdown-empty">No saved runners</div>';
            return;
        }

        this.dom.runnerList.innerHTML = runners.map(runner => {
            const requestCount = runner.requests?.length || 0;
            const isSelected = this.currentRunnerId === runner.id;
            return `
                <div class="runner-dropdown-item ${isSelected ? 'is-selected' : ''}" data-runner-id="${runner.id}">
                    <span class="runner-dropdown-item-name">${this._escapeHtml(runner.name)}</span>
                    <span class="runner-dropdown-item-meta">${requestCount} requests</span>
                </div>
            `;
        }).join('');

        // Add click handlers
        this.dom.runnerList.querySelectorAll('.runner-dropdown-item').forEach(item => {
            item.addEventListener('click', () => {
                const {runnerId} = item.dataset;
                this._selectRunner(runnerId);
                this._closeDropdown();
            });
        });
    }

    /**
     * Selects a runner from the dropdown
     *
     * @private
     * @param {string} runnerId - Runner ID to select
     */
    _selectRunner(runnerId) {
        this.currentRunnerId = runnerId;
        if (this.onRunnerSelect) {
            this.onRunnerSelect(runnerId);
        }
    }

    /**
     * Handles new runner button click
     *
     * @private
     */
    _handleNewRunner() {
        this.currentRunnerId = null;
        this.selectedRequests = [];
        this.selectedRequestIndex = -1;
        
        if (this.dom.nameInput) {
            this.dom.nameInput.value = '';
        }
        
        this._renderRequestsList();
        this._updateRequestCount();
        this._showScriptEditor();

        if (this.onNewRunner) {
            this.onNewRunner();
        }
    }

    /**
     * Handles delete runner button click
     *
     * @private
     */
    _handleDelete() {
        if (!this.currentRunnerId) {
            // No saved runner to delete
            return;
        }

        if (this.onRunnerDelete) {
            this.onRunnerDelete(this.currentRunnerId);
        }
    }

    /**
     * Escapes HTML special characters
     *
     * @private
     * @param {string} str - String to escape
     * @returns {string} Escaped string
     */
    _escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str || '';
        return div.innerHTML;
    }

    /**
     * Handles run button click
     *
     * @private
     */
    _handleRun() {
        // Save current script first
        this._handleScriptChange();

        if (this.selectedRequests.length === 0) {
            return;
        }

        this._setRunningState(true);

        // Show results panel at bottom
        this.showResultsPanel();

        if (this.onRun) {
            this.onRun(this.getRunnerData());
        }
    }

    /**
     * Handles stop button click
     *
     * @private
     */
    _handleStop() {
        if (this.onStop) {
            this.onStop();
        }
    }

    /**
     * Sets the running state UI
     *
     * @param {boolean} isRunning - Whether runner is executing
     */
    _setRunningState(isRunning) {
        if (isRunning) {
            this.dom.runButton?.classList.add('is-hidden');
            this.dom.stopButton?.classList.remove('is-hidden');
        } else {
            this.dom.runButton?.classList.remove('is-hidden');
            this.dom.stopButton?.classList.add('is-hidden');
        }
    }

    /**
     * Gets the current runner configuration
     *
     * @returns {Object} Runner data
     */
    getRunnerData() {
        return {
            name: this.dom.nameInput?.value || 'Untitled Runner',
            requests: [...this.selectedRequests],
            options: {
                stopOnError: this.dom.stopOnErrorCheckbox?.checked ?? true,
                delayMs: parseInt(this.dom.delayInput?.value, 10) || 0
            }
        };
    }

    /**
     * Loads runner data into the panel
     *
     * @param {Object} runner - Runner object
     */
    loadRunner(runner) {
        if (this.dom.nameInput) {
            this.dom.nameInput.value = runner.name || 'Untitled Runner';
        }

        this.selectedRequests = runner.requests ? [...runner.requests] : [];
        this.selectedRequestIndex = -1;

        if (this.dom.stopOnErrorCheckbox) {
            this.dom.stopOnErrorCheckbox.checked = runner.options?.stopOnError ?? true;
        }
        if (this.dom.delayInput) {
            this.dom.delayInput.value = runner.options?.delayMs || 0;
        }

        this._renderRequestsList();
        this._updateRequestCount();
        this._showScriptEditor();
    }


    /**
     * Gets the CSS class for a status code
     *
     * @private
     * @param {number} statusCode - HTTP status code
     * @returns {string} CSS class suffix
     */
    _getStatusCodeClass(statusCode) {
        if (statusCode >= 200 && statusCode < 300) {return 'success';}
        if (statusCode >= 300 && statusCode < 400) {return 'redirect';}
        if (statusCode >= 400 && statusCode < 500) {return 'client-error';}
        if (statusCode >= 500) {return 'server-error';}
        return 'unknown';
    }

    /**
     * Shows execution results
     *
     * @param {Object} results - Execution results
     */
    showResults(results) {
        this.results = results;
        this.isShowingResults = true;
        this._setRunningState(false);

        // Store results data for detail view
        if (results.requests) {
            this.resultsData = results.requests;
            results.requests.forEach((result, index) => {
                this._updateResultItem(index, result);
            });
        }

        // Update summary
        this._updateResultsSummary(results);

    }

    /**
     * Shows the results panel at the bottom
     */
    showResultsPanel() {
        // If panel already exists, clear it for a new run
        if (this.resultsPanel) {
            this._clearResultsPanel();
            this._initializeResultsList();
            return;
        }

        const fragment = templateLoader.cloneSync(
            './src/templates/runner/runnerPanel.html',
            'tpl-runner-results-panel'
        );

        const runnerPanel = this.container.querySelector('.runner-panel');
        if (!runnerPanel) {return;}

        // Append all children from fragment (resizer + container)
        this.resultsResizer = fragment.querySelector('.runner-results-resizer');
        this.resultsPanel = fragment.querySelector('.runner-results-container');

        if (this.resultsResizer) {runnerPanel.appendChild(this.resultsResizer);}
        if (this.resultsPanel) {runnerPanel.appendChild(this.resultsPanel);}

        this._cacheResultsElements();
        this._attachResultsEventListeners();
        this._attachResultsResizerListeners();
        this._initializeResultsList();

        if (window.i18n && window.i18n.updateUI) {
            window.i18n.updateUI();
        }
    }

    /**
     * Clears the results panel for a new run
     *
     * @private
     */
    _clearResultsPanel() {
        // Reset data
        this.resultsData = [];
        this.selectedResultIndex = -1;

        // Clear summary
        if (this.resultsDom.passed) {this.resultsDom.passed.textContent = '0 passed';}
        if (this.resultsDom.failed) {this.resultsDom.failed.textContent = '0 failed';}
        if (this.resultsDom.totalTime) {this.resultsDom.totalTime.textContent = '';}

        // Clear results list
        if (this.resultsDom.resultsList) {
            this.resultsDom.resultsList.innerHTML = '';
        }

        // Clear detail panel
        if (this.resultsDom.detailMethod) {this.resultsDom.detailMethod.textContent = '';}
        if (this.resultsDom.detailName) {this.resultsDom.detailName.textContent = '';}
        if (this.resultsDom.detailStatus) {
            this.resultsDom.detailStatus.textContent = '';
            this.resultsDom.detailStatus.className = 'runner-results-detail-status';
        }
        if (this.resultsDom.detailTime) {this.resultsDom.detailTime.textContent = '';}
        if (this.resultsDom.bodyContent) {this.resultsDom.bodyContent.textContent = '';}
        if (this.resultsDom.headersBody) {this.resultsDom.headersBody.innerHTML = '';}
        if (this.resultsDom.cookiesBody) {this.resultsDom.cookiesBody.innerHTML = '';}

        // Hide detail panel until a result is selected
        if (this.resultsDom.detailPanel) {
            this.resultsDom.detailPanel.classList.add('is-hidden');
        }
    }

    /**
     * Hides the results panel
     */
    hideResultsPanel() {
        if (this.resultsResizer) {
            this.resultsResizer.remove();
            this.resultsResizer = null;
        }
        if (this.resultsPanel) {
            this.resultsPanel.remove();
            this.resultsPanel = null;
            this.resultsDom = {};
            this.resultsData = [];
            this.selectedResultIndex = -1;
        }
    }

    /**
     * Caches DOM references for results panel
     *
     * @private
     */
    _cacheResultsElements() {
        if (!this.resultsPanel) {return;}

        this.resultsDom = {
            container: this.resultsPanel,
            summary: this.resultsPanel.querySelector('[data-role="summary"]'),
            passed: this.resultsPanel.querySelector('[data-role="passed"]'),
            failed: this.resultsPanel.querySelector('[data-role="failed"]'),
            totalTime: this.resultsPanel.querySelector('[data-role="total-time"]'),
            resultsList: this.resultsPanel.querySelector('[data-role="results-list"]'),
            detailPanel: this.resultsPanel.querySelector('[data-role="detail-panel"]'),
            detailMethod: this.resultsPanel.querySelector('[data-role="detail-method"]'),
            detailName: this.resultsPanel.querySelector('[data-role="detail-name"]'),
            detailStatus: this.resultsPanel.querySelector('[data-role="detail-status"]'),
            detailTime: this.resultsPanel.querySelector('[data-role="detail-time"]'),
            bodyContent: this.resultsPanel.querySelector('[data-role="body-content"]'),
            headersBody: this.resultsPanel.querySelector('[data-role="headers-body"]'),
            cookiesBody: this.resultsPanel.querySelector('[data-role="cookies-body"]'),
            noCookies: this.resultsPanel.querySelector('[data-role="no-cookies"]')
        };
    }

    /**
     * Attaches event listeners for results panel
     *
     * @private
     */
    _attachResultsEventListeners() {
        if (!this.resultsPanel) {return;}

        // Tab switching
        this.resultsPanel.querySelectorAll('.runner-results-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                this._switchResultsTab(tab.dataset.tab);
            });
        });
    }

    /**
     * Attaches event listeners for results panel resizer
     *
     * @private
     */
    _attachResultsResizerListeners() {
        if (!this.resultsResizer || !this.resultsPanel) {return;}

        const runnerMain = this.container.querySelector('.runner-main');
        if (!runnerMain) {return;}

        this.resultsResizer.addEventListener('mousedown', (e) => {
            this._isResizingResults = true;
            this._resizeStartY = e.clientY;
            this._resizeStartHeight = this.resultsPanel.offsetHeight;
            this._resizeStartMainHeight = runnerMain.offsetHeight;

            this.resultsResizer.classList.add('is-dragging');
            document.body.style.userSelect = 'none';
            document.body.style.cursor = 'row-resize';

            e.preventDefault();
        });

        document.addEventListener('mousemove', (e) => {
            if (!this._isResizingResults) {return;}

            const deltaY = this._resizeStartY - e.clientY;
            const newResultsHeight = this._resizeStartHeight + deltaY;
            const newMainHeight = this._resizeStartMainHeight - deltaY;

            // Enforce min/max constraints
            const minResultsHeight = 150;
            const maxResultsHeight = window.innerHeight * 0.7;
            const minMainHeight = 200;

            if (newResultsHeight < minResultsHeight || newResultsHeight > maxResultsHeight) {return;}
            if (newMainHeight < minMainHeight) {return;}

            this.resultsPanel.style.height = `${newResultsHeight}px`;
            runnerMain.style.flex = `0 0 ${newMainHeight}px`;

            e.preventDefault();
        });

        document.addEventListener('mouseup', () => {
            if (!this._isResizingResults) {return;}

            this._isResizingResults = false;
            this.resultsResizer?.classList.remove('is-dragging');
            document.body.style.userSelect = '';
            document.body.style.cursor = '';
        });
    }

    /**
     * Initializes the results list with pending items
     *
     * @private
     */
    _initializeResultsList() {
        if (!this.resultsDom.resultsList) {return;}

        this.resultsDom.resultsList.innerHTML = '';
        this.resultsData = [];

        this.selectedRequests.forEach((request, index) => {
            const resultData = {
                index,
                method: request.method,
                name: request.name,
                status: 'pending',
                statusCode: null,
                time: null,
                body: null,
                headers: null,
                cookies: null
            };
            this.resultsData.push(resultData);

            const el = this._createResultItemElement(resultData, index);
            this.resultsDom.resultsList.appendChild(el);
        });
    }

    /**
     * Creates a result item element
     *
     * @private
     * @param {Object} result - Result data
     * @param {number} index - Result index
     * @returns {HTMLElement} Result item element
     */
    _createResultItemElement(result, index) {
        const fragment = templateLoader.cloneSync(
            './src/templates/runner/runnerPanel.html',
            'tpl-runner-result-item'
        );

        const el = fragment.firstElementChild;
        el.dataset.index = index;

        const methodEl = el.querySelector('[data-role="method"]');
        if (methodEl) {
            methodEl.textContent = result.method;
            methodEl.dataset.method = result.method;
        }

        const nameEl = el.querySelector('[data-role="name"]');
        if (nameEl) {
            nameEl.textContent = result.name;
        }

        const statusIcon = el.querySelector('[data-role="status-icon"]');
        if (statusIcon) {
            statusIcon.classList.add('is-pending');
        }

        const statusCodeEl = el.querySelector('[data-role="status-code"]');
        if (statusCodeEl) {
            statusCodeEl.style.display = 'none';
        }

        const timeEl = el.querySelector('[data-role="time"]');
        if (timeEl) {
            timeEl.style.display = 'none';
        }

        // Click to view details
        el.addEventListener('click', () => {
            this._selectResultItem(index);
        });

        return el;
    }

    /**
     * Updates a result item in the results panel
     *
     * @private
     * @param {number} index - Result index
     * @param {Object} result - Result data
     */
    _updateResultItem(index, result) {
        if (!this.resultsDom.resultsList) {return;}

        const el = this.resultsDom.resultsList.querySelector(`[data-index="${index}"]`);
        if (!el) {return;}

        // Update stored data
        if (this.resultsData[index]) {
            Object.assign(this.resultsData[index], result);
        }

        // Update status icon
        const statusIcon = el.querySelector('[data-role="status-icon"]');
        if (statusIcon) {
            statusIcon.classList.remove('is-pending', 'is-running', 'is-success', 'is-error');
            if (result.status === 'success') {
                statusIcon.classList.add('is-success');
            } else if (result.status === 'error') {
                statusIcon.classList.add('is-error');
            } else if (result.status === 'running') {
                statusIcon.classList.add('is-running');
            } else {
                statusIcon.classList.add('is-pending');
            }
        }

        // Update status code
        const statusCodeEl = el.querySelector('[data-role="status-code"]');
        if (statusCodeEl && result.statusCode != null) {
            statusCodeEl.textContent = result.statusCode;
            statusCodeEl.style.display = '';
            statusCodeEl.dataset.statusClass = this._getStatusCodeClass(result.statusCode);
        }

        // Update time
        const timeEl = el.querySelector('[data-role="time"]');
        if (timeEl && result.time != null) {
            timeEl.textContent = `${result.time}ms`;
            timeEl.style.display = '';
        }
    }

    /**
     * Selects a result item and shows its details
     *
     * @private
     * @param {number} index - Result index
     */
    _selectResultItem(index) {
        if (index < 0 || index >= this.resultsData.length) {return;}

        this.selectedResultIndex = index;

        // Update selection state
        this.resultsDom.resultsList?.querySelectorAll('.runner-result-item').forEach((el, i) => {
            el.classList.toggle('is-selected', i === index);
        });

        // Show detail panel
        this.resultsDom.detailPanel?.classList.remove('is-hidden');

        // Populate detail view
        this._populateResultDetail(this.resultsData[index]);
    }

    /**
     * Populates the result detail panel
     *
     * @private
     * @param {Object} result - Result data
     */
    _populateResultDetail(result) {
        if (!result) {return;}

        // Update header info
        if (this.resultsDom.detailMethod) {
            this.resultsDom.detailMethod.textContent = result.method;
            this.resultsDom.detailMethod.dataset.method = result.method;
        }

        if (this.resultsDom.detailName) {
            this.resultsDom.detailName.textContent = result.name;
        }

        if (this.resultsDom.detailStatus) {
            const statusText = result.statusCode ? `${result.statusCode} ${this._getStatusText(result.statusCode)}` : 'Pending';
            this.resultsDom.detailStatus.textContent = statusText;
            this.resultsDom.detailStatus.classList.remove('is-success', 'is-error');
            if (result.status === 'success') {
                this.resultsDom.detailStatus.classList.add('is-success');
            } else if (result.status === 'error') {
                this.resultsDom.detailStatus.classList.add('is-error');
            }
        }

        if (this.resultsDom.detailTime) {
            this.resultsDom.detailTime.textContent = result.time != null ? `${result.time}ms` : '';
        }

        // Populate body
        if (this.resultsDom.bodyContent) {
            let bodyText = '';
            if (result.body != null) {
                if (typeof result.body === 'object') {
                    try {
                        bodyText = JSON.stringify(result.body, null, 2);
                    } catch {
                        bodyText = String(result.body);
                    }
                } else {
                    bodyText = String(result.body);
                }
            }
            this.resultsDom.bodyContent.textContent = bodyText || '(No response body)';
        }

        // Populate headers
        if (this.resultsDom.headersBody) {
            this.resultsDom.headersBody.innerHTML = '';
            const headers = result.headers || {};
            const headerEntries = Object.entries(headers);

            if (headerEntries.length > 0) {
                headerEntries.forEach(([name, value]) => {
                    const row = document.createElement('tr');
                    row.innerHTML = `<td>${this._escapeHtml(name)}</td><td>${this._escapeHtml(String(value))}</td>`;
                    this.resultsDom.headersBody.appendChild(row);
                });
            } else {
                const row = document.createElement('tr');
                row.innerHTML = '<td colspan="2" style="text-align: center; color: var(--text-tertiary);">No headers</td>';
                this.resultsDom.headersBody.appendChild(row);
            }
        }

        // Populate cookies
        if (this.resultsDom.cookiesBody && this.resultsDom.noCookies) {
            this.resultsDom.cookiesBody.innerHTML = '';
            const cookies = result.cookies || [];

            if (cookies.length > 0) {
                this.resultsDom.noCookies.classList.add('is-hidden');
                cookies.forEach(cookie => {
                    const row = document.createElement('tr');
                    row.innerHTML = `
                        <td>${this._escapeHtml(cookie.name || '')}</td>
                        <td>${this._escapeHtml(cookie.value || '')}</td>
                        <td>${this._escapeHtml(cookie.domain || '')}</td>
                        <td>${this._escapeHtml(cookie.path || '/')}</td>
                    `;
                    this.resultsDom.cookiesBody.appendChild(row);
                });
            } else {
                this.resultsDom.noCookies.classList.remove('is-hidden');
            }
        }
    }

    /**
     * Switches the active tab in the results detail panel
     *
     * @private
     * @param {string} tabName - Tab name (body, headers, cookies)
     */
    _switchResultsTab(tabName) {
        if (!this.resultsPanel) {return;}

        // Update tab buttons
        this.resultsPanel.querySelectorAll('.runner-results-tab').forEach(tab => {
            tab.classList.toggle('is-active', tab.dataset.tab === tabName);
        });

        // Update tab content
        this.resultsPanel.querySelectorAll('.runner-results-tab-content').forEach(content => {
            content.classList.toggle('is-active', content.dataset.content === tabName);
        });
    }

    /**
     * Updates the results summary
     *
     * @private
     * @param {Object} results - Results object
     */
    _updateResultsSummary(results) {
        if (this.resultsDom.passed) {
            this.resultsDom.passed.textContent = `${results.passed || 0} passed`;
        }
        if (this.resultsDom.failed) {
            this.resultsDom.failed.textContent = `${results.failed || 0} failed`;
        }
        if (this.resultsDom.totalTime) {
            this.resultsDom.totalTime.textContent = `${results.totalTime || 0}ms`;
        }
    }

    /**
     * Gets HTTP status text for a status code
     *
     * @private
     * @param {number} statusCode - HTTP status code
     * @returns {string} Status text
     */
    _getStatusText(statusCode) {
        const statusTexts = {
            200: 'OK',
            201: 'Created',
            204: 'No Content',
            301: 'Moved Permanently',
            302: 'Found',
            304: 'Not Modified',
            400: 'Bad Request',
            401: 'Unauthorized',
            403: 'Forbidden',
            404: 'Not Found',
            405: 'Method Not Allowed',
            422: 'Unprocessable Entity',
            429: 'Too Many Requests',
            500: 'Internal Server Error',
            502: 'Bad Gateway',
            503: 'Service Unavailable',
            504: 'Gateway Timeout'
        };
        return statusTexts[statusCode] || '';
    }

    /**
     * Marks a request as running in the results panel
     *
     * @param {number} index - Request index
     */
    markRequestRunning(index) {
        this._updateResultItem(index, { status: 'running' });
    }

    /**
     * Updates a request result in the results panel
     *
     * @param {number} index - Request index
     * @param {Object} result - Result data including body, headers, cookies
     */
    updateResultWithResponse(index, result) {
        if (this.resultsData[index]) {
            Object.assign(this.resultsData[index], result);
        }
        this._updateResultItem(index, result);

        // If this result is currently selected, refresh the detail view
        if (this.selectedResultIndex === index) {
            this._populateResultDetail(this.resultsData[index]);
        }
    }

    /**
     * Resets the panel to initial state
     */
    reset() {
        this.selectedRequests = [];
        this.selectedRequestIndex = -1;
        this.results = null;
        this.isShowingResults = false;

        if (this.dom.nameInput) {
            this.dom.nameInput.value = '';
        }

        this._renderRequestsList();
        this._updateRequestCount();
        this._showScriptEditor();
        this._setRunningState(false);
        this.hideResultsPanel();
    }

    /**
     * Notifies about requests change
     *
     * @private
     */
    _notifyRequestsChange() {
        if (this.onRequestsChange) {
            this.onRequestsChange(this.selectedRequests);
        }
    }
}
