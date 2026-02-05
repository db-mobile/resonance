/**
 * @fileoverview UI Dialog for managing mock server
 * @module ui/MockServerDialog
 */

import { templateLoader } from '../templateLoader.js';

/**
 * UI Dialog for managing mock server
 *
 * @class
 * @classdesc Provides comprehensive interface for mock server management including
 * start/stop controls, port configuration, collection selection, endpoint delay
 * configuration, and request log viewing. Follows EnvironmentManager dialog pattern.
 */
export class MockServerDialog {
    /**
     * Creates a MockServerDialog instance
     *
     * @param {MockServerController} controller - Controller for mock server operations
     */
    constructor(controller) {
        this.controller = controller;
        this.dialog = null;
        this.resolve = null;
        this.statusPoller = null;
        this.logsPoller = null;
        this.escapeHandler = null;
    }

    /**
     * Shows the mock server dialog
     *
     * @returns {Promise<boolean>} Resolves when dialog is closed
     */
    show() {
        return new Promise((resolve) => {
            this.resolve = resolve;
            this.createDialog();
        });
    }

    /**
     * Creates and displays the dialog
     *
     * @async
     */
    async createDialog() {
        // Create overlay
        this.dialog = document.createElement('div');
        this.dialog.className = 'mock-server-overlay modal-overlay';

        const dialogContent = document.createElement('div');
        dialogContent.className = 'mock-server-dialog modal-dialog modal-dialog--mock-server';

        const t = (key, fallback) => window.i18n ? window.i18n.t(key) || fallback : fallback;

        const fragment = templateLoader.cloneSync(
            './src/templates/mockServer/mockServerDialog.html',
            'tpl-mock-server-dialog'
        );
        dialogContent.appendChild(fragment);

        const titleEl = dialogContent.querySelector('[data-role="title"]');
        if (titleEl) {
            titleEl.textContent = t('mock_server.title', 'Mock Server');
        }

        const statusStoppedEl = dialogContent.querySelector('[data-role="status-stopped"]');
        if (statusStoppedEl) {
            statusStoppedEl.textContent = t('mock_server.status_stopped', 'Stopped');
        }

        const startServerEl = dialogContent.querySelector('[data-role="start-server"]');
        if (startServerEl) {
            startServerEl.textContent = t('mock_server.start_server', 'Start Server');
        }

        const portLabelEl = dialogContent.querySelector('[data-role="port-label"]');
        if (portLabelEl) {
            portLabelEl.textContent = `${t('mock_server.port', 'Port')}:`;
        }

        const collectionsHeadingEl = dialogContent.querySelector('[data-role="collections-heading"]');
        if (collectionsHeadingEl) {
            collectionsHeadingEl.textContent = t('mock_server.collections_heading', 'COLLECTIONS TO MOCK');
        }

        const requestLogHeadingEl = dialogContent.querySelector('[data-role="request-log-heading"]');
        if (requestLogHeadingEl) {
            requestLogHeadingEl.textContent = t('mock_server.request_log_heading', 'REQUEST LOG');
        }

        const clearEl = dialogContent.querySelector('[data-role="clear"]');
        if (clearEl) {
            clearEl.textContent = t('mock_server.clear', 'Clear');
        }

        const closeEl = dialogContent.querySelector('[data-role="close"]');
        if (closeEl) {
            closeEl.textContent = t('mock_server.close', 'Close');
        }

        const closeBtn = dialogContent.querySelector('#mock-server-close-btn');
        if (closeBtn) {
            closeBtn.setAttribute('aria-label', t('mock_server.close', 'Close'));
        }

        this.dialog.appendChild(dialogContent);
        document.body.appendChild(this.dialog);

        // Setup event listeners
        this.setupEventListeners();

        // Load initial state
        await this.loadInitialState();

        // Start polling
        this.startStatusPolling();
        this.startLogsPolling();
    }

