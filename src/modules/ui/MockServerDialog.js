/**
 * @fileoverview UI Dialog for managing mock server
 * @module ui/MockServerDialog
 */

import { templateLoader } from '../templateLoader.js';
import { SchemaProcessor } from '../schema/SchemaProcessor.js';
import { BaseModal } from './BaseModal.js';
import { ConfirmDialog } from './ConfirmDialog.js';
import { flattenRequests, endpointKey } from '../collections/collectionTree.js';
import { el } from '../htmlUtils.js';
import { translate } from '../utils/translate.js';
import { toast } from './Toast.js';
import { setRoleTexts } from './roleText.js';
import { extractResponseSchema } from '../controllers/MockServerController.js';

const LOG_STATUS_CLASSES = Object.freeze({ 200: 'is-success', 404: 'is-warning' });
const DEFAULT_STATUS_CODES = Object.freeze({ POST: 201, DELETE: 204 });
const TEMPLATE_PATH = './src/templates/mockServer/mockServerDialog.html';

/** @augments */
export class MockServerDialog extends BaseModal {
    /** @param {MockServerController} controller */
    constructor(controller) {
        super();
        this.controller = controller;
        this.resolve = null;
        this.statusPoller = null;
        this.logsPoller = null;
        /** @type {BaseModal|null} */
        this.responseEditor = null;
    }

    /** @returns {Promise<boolean>} */
    show() {
        if (this.overlay) {
            return Promise.resolve(false);
        }
        return new Promise((resolve) => {
            this.resolve = resolve;
            this.createDialog();
        });
    }

    async createDialog() {
        const dialogContent = this.mount({
            overlayClass: 'mock-server-overlay',
            dialogClass: 'mock-server-dialog modal-dialog modal-dialog--mock-server',
            templatePath: TEMPLATE_PATH,
            templateId: 'tpl-mock-server-dialog'
        });

        setRoleTexts(dialogContent, {
            title: translate('mock_server.title', 'Mock Server'),
            'status-stopped': translate('mock_server.status_stopped', 'Stopped'),
            'start-server': translate('mock_server.start_server', 'Start Server'),
            'port-label': `${translate('mock_server.port', 'Port')}:`,
            'collections-heading': translate('mock_server.collections_heading', 'COLLECTIONS TO MOCK'),
            'request-log-heading': translate('mock_server.request_log_heading', 'REQUEST LOG'),
            clear: translate('mock_server.clear', 'Clear'),
            close: translate('mock_server.close', 'Close')
        });

        const closeBtn = dialogContent.querySelector('#mock-server-close-btn');
        if (closeBtn) {
            closeBtn.setAttribute('aria-label', translate('mock_server.close', 'Close'));
        }

        this.setupEventListeners();

        await this.loadInitialState();

        if (!this.dialog) {
            return;
        }

        this.startStatusPolling();
        this.startLogsPolling();
    }

    setupEventListeners() {
        const toggleBtn = this.dialog.querySelector('#mock-server-toggle-btn');
        const portInput = this.dialog.querySelector('#mock-server-port-input');
        const clearLogsBtn = this.dialog.querySelector('#mock-server-clear-logs-btn');
        const closeBtn = this.dialog.querySelector('#mock-server-close-btn');

        toggleBtn.addEventListener('click', () => this.handleToggleServer());

        portInput.addEventListener('change', async (e) => {
            await this.handlePortChange(e.target.value);
        });

        clearLogsBtn.addEventListener('click', () => this.handleClearLogs());

        closeBtn.addEventListener('click', () => this.close());
    }

    async loadInitialState() {
        try {
            const [settings, collections, status] = await Promise.all([
                this.controller.getSettings(),
                this.controller.getCollections(),
                this.controller.getStatus()
            ]);

            const portInput = this.dialog.querySelector('#mock-server-port-input');
            portInput.value = settings.port;

            await this.renderCollections(collections, settings);

            await this.updateStatusDisplay(status);
        } catch {}
    }

