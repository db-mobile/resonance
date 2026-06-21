/**
 * @fileoverview UI component for the Collection Runner panel
 * @module ui/RunnerPanel
 */

import { app } from '../appContext.js';
import { templateLoader } from '../templateLoader.js';
import { RunnerResultsPanel } from './runner/RunnerResultsPanel.js';
import { RequestEditorModal } from './runner/RequestEditorModal.js';
import { CollectionPalette } from './runner/CollectionPalette.js';
import { RequestQueue } from './runner/RequestQueue.js';
import { RunnerSelectorMenu } from './runner/RunnerSelectorMenu.js';

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

        this.palette = new CollectionPalette({
            onAddEndpoint: (collection, endpoint) => this.queue.addRequest(collection, endpoint)
        });
        this.queue = new RequestQueue({
            onChange: () => this._notifyRequestsChange(),
            onCountChange: () => this._updateRequestCount(),
            onEditRequest: (index) => this._openScriptModal(index),
            onResolveEndpointDefaults: (collectionId, endpointId) =>
                this.onResolveEndpointDefaults?.(collectionId, endpointId)
        });

        this.menu = new RunnerSelectorMenu({
            onLoadRunners: () => this.onLoadRunners?.(),
            onSelect: (runnerId) => this.onRunnerSelect?.(runnerId)
        });

        this.resultsView = new RunnerResultsPanel(container);

        this.editorModal = new RequestEditorModal();

        this.onResolveEndpointDefaults = null;

        this.onRequestsChange = null;
        this.onScriptChange = null;
        this.onRunnerSave = null;
        this.onRunnerLoad = null;
        this.onRun = null;
        this.onStop = null;

        this.dom = {};
    }

    /**
     * The id of the currently loaded saved runner (null when unsaved/new).
     * Backed by the selector menu, which uses it to highlight the active entry.
     *
     * @type {string|null}
     */
    get currentRunnerId() {
        return this.menu.currentRunnerId;
    }

    set currentRunnerId(runnerId) {
        this.menu.currentRunnerId = runnerId;
    }

    /**
     * Renders the runner panel
     *
     * @param {Array<Object>} collections - Available collections
     */
    render(collections) {
        try {
            const fragment = templateLoader.cloneSync(
                './src/templates/runner/runnerPanel.html',
                'tpl-runner-tab-content'
            );

            this.container.innerHTML = '';
            this.container.appendChild(fragment);

            this._cacheElements();
            this._attachEventListeners();
            this.menu.mount(this.container);
            this.palette.render(this.dom.collectionTree, collections);
            this.queue.mount(this.dom.requestsList);
        } catch (error) {
            console.error('[RunnerPanel] Error rendering:', error);
        }

        if (app.i18n && app.i18n.updateUI) {
            app.i18n.updateUI();
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
        this.container.querySelector('[data-action="new-runner"]')?.addEventListener('click', () => {
            this.startNewRunner();
        });

        this.container.querySelector('[data-action="save-runner"]')?.addEventListener('click', () => {
            this._handleSave();
        });

        this.container.querySelector('[data-action="delete-runner"]')?.addEventListener('click', () => {
            this._handleDelete();
        });

        this.container.querySelector('[data-action="clear-all"]')?.addEventListener('click', () => {
            this.queue.clearAll();
        });

        this.dom.runButton?.addEventListener('click', () => {
            this._handleRun();
        });

        this.dom.stopButton?.addEventListener('click', () => {
            this._handleStop();
        });
    }

    /**
     * Opens the per-request editor modal (params, headers, body, script) for the
     * request at the given index, persisting edits back onto it on save.
     *
     * @private
     * @param {number} index - Request index
     */
    _openScriptModal(index) {
        const requests = this.queue.getRequests();
        if (index < 0 || index >= requests.length) {
            return;
        }

        const request = requests[index];
        this.editorModal.open(request, {
            onSave: () => {
                if (this.onScriptChange) {
                    this.onScriptChange(index, request.postResponseScript);
                }
                this._notifyRequestsChange();
            }
        });
    }

    /**
     * Updates the request count display from the queue.
     *
     * @private
     */
    _updateRequestCount() {
        if (this.dom.requestCount) {
            const { count } = this.queue;
            this.dom.requestCount.textContent = `${count} request${count !== 1 ? 's' : ''}`;
        }
    }

    /**
     * Handles save button click
     *
     * @private
     */
    _handleSave() {
        const runnerData = this.getRunnerData();

        if (this.onRunnerSave) {
            this.onRunnerSave(runnerData);
        }
    }

    /**
     * Resets the panel for a brand-new (unsaved) runner. Public so the host can
     * invoke it after deleting the active runner.
     */
    startNewRunner() {
        this.currentRunnerId = null;
        this.queue.reset();

        if (this.dom.nameInput) {
            this.dom.nameInput.value = '';
        }

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
            return;
        }

        if (this.onRunnerDelete) {
            this.onRunnerDelete(this.currentRunnerId);
        }
    }

    /**
     * Handles run button click
     *
     * @private
     */
    _handleRun() {
        if (this.queue.count === 0) {
            return;
        }

        this._setRunningState(true);

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
            requests: [...this.queue.getRequests()],
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

        if (this.dom.stopOnErrorCheckbox) {
            this.dom.stopOnErrorCheckbox.checked = runner.options?.stopOnError ?? true;
        }
        if (this.dom.delayInput) {
            this.dom.delayInput.value = runner.options?.delayMs || 0;
        }

        this.queue.setRequests(runner.requests);
    }

    /**
     * Shows execution results and restores the idle (not-running) button state.
     *
     * @param {Object} results - Execution results
     */
    showResults(results) {
        this._setRunningState(false);
        this.resultsView.show(results);
    }

    /**
     * Opens the results panel at the bottom, seeded from the queued requests.
     */
    showResultsPanel() {
        this.resultsView.open(this.queue.getRequests());
    }

    /**
     * Hides the results panel.
     */
    hideResultsPanel() {
        this.resultsView.hide();
    }

    /**
     * Marks a request as running in the results panel.
     *
     * @param {number} index - Request index
     */
    markRequestRunning(index) {
        this.resultsView.markRequestRunning(index);
    }

    /**
     * Updates a request result in the results panel.
     *
     * @param {number} index - Request index
     * @param {Object} result - Result data including body, headers, cookies
     */
    updateResultWithResponse(index, result) {
        this.resultsView.updateResultWithResponse(index, result);
    }

    /**
     * Resets the panel to initial state
     */
    reset() {
        this.queue.reset();

        if (this.dom.nameInput) {
            this.dom.nameInput.value = '';
        }

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
            this.onRequestsChange(this.queue.getRequests());
        }
    }
}