    /**
     * Sets up event listeners for the dialog
     */
    setupEventListeners() {
        const toggleBtn = this.dialog.querySelector('#mock-server-toggle-btn');
        const portInput = this.dialog.querySelector('#mock-server-port-input');
        const clearLogsBtn = this.dialog.querySelector('#mock-server-clear-logs-btn');
        const closeBtn = this.dialog.querySelector('#mock-server-close-btn');
        const closeBtn2 = this.dialog.querySelector('#mock-server-close-btn-2');

        // Toggle server
        toggleBtn.addEventListener('click', () => this.handleToggleServer());

        // Port change
        portInput.addEventListener('change', async (e) => {
            await this.handlePortChange(e.target.value);
        });

        // Clear logs
        clearLogsBtn.addEventListener('click', () => this.handleClearLogs());

        // Close buttons
        closeBtn.addEventListener('click', () => this.close());
        closeBtn2.addEventListener('click', () => this.close());

        // Close on overlay click
        this.dialog.addEventListener('click', (e) => {
            if (e.target === this.dialog) {
                this.close();
            }
        });

        // Close on Escape key
        this.escapeHandler = (e) => {
            if (e.key === 'Escape') {
                this.close();
            }
        };
        document.addEventListener('keydown', this.escapeHandler);
    }

    /**
     * Loads initial state of settings and collections
     *
     * @async
     */
    async loadInitialState() {
        try {
            const [settings, collections, status] = await Promise.all([
                this.controller.getSettings(),
                this.controller.getCollections(),
                this.controller.getStatus()
            ]);

            // Update port input
            const portInput = this.dialog.querySelector('#mock-server-port-input');
            portInput.value = settings.port;

            // Render collections
            await this.renderCollections(collections, settings);

            // Update status
            await this.updateStatusDisplay(status);
        } catch (error) {
            void error;
        }
    }

