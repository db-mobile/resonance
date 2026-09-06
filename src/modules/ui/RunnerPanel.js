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

export class RunnerPanel {
    /** @param {HTMLElement} container */
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

    /** @type {string|null} */
    get currentRunnerId() {
        return this.menu.currentRunnerId;
    }

    set currentRunnerId(runnerId) {
        this.menu.currentRunnerId = runnerId;
    }

    /** @param {Array<Object>} collections */
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

        this._attachMainResizer();
    }

    _attachMainResizer() {
        const resizer = this.container.querySelector('[data-role="main-resizer"]');
        const main = this.container.querySelector('.runner-main');
        const selected = this.container.querySelector('.runner-requests-panel');
        if (!resizer || !main || !selected) {return;}

        const minWidth = 160;
        const maxWidth = 820;

        const onMouseDown = (e) => {
            e.preventDefault();
            resizer.classList.add('dragging');
            document.body.style.userSelect = 'none';
            document.body.style.cursor = 'col-resize';

            const onMove = (moveEvent) => {
                const mainRect = main.getBoundingClientRect();
                const raw = mainRect.right - moveEvent.clientX;
                const width = Math.min(maxWidth, Math.max(minWidth, raw));
                main.style.setProperty('--runner-selected-width', `${width}px`);
            };

            const onUp = () => {
                resizer.classList.remove('dragging');
                document.body.style.userSelect = '';
                document.body.style.cursor = '';
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
            };

            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        };

        resizer.addEventListener('mousedown', onMouseDown);
    }

    /** @param {number} index */
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

    _updateRequestCount() {
        if (this.dom.requestCount) {
            const { count } = this.queue;
            this.dom.requestCount.textContent = `${count} request${count !== 1 ? 's' : ''}`;
        }
    }

    _handleSave() {
        const runnerData = this.getRunnerData();

        if (this.onRunnerSave) {
            this.onRunnerSave(runnerData);
        }
    }

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

    _handleDelete() {
        if (!this.currentRunnerId) {
            return;
        }

        if (this.onRunnerDelete) {
            this.onRunnerDelete(this.currentRunnerId);
        }
    }

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

    _handleStop() {
        if (this.onStop) {
            this.onStop();
        }
    }

    /** @param {boolean} isRunning */
    _setRunningState(isRunning) {
        if (isRunning) {
            this.dom.runButton?.classList.add('is-hidden');
            this.dom.stopButton?.classList.remove('is-hidden');
        } else {
            this.dom.runButton?.classList.remove('is-hidden');
            this.dom.stopButton?.classList.add('is-hidden');
        }
    }

    /** @returns {Object} */
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

    /** @param {Object} runner */
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

    /** @param {Object} results */
    showResults(results) {
        this._setRunningState(false);
        this.resultsView.show(results);
    }

    showResultsPanel() {
        this.resultsView.open(this.queue.getRequests());
    }

    hideResultsPanel() {
        this.resultsView.hide();
    }

    /** @param {number} index */
    markRequestRunning(index) {
        this.resultsView.markRequestRunning(index);
    }

    /**
     * @param {number} index
     * @param {Object} result
     */
    updateResultWithResponse(index, result) {
        this.resultsView.updateResultWithResponse(index, result);
    }

    reset() {
        this.queue.reset();

        if (this.dom.nameInput) {
            this.dom.nameInput.value = '';
        }

        this._setRunningState(false);
        this.hideResultsPanel();
    }

    _notifyRequestsChange() {
        if (this.onRequestsChange) {
            this.onRequestsChange(this.queue.getRequests());
        }
    }

    /** @returns {void} */
    destroy() {
        this.menu.destroy();
        this.resultsView.hide();
    }
}
