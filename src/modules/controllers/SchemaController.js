/**
 * @fileoverview Controller for response schema validation feature
 * @module controllers/SchemaController
 */

import { createLazyEditorProxy } from '../editorLoader.js';
import { debounce } from '../utils/debounce.js';
import { SchemaValidator } from '../schema/SchemaValidator.js';

export class SchemaController {
    /**
     * @param {Object} options
     * @param {Object} options.repository
     * @param {Object} options.statusDisplay
     */
    constructor({ repository, statusDisplay, backendAPI }) {
        this.repository = repository;
        this.statusDisplay = statusDisplay;
        this.validator = new SchemaValidator(backendAPI);
        this._contextRevision = 0;
        this._checkRevision = 0;
        this._destroyed = false;
        this.editor = null;
        this.currentCollectionId = null;
        this.currentEndpointId = null;
        this.lastResponseBody = null;
        this._inFlightSave = null;
        this._debouncedSave = debounce((collectionId, endpointId) => {
            this._inFlightSave = this._saveSchema(collectionId, endpointId).finally(() => {
                this._inFlightSave = null;
            });
            return this._inFlightSave;
        }, 1000);
        this._initialized = false;
    }

    initialize() {
        if (this._initialized) {
            return;
        }

        const container = document.getElementById('schema-editor-container');
        if (!container) {
            return;
        }

        this.editor = createLazyEditorProxy('schema', container, [{
            onChange: (value) => this._handleSchemaChange(value)
        }]);

        this._setupEventListeners();
        this._initialized = true;
    }

    _setupEventListeners() {
        const inferBtn = document.getElementById('schema-infer-btn');
        const clearBtn = document.getElementById('schema-clear-btn');

        if (inferBtn) {
            inferBtn.addEventListener('click', () => this.inferSchemaFromResponse());
        }

        if (clearBtn) {
            clearBtn.addEventListener('click', () => this.clearSchema());
        }
    }

    _handleSchemaChange(_value) {
        this._updateValidationStatus();
        if (this.currentCollectionId && this.currentEndpointId) {
            this._debouncedSave(this.currentCollectionId, this.currentEndpointId);
        }
    }

    /**
     * @param {string} collectionId
     * @param {string} endpointId
     * @returns {Promise<void>}
     */
    async _saveSchema(collectionId, endpointId) {
        if (!collectionId || !endpointId) {
            return;
        }

        const snapshot = this.captureSchema();
        if (snapshot.error || (snapshot.hasSchema && (snapshot.schema === null ||
            (typeof snapshot.schema !== 'boolean' && typeof snapshot.schema !== 'object')))) {
            return;
        }

        try {
            await this.repository.saveResponseSchema(collectionId, endpointId, snapshot.schema);
        } catch (error) {
            console.error('Failed to save schema:', error);
        }
    }

    /** @returns {Promise<void>} */
    async flushPendingSave() {
        await this._debouncedSave.flush();
        await this._inFlightSave;
    }

    /** Snapshot the editor before an asynchronous request can change its context. */
    captureSchema() {
        const content = this.editor?.getContent?.() ?? JSON.stringify(this.editor?.getSchema?.()) ?? '';
        const snapshot = {
            content,
            schema: null,
            hasSchema: Boolean(content.trim()),
            collectionId: this.currentCollectionId,
            endpointId: this.currentEndpointId,
            revision: this._contextRevision
        };
        if (snapshot.hasSchema) {
            try {
                snapshot.schema = JSON.parse(content);
            } catch {
                snapshot.error = 'Invalid JSON syntax';
            }
        }
        return snapshot;
    }

    isCurrentSnapshot(snapshot) {
        return !this._destroyed && snapshot.revision === this._contextRevision &&
            snapshot.content === this.captureSchema().content;
    }