    /**
     * Renders collections with checkboxes and endpoint lists
     *
     * @async
     * @param {Array} collections - Array of collection objects
     * @param {Object} settings - Mock server settings
     */
    async renderCollections(collections, settings) {
        const container = this.dialog.querySelector('#mock-server-collections');
        const t = (key, fallback) => window.i18n ? window.i18n.t(key) || fallback : fallback;

        if (collections.length === 0) {
            const fragment = templateLoader.cloneSync(
                './src/templates/mockServer/mockServerDialog.html',
                'tpl-mock-server-empty-state'
            );
            const emptyEl = fragment.firstElementChild;
            const contentEl = emptyEl.querySelector('[data-role="content"]');
            if (contentEl) {
                const raw = t('mock_server.empty_collections', 'No collections available.<br>Import an OpenAPI or Postman collection first.');
                contentEl.innerHTML = '';
                String(raw)
                    .split(/<br\s*\/?\s*>/i)
                    .forEach((part, idx) => {
                        if (idx > 0) {
                            contentEl.appendChild(document.createElement('br'));
                        }
                        contentEl.appendChild(document.createTextNode(part));
                    });
            }
            container.innerHTML = '';
            container.appendChild(emptyEl);
            return;
        }

        container.innerHTML = '';

        for (const collection of collections) {
            const isEnabled = settings.enabledCollections.includes(collection.id);
            const endpoints = collection.endpoints || [];

            const collectionDiv = document.createElement('div');
            collectionDiv.className = 'mock-server-collection';

            // Collection header with toggle switch
            const headerDiv = document.createElement('div');
            headerDiv.className = 'mock-server-collection-header';
            headerDiv.classList.toggle('has-endpoints', Boolean(isEnabled && endpoints.length > 0));

            const toggleLabel = document.createElement('label');
            toggleLabel.className = 'toggle-switch';

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.checked = isEnabled;
            checkbox.dataset.collectionId = collection.id;
            checkbox.addEventListener('change', (e) => {
                this.handleToggleCollection(collection.id);
                e.stopPropagation();
            });

            const toggleTrack = document.createElement('span');
            toggleTrack.className = 'toggle-track';

            const labelText = document.createElement('span');
            labelText.className = 'mock-server-collection-label';
            labelText.textContent = `${collection.name} (${endpoints.length} ${t('mock_server.endpoints', 'endpoints')})`;

            toggleLabel.appendChild(checkbox);
            toggleLabel.appendChild(toggleTrack);
            toggleLabel.appendChild(labelText);
            headerDiv.appendChild(toggleLabel);
            collectionDiv.appendChild(headerDiv);

            // Endpoints list (only show if enabled)
            if (isEnabled && endpoints.length > 0) {
                const endpointsDiv = document.createElement('div');
                endpointsDiv.className = 'mock-server-endpoints';

                // Determine how many endpoints to show (10 by default, or all if expanded)
                const endpointsToShow = collection._showAllEndpoints ? endpoints : endpoints.slice(0, 10);

                for (const endpoint of endpointsToShow) {
                    const endpointDiv = document.createElement('div');
                    endpointDiv.className = 'mock-server-endpoint';

                    const methodSpan = document.createElement('span');
                    methodSpan.className = 'mock-server-endpoint-method';
                    methodSpan.textContent = endpoint.method.toUpperCase();

                    const pathSpan = document.createElement('span');
                    pathSpan.className = 'mock-server-endpoint-path';
                    pathSpan.textContent = endpoint.path;

                    const editResponseBtn = document.createElement('button');
                    editResponseBtn.className = 'mock-server-edit-response-btn';
                    {
                        const iconEl = document.createElement('span');
                        iconEl.className = 'icon icon-12 icon-pencil';
                        const labelEl = document.createElement('span');
                        labelEl.textContent = t('mock_server.edit_response', 'Edit');
                        editResponseBtn.appendChild(iconEl);
                        editResponseBtn.appendChild(labelEl);
                    }
                    editResponseBtn.title = t('mock_server.edit_response_tooltip', 'Edit custom response');
                    editResponseBtn.addEventListener('click', () => {
                        this.showResponseEditor(collection, endpoint);
                    });

                    endpointDiv.appendChild(methodSpan);
                    endpointDiv.appendChild(pathSpan);
                    endpointDiv.appendChild(editResponseBtn);

                    endpointsDiv.appendChild(endpointDiv);
                }

                if (endpoints.length > 10 && !collection._showAllEndpoints) {
                    const moreDiv = document.createElement('div');
                    moreDiv.className = 'mock-server-endpoints-toggle';
                    const showAllText = window.i18n ?
                        window.i18n.t('mock_server.show_all_endpoints', { count: endpoints.length }) || `Show all ${endpoints.length} endpoints` :
                        `Show all ${endpoints.length} endpoints`;
                    {
                        const labelEl = document.createElement('span');
                        labelEl.textContent = showAllText;
                        const iconEl = document.createElement('span');
                        iconEl.className = 'icon icon-12 icon-chevron-down';
                        moreDiv.appendChild(labelEl);
                        moreDiv.appendChild(iconEl);
                    }
                    moreDiv.addEventListener('click', async () => {
                        collection._showAllEndpoints = true;
                        await this.renderCollections(collections, settings);
                    });
                    endpointsDiv.appendChild(moreDiv);
                } else if (endpoints.length > 10 && collection._showAllEndpoints) {
                    const lessDiv = document.createElement('div');
                    lessDiv.className = 'mock-server-endpoints-toggle';
                    {
                        const labelEl = document.createElement('span');
                        labelEl.textContent = t('mock_server.show_less', 'Show less');
                        const iconEl = document.createElement('span');
                        iconEl.className = 'icon icon-12 icon-chevron-up';
                        lessDiv.appendChild(labelEl);
                        lessDiv.appendChild(iconEl);
                    }
                    lessDiv.addEventListener('click', async () => {
                        collection._showAllEndpoints = false;
                        await this.renderCollections(collections, settings);
                    });
                    endpointsDiv.appendChild(lessDiv);
                }

                collectionDiv.appendChild(endpointsDiv);
            }

            container.appendChild(collectionDiv);
        }
    }

