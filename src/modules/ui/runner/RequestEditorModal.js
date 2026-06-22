/**
 * @fileoverview Per-request editor modal for the Collection Runner: edits the
 * override path params, query params, headers, body, and post-response script
 * for a single queued request. Extracted from RunnerPanel so the modal owns its
 * own DOM and CodeMirror editor lifecycle.
 * @module ui/runner/RequestEditorModal
 */

import { app } from '../../appContext.js';
import { templateLoader } from '../../templateLoader.js';
import { ScriptEditor } from '../../scriptEditor.bundle.js';
import { JSONEditor } from '../../jsonEditor.bundle.js';

/**
 * Modal dialog for editing a single runner request's overrides and script.
 *
 * @class
 */
export class RequestEditorModal {
    constructor() {
        this.modal = null;
        this.scriptEditor = null;
        this.bodyEditor = null;
        this.request = null;
        this._onSave = null;
        this._keyHandler = null;
    }

    /**
     * Opens the modal for a request. The request object is mutated in place when
     * the user saves; `onSave` is then invoked so the host can react (persist,
     * notify listeners, etc.).
     *
     * @param {Object} request - Request to edit (mutated on save)
     * @param {Object} [callbacks]
     * @param {() => void} [callbacks.onSave] - Called after a successful save
     */
    open(request, { onSave } = {}) {
        this.request = request;
        this._onSave = onSave || null;
        const overrides = this._ensureOverrides(request);

        const fragment = templateLoader.cloneSync(
            './src/templates/runner/runnerPanel.html',
            'tpl-runner-script-modal'
        );

        this.modal = fragment.firstElementChild;
        document.body.appendChild(this.modal);

        const methodEl = this.modal.querySelector('[data-role="script-method"]');
        const pathEl = this.modal.querySelector('[data-role="script-path"]');
        if (methodEl) {
            methodEl.textContent = request.method;
            methodEl.dataset.method = request.method;
        }
        if (pathEl) {
            pathEl.textContent = request.path;
        }

        this._renderKvList(this.modal.querySelector('[data-role="path-params-list"]'), overrides.pathParams);
        this._renderKvList(this.modal.querySelector('[data-role="query-params-list"]'), overrides.queryParams);
        this._renderKvList(this.modal.querySelector('[data-role="headers-list"]'), overrides.headers);

        const bodyContainer = this.modal.querySelector('[data-role="override-body-container"]');
        if (bodyContainer) {
            this.bodyEditor = new JSONEditor(bodyContainer);
            this.bodyEditor.setContent(overrides.body || '');
        }

        const editorContainer = this.modal.querySelector('[data-role="script-editor-container"]');
        if (editorContainer) {
            this.scriptEditor = new ScriptEditor(editorContainer);
            this.scriptEditor.setContent(request.postResponseScript || '');
        }

        this._attachEventListeners();

        if (app.i18n && app.i18n.updateUI) {
            app.i18n.updateUI(this.modal);
        }
    }

    /**
     * Closes the modal, optionally persisting the edited overrides and script
     * back onto the request and notifying the host.
     *
     * @param {boolean} save - Whether to save the edited content
     */
    close(save) {
        if (save && this.request) {
            const { request } = this;
            const overrides = this._ensureOverrides(request);

            overrides.pathParams = this._collectKvList(this.modal?.querySelector('[data-role="path-params-list"]'));
            overrides.queryParams = this._collectKvList(this.modal?.querySelector('[data-role="query-params-list"]'));
            overrides.headers = this._collectKvList(this.modal?.querySelector('[data-role="headers-list"]'));
            overrides.body = this.bodyEditor ? this.bodyEditor.getContent() : (overrides.body || '');

            request.postResponseScript = this.scriptEditor
                ? this.scriptEditor.getContent()
                : (request.postResponseScript || '');

            this._onSave?.();
        }

        if (this._keyHandler) {
            document.removeEventListener('keydown', this._keyHandler);
            this._keyHandler = null;
        }

        if (this.bodyEditor) {
            this.bodyEditor.destroy();
            this.bodyEditor = null;
        }

        if (this.scriptEditor) {
            this.scriptEditor.destroy();
            this.scriptEditor = null;
        }

        if (this.modal) {
            this.modal.remove();
            this.modal = null;
        }

        this.request = null;
        this._onSave = null;
    }

