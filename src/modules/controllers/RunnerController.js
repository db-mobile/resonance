/**
 * @fileoverview Controller for coordinating collection runner operations
 * @module controllers/RunnerController
 */

import { RunnerRepository } from '../storage/RunnerRepository.js';
import { RunnerService } from '../services/RunnerService.js';
import { RunnerPanel } from '../ui/RunnerPanel.js';
import { groupRunnersByCollection } from '../ui/runner/RunnerSelectorMenu.js';
import { ConfirmDialog } from '../ui/ConfirmDialog.js';
import { StatusDisplayAdapter } from '../interfaces/IStatusDisplay.js';
import { updateStatusDisplay } from '../statusDisplay.js';
import { toast } from '../ui/Toast.js';
import { updateSetting } from '../state/settingsCache.js';
import { translate, translateCount } from '../utils/translate.js';
import { resolveRequestLinks } from '../utils/runnerRequestLinks.js';
import { parseDataFile } from '../utils/dataFile.js';
import { isAbsolutePath, toCollectionRelativePath } from '../utils/dataFilePath.js';
import { summarizeRun, toJsonReport, toJunitXml, reportFileName } from '../utils/runnerReport.js';
import { RunnerHistoryRepository } from '../storage/RunnerHistoryRepository.js';

export class RunnerController {
    /**
     * @param {Object} backendAPI
     * @param {Function} getCollections
     * @param {Function} [subscribeToCollections]
     * @param {{requestPipeline?: Object}} [deps]
     */
    constructor(backendAPI, getCollections, subscribeToCollections = null, { requestPipeline = null } = {}) {
        this.backendAPI = backendAPI;
        this.getCollections = getCollections;
        this.subscribeToCollections = subscribeToCollections;
        this._unsubscribeCollections = null;

        const statusDisplay = new StatusDisplayAdapter(updateStatusDisplay);
        this.repository = RunnerRepository.shared(backendAPI);
        this.historyRepository = RunnerHistoryRepository.shared(backendAPI);
        this.service = new RunnerService(this.repository, backendAPI, statusDisplay, { pipeline: requestPipeline });

        this.panel = null;
        this._currentRunnerId = null;
        this._currentCollectionId = null;

        this._handleSave = this._handleSave.bind(this);
        this._handleLoadRunners = this._handleLoadRunners.bind(this);
        this._handleRunnerSelect = this._handleRunnerSelect.bind(this);
        this._handleNewRunner = this._handleNewRunner.bind(this);
        this._handleRunnerDelete = this._handleRunnerDelete.bind(this);
        this._handleRun = this._handleRun.bind(this);
        this._handleStop = this._handleStop.bind(this);
    }

    /** @type {string|null} */
    get currentRunnerId() {
        return this._currentRunnerId;
    }

    set currentRunnerId(runnerId) {
        this._currentRunnerId = runnerId;
        if (!runnerId) {
            this._currentCollectionId = null;
        }
        if (this.panel) {
            this.panel.currentRunnerId = runnerId;
        }
    }

    /** @type {string|null} */
    get currentCollectionId() {
        return this._currentCollectionId;
    }