    /**
     * Handles server start/stop toggle
     *
     * @async
     */
    async handleToggleServer() {
        try {
            const toggleBtn = this.dialog.querySelector('#mock-server-toggle-btn');
            toggleBtn.disabled = true;

            const status = await this.controller.getStatus();

            let result;
            if (status.running) {
                result = await this.controller.handleStop();
            } else {
                result = await this.controller.handleStart();
            }

            if (!result.success) {
                this.showAlert(result.message);
            }

            // Update status immediately
            await this.updateStatus();

            toggleBtn.disabled = false;
        } catch (error) {
            const t = (key, fallback) => window.i18n ? window.i18n.t(key) || fallback : fallback;
            this.showAlert(error.message || t('mock_server.error_toggle_server', 'Failed to toggle server'));
        }
    }

    /**
     * Handles port change
     *
     * @async
     * @param {string} port - New port value
     */
    async handlePortChange(port) {
        try {
            const result = await this.controller.handleUpdatePort(port);
            if (!result.success) {
                this.showAlert(result.message);
                // Revert to previous value
                const settings = await this.controller.getSettings();
                const portInput = this.dialog.querySelector('#mock-server-port-input');
                portInput.value = settings.port;
            }
        } catch (error) {
            void error;
        }
    }

    /**
     * Handles collection enable/disable toggle
     *
     * @async
     * @param {string} collectionId - Collection ID to toggle
     */
    async handleToggleCollection(collectionId) {
        try {
            const result = await this.controller.handleToggleCollection(collectionId);

            if (result.success) {
                // Reload collections to show/hide endpoints
                const [settings, collections] = await Promise.all([
                    this.controller.getSettings(),
                    this.controller.getCollections()
                ]);
                await this.renderCollections(collections, settings);
            }
        } catch (error) {
            void error;
        }
    }

    /**
     * Handles endpoint delay change
     *
     * @async
     * @param {string} collectionId - Collection ID
     * @param {string} endpointId - Endpoint ID
     * @param {number} delayMs - Delay in milliseconds
     */
    async handleSetDelay(collectionId, endpointId, delayMs) {
        try {
            const result = await this.controller.handleSetDelay(collectionId, endpointId, delayMs);
            if (!result.success) {
                this.showAlert(result.message);
            }
        } catch (error) {
            void error;
        }
    }

    /**
     * Handles clear logs action
     *
     * @async
     */
    async handleClearLogs() {
        try {
            await this.controller.clearRequestLogs();
            await this.updateLogs();
        } catch (error) {
            void error;
        }
    }

    /**
     * Starts status polling
     */
    startStatusPolling() {
        this.updateStatus();
        this.statusPoller = setInterval(() => {
            this.updateStatus();
        }, 1000);
    }

    /**
     * Starts logs polling
     */
    startLogsPolling() {
        this.updateLogs();
        this.logsPoller = setInterval(() => {
            this.updateLogs();
        }, 2000);
    }

    /**
     * Updates server status display
     *
     * @async
     */
    async updateStatus() {
        try {
            const status = await this.controller.getStatus();
            await this.updateStatusDisplay(status);
        } catch (error) {
            void error;
        }
    }