    /**
     * @param {Array} collections
     * @param {Object} settings
     */
    async renderCollections(collections, settings) {
        const container = this.dialog.querySelector('#mock-server-collections');

        if (collections.length === 0) {
            const fragment = templateLoader.cloneSync(
                TEMPLATE_PATH,
                'tpl-mock-server-empty-state'
            );
            const emptyEl = fragment.firstElementChild;
            const contentEl = emptyEl.querySelector('[data-role="content"]');
            if (contentEl) {
                const raw = translate('mock_server.empty_collections', 'No collections available.<br>Import an OpenAPI or Postman collection first.');
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
            const endpoints = flattenRequests(collection);
            const httpEndpoints = endpoints.filter(e => !['WS', 'GRPC'].includes(e.method?.toUpperCase()));

            if (httpEndpoints.length === 0) {
                continue;
            }

            const collectionDiv = el('div', 'mock-server-collection');

            const headerDiv = el('div', 'mock-server-collection-header u-flex u-items-center u-gap-2');
            headerDiv.classList.toggle('has-endpoints', isEnabled);

            const toggleLabel = el('label', 'toggle-switch');

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.checked = isEnabled;
            checkbox.dataset.collectionId = collection.id;
            checkbox.addEventListener('change', (e) => {
                this.handleToggleCollection(collection.id);
                e.stopPropagation();
            });

            const toggleTrack = el('span', 'toggle-track');

            const labelText = el('span', 'mock-server-collection-label', `${collection.name} (${httpEndpoints.length} ${translate('mock_server.endpoints', 'endpoints')})`);

            toggleLabel.appendChild(checkbox);
            toggleLabel.appendChild(toggleTrack);
            toggleLabel.appendChild(labelText);
            headerDiv.appendChild(toggleLabel);
            collectionDiv.appendChild(headerDiv);

            if (isEnabled) {
                const endpointsDiv = el('div', 'mock-server-endpoints');

                const endpointsToShow = collection._showAllEndpoints ? httpEndpoints : httpEndpoints.slice(0, 10);

                for (const endpoint of endpointsToShow) {
                    const endpointDiv = el('div', 'mock-server-endpoint u-flex u-items-center u-gap-3');

                    const methodSpan = el('span', 'method-pill');
                    methodSpan.dataset.method = endpoint.method.toUpperCase();
                    methodSpan.textContent = endpoint.method.toUpperCase();

                    const pathSpan = el('span', 'mock-server-endpoint-path', endpoint.path);

                    const editResponseBtn = el('button', 'mock-server-edit-response-btn u-flex u-items-center u-gap-1');
                    {
                        const iconEl = el('span', 'icon icon-12 icon-pencil');
                        const labelEl = document.createElement('span');
                        labelEl.textContent = translate('mock_server.edit_response', 'Edit');
                        editResponseBtn.appendChild(iconEl);
                        editResponseBtn.appendChild(labelEl);
                    }
                    editResponseBtn.title = translate('mock_server.edit_response_tooltip', 'Edit custom response');
                    editResponseBtn.addEventListener('click', () => {
                        this.showResponseEditor(collection, endpoint);
                    });

                    endpointDiv.appendChild(methodSpan);
                    endpointDiv.appendChild(pathSpan);
                    endpointDiv.appendChild(editResponseBtn);

                    endpointsDiv.appendChild(endpointDiv);
                }

                if (httpEndpoints.length > 10 && !collection._showAllEndpoints) {
                    endpointsDiv.appendChild(this._createEndpointsToggle(
                        translate('mock_server.show_all_endpoints', 'Show all {{count}} endpoints', { count: httpEndpoints.length }),
                        'icon-chevron-down',
                        async () => {
                            collection._showAllEndpoints = true;
                            await this.renderCollections(collections, settings);
                        }
                    ));
                } else if (endpoints.length > 10 && collection._showAllEndpoints) {
                    endpointsDiv.appendChild(this._createEndpointsToggle(
                        translate('mock_server.show_less', 'Show less'),
                        'icon-chevron-up',
                        async () => {
                            collection._showAllEndpoints = false;
                            await this.renderCollections(collections, settings);
                        }
                    ));
                }

                collectionDiv.appendChild(endpointsDiv);
            }

            container.appendChild(collectionDiv);
        }
    }

    /**
     * @param {string} label
     * @param {string} iconClass
     * @param {() => Promise<void>} onClick
     * @returns {HTMLElement}
     */
    _createEndpointsToggle(label, iconClass, onClick) {
        const toggle = el('div', 'mock-server-endpoints-toggle u-flex u-items-center u-gap-1');
        const labelEl = document.createElement('span');
        labelEl.textContent = label;
        toggle.appendChild(labelEl);
        toggle.appendChild(el('span', `icon icon-12 ${iconClass}`));
        toggle.addEventListener('click', onClick);
        return toggle;
    }

    async handleToggleServer() {
        const toggleBtn = this.dialog.querySelector('#mock-server-toggle-btn');
        toggleBtn.disabled = true;
        try {

            const status = await this.controller.getStatus();

            const outcome = status.running
                ? await this.controller.handleStop()
                : await this.controller.handleStart();

            if (!outcome.success) {
                toast.error(outcome.message);
            }

            await this.updateStatus();
        } catch (error) {
            toast.error(error.message || translate('mock_server.error_toggle_server', 'Failed to toggle server'));
        } finally {
            toggleBtn.disabled = false;
        }
    }

    /** @param {string} port */
    async handlePortChange(port) {
        try {
            const result = await this.controller.handleUpdatePort(port);
            if (!result.success) {
                toast.error(result.message);
                const settings = await this.controller.getSettings();
                const portInput = this.dialog.querySelector('#mock-server-port-input');
                portInput.value = settings.port;
            }
        } catch {
            toast.error(translate('mock_server.error_update_port', 'Failed to update port'));
        }
    }

    /** @returns {Promise<void>} */
    async _refreshCollections() {
        const [settings, collections] = await Promise.all([
            this.controller.getSettings(),
            this.controller.getCollections()
        ]);
        await this.renderCollections(collections, settings);
    }

    /** @param {string} collectionId */
    async handleToggleCollection(collectionId) {
        try {
            const result = await this.controller.handleToggleCollection(collectionId);

            if (result.success) {
                await this._refreshCollections();
            }
        } catch {
            toast.error(translate('mock_server.error_toggle_collection', 'Failed to update collection'));
        }
    }

    async handleClearLogs() {
        try {
            await this.controller.clearRequestLogs();
            await this.updateLogs();
        } catch {
            toast.error(translate('mock_server.error_clear_logs', 'Failed to clear request logs'));
        }
    }

    startStatusPolling() {
        this.updateStatus();
        this.statusPoller = setInterval(() => {
            this.updateStatus();
        }, 1000);
    }

    startLogsPolling() {
        this.updateLogs();
        this.logsPoller = setInterval(() => {
            this.updateLogs();
        }, 2000);
    }

    async updateStatus() {
        try {
            const status = await this.controller.getStatus();
            await this.updateStatusDisplay(status);
        } catch {}
    }

    /** @param {Object} status */
    async updateStatusDisplay(status) {
        const indicator = this.dialog.querySelector('#mock-server-status-indicator');
        const statusText = this.dialog.querySelector('#mock-server-status-text');
        const urlText = this.dialog.querySelector('#mock-server-url');
        const toggleBtn = this.dialog.querySelector('#mock-server-toggle-btn');
        const portInput = this.dialog.querySelector('#mock-server-port-input');

        if (status.running) {
            indicator.textContent = '●';
            indicator.classList.add('is-running');
            statusText.textContent = translate('mock_server.status_running', 'Running');
            urlText.textContent = `http://localhost:${status.port}`;
            toggleBtn.textContent = translate('mock_server.stop_server', 'Stop Server');
            toggleBtn.classList.remove('btn-primary');
            toggleBtn.classList.add('btn-danger');
            portInput.disabled = true;
        } else {
            indicator.textContent = '○';
            indicator.classList.remove('is-running');
            statusText.textContent = translate('mock_server.status_stopped', 'Stopped');
            urlText.textContent = '';
            toggleBtn.textContent = translate('mock_server.start_server', 'Start Server');
            toggleBtn.classList.remove('btn-danger');
            toggleBtn.classList.add('btn-primary');
            portInput.disabled = false;
        }
    }

    async updateLogs() {
        try {
            const logs = await this.controller.getRequestLogs(20);
            const container = this.dialog.querySelector('#mock-server-logs');

            if (!container) {
                return;
            }

            const signature = JSON.stringify((logs || []).map(log => [log.timestamp, log.method, log.path, log.responseStatus]));
            if (container.dataset.logSignature === signature) {
                return;
            }
            container.dataset.logSignature = signature;

            if (!logs || logs.length === 0) {
                const fragment = templateLoader.cloneSync(
                    TEMPLATE_PATH,
                    'tpl-mock-server-logs-empty'
                );
                const emptyEl = fragment.firstElementChild;
                const contentEl = emptyEl.querySelector('[data-role="content"]');
                if (contentEl) {
                    contentEl.textContent = translate('mock_server.empty_logs', 'No requests logged yet.');
                }
                container.innerHTML = '';
                container.appendChild(emptyEl);
                return;
            }

            const tableFragment = templateLoader.cloneSync(
                TEMPLATE_PATH,
                'tpl-mock-server-logs-table'
            );
            const tableEl = tableFragment.firstElementChild;
            const tbodyEl = tableEl.querySelector('[data-role="tbody"]');

            setRoleTexts(tableEl, {
                'th-time': translate('mock_server.log_time', 'Time'),
                'th-method': translate('mock_server.log_method', 'Method'),
                'th-path': translate('mock_server.log_path', 'Path'),
                'th-status': translate('mock_server.log_status', 'Status'),
                'th-time-ms': translate('mock_server.log_time_ms', 'Time (ms)')
            });

            logs.forEach(log => {
                const rowFragment = templateLoader.cloneSync(
                    TEMPLATE_PATH,
                    'tpl-mock-server-logs-row'
                );
                const rowEl = rowFragment.firstElementChild;

                setRoleTexts(rowEl, {
                    time: new Date(log.timestamp).toLocaleTimeString(),
                    method: log.method,
                    path: log.path,
                    status: log.responseStatus,
                    'time-ms': log.responseTime
                });
                const pathEl = rowEl.querySelector('[data-role="path"]');
                if (pathEl) {pathEl.title = log.path;}
                rowEl.querySelector('[data-role="status"]')?.classList.add(LOG_STATUS_CLASSES[log.responseStatus] ?? 'is-danger');

                tbodyEl.appendChild(rowEl);
            });

            container.innerHTML = '';
            container.appendChild(tableEl);
        } catch {}
    }

    /**
     * @param {Object} collection
     * @param {Object} endpoint
     */
    async showResponseEditor(collection, endpoint) {

        const customResponse = await this.controller.getCustomResponse(collection.id, endpoint.id);
        const hasCustomResponse = customResponse !== null;

        const settings = await this.controller.getSettings();
        const delayKey = endpointKey(collection.id, endpoint.id);
        const currentDelay = settings.endpointDelays[delayKey] || 0;

        const customStatusCode = await this.controller.getCustomStatusCode(collection.id, endpoint.id);
        const currentStatusCode = customStatusCode || this.getDefaultStatusCode(endpoint);

        const defaultResponse =
            (await this.controller.getDefaultResponse(collection.id, endpoint.id)) ??
            this.generateDefaultResponse(endpoint);
        const currentResponse = customResponse || defaultResponse;

        if (!this.dialog) {
            return;
        }

        const editor = new BaseModal();
        const dialog = editor.mount({
            overlayClass: 'mock-server-response-editor-overlay',
            dialogClass: 'modal-dialog modal-dialog--mock-server-response-editor',
            templatePath: TEMPLATE_PATH,
            templateId: 'tpl-mock-server-response-editor',
            closeOnOverlayClick: false
        });
        this.responseEditor = editor;

        setRoleTexts(dialog, {
            title: translate('mock_server.edit_response_title', 'Edit Response'),
            subtitle: `${endpoint.method.toUpperCase()} ${endpoint.path}`,
            'delay-label': translate('mock_server.delay', 'Delay (ms)'),
            'status-code-label': translate('mock_server.status_code', 'Status Code'),
            'body-label': translate('mock_server.response_body', 'Response Body (JSON)'),
            'template-hint': translate(
                'mock_server.template_hint',
                'Strings may use {{request.params.id}}, {{request.query.name}}, {{request.headers.name}}, {{request.body.path}}, {{$uuid}}, {{$timestamp}}, {{$isoTimestamp}} and {{$randomInt}}. Send "Prefer: code=404" or "Prefer: example=name" to get another documented response.'
            ),
            reset: translate('mock_server.reset_to_default', 'Reset to Default'),
            cancel: translate('common.cancel', 'Cancel'),
            save: translate('common.save', 'Save')
        });

        const closeBtn = dialog.querySelector('#response-editor-close');
        if (closeBtn) {
            closeBtn.setAttribute('aria-label', translate('mock_server.close', 'Close'));
        }

        const customNoticeEl = dialog.querySelector('[data-role="custom-notice"]');
        if (customNoticeEl) {
            customNoticeEl.classList.toggle('is-hidden', !hasCustomResponse);
            if (hasCustomResponse) {
                customNoticeEl.textContent = translate('mock_server.using_custom_response', 'Using custom response');
            }
        }

        const textarea = dialog.querySelector('#response-editor-textarea');
        const delayInput = dialog.querySelector('#response-editor-delay');
        const statusCodeInput = dialog.querySelector('#response-editor-status-code');
        const errorDiv = dialog.querySelector('#response-editor-error');
        const saveBtn = dialog.querySelector('#response-editor-save');
        const cancelBtn = dialog.querySelector('#response-editor-cancel');
        const resetBtn = dialog.querySelector('#response-editor-reset');

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
            editor.destroy();
            if (this.responseEditor === editor) {
                this.responseEditor = null;
            }
        };
        editor.onDismiss = cleanup;

        textarea.addEventListener('input', () => {
            try {
                JSON.parse(textarea.value);
                errorDiv.textContent = '';
                saveBtn.disabled = false;
            } catch (e) {
                errorDiv.textContent = translate('mock_server.invalid_json', 'Invalid JSON: {{message}}', { message: e.message });
                saveBtn.disabled = true;
            }
        });

        saveBtn.addEventListener('click', async () => {
            try {
                const response = JSON.parse(textarea.value);
                const delay = parseInt(delayInput.value, 10);
                const statusCode = parseInt(statusCodeInput.value, 10);

                if (delay < 0 || delay > 30000) {
                    errorDiv.textContent = 'Delay must be between 0 and 30000ms';
                    return;
                }

                if (statusCode < 100 || statusCode > 599) {
                    errorDiv.textContent = 'Status code must be between 100 and 599';
                    return;
                }

                const saved = await this._saveResponseOverrides(collection, endpoint, { delay, statusCode, response });

                if (saved.success) {
                    cleanup();
                    await this._refreshCollections();
                } else {
                    errorDiv.textContent = saved.message;
                }
            } catch (e) {
                errorDiv.textContent = translate('mock_server.invalid_json', 'Invalid JSON: {{message}}', { message: e.message });
            }
        });

        resetBtn.addEventListener('click', async () => {
            const confirmed = await new ConfirmDialog().show(
                translate(
                    'mock_server.reset_confirm_message',
                    'Discard the custom delay, status code and response body for {{endpoint}}?',
                    { endpoint: `${endpoint.method.toUpperCase()} ${endpoint.path}` }
                ),
                {
                    title: translate('mock_server.reset_confirm_title', 'Reset to Default?'),
                    confirmText: translate('mock_server.reset', 'Reset'),
                    cancelText: translate('common.cancel', 'Cancel'),
                    dangerous: true
                }
            );
            if (!confirmed) {
                return;
            }
            const saved = await this._saveResponseOverrides(collection, endpoint, { delay: 0, statusCode: null, response: null })
                .catch(error => ({ success: false, message: error?.message }));
            if (!saved.success) {
                toast.error(saved.message || translate('mock_server.error_reset_response', 'Failed to reset response'));
                return;
            }
            cleanup();
            await this._refreshCollections();
        });

        cancelBtn.addEventListener('click', cleanup);
        closeBtn.addEventListener('click', cleanup);
    }