    /**
     * @param {HTMLElement} container
     * @param {{name: string, requests: Array<{collection: Object, endpoint: Object}>}|null} [preset]
     */
    async initialize(container, preset = null) {
        this.panel = new RunnerPanel(container);

        this.panel.onRunnerSave = this._handleSave;
        this.panel.onLoadRunners = this._handleLoadRunners;
        this.panel.onRunnerSelect = this._handleRunnerSelect;
        this.panel.onNewRunner = this._handleNewRunner;
        this.panel.onRunnerDelete = this._handleRunnerDelete;
        this.panel.onRun = this._handleRun;
        this.panel.onStop = this._handleStop;
        this.panel.onResolveEndpointDefaults = (collectionId, endpointId) =>
            this.service.getEndpointRequestConfig(collectionId, endpointId);
        this.panel.onPickDataFile = () => this._pickDataFile();
        this.panel.onLoadHistory = () => this.historyRepository.list(this.currentRunnerId);
        this.panel.onExport = (format, summary) => this._exportReport(format, summary);

        const [collections, settings] = await Promise.all([
            this.getCollections(),
            this.backendAPI.settings.get().catch(() => ({}))
        ]);

        this.panel.render(collections);
        this._unsubscribeCollections = this.subscribeToCollections?.(
            (latest) => this.panel?.updateCollections(latest)
        ) || null;

        this.service.addListener((event, data) => {
            this._handleServiceEvent(event, data);
        });

        if (preset) {
            this.panel.loadPreset(preset);
        } else {
            await this._loadLastRunner(settings);
        }
    }

    /**
     * @param {Object} runnerData
     * @returns {Object}
     */
    _named(runnerData) {
        return { ...runnerData, name: runnerData.name || translate('runner.untitled', 'Untitled Runner') };
    }

    /**
     * @param {Object} runnerData
     * @returns {string|null}
     */
    _collectionFor(runnerData) {
        const collectionId = this._currentCollectionId || runnerData.collectionId || null;
        if (!collectionId) {
            toast.error(translate('runner.no_collection', 'Add a request first so the runner belongs to a collection'));
        }
        return collectionId;
    }

    /**
     * @param {Object} runnerData
     * @returns {Promise<string|null>}
     */
    async _persist(runnerData) {
        const collectionId = this._collectionFor(runnerData);
        if (!collectionId) {
            return null;
        }
        const named = this._named(runnerData);
        if (this.currentRunnerId) {
            await this.service.updateRunner(collectionId, this.currentRunnerId, named);
            return this.currentRunnerId;
        }
        const runner = await this.service.createRunner(collectionId, named);
        this._currentCollectionId = collectionId;
        this.currentRunnerId = runner.id;
        return runner.id;
    }

    /** @param {Object} runnerData */
    async _handleSave(runnerData) {
        try {
            await this._persist(runnerData);
        } catch (error) {
            toast.error(translate('runner.error_saving', 'Error saving runner: {{message}}', { message: error.message }));
        }
    }

    /** @returns {Promise<Array>} */
    async _handleLoadRunners() {
        try {
            const [runners, collections] = await Promise.all([
                this.service.getAllRunners({ fresh: true }),
                this.getCollections()
            ]);
            return groupRunnersByCollection(runners, collections || []);
        } catch (error) {
            toast.error(translate('runner.error_loading_runners', 'Error loading runners: {{message}}', { message: error.message }));
            return [];
        }
    }

    /**
     * @param {string} collectionId
     * @param {string} runnerId
     * @returns {Promise<Object|null>}
     */
    async _applyRunner(collectionId, runnerId) {
        const { runner, missing } = await this._prepareRunner(await this.service.getRunner(collectionId, runnerId));
        if (!runner) {
            return null;
        }
        this._currentCollectionId = collectionId;
        this.currentRunnerId = runnerId;
        this.panel?.loadRunner(runner, missing);
        this._checkDataFile(collectionId, runner.options?.dataFile);
        return runner;
    }

    /**
     * @param {string} runnerId
     * @param {string} collectionId
     */
    async _handleRunnerSelect(runnerId, collectionId) {
        try {
            const runner = await this._applyRunner(collectionId, runnerId);
            if (runner) {
                await this._saveLastRunnerId(runnerId);
                updateStatusDisplay(translate('runner.loaded', 'Loaded runner: {{name}}', { name: runner.name }), null);
            }
        } catch (error) {
            toast.error(translate('runner.error_loading', 'Error loading runner: {{message}}', { message: error.message }));
        }
    }

    _handleNewRunner() {
        this.currentRunnerId = null;
    }

