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
import { OVERRIDES_VERSION } from '../utils/requestOverrides.js';
import { translate, translateCount } from '../utils/translate.js';
import { pushEscapeHandler } from './modalEscape.js';

export class RunnerPanel {
    /** @param {HTMLElement} container */
    constructor(container) {
        this.container = container;

        this.palette = new CollectionPalette({
            onAddEndpoint: (collection, endpoint) => this.queue.addRequest(collection, endpoint),
            onAddAll: (collection, endpoints) =>
                this.queue.appendRequests(endpoints.map(endpoint => ({ collection, endpoint })))
        });
        this.queue = new RequestQueue({
            onCountChange: () => this._updateRequestCount(),
            onEditRequest: (index) => this._openScriptModal(index)
        });

        this.menu = new RunnerSelectorMenu({
            onLoadRunners: () => this.onLoadRunners?.(),
            onSelect: (runnerId) => this.onRunnerSelect?.(runnerId)
        });

        this.resultsView = new RunnerResultsPanel(container);
        this.resultsView.onExport = (format, summary) => this.onExport?.(format, summary);

        this.editorModal = new RequestEditorModal();

        this.onResolveEndpointDefaults = null;
        this.onPickDataFile = null;
        this.onLoadHistory = null;
        this.onExport = null;
        this.dataFile = null;
        this._closeHistoryMenu = null;

        this.onRunnerSave = null;
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

    /** @param {Array<Object>} collections */
    updateCollections(collections) {
        if (this.dom.collectionTree) {
            this.palette.render(this.dom.collectionTree, collections);
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
            iterationsInput: this.container.querySelector('[data-option="iterations"]'),
            dataChip: this.container.querySelector('[data-role="data-chip"]'),
            dataFileLabel: this.container.querySelector('[data-role="data-file-label"]'),
            dataClearButton: this.container.querySelector('[data-action="clear-data-file"]'),
            historyButton: this.container.querySelector('[data-action="toggle-history"]'),
            historyDropdown: this.container.querySelector('[data-role="history-dropdown"]'),
            historyList: this.container.querySelector('[data-role="history-list"]'),
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

        this.dom.runButton?.addEventListener('click', () => {
            this._handleRun();
        });

        this.dom.stopButton?.addEventListener('click', () => {
            this._handleStop();
        });

        this.container.querySelector('[data-action="pick-data-file"]')?.addEventListener('click', async () => {
            const picked = await this.onPickDataFile?.();
            if (picked) {
                this.setDataFile({ path: picked.path, name: picked.name }, { rowCount: picked.rowCount });
            }
        });

        this.dom.dataClearButton?.addEventListener('click', () => {
            this.setDataFile(null);
        });

        this.dom.historyButton?.addEventListener('click', (e) => {
            e.stopPropagation();
            if (this._closeHistoryMenu) {
                this._closeHistoryMenu();
            } else {
                this._openHistoryMenu();
            }
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
            resolveDefaults: (collectionId, endpointId) =>
                this.onResolveEndpointDefaults?.(collectionId, endpointId)
        });
    }

    _updateRequestCount() {
        if (this.dom.requestCount) {
            const { count } = this.queue;
            this.dom.requestCount.textContent = translateCount('runner.request_count', count, {
                one: '{{count}} request',
                other: '{{count}} requests'
            });
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
        this.setDataFile(null);
        if (this.dom.iterationsInput) {
            this.dom.iterationsInput.value = 1;
        }

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
            name: this.dom.nameInput?.value.trim() || '',
            requests: [...this.queue.getRequests()],
            overridesVersion: OVERRIDES_VERSION,
            options: {
                stopOnError: this.dom.stopOnErrorCheckbox?.checked ?? true,
                delayMs: parseInt(this.dom.delayInput?.value, 10) || 0,
                iterations: parseInt(this.dom.iterationsInput?.value, 10) || 1,
                dataFile: this.dataFile ? { ...this.dataFile } : null
            }
        };
    }

    /** @param {{name: string, requests: Array<{collection: Object, endpoint: Object}>}} preset */
    loadPreset({ name, requests }) {
        this.startNewRunner();
        if (this.dom.nameInput) {
            this.dom.nameInput.value = name || '';
        }
        this.queue.setRequests(requests.map(({ collection, endpoint }) => RequestQueue.buildRequest(collection, endpoint)));
    }

    /**
     * @param {Object} runner
     * @param {Set<number>} [missing]
     */
    loadRunner(runner, missing = new Set()) {
        if (this.dom.nameInput) {
            this.dom.nameInput.value = runner.name || '';
        }

        if (this.dom.stopOnErrorCheckbox) {
            this.dom.stopOnErrorCheckbox.checked = runner.options?.stopOnError ?? true;
        }
        if (this.dom.delayInput) {
            this.dom.delayInput.value = runner.options?.delayMs || 0;
        }
        if (this.dom.iterationsInput) {
            this.dom.iterationsInput.value = runner.options?.iterations || 1;
        }
        this.setDataFile(runner.options?.dataFile || null);

        this.queue.setRequests(runner.requests, missing);
    }

    /**
     * @param {{path: string, name: string}|null} dataFile
     * @param {{rowCount?: number, error?: string}} [status]
     */
    setDataFile(dataFile, { rowCount, error } = {}) {
        this.dataFile = dataFile;
        const hasFile = Boolean(dataFile);

        if (this.dom.dataFileLabel) {
            this.dom.dataFileLabel.removeAttribute('data-i18n');
            this.dom.dataFileLabel.textContent = !hasFile
                ? translate('runner.no_data_file', 'None')
                : rowCount === undefined
                    ? dataFile.name
                    : translateCount('runner.data_file_rows', rowCount, {
                        one: '{{name}} · {{count}} row',
                        other: '{{name}} · {{count}} rows'
                    }, { name: dataFile.name });
        }
        this.dom.dataChip?.classList.toggle('is-error', Boolean(error));
        if (this.dom.dataChip) {
            this.dom.dataChip.title = error || '';
        }
        this.dom.dataClearButton?.classList.toggle('is-hidden', !hasFile);

        if (this.dom.iterationsInput) {
            this.dom.iterationsInput.disabled = hasFile;
            if (hasFile && rowCount !== undefined) {
                this.dom.iterationsInput.value = rowCount;
            }
        }
    }

    async _openHistoryMenu() {
        if (!this.dom.historyDropdown || !this.dom.historyList) {return;}

        const runs = this.currentRunnerId ? await this.onLoadHistory?.() || [] : null;
        this._renderHistory(runs);

        this.dom.historyDropdown.classList.remove('is-hidden');
        this.dom.historyButton?.setAttribute('aria-expanded', 'true');

        const onDocumentClick = (event) => {
            if (!this.dom.historyDropdown?.contains(event.target)) {
                this._closeHistoryMenu?.();
            }
        };
        document.addEventListener('click', onDocumentClick);
        const releaseEscape = pushEscapeHandler(() => this._closeHistoryMenu?.());

        this._closeHistoryMenu = () => {
            document.removeEventListener('click', onDocumentClick);
            releaseEscape();
            this.dom.historyDropdown?.classList.add('is-hidden');
            this.dom.historyButton?.setAttribute('aria-expanded', 'false');
            this._closeHistoryMenu = null;
        };
    }

    /** @param {Array<Object>|null} runs */
    _renderHistory(runs) {
        const list = this.dom.historyList;
        list.innerHTML = '';

        if (!runs || runs.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'dropdown-empty';
            empty.textContent = runs
                ? translate('runner.history_empty', 'No runs yet')
                : translate('runner.history_unsaved', 'Save this runner to keep a history of its runs');
            list.appendChild(empty);
            return;
        }

        for (const run of runs) {
            const item = document.createElement('button');
            item.type = 'button';
            item.className = 'dropdown-item runner-history-item';
            item.setAttribute('role', 'menuitem');

            const label = document.createElement('span');
            label.className = 'dropdown-item-label';
            label.textContent = new Date(run.startedAt).toLocaleString();

            const meta = document.createElement('span');
            meta.className = 'runner-history-meta';
            const failed = document.createElement('span');
            failed.className = run.summary.failed > 0 ? 'is-failed' : '';
            failed.textContent = translate('runner.history_failed', '{{count}} failed', { count: run.summary.failed });
            meta.append(
                translate('runner.history_passed', '{{count}} passed', { count: run.summary.passed }),
                ' · ',
                failed
            );

            item.append(label, meta);
            item.addEventListener('click', () => {
                this._closeHistoryMenu?.();
                this.resultsView.showSummary(run, translate('runner.history_source', 'Run from {{date}}', {
                    date: new Date(run.startedAt).toLocaleString()
                }));
            });
            list.appendChild(item);
        }
    }

    /** @param {Object} summary */
    setRunSummary(summary) {
        this.resultsView.setSummary(summary);
    }

    /**
     * @param {number} iterations
     * @param {string[]|null} labels
     */
    prepareResults(iterations, labels) {
        this.resultsView.open(this.queue.getRequests(), { iterations, labels });
    }

    /** @param {Object} results */
    showResults(results) {
        this._setRunningState(false);
        this.resultsView.show(results);
    }

    showResultsPanel() {
        this.resultsView.open(this.queue.getRequests());
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

    /** @returns {void} */
    destroy() {
        this._closeHistoryMenu?.();
        this.menu.destroy();
        this.resultsView.hide();
    }
}