    /**
     * @param {Object} collection
     * @param {Object} endpoint
     * @param {{delay: number, statusCode: number|null, response: Object|null}} overrides
     * @returns {Promise<{success: boolean, message: string|undefined}>}
     */
    async _saveResponseOverrides(collection, endpoint, { delay, statusCode, response }) {
        const delayResult = await this.controller.handleSetDelay(collection.id, endpoint.id, delay);
        const statusCodeResult = await this.controller.handleSetCustomStatusCode(collection.id, endpoint.id, statusCode);
        const responseResult = await this.controller.handleSetCustomResponse(collection.id, endpoint.id, response);
        return {
            success: Boolean(responseResult.success && delayResult.success && statusCodeResult.success),
            message: responseResult.message || delayResult.message || statusCodeResult.message
        };
    }

    /**
     * @param {Object} endpoint
     * @returns {Object}
     */
    generateDefaultResponse(endpoint) {
        const schema = extractResponseSchema(endpoint);

        if (!schema) {
            return { message: 'Success', data: {} };
        }

        const schemaProcessor = new SchemaProcessor();
        const generated = schemaProcessor.generateExampleFromSchema(schema);

        if (typeof generated === 'string') {
            try {return JSON.parse(generated);} catch {return { message: 'Success' };}
        }
        return generated ?? { message: 'Success' };
    }

    /**
     * @param {Object} endpoint
     * @returns {number}
     */
    getDefaultStatusCode(endpoint) {
        return DEFAULT_STATUS_CODES[endpoint.method.toUpperCase()] ?? 200;
    }

    /** @returns {void} */
    onDismiss() {
        this.close();
    }

    close() {
        if (this.statusPoller) {
            clearInterval(this.statusPoller);
            this.statusPoller = null;
        }

        if (this.logsPoller) {
            clearInterval(this.logsPoller);
            this.logsPoller = null;
        }

        if (this.responseEditor) {
            this.responseEditor.destroy();
            this.responseEditor = null;
        }

        this.destroy();

        if (this.resolve) {
            this.resolve(true);
            this.resolve = null;
        }
    }
}