    /**
     * Updates status display elements
     *
     * @param {Object} status - Status object
     */
    async updateStatusDisplay(status) {
        const indicator = this.dialog.querySelector('#mock-server-status-indicator');
        const statusText = this.dialog.querySelector('#mock-server-status-text');
        const urlText = this.dialog.querySelector('#mock-server-url');
        const toggleBtn = this.dialog.querySelector('#mock-server-toggle-btn');
        const portInput = this.dialog.querySelector('#mock-server-port-input');
        const t = (key, fallback) => window.i18n ? window.i18n.t(key) || fallback : fallback;

        if (status.running) {
            indicator.textContent = '●';
            indicator.classList.add('is-running');
            statusText.textContent = t('mock_server.status_running', 'Running');
            urlText.textContent = `http://localhost:${status.port}`;
            toggleBtn.textContent = t('mock_server.stop_server', 'Stop Server');
            toggleBtn.classList.remove('btn-primary');
            toggleBtn.classList.add('btn-danger');
            portInput.disabled = true;
        } else {
            indicator.textContent = '○';
            indicator.classList.remove('is-running');
            statusText.textContent = t('mock_server.status_stopped', 'Stopped');
            urlText.textContent = '';
            toggleBtn.textContent = t('mock_server.start_server', 'Start Server');
            toggleBtn.classList.remove('btn-danger');
            toggleBtn.classList.add('btn-primary');
            portInput.disabled = false;
        }
    }

    /**
     * Updates request logs display
     *
     * @async
     */
    async updateLogs() {
        try {
            const logs = await this.controller.getRequestLogs(20);
            const container = this.dialog.querySelector('#mock-server-logs');
            const t = (key, fallback) => window.i18n ? window.i18n.t(key) || fallback : fallback;

            if (!container) {
                return;
            }

            if (!logs || logs.length === 0) {
                const fragment = templateLoader.cloneSync(
                    './src/templates/mockServer/mockServerDialog.html',
                    'tpl-mock-server-logs-empty'
                );
                const emptyEl = fragment.firstElementChild;
                const contentEl = emptyEl.querySelector('[data-role="content"]');
                if (contentEl) {
                    contentEl.textContent = t('mock_server.empty_logs', 'No requests logged yet.');
                }
                container.innerHTML = '';
                container.appendChild(emptyEl);
                return;
            }

            const tableFragment = templateLoader.cloneSync(
                './src/templates/mockServer/mockServerDialog.html',
                'tpl-mock-server-logs-table'
            );
            const tableEl = tableFragment.firstElementChild;
            const tbodyEl = tableEl.querySelector('[data-role="tbody"]');

            const thTimeEl = tableEl.querySelector('[data-role="th-time"]');
            const thMethodEl = tableEl.querySelector('[data-role="th-method"]');
            const thPathEl = tableEl.querySelector('[data-role="th-path"]');
            const thStatusEl = tableEl.querySelector('[data-role="th-status"]');
            const thTimeMsEl = tableEl.querySelector('[data-role="th-time-ms"]');

            if (thTimeEl) {thTimeEl.textContent = t('mock_server.log_time', 'Time');}
            if (thMethodEl) {thMethodEl.textContent = t('mock_server.log_method', 'Method');}
            if (thPathEl) {thPathEl.textContent = t('mock_server.log_path', 'Path');}
            if (thStatusEl) {thStatusEl.textContent = t('mock_server.log_status', 'Status');}
            if (thTimeMsEl) {thTimeMsEl.textContent = t('mock_server.log_time_ms', 'Time (ms)');}

            logs.forEach(log => {
                const rowFragment = templateLoader.cloneSync(
                    './src/templates/mockServer/mockServerDialog.html',
                    'tpl-mock-server-logs-row'
                );
                const rowEl = rowFragment.firstElementChild;

                const time = new Date(log.timestamp).toLocaleTimeString();
                const statusClass = log.responseStatus === 200 ? 'is-success' :
                    log.responseStatus === 404 ? 'is-warning' :
                        'is-danger';

                const timeEl = rowEl.querySelector('[data-role="time"]');
                const methodEl = rowEl.querySelector('[data-role="method"]');
                const pathEl = rowEl.querySelector('[data-role="path"]');
                const statusEl = rowEl.querySelector('[data-role="status"]');
                const timeMsEl = rowEl.querySelector('[data-role="time-ms"]');

                if (timeEl) {timeEl.textContent = time;}
                if (methodEl) {methodEl.textContent = log.method;}
                if (pathEl) {
                    pathEl.textContent = log.path;
                    pathEl.title = log.path;
                }
                if (statusEl) {
                    statusEl.textContent = log.responseStatus;
                    statusEl.classList.add(statusClass);
                }
                if (timeMsEl) {timeMsEl.textContent = log.responseTime;}

                tbodyEl.appendChild(rowEl);
            });

            container.innerHTML = '';
            container.appendChild(tableEl);
        } catch (error) {
            void error;
        }
    }