    /** @param {string} runnerId */
    async _handleRunnerDelete(runnerId) {
        if (!runnerId) {return;}

        const confirmDialog = new ConfirmDialog();
        const confirmed = await confirmDialog.show(
            translate('runner.delete_confirm', 'Are you sure you want to delete this runner?'),
            {
                title: translate('runner.delete_title', 'Delete Runner'),
                confirmText: translate('common.delete', 'Delete'),
                cancelText: translate('common.cancel', 'Cancel'),
                dangerous: true
            }
        );

        if (!confirmed) {
            return;
        }

        try {
            await this.service.deleteRunner(this._currentCollectionId, runnerId);
            this.historyRepository.remove(runnerId).catch(() => {});
            this.currentRunnerId = null;
            await this._saveLastRunnerId(null);
            this.panel?.startNewRunner();
            updateStatusDisplay(translate('runner.deleted', 'Runner deleted'), null);
        } catch (error) {
            toast.error(translate('runner.error_deleting', 'Error deleting runner: {{message}}', { message: error.message }));
        }
    }

    /** @param {Object} runnerData */
    async _handleRun(runnerData) {
        try {
            let runnerId = this.currentRunnerId;

            if (runnerId || runnerData.name) {
                runnerId = await this._persist(runnerData);
            }

            const onProgress = (index, total, result) => {
                this.panel?.updateResultWithResponse(index, result);
            };
            const results = runnerId
                ? await this.service.executeRunner(this._currentCollectionId, runnerId, onProgress)
                : await this.service.executeRunnerData(runnerData, onProgress);

            this.panel?.showResults(results);

            const summary = summarizeRun(results);
            this.panel?.setRunSummary(summary);
            if (runnerId) {
                this.historyRepository.record(runnerId, summary).catch(() => {});
            }

        } catch (error) {
            toast.error(translate('runner.run_error', 'Runner error: {{message}}', { message: error.message }));
            this.panel?.showResults({ error: error.message });
        }
    }

    _handleStop() {
        this.service.stopExecution();
    }

    /**
     * @param {string} event
     * @param {*} data
     */
    _handleServiceEvent(event, data) {
        switch (event) {
            case 'run-started':
                this.panel?.prepareResults?.(data.iterations, data.iterationLabels, data.timeline);
                updateStatusDisplay(translateCount('runner.running_requests', data.total, {
                    one: 'Running {{count}} request...',
                    other: 'Running {{count}} requests...'
                }), null);
                break;

            case 'request-started':
                this.panel?.markRequestRunning?.(data.index, data);
                break;

            case 'request-completed': {
                const succeeded = data.result.status === 'success';
                updateStatusDisplay(
                    translate('runner.request_status', 'Request {{number}}: {{detail}}', {
                        number: data.index + 1,
                        detail: succeeded ? data.result.statusCode : data.result.error
                    }),
                    succeeded ? data.result.statusCode : null
                );
                break;
            }

            case 'run-completed':
                updateStatusDisplay(
                    data.error || translate('runner.completed', 'Completed: {{passed}} passed, {{failed}} failed ({{time}}ms)', {
                        passed: data.passed,
                        failed: data.failed,
                        time: data.totalTime
                    }),
                    data.failed === 0 && !data.error ? 200 : null
                );
                break;
        }
    }

    /** @param {string|null} runnerId */
    async _saveLastRunnerId(runnerId) {
        await updateSetting('lastRunnerId', runnerId);
    }

    async _loadLastRunner(settings) {
        try {
            const lastRunnerId = settings?.lastRunnerId;
            if (!lastRunnerId) {
                return;
            }
            const runner = await this.service.findRunner(lastRunnerId);
            if (runner) {
                await this._applyRunner(runner.collectionId, runner.id);
            }
        } catch (error) {
        }
    }