    async _updateValidationStatus() {
        const revision = ++this._checkRevision;
        const statusEl = document.getElementById('schema-validation-status');
        if (!statusEl || !this.editor || this._destroyed) {
            return;
        }
        const snapshot = this.captureSchema();
        statusEl.className = 'schema-validation-status';
        statusEl.title = '';
        if (!snapshot.hasSchema) {
            statusEl.textContent = '';
            return;
        }
        if (snapshot.error) {
            statusEl.classList.add('is-error');
            statusEl.textContent = snapshot.error;
            return;
        }
        statusEl.textContent = 'Checking schema…';
        const result = await this.validator.check(snapshot.schema);
        if (revision !== this._checkRevision || !this.isCurrentSnapshot(snapshot)) {
            return;
        }
        statusEl.classList.add(result.valid ? 'is-success' : 'is-error');
        statusEl.textContent = result.valid ? 'Valid JSON Schema' :
            result.errors.some(error => error.keyword === 'backend') ? 'Schema validation unavailable' : 'Invalid JSON Schema';
        statusEl.title = result.errors.map(error => `${error.path}: ${error.message}`).join('\n');
    }

    /**
     * @param {string} collectionId
     * @param {string} endpointId
     */
    async loadSchema(collectionId, endpointId) {
        const revision = ++this._contextRevision;
        await this.flushPendingSave();
        if (this._destroyed || revision !== this._contextRevision) {
            return;
        }

        this.currentCollectionId = collectionId;
        this.currentEndpointId = endpointId;
        this.lastResponseBody = null;

        if (!this.editor) {
            this.initialize();
        }

        try {
            const schema = await this.repository.getResponseSchema(collectionId, endpointId);
            await this.editor?.__ready;
            if (this._destroyed || revision !== this._contextRevision) {
                return;
            }
            this.editor.setSchema(schema, { emitChange: false });
            await this._updateValidationStatus();
        } catch (error) {
            if (!this._destroyed && revision === this._contextRevision) {
                console.error('Failed to load schema:', error);
                this.editor?.setSchema(null, { emitChange: false });
            }
        }
    }

    async clearContext() {
        const revision = ++this._contextRevision;
        await this.flushPendingSave();
        if (this._destroyed || revision !== this._contextRevision) {
            return;
        }

        this.currentCollectionId = null;
        this.currentEndpointId = null;
        this.lastResponseBody = null;
        if (this.editor) {
            this.editor.setSchema(null, { emitChange: false });
        }
        this._updateValidationStatus();
    }

    /** @param {*} responseBody */
    setLastResponseBody(responseBody) {
        this.lastResponseBody = responseBody;
    }

    inferSchemaFromResponse() {
        if (this.lastResponseBody === null || this.lastResponseBody === undefined) {
            this.statusDisplay.update('No response available to infer schema from', null);
            return;
        }

        if (!this.currentCollectionId || !this.currentEndpointId) {
            this.statusDisplay.update('No endpoint selected - schema will not be saved', null);
        }

        const schema = this.validator.inferSchema(this.lastResponseBody);
        this.editor.setSchema(schema);
        this._updateValidationStatus();
        this.statusDisplay.update('Schema inferred from response', null);

        this._saveSchema(this.currentCollectionId, this.currentEndpointId);
    }

    clearSchema() {
        this.editor.setSchema(null);
        this._updateValidationStatus();
        this._saveSchema(this.currentCollectionId, this.currentEndpointId);
        this.statusDisplay.update('Schema cleared', null);
    }

    /**
     * @param {*} responseBody
     * @returns {Object}
     */
    async validateResponse(responseBody, snapshot = this.captureSchema(), { isJson = true } = {}) {
        if (!snapshot.hasSchema) {
            return { valid: true, errors: [], hasSchema: false };
        }
        if (snapshot.error) {
            return {
                valid: false, schemaValid: false, hasSchema: true,
                errors: [{ path: '/', message: snapshot.error, keyword: 'parse' }]
            };
        }
        if (!isJson) {
            return {
                valid: false, schemaValid: true, hasSchema: true,
                errors: [{ path: '/', message: 'Response is not valid JSON', keyword: 'parse' }]
            };
        }
        // HTTP transport has already decoded JSON, including scalar strings.
        const result = await this.validator.validate(responseBody, snapshot.schema);
        return { ...result, hasSchema: true };
    }

    destroy() {
        this._destroyed = true;
        this._contextRevision++;
        this._debouncedSave.cancel();
        if (this.editor) {
            this.editor.destroy();
        }
    }
}
