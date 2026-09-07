/**
 * @fileoverview Controller for coordinating collection runner operations
 * @module controllers/RunnerController
 */

import { app } from '../appContext.js';
import { RunnerRepository } from '../storage/RunnerRepository.js';
import { RunnerService } from '../services/RunnerService.js';
import { RunnerPanel } from '../ui/RunnerPanel.js';
import { ConfirmDialog } from '../ui/ConfirmDialog.js';
import { StatusDisplayAdapter } from '../interfaces/IStatusDisplay.js';
import { updateStatusDisplay } from '../statusDisplay.js';
import { templateLoader } from '../templateLoader.js';
import { toast } from '../ui/Toast.js';

export class RunnerController {
    /**
     * @param {Object} backendAPI
     * @param {Function} getCollections
     */
    constructor(backendAPI, getCollections) {
        this.backendAPI = backendAPI;
        this.getCollections = getCollections;

        const statusDisplay = new StatusDisplayAdapter(updateStatusDisplay);
        this.repository = new RunnerRepository(backendAPI);
        this.service = new RunnerService(this.repository, backendAPI, statusDisplay);

        this.panel = null;
        this.currentRunnerId = null;

        this._handleSave = this._handleSave.bind(this);
        this._handleLoadRunners = this._handleLoadRunners.bind(this);
        this._handleRunnerSelect = this._handleRunnerSelect.bind(this);
        this._handleNewRunner = this._handleNewRunner.bind(this);
        this._handleRunnerDelete = this._handleRunnerDelete.bind(this);
        this._handleRun = this._handleRun.bind(this);
        this._handleStop = this._handleStop.bind(this);
    }

    /** @param {HTMLElement} container */
    async initialize(container) {
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

        const [collections, settings] = await Promise.all([
            this.getCollections(),
            this.backendAPI.settings.get().catch(() => ({}))
        ]);

        this.panel.render(collections);

        this.service.addListener((event, data) => {
            this._handleServiceEvent(event, data);
        });

        await this._loadLastRunner(settings);
    }

    /** @param {Object} runnerData */
    async _handleSave(runnerData) {
        try {
            if (this.currentRunnerId) {
                await this.service.updateRunner(this.currentRunnerId, runnerData);
            } else {
                const runner = await this.service.createRunner(runnerData);
                this.currentRunnerId = runner.id;
            }
        } catch (error) {
            toast.error(`Error saving runner: ${error.message}`);
        }
    }

    /** @returns {Promise<Array>} */
    async _handleLoadRunners() {
        try {
            return await this.service.getAllRunners();
        } catch (error) {
            toast.error(`Error loading runners: ${error.message}`);
            return [];
        }
    }

    /** @param {string} runnerId */
    async _handleRunnerSelect(runnerId) {
        try {
            const runner = await this.service.getRunner(runnerId);
            if (runner) {
                this.currentRunnerId = runnerId;
                this.panel?.loadRunner(runner);
                this.panel.currentRunnerId = runnerId;
                await this._saveLastRunnerId(runnerId);
                updateStatusDisplay(`Loaded runner: ${runner.name}`, null);
            }
        } catch (error) {
            toast.error(`Error loading runner: ${error.message}`);
        }
    }

    _handleNewRunner() {
        this.currentRunnerId = null;
        if (this.panel) {
            this.panel.currentRunnerId = null;
        }
    }

    /** @param {string} runnerId */
    async _handleRunnerDelete(runnerId) {
        if (!runnerId) {return;}

        const confirmDialog = new ConfirmDialog();
        const confirmed = await confirmDialog.show('Are you sure you want to delete this runner?', {
            title: 'Delete Runner',
            confirmText: 'Delete',
            cancelText: 'Cancel',
            dangerous: true
        });

        if (!confirmed) {
            return;
        }

        try {
            await this.service.deleteRunner(runnerId);
            this.currentRunnerId = null;
            if (this.panel) {
                this.panel.currentRunnerId = null;
            }
            await this._saveLastRunnerId(null);
            this.panel?.startNewRunner();
            updateStatusDisplay('Runner deleted', null);
        } catch (error) {
            toast.error(`Error deleting runner: ${error.message}`);
        }
    }

