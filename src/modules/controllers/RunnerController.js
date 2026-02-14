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
import { templateLoader } from '../templateLoader.js';

/**
 * Controller for coordinating collection runner operations
 *
 * @class
 * @classdesc Mediates between the runner UI panel, service layer, and workspace
 * tab system. Handles runner lifecycle, execution coordination, and saved
 * runners management.
 */
export class RunnerController {
    /**
     * Creates a RunnerController instance
     *
     * @param {Object} backendAPI - Backend API for HTTP requests and storage
     * @param {Function} getCollections - Function to get available collections
     */
    constructor(backendAPI, getCollections) {
        this.backendAPI = backendAPI;
        this.getCollections = getCollections;

        const statusDisplay = new StatusDisplayAdapter(updateStatusDisplay);
        this.repository = new RunnerRepository(backendAPI);
        this.service = new RunnerService(this.repository, backendAPI, statusDisplay);

        this.panel = null;
        this.currentRunnerId = null;

        // Bind methods
        this._handleSave = this._handleSave.bind(this);
        this._handleLoadRunners = this._handleLoadRunners.bind(this);
        this._handleRunnerSelect = this._handleRunnerSelect.bind(this);
        this._handleNewRunner = this._handleNewRunner.bind(this);
        this._handleRunnerDelete = this._handleRunnerDelete.bind(this);
        this._handleRun = this._handleRun.bind(this);
        this._handleStop = this._handleStop.bind(this);
    }

    /**
     * Initializes the runner panel in a container
     *
     * @async
     * @param {HTMLElement} container - Container element for the panel
     */
    async initialize(container) {
        this.panel = new RunnerPanel(container);

        // Set up callbacks
        this.panel.onRunnerSave = this._handleSave;
        this.panel.onLoadRunners = this._handleLoadRunners;
        this.panel.onRunnerSelect = this._handleRunnerSelect;
        this.panel.onNewRunner = this._handleNewRunner;
        this.panel.onRunnerDelete = this._handleRunnerDelete;
        this.panel.onRun = this._handleRun;
        this.panel.onStop = this._handleStop;

        // Get collections and render
        const collections = await this.getCollections();
        this.panel.render(collections);

        // Listen for service events
        this.service.addListener((event, data) => {
            this._handleServiceEvent(event, data);
        });

        // Load last opened runner
        await this._loadLastRunner();
    }

    /**
     * Handles save runner action
     *
     * @private
     * @async
     * @param {Object} runnerData - Runner configuration
     */
    async _handleSave(runnerData) {
        try {
            if (this.currentRunnerId) {
                // Update existing runner
                await this.service.updateRunner(this.currentRunnerId, runnerData);
            } else {
                // Create new runner
                const runner = await this.service.createRunner(runnerData);
                this.currentRunnerId = runner.id;
            }
        } catch (error) {
            updateStatusDisplay(`Error saving runner: ${error.message}`, null);
        }
    }

    /**
     * Returns all saved runners for the dropdown
     *
     * @private
     * @async
     * @returns {Promise<Array>} Array of saved runners
     */
    async _handleLoadRunners() {
        try {
            return await this.service.getAllRunners();
        } catch (error) {
            console.error('Error loading runners:', error);
            return [];
        }
    }