    /**
     * Shows alert dialog
     *
     * @param {string} message - Alert message
     */
    showAlert(message) {
        const t = (key, fallback) => window.i18n ? window.i18n.t(key) || fallback : fallback;
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';

        const dialog = document.createElement('div');
        dialog.className = 'modal-dialog modal-dialog--sm';

        const fragment = templateLoader.cloneSync(
            './src/templates/mockServer/mockServerDialog.html',
            'tpl-mock-server-alert'
        );
        dialog.appendChild(fragment);

        const messageEl = dialog.querySelector('[data-role="message"]');
        if (messageEl) {
            messageEl.textContent = message;
        }

        const okTextEl = dialog.querySelector('[data-role="ok"]');
        if (okTextEl) {
            okTextEl.textContent = t('mock_server.ok', 'OK');
        }

        overlay.appendChild(dialog);
        document.body.appendChild(overlay);

        const okBtn = dialog.querySelector('#alert-ok');
        const cleanup = () => {
            document.body.removeChild(overlay);
        };

        okBtn.addEventListener('click', cleanup);
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {cleanup();}
        });
    }

    /**
     * Shows response editor dialog
     *
     * @async
     * @param {Object} collection - Collection object
     * @param {Object} endpoint - Endpoint object
     */
    async showResponseEditor(collection, endpoint) {
        const t = (key, fallback) => window.i18n ? window.i18n.t(key) || fallback : fallback;

        // Get custom response or default
        const customResponse = await this.controller.getCustomResponse(collection.id, endpoint.id);
        const hasCustomResponse = customResponse !== null;

        // Get current delay
        const settings = await this.controller.getSettings();
        const delayKey = `${collection.id}_${endpoint.id}`;
        const currentDelay = settings.endpointDelays[delayKey] || 0;

        // Get current status code
        const customStatusCode = await this.controller.getCustomStatusCode(collection.id, endpoint.id);
        const currentStatusCode = customStatusCode || this.getDefaultStatusCode(endpoint);

        // For default, we'll generate it from the endpoint schema (similar to mock server)
        const defaultResponse = this.generateDefaultResponse(endpoint);
        const currentResponse = customResponse || defaultResponse;

        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';

        const dialog = document.createElement('div');
        dialog.className = 'modal-dialog modal-dialog--mock-server-response-editor';

        const fragment = templateLoader.cloneSync(
            './src/templates/mockServer/mockServerDialog.html',
            'tpl-mock-server-response-editor'
        );
        dialog.appendChild(fragment);

        const titleEl = dialog.querySelector('[data-role="title"]');
        if (titleEl) {
            titleEl.textContent = t('mock_server.edit_response_title', 'Edit Response');
        }

        const subtitleEl = dialog.querySelector('[data-role="subtitle"]');
        if (subtitleEl) {
            subtitleEl.textContent = `${endpoint.method.toUpperCase()} ${endpoint.path}`;
        }

        const closeBtn = dialog.querySelector('#response-editor-close');
        if (closeBtn) {
            closeBtn.setAttribute('aria-label', t('mock_server.close', 'Close'));
        }

        const customNoticeEl = dialog.querySelector('[data-role="custom-notice"]');
        if (customNoticeEl) {
            customNoticeEl.classList.toggle('is-hidden', !hasCustomResponse);
            if (hasCustomResponse) {
                customNoticeEl.textContent = t('mock_server.using_custom_response', 'Using custom response');
            }
        }

        const delayLabelEl = dialog.querySelector('[data-role="delay-label"]');
        if (delayLabelEl) {
            delayLabelEl.textContent = t('mock_server.delay', 'Delay (ms)');
        }
        const statusCodeLabelEl = dialog.querySelector('[data-role="status-code-label"]');
        if (statusCodeLabelEl) {
            statusCodeLabelEl.textContent = t('mock_server.status_code', 'Status Code');
        }
        const bodyLabelEl = dialog.querySelector('[data-role="body-label"]');
        if (bodyLabelEl) {
            bodyLabelEl.textContent = t('mock_server.response_body', 'Response Body (JSON)');
        }

        const resetTextEl = dialog.querySelector('[data-role="reset"]');
        if (resetTextEl) {
            resetTextEl.textContent = t('mock_server.reset_to_default', 'Reset to Default');
        }
        const cancelTextEl = dialog.querySelector('[data-role="cancel"]');
        if (cancelTextEl) {
            cancelTextEl.textContent = t('common.cancel', 'Cancel');
        }
        const saveTextEl = dialog.querySelector('[data-role="save"]');
        if (saveTextEl) {
            saveTextEl.textContent = t('common.save', 'Save');
        }

        overlay.appendChild(dialog);
        document.body.appendChild(overlay);

        const textarea = dialog.querySelector('#response-editor-textarea');
        const delayInput = dialog.querySelector('#response-editor-delay');
        const statusCodeInput = dialog.querySelector('#response-editor-status-code');
        const errorDiv = dialog.querySelector('#response-editor-error');
        const saveBtn = dialog.querySelector('#response-editor-save');
        const cancelBtn = dialog.querySelector('#response-editor-cancel');
        const resetBtn = dialog.querySelector('#response-editor-reset');
        const _closeBtn = dialog.querySelector('#response-editor-close');

        if (delayInput) {
            delayInput.value = String(currentDelay);
        }
        if (statusCodeInput) {
            statusCodeInput.value = String(currentStatusCode);
        }
        if (textarea) {
            textarea.value = JSON.stringify(currentResponse, null, 2);
        }
        if (errorDiv) {
            errorDiv.textContent = '';
        }

        const cleanup = () => {
            document.body.removeChild(overlay);
        };

        // Validate JSON on input
        textarea.addEventListener('input', () => {
            try {
                JSON.parse(textarea.value);
                errorDiv.textContent = '';
                saveBtn.disabled = false;
            } catch (e) {
                errorDiv.textContent = t('mock_server.invalid_json', `Invalid JSON: ${e.message}`);
                saveBtn.disabled = true;
            }
        });

        // Save custom response, delay, and status code
        saveBtn.addEventListener('click', async () => {
            try {
                const response = JSON.parse(textarea.value);
                const delay = parseInt(delayInput.value, 10);
                const statusCode = parseInt(statusCodeInput.value, 10);

                // Validate delay
                if (delay < 0 || delay > 30000) {
                    errorDiv.textContent = 'Delay must be between 0 and 30000ms';
                    return;
                }

                // Validate status code
                if (statusCode < 100 || statusCode > 599) {
                    errorDiv.textContent = 'Status code must be between 100 and 599';
                    return;
                }

                // Save all three settings sequentially to avoid race condition
                const delayResult = await this.controller.handleSetDelay(collection.id, endpoint.id, delay);
                const statusCodeResult = await this.controller.handleSetCustomStatusCode(collection.id, endpoint.id, statusCode);
                const responseResult = await this.controller.handleSetCustomResponse(collection.id, endpoint.id, response);

                if (responseResult.success && delayResult.success && statusCodeResult.success) {
                    cleanup();
                    // Refresh the collections display
                    const [updatedSettings, collections] = await Promise.all([
                        this.controller.getSettings(),
                        this.controller.getCollections()
                    ]);
                    await this.renderCollections(collections, updatedSettings);
                } else {
                    errorDiv.textContent = responseResult.message || delayResult.message || statusCodeResult.message;
                }
            } catch (e) {
                errorDiv.textContent = t('mock_server.invalid_json', `Invalid JSON: ${e.message}`);
            }
        });

        // Reset to default (response, delay, and status code)
        resetBtn.addEventListener('click', async () => {
            const delayResult = await this.controller.handleSetDelay(collection.id, endpoint.id, 0);
            const statusCodeResult = await this.controller.handleSetCustomStatusCode(collection.id, endpoint.id, null);
            const responseResult = await this.controller.handleSetCustomResponse(collection.id, endpoint.id, null);
            if (responseResult.success && delayResult.success && statusCodeResult.success) {
                cleanup();
                const [updatedSettings, collections] = await Promise.all([
                    this.controller.getSettings(),
                    this.controller.getCollections()
                ]);
                await this.renderCollections(collections, updatedSettings);
            }
        });

        // Close handlers
        const closeHandler = () => cleanup();
        cancelBtn.addEventListener('click', closeHandler);
        _closeBtn.addEventListener('click', closeHandler);
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                closeHandler();
            }
        });

        // Escape key
        const escapeHandler = (e) => {
            if (e.key === 'Escape') {
                closeHandler();
                document.removeEventListener('keydown', escapeHandler);
            }
        };
        document.addEventListener('keydown', escapeHandler);
    }

    /**
     * Generates default response from endpoint schema
     *
     * @param {Object} endpoint - Endpoint object
     * @returns {Object} Default response object
     */
    generateDefaultResponse(endpoint) {
        // Simple default response generation
        // In production, this would use the schema processor
        let schema = null;

        // Try to find response schema
        if (endpoint.responses?.['200']?.content?.['application/json']?.schema) {
            ({ schema } = endpoint.responses['200'].content['application/json']);
        } else if (['POST', 'PUT'].includes(endpoint.method.toUpperCase()) &&
                   endpoint.responses?.['201']?.content?.['application/json']?.schema) {
            ({ schema } = endpoint.responses['201'].content['application/json']);
        }

        // Return a basic example if no schema
        if (!schema) {
            return {
                message: 'Success',
                data: {}
            };
        }

        // Return the example or a basic object
        return schema.example || { message: 'Success' };
    }

    /**
     * Gets default status code based on endpoint method
     *
     * @param {Object} endpoint - Endpoint object
     * @returns {number} Default status code
     */
    getDefaultStatusCode(endpoint) {
        const method = endpoint.method.toUpperCase();

        // Return appropriate default based on HTTP method
        switch (method) {
            case 'POST':
                return 201; // Created
            case 'DELETE':
                return 204; // No Content
            case 'GET':
            case 'PUT':
            case 'PATCH':
            case 'HEAD':
            case 'OPTIONS':
            default:
                return 200; // OK
        }
    }

    /**
     * Escapes HTML to prevent XSS
     *
     * @param {string} text - Text to escape
     * @returns {string} Escaped text
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * Closes the dialog
     */
    close() {
        // Stop polling
        if (this.statusPoller) {
            clearInterval(this.statusPoller);
            this.statusPoller = null;
        }

        if (this.logsPoller) {
            clearInterval(this.logsPoller);
            this.logsPoller = null;
        }

        // Remove escape handler
        if (this.escapeHandler) {
            document.removeEventListener('keydown', this.escapeHandler);
            this.escapeHandler = null;
        }

        // Remove dialog from DOM
        if (this.dialog) {
            document.body.removeChild(this.dialog);
            this.dialog = null;
        }

        // Resolve promise
        if (this.resolve) {
            this.resolve(true);
            this.resolve = null;
        }
    }
}
