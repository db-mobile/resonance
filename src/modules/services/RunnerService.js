import { app } from '../appContext.js';
import { ChangeEmitter } from './ChangeEmitter.js';
import { translate } from '../utils/translate.js';
import { CoreExecutionService, adaptResult, executionError } from './CoreExecutionService.js';
import { loadEndpointRequestConfig } from './endpointRequestConfig.js';

export class RunnerService {
    /**
     * @param {RunnerRepository} repository
     * @param {Object} backendAPI
     * @param {IStatusDisplay} statusDisplay
     * @param {{pipeline: import('./RequestPipeline.js').RequestPipeline}} deps
     */
    constructor(repository, backendAPI, statusDisplay, { pipeline } = {}) {
        if (!pipeline) {
            throw new Error('RunnerService needs a RequestPipeline');
        }
        this.repository = repository;
        this.backendAPI = backendAPI;
        this.statusDisplay = statusDisplay;
        this.pipeline = pipeline;
        this.collectionRepository = pipeline.collectionRepository;

        this.isRunning = false;
        this.shouldStop = false;
        this.currentRunId = null;
        this.core = new CoreExecutionService(pipeline, backendAPI);
        this._events = new ChangeEmitter();
    }

    /** @returns {Set<Function>} */
    get listeners() {
        return this._events.listeners;
    }

    /**
     * @param {{fresh?: boolean}} [options]
     * @returns {Promise<Array<Object>>}
     */
    async getAllRunners(options = {}) {
        return this.repository.getAll(options);
    }

    /**
     * @param {string} collectionId
     * @param {string} id
     * @returns {Promise<Object|undefined>}
     */
    async getRunner(collectionId, id) {
        return this.repository.getById(collectionId, id);
    }

    /**
     * @param {string} id
     * @returns {Promise<Object|undefined>}
     */
    async findRunner(id) {
        return this.repository.findById(id);
    }

    /**
     * @param {string} collectionId
     * @param {Object} runnerData
     * @returns {Promise<Object>}
     */
    async createRunner(collectionId, runnerData) {
        const runner = await this.repository.add(collectionId, runnerData);
        this.statusDisplay?.update(
            translate('runner.created', 'Runner "{{name}}" created', { name: runner.name }),
            null
        );
        return runner;
    }

    /**
     * @param {string} collectionId
     * @param {string} id
     * @param {Object} updates
     * @returns {Promise<Object|null>}
     */
    async updateRunner(collectionId, id, updates) {
        const runner = await this.repository.update(collectionId, id, updates);
        if (runner) {
            this.statusDisplay?.update(
                translate('runner.saved', 'Runner "{{name}}" saved', { name: runner.name }),
                null
            );
        }
        return runner;
    }

    /**
     * @param {string} collectionId
     * @param {string} id
     * @returns {Promise<boolean>}
     */
    async deleteRunner(collectionId, id) {
        const success = await this.repository.delete(collectionId, id);
        if (success) {
            this.statusDisplay?.update(translate('runner.deleted', 'Runner deleted'), null);
        }
        return success;
    }

    /**
     * @param {string} collectionId
     * @param {string} endpointId
     * @returns {Promise<Object>}
     */
    getEndpointRequestConfig(collectionId, endpointId) {
        return loadEndpointRequestConfig(this.collectionRepository, collectionId, endpointId);
    }

    /**
     * @param {string} collectionId
     * @param {string} runnerId
     * @param {Function} [onProgress]
     * @returns {Promise<Object>}
     */
    async executeRunner(collectionId, runnerId, onProgress) {
        this._assertIdle();

        const runner = await this.repository.getById(collectionId, runnerId);
        if (!runner) {
            throw new Error(translate('runner.error_not_found', 'Runner not found'));
        }

        return this._execute(runner, {
            runnerId,
            runnerName: runner.name || translate('runner.untitled', 'Untitled Runner'),
            onProgress,
            onFinish: () => this.repository.updateLastRun(runnerId)
        });
    }