    /**
     * Handles runner selection from dropdown
     *
     * @private
     * @async
     * @param {string} runnerId - Selected runner ID
     */
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
            updateStatusDisplay(`Error loading runner: ${error.message}`, null);
        }
    }

    /**
     * Handles new runner button click
     *
     * @private
     */
    _handleNewRunner() {
        this.currentRunnerId = null;
        if (this.panel) {
            this.panel.currentRunnerId = null;
        }
    }

    /**
     * Handles runner deletion
     *
     * @private
     * @async
     * @param {string} runnerId - Runner ID to delete
     */
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
            // Reset the panel
            this.panel?._handleNewRunner();
            updateStatusDisplay('Runner deleted', null);
        } catch (error) {
            updateStatusDisplay(`Error deleting runner: ${error.message}`, null);
        }
    }

    /**
     * Shows the saved runners dialog
     *
     * @private
     * @param {Array<Object>} runners - Array of saved runners
     */
    _showSavedRunnersDialog(runners) {
        const fragment = templateLoader.cloneSync(
            './src/templates/runner/runnerPanel.html',
            'tpl-runner-saved-list'
        );

        const overlay = fragment.firstElementChild;
        document.body.appendChild(overlay);

        const listContainer = overlay.querySelector('[data-role="saved-list"]');
        const closeButtons = overlay.querySelectorAll('[data-action="close"]');

        // Close handlers
        const closeDialog = () => {
            overlay.remove();
        };

        closeButtons.forEach(btn => btn.addEventListener('click', closeDialog));
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {closeDialog();}
        });

        // Render runners
        if (runners.length === 0) {
            listContainer.innerHTML = `
                <div class="runner-empty-state">
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

        if (window.i18n && window.i18n.updateUI) {
            window.i18n.updateUI();
        }
    }

    /**
     * Creates a saved runner item element
     *
     * @private
     * @param {Object} runner - Runner object
     * @param {Function} closeDialog - Function to close the dialog
     * @returns {HTMLElement} Runner item element
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

        // Load button
        el.querySelector('[data-action="load"]')?.addEventListener('click', async () => {
            await this._loadRunner(runner.id);
            closeDialog();
        });

        // Delete button
        el.querySelector('[data-action="delete"]')?.addEventListener('click', async () => {
            if (confirm(`Delete runner "${runner.name}"?`)) {
                await this.service.deleteRunner(runner.id);
                el.remove();

                // Check if list is now empty
                const listContainer = el.parentElement;
                if (listContainer && listContainer.children.length === 0) {
                    listContainer.innerHTML = `
                        <div class="runner-empty-state">
                            <p>No saved runners yet</p>
                        </div>
                    `;
                }
            }
        });

        return el;
    }

    /**
     * Loads a runner into the panel
     *
     * @private
     * @async
     * @param {string} runnerId - Runner ID to load
     */
    async _loadRunner(runnerId) {
        try {
            const runner = await this.service.getRunner(runnerId);
            if (runner) {
                this.currentRunnerId = runnerId;
                this.panel?.loadRunner(runner);
                updateStatusDisplay(`Loaded runner: ${runner.name}`, null);
            }
        } catch (error) {
            updateStatusDisplay(`Error loading runner: ${error.message}`, null);
        }
    }

    /**
     * Handles run action
     *
     * @private
     * @async
     * @param {Object} runnerData - Runner configuration
     */
    async _handleRun(runnerData) {
        try {
            // Save runner first if it has a name
            let runnerId = this.currentRunnerId;

            if (!runnerId && runnerData.name && runnerData.name !== 'Untitled Runner') {
                const runner = await this.service.createRunner(runnerData);
                runnerId = runner.id;
                this.currentRunnerId = runnerId;
            }

            // If we have a saved runner, update it before running
            if (runnerId) {
                await this.service.updateRunner(runnerId, runnerData);
            }

            // Execute the runner - use executeRunnerData for unsaved runners
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
            updateStatusDisplay(`Runner error: ${error.message}`, null);
            this.panel?.showResults({ error: error.message });
        }
    }

    /**
     * Handles stop action
     *
     * @private
     */
    _handleStop() {
        this.service.stopExecution();
    }

    /**
     * Handles service events
     *
     * @private
     * @param {string} event - Event type
     * @param {*} data - Event data
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

    /**
     * Creates a new runner tab
     *
     * @returns {Object} Tab configuration for workspace tab system
     */
    static createRunnerTab() {
        return {
            type: 'runner',
            name: 'Collection Runner',
            icon: 'play'
        };
    }

    /**
     * Checks if this controller manages a runner tab
     *
     * @param {Object} tab - Tab object
     * @returns {boolean} True if this is a runner tab
     */
    static isRunnerTab(tab) {
        return tab?.type === 'runner';
    }

    /**
     * Saves the last opened runner ID to settings
     *
     * @private
     * @async
     * @param {string|null} runnerId - Runner ID to save
     */
    async _saveLastRunnerId(runnerId) {
        try {
            const settings = await this.backendAPI.settings.get() || {};
            settings.lastRunnerId = runnerId;
            await this.backendAPI.settings.set(settings);
        } catch (error) {
            // Silently fail - not critical
        }
    }

    /**
     * Loads the last opened runner on initialization
     *
     * @private
     * @async
     */
    async _loadLastRunner() {
        try {
            const settings = await this.backendAPI.settings.get();
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
            // Silently fail - not critical
        }
    }
}