    /**
     * @param {Object|undefined} runner
     * @returns {Promise<{runner: Object|undefined, missing: Set<number>}>}
     */
    async _prepareRunner(runner) {
        if (!runner) {
            return { runner, missing: new Set() };
        }

        let collections = [];
        try {
            collections = await this.getCollections() || [];
        } catch {}

        const own = collections.filter(collection => collection.id === runner.collectionId);
        const links = resolveRequestLinks(runner.requests, own);
        const { requests } = links;

        if (links.relinked > 0) {
            try {
                await this.repository.update(runner.collectionId, runner.id, { requests });
            } catch {}
            toast.info(translateCount('runner.relinked', links.relinked, {
                one: 'Re-linked {{count}} request within its collection',
                other: 'Re-linked {{count}} requests within its collection'
            }));
        }
        if (links.missing.size > 0) {
            toast.warning(translateCount('runner.missing_requests', links.missing.size, {
                one: '{{count}} request in "{{name}}" no longer exists in its collection',
                other: '{{count}} requests in "{{name}}" no longer exist in its collection'
            }, { name: runner.name }));
        }

        return { runner: { ...runner, requests }, missing: links.missing };
    }

    /**
     * @param {'json'|'junit'} format
     * @param {Object} summary
     * @returns {Promise<void>}
     */
    async _exportReport(format, summary) {
        const junit = format === 'junit';
        const extension = junit ? 'xml' : 'json';
        try {
            const result = await this.backendAPI.runner.saveReport(
                reportFileName(summary, extension),
                junit ? toJunitXml(summary) : toJsonReport(summary),
                junit ? 'JUnit XML' : 'JSON',
                [extension]
            );
            if (result?.success) {
                toast.success(translate('runner.report_saved', 'Report saved to {{path}}', { path: result.filePath }));
            }
        } catch (error) {
            toast.error(translate('runner.report_error', 'Could not save the report: {{message}}', {
                message: error?.message || String(error)
            }));
        }
    }

    /** @returns {Promise<{path: string, name: string, rowCount: number, portable: boolean}|null>} */
    async _pickDataFile() {
        const collectionId = this.panel?.collectionId || this._currentCollectionId;
        if (!collectionId) {
            toast.error(translate('runner.no_collection', 'Add a request first so the runner belongs to a collection'));
            return null;
        }
        try {
            const file = await this.backendAPI.runner.pickDataFile();
            if (!file) {
                return null;
            }
            const rows = parseDataFile(file.name, file.content);
            if (rows.length === 0) {
                toast.error(translate('runner.data_file_empty', 'Data file {{name}} has no rows', { name: file.name }));
                return null;
            }
            let storagePath = null;
            try {
                storagePath = (await this.getCollections() || []).find(collection => collection.id === collectionId)?.storagePath || null;
            } catch {}
            const { path, portable } = toCollectionRelativePath(file.path, storagePath);
            return { path, name: file.name, rowCount: rows.length, portable };
        } catch (error) {
            toast.error(translate('runner.data_file_unusable', 'Could not use this data file: {{message}}', {
                message: error?.message || String(error)
            }));
            return null;
        }
    }

    /**
     * @param {string} collectionId
     * @param {{path: string, name: string}|null|undefined} dataFile
     * @returns {Promise<void>}
     */
    async _checkDataFile(collectionId, dataFile) {
        if (!dataFile?.path) {
            return;
        }
        const portable = !isAbsolutePath(dataFile.path);
        try {
            const file = await this.backendAPI.collections.runners.readData(collectionId, dataFile.path);
            this.panel?.setDataFile(dataFile, { rowCount: parseDataFile(file.name, file.content).length, portable });
        } catch (error) {
            this.panel?.setDataFile(dataFile, { error: error?.message || String(error), portable });
        }
    }

    /** @returns {void} */
    destroy() {
        this.service.stopExecution();
        this._unsubscribeCollections?.();
        this._unsubscribeCollections = null;
        this.panel?.destroy?.();
    }
}
