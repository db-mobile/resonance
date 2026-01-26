/**
 * @fileoverview UI Dialog for managing mock server
 * @module ui/MockServerDialog
 */

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
        this.dialog.className = 'mock-server-overlay';
        this.dialog.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.5);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10000;
        `;

        const dialogContent = document.createElement('div');
        dialogContent.className = 'mock-server-dialog';
        dialogContent.style.cssText = `
            background: var(--bg-primary);
            border-radius: var(--radius-xl);
            padding: 24px;
            width: 90vw;
            max-width: 1200px;
            max-height: 85vh;
            display: flex;
            flex-direction: column;
            box-shadow: var(--shadow-xl);
            border: 1px solid var(--border-light);
        `;

        const t = (key, fallback) => window.i18n ? window.i18n.t(key) || fallback : fallback;

        dialogContent.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
                <h3 style="margin: 0; color: var(--text-primary);">${t('mock_server.title', 'Mock Server')}</h3>
                <button id="mock-server-close-btn" style="background: none; border: none; color: var(--text-secondary); cursor: pointer; font-size: 24px; padding: 0; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center;" aria-label="${t('mock_server.close', 'Close')}">&times;</button>
            </div>

            <!-- Status Section -->
            <div style="background: var(--bg-secondary); padding: 16px; border-radius: var(--radius-md); margin-bottom: 16px;">
                <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 12px;">
                    <span id="mock-server-status-indicator" style="font-size: 20px;">○</span>
                    <span id="mock-server-status-text" style="color: var(--text-primary); font-weight: 500;">${t('mock_server.status_stopped', 'Stopped')}</span>
                    <span id="mock-server-url" style="color: var(--text-secondary); font-size: 13px;"></span>
                </div>
                <div style="display: flex; gap: 12px; align-items: center;">
                    <button id="mock-server-toggle-btn" style="padding: 8px 16px; border: none; background: var(--color-primary); color: white; border-radius: var(--radius-sm); cursor: pointer; font-weight: 500;">${t('mock_server.start_server', 'Start Server')}</button>
                    <label style="display: flex; align-items: center; gap: 8px; color: var(--text-secondary); font-size: 14px;">
                        ${t('mock_server.port', 'Port')}:
                        <input
                            type="number"
                            id="mock-server-port-input"
                            min="1024"
                            max="65535"
                            value="3000"
                            style="width: 100px; padding: 6px 10px; border: 1px solid var(--border-light); border-radius: var(--radius-sm); background: var(--bg-primary); color: var(--text-primary);"
                        />
                    </label>
                </div>
            </div>

            <div style="display: flex; gap: 16px; flex: 1; overflow: hidden;">
                <!-- Collections Section -->
                <div style="flex: 1; display: flex; flex-direction: column; border-right: 1px solid var(--border-light); padding-right: 16px; overflow: hidden;">
                    <h4 style="margin: 0 0 12px 0; font-size: 14px; color: var(--text-secondary);">${t('mock_server.collections_heading', 'COLLECTIONS TO MOCK')}</h4>
                    <div id="mock-server-collections" style="flex: 1; overflow-y: auto;"></div>
                </div>

                <!-- Request Log Section -->
                <div style="flex: 1; display: flex; flex-direction: column; overflow: hidden;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                        <h4 style="margin: 0; font-size: 14px; color: var(--text-secondary);">${t('mock_server.request_log_heading', 'REQUEST LOG')}</h4>
                        <button id="mock-server-clear-logs-btn" style="padding: 4px 12px; border: 1px solid var(--border-light); background: transparent; color: var(--text-secondary); border-radius: var(--radius-sm); cursor: pointer; font-size: 12px;">${t('mock_server.clear', 'Clear')}</button>
                    </div>
                    <div id="mock-server-logs" style="flex: 1; overflow-y: auto; font-family: monospace; font-size: 12px;"></div>
                </div>
            </div>

            <div style="display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px; padding-top: 16px; border-top: 1px solid var(--border-light);">
                <button id="mock-server-close-btn-2" style="padding: 8px 16px; border: 1px solid var(--border-light); background: transparent; color: var(--text-primary); border-radius: var(--radius-sm); cursor: pointer;">${t('mock_server.close', 'Close')}</button>
            </div>
        `;

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
            container.innerHTML = `
                <div style="text-align: center; color: var(--text-secondary); padding: 40px 20px;">
                    ${t('mock_server.empty_collections', 'No collections available.<br>Import an OpenAPI or Postman collection first.')}
                </div>
            `;
            return;
        }

        container.innerHTML = '';

        for (const collection of collections) {
            const isEnabled = settings.enabledCollections.includes(collection.id);
            const endpoints = collection.endpoints || [];

            const collectionDiv = document.createElement('div');
            collectionDiv.style.cssText = `
                margin-bottom: 16px;
                border: 1px solid var(--border-light);
                border-radius: var(--radius-sm);
                padding: 12px;
                background: var(--bg-secondary);
            `;

            // Collection header with checkbox
            const headerDiv = document.createElement('div');
            headerDiv.style.cssText = `
                display: flex;
                align-items: center;
                gap: 8px;
                margin-bottom: ${isEnabled && endpoints.length > 0 ? '12px' : '0'};
                cursor: pointer;
            `;

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.checked = isEnabled;
            checkbox.dataset.collectionId = collection.id;
            checkbox.addEventListener('change', (e) => {
                this.handleToggleCollection(collection.id);
                e.stopPropagation();
            });

            const label = document.createElement('label');
            label.style.cssText = `
                flex: 1;
                color: var(--text-primary);
                font-weight: 500;
                cursor: pointer;
            `;
            label.textContent = `${collection.name} (${endpoints.length} ${t('mock_server.endpoints', 'endpoints')})`;
            label.addEventListener('click', () => checkbox.click());

            headerDiv.appendChild(checkbox);
            headerDiv.appendChild(label);
            collectionDiv.appendChild(headerDiv);

            // Endpoints list (only show if enabled)
            if (isEnabled && endpoints.length > 0) {
                const endpointsDiv = document.createElement('div');
                endpointsDiv.style.cssText = `
                    padding-left: 24px;
                    border-left: 2px solid var(--border-light);
                    margin-left: 8px;
                `;

                // Determine how many endpoints to show (10 by default, or all if expanded)
                const endpointsToShow = collection._showAllEndpoints ? endpoints : endpoints.slice(0, 10);

                for (const endpoint of endpointsToShow) {
                    const endpointDiv = document.createElement('div');
                    endpointDiv.style.cssText = `
                        display: flex;
                        align-items: center;
                        gap: 12px;
                        margin-bottom: 8px;
                        font-size: 13px;
                    `;

                    const methodSpan = document.createElement('span');
                    methodSpan.style.cssText = `
                        display: inline-block;
                        padding: 2px 6px;
                        background: var(--color-primary-light);
                        color: var(--color-primary);
                        border-radius: var(--radius-sm);
                        font-weight: 600;
                        font-size: 11px;
                        min-width: 45px;
                        text-align: center;
                    `;
                    methodSpan.textContent = endpoint.method.toUpperCase();

                    const pathSpan = document.createElement('span');
                    pathSpan.style.cssText = `
                        flex: 1;
                        color: var(--text-secondary);
                        overflow: hidden;
                        text-overflow: ellipsis;
                        white-space: nowrap;
                    `;
                    pathSpan.textContent = endpoint.path;

                    const editResponseBtn = document.createElement('button');
                    editResponseBtn.style.cssText = `
                        padding: 4px 8px;
                        border: 1px solid var(--border-light);
                        background: var(--bg-primary);
                        color: var(--color-primary);
                        border-radius: var(--radius-sm);
                        cursor: pointer;
                        font-size: 11px;
                        margin-left: 8px;
                        display: flex;
                        align-items: center;
                        gap: 4px;
                    `;
                    editResponseBtn.innerHTML = `
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                        </svg>
                        <span>${t('mock_server.edit_response', 'Edit')}</span>
                    `;
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
                    moreDiv.style.cssText = `
                        color: var(--color-primary);
                        font-size: 12px;
                        margin-top: 8px;
                        cursor: pointer;
                        display: flex;
                        align-items: center;
                        gap: 4px;
                    `;
                    const showAllText = window.i18n ?
                        window.i18n.t('mock_server.show_all_endpoints', { count: endpoints.length }) || `Show all ${endpoints.length} endpoints` :
                        `Show all ${endpoints.length} endpoints`;
                    moreDiv.innerHTML = `
                        <span>${showAllText}</span>
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="2 4 6 8 10 4"></polyline>
                        </svg>
                    `;
                    moreDiv.addEventListener('click', async () => {
                        collection._showAllEndpoints = true;
                        await this.renderCollections(collections, settings);
                    });
                    endpointsDiv.appendChild(moreDiv);
                } else if (endpoints.length > 10 && collection._showAllEndpoints) {
                    const lessDiv = document.createElement('div');
                    lessDiv.style.cssText = `
                        color: var(--color-primary);
                        font-size: 12px;
                        margin-top: 8px;
                        cursor: pointer;
                        display: flex;
                        align-items: center;
                        gap: 4px;
                    `;
                    lessDiv.innerHTML = `
                        <span>${t('mock_server.show_less', 'Show less')}</span>
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="10 8 6 4 2 8"></polyline>
                        </svg>
                    `;
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
            indicator.style.color = 'var(--color-success)';
            statusText.textContent = t('mock_server.status_running', 'Running');
            urlText.textContent = `http://localhost:${status.port}`;
            toggleBtn.textContent = t('mock_server.stop_server', 'Stop Server');
            toggleBtn.style.background = 'var(--color-danger)';
            portInput.disabled = true;
        } else {
            indicator.textContent = '○';
            indicator.style.color = 'var(--text-secondary)';
            statusText.textContent = t('mock_server.status_stopped', 'Stopped');
            urlText.textContent = '';
            toggleBtn.textContent = t('mock_server.start_server', 'Start Server');
            toggleBtn.style.background = 'var(--color-primary)';
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
                container.innerHTML = `
                    <div style="text-align: center; color: var(--text-secondary); padding: 40px 20px;">
                        ${t('mock_server.empty_logs', 'No requests logged yet.')}
                    </div>
                `;
                return;
            }

            container.innerHTML = `
                <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
                    <thead>
                        <tr style="border-bottom: 1px solid var(--border-light);">
                            <th style="text-align: left; padding: 8px 4px; color: var(--text-secondary); font-weight: 500;">${t('mock_server.log_time', 'Time')}</th>
                            <th style="text-align: left; padding: 8px 4px; color: var(--text-secondary); font-weight: 500;">${t('mock_server.log_method', 'Method')}</th>
                            <th style="text-align: left; padding: 8px 4px; color: var(--text-secondary); font-weight: 500;">${t('mock_server.log_path', 'Path')}</th>
                            <th style="text-align: left; padding: 8px 4px; color: var(--text-secondary); font-weight: 500;">${t('mock_server.log_status', 'Status')}</th>
                            <th style="text-align: right; padding: 8px 4px; color: var(--text-secondary); font-weight: 500;">${t('mock_server.log_time_ms', 'Time (ms)')}</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${logs.map(log => {
                            const time = new Date(log.timestamp).toLocaleTimeString();
                            const statusColor = log.responseStatus === 200 ? 'var(--color-success)' :
                                              log.responseStatus === 404 ? 'var(--color-warning)' :
                                              'var(--color-danger)';

                            return `
                                <tr style="border-bottom: 1px solid var(--border-light);">
                                    <td style="padding: 8px 4px; color: var(--text-secondary);">${time}</td>
                                    <td style="padding: 8px 4px;">
                                        <span style="color: var(--color-primary); font-weight: 600;">${log.method}</span>
                                    </td>
                                    <td style="padding: 8px 4px; color: var(--text-primary); max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${log.path}">${log.path}</td>
                                    <td style="padding: 8px 4px;">
                                        <span style="color: ${statusColor}; font-weight: 600;">${log.responseStatus}</span>
                                    </td>
                                    <td style="padding: 8px 4px; color: var(--text-secondary); text-align: right;">${log.responseTime}</td>
                                </tr>
                            `;
                        }).join('')}
                    </tbody>
                </table>
            `;
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
        overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.5);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10001;
        `;

        const dialog = document.createElement('div');
        dialog.style.cssText = `
            background: var(--bg-primary);
            border-radius: var(--radius-xl);
            padding: 24px;
            min-width: 400px;
            max-width: 500px;
            box-shadow: var(--shadow-xl);
            border: 1px solid var(--border-light);
        `;

        dialog.innerHTML = `
            <p style="margin: 0 0 16px 0; color: var(--text-primary); font-size: 14px;">${this.escapeHtml(message)}</p>
            <div style="display: flex; justify-content: flex-end;">
                <button id="alert-ok" style="padding: 8px 16px; border: none; background: var(--color-primary); color: white; border-radius: var(--radius-sm); cursor: pointer;">${t('mock_server.ok', 'OK')}</button>
            </div>
        `;

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
        overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.5);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10002;
        `;

        const dialog = document.createElement('div');
        dialog.style.cssText = `
            background: var(--bg-primary);
            border-radius: var(--radius-xl);
            padding: 24px;
            width: 90vw;
            max-width: 800px;
            max-height: 85vh;
            display: flex;
            flex-direction: column;
            box-shadow: var(--shadow-xl);
            border: 1px solid var(--border-light);
        `;

        dialog.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
                <div>
                    <h3 style="margin: 0; color: var(--text-primary);">${t('mock_server.edit_response_title', 'Edit Response')}</h3>
                    <p style="margin: 4px 0 0 0; color: var(--text-secondary); font-size: 13px;">${endpoint.method.toUpperCase()} ${endpoint.path}</p>
                </div>
                <button id="response-editor-close" style="background: none; border: none; color: var(--text-secondary); cursor: pointer; font-size: 24px; padding: 0; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center;" aria-label="${t('mock_server.close', 'Close')}">&times;</button>
            </div>

            ${hasCustomResponse ? `
                <div style="padding: 8px 12px; background: var(--color-primary-light, #e3f2fd); border-left: 3px solid var(--color-primary); border-radius: var(--radius-sm); margin-bottom: 12px; font-size: 13px; color: var(--text-primary);">
                    ${t('mock_server.using_custom_response', 'Using custom response')}
                </div>
            ` : ''}

            <div style="display: flex; gap: 24px; margin-bottom: 16px;">
                <div style="flex: 1;">
                    <label style="display: block; margin-bottom: 8px; color: var(--text-secondary); font-size: 14px; font-weight: 500;">
                        ${t('mock_server.delay', 'Delay (ms)')}
                    </label>
                    <input
                        type="number"
                        id="response-editor-delay"
                        min="0"
                        max="30000"
                        value="${currentDelay}"
                        style="width: 150px; padding: 8px 12px; border: 1px solid var(--border-light); border-radius: var(--radius-sm); background: var(--bg-secondary); color: var(--text-primary); font-size: 13px;"
                    />
                    <span style="margin-left: 8px; color: var(--text-secondary); font-size: 12px;">(0-30000)</span>
                </div>
                <div style="flex: 1;">
                    <label style="display: block; margin-bottom: 8px; color: var(--text-secondary); font-size: 14px; font-weight: 500;">
                        ${t('mock_server.status_code', 'Status Code')}
                    </label>
                    <input
                        type="number"
                        id="response-editor-status-code"
                        min="100"
                        max="599"
                        value="${currentStatusCode}"
                        style="width: 150px; padding: 8px 12px; border: 1px solid var(--border-light); border-radius: var(--radius-sm); background: var(--bg-secondary); color: var(--text-primary); font-size: 13px;"
                    />
                    <span style="margin-left: 8px; color: var(--text-secondary); font-size: 12px;">(100-599)</span>
                </div>
            </div>

            <div style="flex: 1; overflow: hidden; display: flex; flex-direction: column;">
                <label style="display: block; margin-bottom: 8px; color: var(--text-secondary); font-size: 14px; font-weight: 500;">
                    ${t('mock_server.response_body', 'Response Body (JSON)')}
                </label>
                <textarea
                    id="response-editor-textarea"
                    style="flex: 1; padding: 12px; border: 1px solid var(--border-light); border-radius: var(--radius-sm); background: var(--bg-secondary); color: var(--text-primary); font-family: 'Courier New', monospace; font-size: 13px; resize: none; min-height: 300px;"
                    spellcheck="false"
                >${JSON.stringify(currentResponse, null, 2)}</textarea>
                <div id="response-editor-error" style="color: var(--color-danger); font-size: 12px; margin-top: 4px; min-height: 18px;"></div>
            </div>

            <div style="display: flex; gap: 8px; justify-content: space-between; margin-top: 16px; padding-top: 16px; border-top: 1px solid var(--border-light);">
                <button id="response-editor-reset" style="padding: 8px 16px; border: 1px solid var(--border-light); background: transparent; color: var(--text-secondary); border-radius: var(--radius-sm); cursor: pointer;">
                    ${t('mock_server.reset_to_default', 'Reset to Default')}
                </button>
                <div style="display: flex; gap: 8px;">
                    <button id="response-editor-cancel" style="padding: 8px 16px; border: 1px solid var(--border-light); background: transparent; color: var(--text-primary); border-radius: var(--radius-sm); cursor: pointer;">
                        ${t('common.cancel', 'Cancel')}
                    </button>
                    <button id="response-editor-save" style="padding: 8px 16px; border: none; background: var(--color-primary); color: white; border-radius: var(--radius-sm); cursor: pointer;">
                        ${t('common.save', 'Save')}
                    </button>
                </div>
            </div>
        `;

        overlay.appendChild(dialog);
        document.body.appendChild(overlay);

        const textarea = dialog.querySelector('#response-editor-textarea');
        const delayInput = dialog.querySelector('#response-editor-delay');
        const statusCodeInput = dialog.querySelector('#response-editor-status-code');
        const errorDiv = dialog.querySelector('#response-editor-error');
        const saveBtn = dialog.querySelector('#response-editor-save');
        const cancelBtn = dialog.querySelector('#response-editor-cancel');
        const resetBtn = dialog.querySelector('#response-editor-reset');
        const closeBtn = dialog.querySelector('#response-editor-close');

        const cleanup = () => {
            document.body.removeChild(overlay);
        };

        // Validate JSON on input
        textarea.addEventListener('input', () => {
            try {
                JSON.parse(textarea.value);
                errorDiv.textContent = '';
                saveBtn.disabled = false;
                saveBtn.style.opacity = '1';
            } catch (e) {
                errorDiv.textContent = t('mock_server.invalid_json', `Invalid JSON: ${e.message}`);
                saveBtn.disabled = true;
                saveBtn.style.opacity = '0.5';
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
        closeBtn.addEventListener('click', closeHandler);
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
            schema = endpoint.responses['200'].content['application/json'].schema;
        } else if (['POST', 'PUT'].includes(endpoint.method.toUpperCase()) &&
                   endpoint.responses?.['201']?.content?.['application/json']?.schema) {
            schema = endpoint.responses['201'].content['application/json'].schema;
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