    /**
     * @param {Object} runnerData
     * @param {Function} [onProgress]
     * @returns {Promise<Object>}
     */
    async executeRunnerData(runnerData, onProgress) {
        this._assertIdle();

        return this._execute(runnerData, {
            runnerId: null,
            runnerName: runnerData.name || translate('runner.untitled', 'Untitled Runner'),
            onProgress
        });
    }

    /** @returns {void} */
    _assertIdle() {
        if (this.isRunning) {
            throw new Error(translate('runner.error_already_running', 'A runner is already executing'));
        }
    }

    /**
     * @param {Object} runner
     * @param {Object} identity
     * @param {string|null} identity.runnerId
     * @param {string} identity.runnerName
     * @param {Function} [identity.onProgress]
     * @param {Function} [identity.onFinish]
     * @returns {Promise<Object>}
     */
    async _execute(runner, { runnerId, runnerName, onProgress, onFinish = null }) {
        if (!runner.requests?.length) {
            throw new Error(translate('runner.error_no_requests', 'Runner has no requests to execute'));
        }
        this._assertIdle();
        this.isRunning = true;
        this.shouldStop = false;
        this.currentRunId = runnerId ?? 'temp';
        const execution = this.core.createExecution();
        this._execution = execution;
        const startTime = Date.now();
        let results = {
            runnerId,
            runnerName,
            startTime,
            requests: [],
            totalRequests: 0,
            plannedRequests: 0,
            sentRequests: 0,
            iterations: 1,
            passed: 0,
            failed: 0,
            skipped: 0,
            variablesSet: {},
            error: null,
            terminationReason: 'completed'
        };
        const historyWrites = [];
        let historyError;
        try {
            const snapshot = await this.core.captureRun(runner);
            let plannedRequests = 0;
            const result = await this.core.execute('run', { ...snapshot, runnerId, runnerName }, execution, (event) => {
                if (event.kind === 'run-started') {
                    plannedRequests = event.data.total;
                }
                if (event.kind === 'completed') {
                    return;
                }
                if (event.kind === 'request-completed') {
                    adaptResult(event.data.result);
                    onProgress?.(event.data.index, plannedRequests, event.data.result);
                }
                if (event.kind === 'response') {
                    historyWrites.push(
                        this._recordHistory(event.data).catch((error) => {
                            historyError ||= error;
                        })
                    );
                }
                if (['run-started', 'request-started', 'request-completed'].includes(event.kind)) {
                    this._notifyListeners(event.kind, event.data);
                }
            });
            results = { ...results, ...result };
        } catch (error) {
            results.error = error.code ? executionError(error) : error.message || String(error);
            results.terminationReason = 'executionError';
        } finally {
            await Promise.all(historyWrites);
            if (historyError) {
                results.error = historyError.message;
                results.terminationReason = 'persistenceError';
            }
            results.endTime ||= Date.now();
            results.totalTime = results.endTime - results.startTime;
            this.isRunning = false;
            this.shouldStop = false;
            this.currentRunId = null;
            this._execution = null;
            try {
                await onFinish?.();
            } catch (error) {
                results.error = error.message;
                results.terminationReason = 'persistenceError';
            }
            this._notifyListeners('run-completed', results);
        }
        return results;
    }

    stopExecution() {
        if (!this.isRunning) {
            return;
        }
        this.shouldStop = true;
        this._execution?.cancel().catch(() => {});
        this.statusDisplay?.update(translate('runner.stopping', 'Stopping runner...'), null);
    }

    async _recordHistory(data) {
        await app.historyController?.addHistoryEntry(
            data.requestConfig,
            data.response,
            { collectionId: data.collectionId, endpointId: data.endpointId },
            data.environmentName,
            data.historySensitive
        );
    }

    addListener(listener) {
        this._events.add(listener);
    }
    _notifyListeners(event, data) {
        this._events.emit(event, data);
    }
}
