/**
 * @fileoverview Controller for coordinating collection runner operations
 * @module controllers/RunnerController
 */

import { RunnerRepository } from '../storage/RunnerRepository.js';
import { RunnerService } from '../services/RunnerService.js';
import { RunnerPanel } from '../ui/RunnerPanel.js';
import { ConfirmDialog } from '../ui/ConfirmDialog.js';
import { StatusDisplayAdapter } from '../interfaces/IStatusDisplay.js';
import { updateStatusDisplay } from '../statusDisplay.js';
import { toast } from '../ui/Toast.js';
import { updateSetting } from '../state/settingsCache.js';
import { translate, translateCount } from '../utils/translate.js';
import { OVERRIDES_VERSION, endpointDefaults, stripUnchangedOverrides } from '../utils/requestOverrides.js';
import { resolveRequestLinks } from '../utils/runnerRequestLinks.js';
import { parseDataFile } from '../utils/dataFile.js';
import { summarizeRun, toJsonReport, toJunitXml, reportFileName } from '../utils/runnerReport.js';
import { RunnerHistoryRepository } from '../storage/RunnerHistoryRepository.js';

export class RunnerController {
    /**
     * @param {Object} backendAPI
     * @param {Function} getCollections
     * @param {Function} [subscribeToCollections]
     */
    constructor(backendAPI, getCollections, subscribeToCollections = null) {
        this.backendAPI = backendAPI;
        this.getCollections = getCollections;
        this.subscribeToCollections = subscribeToCollections;
        this._unsubscribeCollections = null;

        const statusDisplay = new StatusDisplayAdapter(updateStatusDisplay);
        this.repository = RunnerRepository.shared(backendAPI);
        this.historyRepository = RunnerHistoryRepository.shared(backendAPI);
        this.service = new RunnerService(this.repository, backendAPI, statusDisplay);

        this.panel = null;
        this._currentRunnerId = null;

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
        if (this.panel) {
            this.panel.currentRunnerId = runnerId;
        }
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

    /** @param {Object} runnerData */
    async _handleSave(runnerData) {
        const named = { ...runnerData, name: runnerData.name || translate('runner.untitled', 'Untitled Runner') };
        try {
            if (this.currentRunnerId) {
                await this.service.updateRunner(this.currentRunnerId, named);
            } else {
                const runner = await this.service.createRunner(named);
                this.currentRunnerId = runner.id;
            }
        } catch (error) {
            toast.error(translate('runner.error_saving', 'Error saving runner: {{message}}', { message: error.message }));
        }
    }

    /** @returns {Promise<Array>} */
    async _handleLoadRunners() {
        try {
            return await this.service.getAllRunners();
        } catch (error) {
            toast.error(translate('runner.error_loading_runners', 'Error loading runners: {{message}}', { message: error.message }));
            return [];
        }
    }

    /** @param {string} runnerId */
    async _handleRunnerSelect(runnerId) {
        try {
            const { runner, missing } = await this._prepareRunner(await this.service.getRunner(runnerId));
            if (runner) {
                this.currentRunnerId = runnerId;
                this.panel?.loadRunner(runner, missing);
                this._checkDataFile(runner.options?.dataFile);
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
            await this.service.deleteRunner(runnerId);
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

            if (runnerId) {
                await this.service.updateRunner(runnerId, runnerData);
            } else if (runnerData.name) {
                const runner = await this.service.createRunner(runnerData);
                runnerId = runner.id;
                this.currentRunnerId = runnerId;
            }

            const results = runnerId
                ? await this.service.executeRunner(
                    runnerId,
                    (index, total, result) => {
                        this.panel?.updateResultWithResponse(index, result);
                    }
                )
                : await this.service.executeRunnerData(
                    runnerData,
                    (index, total, result) => {
                        this.panel?.updateResultWithResponse(index, result);
                    }
                );

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
                this.panel?.prepareResults?.(data.iterations, data.iterationLabels);
                updateStatusDisplay(translateCount('runner.running_requests', data.total, {
                    one: 'Running {{count}} request...',
                    other: 'Running {{count}} requests...'
                }), null);
                break;

            case 'request-started':
                this.panel?.markRequestRunning?.(data.index);
                break;

            case 'request-completed':
                if (data.result.status === 'success') {
                    updateStatusDisplay(
                        translate('runner.request_status', 'Request {{number}}: {{detail}}', {
                            number: data.index + 1,
                            detail: data.result.statusCode
                        }),
                        data.result.statusCode
                    );
                } else {
                    updateStatusDisplay(
                        translate('runner.request_status', 'Request {{number}}: {{detail}}', {
                            number: data.index + 1,
                            detail: data.result.error
                        }),
                        null
                    );
                }
                break;

            case 'run-completed':
                updateStatusDisplay(
                    translate('runner.completed', 'Completed: {{passed}} passed, {{failed}} failed ({{time}}ms)', {
                        passed: data.passed,
                        failed: data.failed,
                        time: data.totalTime
                    }),
                    data.failed === 0 ? 200 : null
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
            if (lastRunnerId) {
                const { runner, missing } = await this._prepareRunner(await this.service.getRunner(lastRunnerId));
                if (runner) {
                    this.currentRunnerId = lastRunnerId;
                    this.panel?.loadRunner(runner, missing);
                    this._checkDataFile(runner.options?.dataFile);
                }
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
        } catch (error) {
            void error;
        }

        const links = resolveRequestLinks(runner.requests, collections);
        let { requests } = links;
        const needsMigration = runner.overridesVersion !== OVERRIDES_VERSION;

        if (needsMigration) {
            requests = await Promise.all(requests.map(async (request, index) => {
                if (links.missing.has(index)) {
                    return request;
                }
                try {
                    const config = await this.service.getEndpointRequestConfig(request.collectionId, request.endpointId);
                    return { ...request, overrides: stripUnchangedOverrides(request.overrides, endpointDefaults(config)) };
                } catch (error) {
                    void error;
                    return request;
                }
            }));
        }

        if (needsMigration || links.relinked > 0) {
            try {
                await this.repository.update(runner.id, { requests, overridesVersion: OVERRIDES_VERSION });
            } catch (error) {
                void error;
            }
        }

        if (links.relinked > 0) {
            toast.info(translateCount('runner.relinked', links.relinked, {
                one: 'Re-linked {{count}} request to the open collections',
                other: 'Re-linked {{count}} requests to the open collections'
            }));
        }
        if (links.missing.size > 0) {
            toast.warning(translateCount('runner.missing_requests', links.missing.size, {
                one: '{{count}} request in "{{name}}" no longer exists in any open collection',
                other: '{{count}} requests in "{{name}}" no longer exist in any open collection'
            }, { name: runner.name }));
        }

        return { runner: { ...runner, requests, overridesVersion: OVERRIDES_VERSION }, missing: links.missing };
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

    /** @returns {Promise<{path: string, name: string, rowCount: number}|null>} */
    async _pickDataFile() {
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
            return { path: file.path, name: file.name, rowCount: rows.length };
        } catch (error) {
            toast.error(translate('runner.data_file_unusable', 'Could not use this data file: {{message}}', {
                message: error?.message || String(error)
            }));
            return null;
        }
    }

    /**
     * @param {{path: string, name: string}|null|undefined} dataFile
     * @returns {Promise<void>}
     */
    async _checkDataFile(dataFile) {
        if (!dataFile?.path) {
            return;
        }
        try {
            const file = await this.backendAPI.runner.readDataFile(dataFile.path);
            this.panel?.setDataFile(dataFile, { rowCount: parseDataFile(file.name, file.content).length });
        } catch (error) {
            this.panel?.setDataFile(dataFile, { error: error?.message || String(error) });
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