    /**
     * Ensures a request has a complete overrides object (back-compat for older runners).
     *
     * @private
     * @param {Object} request - Request object
     * @returns {Object} The request's overrides object
     */
    _ensureOverrides(request) {
        if (!request.overrides) {
            request.overrides = { pathParams: [], queryParams: [], headers: [], body: '' };
        }
        const o = request.overrides;
        o.pathParams = o.pathParams || [];
        o.queryParams = o.queryParams || [];
        o.headers = o.headers || [];
        o.body = o.body || '';
        return o;
    }

    /**
     * Renders editable key-value rows into a container.
     *
     * @private
     * @param {HTMLElement} container - Target container
     * @param {Array<Object>} rows - Array of {key, value} objects
     */
    _renderKvList(container, rows) {
        if (!container) {return;}
        container.innerHTML = '';
        (rows || []).forEach(row => this._addKvRow(container, row.key, row.value));
    }

    /**
     * Appends a single editable key-value row to a container.
     *
     * @private
     * @param {HTMLElement} container - Target container
     * @param {string} [key] - Initial key
     * @param {string} [value] - Initial value
     */
    _addKvRow(container, key = '', value = '') {
        if (!container) {return;}

        const fragment = templateLoader.cloneSync(
            './src/templates/runner/runnerPanel.html',
            'tpl-runner-kv-row'
        );
        const row = fragment.firstElementChild;

        const keyInput = row.querySelector('[data-role="kv-key"]');
        const valueInput = row.querySelector('[data-role="kv-value"]');
        if (keyInput) {
            keyInput.value = key;
            keyInput.placeholder = app.i18n?.t('runner.key') || 'Key';
        }
        if (valueInput) {
            valueInput.value = value;
            valueInput.placeholder = app.i18n?.t('runner.value') || 'Value';
        }

        row.querySelector('[data-action="remove-kv"]')?.addEventListener('click', () => {
            row.remove();
        });

        container.appendChild(row);
    }

    /**
     * Collects {key, value} rows from a key-value list, skipping rows with empty keys.
     *
     * @private
     * @param {HTMLElement} container - Source container
     * @returns {Array<Object>} Array of {key, value}
     */
    _collectKvList(container) {
        if (!container) {return [];}
        const rows = [];
        container.querySelectorAll('.key-value-row').forEach(row => {
            const key = row.querySelector('[data-role="kv-key"]')?.value.trim() || '';
            const value = row.querySelector('[data-role="kv-value"]')?.value || '';
            if (key) {
                rows.push({ key, value });
            }
        });
        return rows;
    }

    /**
     * Switches the active tab in the editor modal.
     *
     * @private
     * @param {string} tabName - Tab name (params, headers, body, script)
     */
    _switchTab(tabName) {
        if (!this.modal) {return;}

        this.modal.querySelectorAll('.runner-editor-tab').forEach(tab => {
            tab.classList.toggle('is-active', tab.dataset.editTab === tabName);
        });
        this.modal.querySelectorAll('.runner-editor-tab-content').forEach(content => {
            content.classList.toggle('is-active', content.dataset.editContent === tabName);
        });
    }

    /**
     * Attaches event listeners to the modal.
     *
     * @private
     */
    _attachEventListeners() {
        if (!this.modal) {return;}

        this.modal.querySelector('[data-action="close"]')?.addEventListener('click', () => {
            this.close(false);
        });

        this.modal.querySelector('[data-action="cancel"]')?.addEventListener('click', () => {
            this.close(false);
        });

        this.modal.querySelector('[data-action="save"]')?.addEventListener('click', () => {
            this.close(true);
        });

        this.modal.querySelectorAll('.runner-editor-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                this._switchTab(tab.dataset.editTab);
            });
        });

        this.modal.querySelector('[data-action="add-path-param"]')?.addEventListener('click', () => {
            this._addKvRow(this.modal.querySelector('[data-role="path-params-list"]'));
        });
        this.modal.querySelector('[data-action="add-query-param"]')?.addEventListener('click', () => {
            this._addKvRow(this.modal.querySelector('[data-role="query-params-list"]'));
        });
        this.modal.querySelector('[data-action="add-header"]')?.addEventListener('click', () => {
            this._addKvRow(this.modal.querySelector('[data-role="headers-list"]'));
        });

        this.modal.querySelector('[data-role="script-modal-overlay"]')?.addEventListener('click', (e) => {
            if (e.target === e.currentTarget) {
                this.close(false);
            }
        });

        this._keyHandler = (e) => {
            if (e.key === 'Escape') {
                this.close(false);
            } else if (e.key === 's' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                this.close(true);
            }
        };
        document.addEventListener('keydown', this._keyHandler);
    }
}