    /** @param {Array<Object>} runners */
    _showSavedRunnersDialog(runners) {
        const fragment = templateLoader.cloneSync(
            './src/templates/runner/runnerPanel.html',
            'tpl-runner-saved-list'
        );

        const overlay = fragment.firstElementChild;
        document.body.appendChild(overlay);

        const listContainer = overlay.querySelector('[data-role="saved-list"]');
        const closeButtons = overlay.querySelectorAll('[data-action="close"]');

        const closeDialog = () => {
            overlay.remove();
        };

        closeButtons.forEach(btn => btn.addEventListener('click', closeDialog));
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {closeDialog();}
        });

        if (runners.length === 0) {
            listContainer.innerHTML = `
                <div class="empty-state-base runner-empty-state">
                    <p>No saved runners yet</p>
                </div>
            `;
            return;
        }

        listContainer.innerHTML = '';
        runners.forEach(runner => {
            const itemEl = this._createSavedRunnerItem(runner, closeDialog);
            listContainer.appendChild(itemEl);
        });

        if (app.i18n && app.i18n.updateUI) {
            app.i18n.updateUI();
        }
    }

    /**
     * @param {Object} runner
     * @param {Function} closeDialog
     * @returns {HTMLElement}
     */
    _createSavedRunnerItem(runner, closeDialog) {
        const fragment = templateLoader.cloneSync(
            './src/templates/runner/runnerPanel.html',
            'tpl-runner-saved-item'
        );

        const el = fragment.firstElementChild;

        const nameEl = el.querySelector('[data-role="name"]');
        if (nameEl) {nameEl.textContent = runner.name;}

        const metaEl = el.querySelector('[data-role="meta"]');
        if (metaEl) {
            const requestCount = runner.requests?.length || 0;
            const lastRun = runner.lastRunAt
                ? new Date(runner.lastRunAt).toLocaleDateString()
                : 'Never';
            metaEl.textContent = `${requestCount} requests • Last run: ${lastRun}`;
        }

        el.querySelector('[data-action="load"]')?.addEventListener('click', async () => {
            await this._loadRunner(runner.id);
            closeDialog();
        });

        el.querySelector('[data-action="delete"]')?.addEventListener('click', async () => {
            if (confirm(`Delete runner "${runner.name}"?`)) {
                await this.service.deleteRunner(runner.id);
                el.remove();

                const listContainer = el.parentElement;
                if (listContainer && listContainer.children.length === 0) {
                    listContainer.innerHTML = `
                        <div class="empty-state-base runner-empty-state">
                            <p>No saved runners yet</p>
                        </div>
                    `;
                }
            }
        });

        return el;
    }

    /** @param {string} runnerId */
    async _loadRunner(runnerId) {
        try {
            const runner = await this.service.getRunner(runnerId);
            if (runner) {
                this.currentRunnerId = runnerId;
                this.panel?.loadRunner(runner);
                updateStatusDisplay(`Loaded runner: ${runner.name}`, null);
            }
        } catch (error) {
            toast.error(`Error loading runner: ${error.message}`);
        }
    }

    /** @param {Object} runnerData */
    async _handleRun(runnerData) {
        try {
            let runnerId = this.currentRunnerId;

            if (!runnerId && runnerData.name && runnerData.name !== 'Untitled Runner') {
                const runner = await this.service.createRunner(runnerData);
                runnerId = runner.id;
                this.currentRunnerId = runnerId;
            }

            if (runnerId) {
                await this.service.updateRunner(runnerId, runnerData);
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

        } catch (error) {
            toast.error(`Runner error: ${error.message}`);
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
                updateStatusDisplay(`Running ${data.total} requests...`, null);
                break;

            case 'request-completed':
                if (data.result.status === 'success') {
                    updateStatusDisplay(
                        `Request ${data.index + 1}: ${data.result.statusCode}`,
                        data.result.statusCode
                    );
                } else {
                    updateStatusDisplay(
                        `Request ${data.index + 1}: ${data.result.error}`,
                        null
                    );
                }
                break;

            case 'run-completed':
                updateStatusDisplay(
                    `Completed: ${data.passed} passed, ${data.failed} failed (${data.totalTime}ms)`,
                    data.failed === 0 ? 200 : null
                );
                break;
        }
    }

    /** @returns {Object} */
    static createRunnerTab() {
        return {
            type: 'runner',
            name: 'Collection Runner',
            icon: 'play'
        };
    }

    /**
     * @param {Object} tab
     * @returns {boolean}
     */
    static isRunnerTab(tab) {
        return tab?.type === 'runner';
    }

    /** @param {string|null} runnerId */
    async _saveLastRunnerId(runnerId) {
        try {
            const settings = await this.backendAPI.settings.get() || {};
            settings.lastRunnerId = runnerId;
            await this.backendAPI.settings.set(settings);
        } catch (error) {
        }
    }

    async _loadLastRunner(settings) {
        try {
            const lastRunnerId = settings?.lastRunnerId;
            if (lastRunnerId) {
                const runner = await this.service.getRunner(lastRunnerId);
                if (runner) {
                    this.currentRunnerId = lastRunnerId;
                    this.panel?.loadRunner(runner);
                    if (this.panel) {
                        this.panel.currentRunnerId = lastRunnerId;
                    }
                }
            }
        } catch (error) {
        }
    }

    /** @returns {void} */
    destroy() {
        this.panel?.destroy?.();
    }
}
