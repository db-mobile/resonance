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
    constructor({ repository, statusDisplay }) {
        this.repository = repository;
        this.statusDisplay = statusDisplay;
        this.validator = new SchemaValidator();
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
        if (!this.currentCollectionId || !this.currentEndpointId) {
            return;
        }

        this._updateValidationStatus();

        this._debouncedSave(this.currentCollectionId, this.currentEndpointId);
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

        const schema = this.editor.getSchema();

        try {
            await this.repository.saveResponseSchema(collectionId, endpointId, schema);
        } catch (error) {
            console.error('Failed to save schema:', error);
        }
    }

    /** @returns {Promise<void>} */
    async flushPendingSave() {
        await this._debouncedSave.flush();
        await this._inFlightSave;
    }

    _updateValidationStatus() {
        const statusEl = document.getElementById('schema-validation-status');
        if (!statusEl || !this.editor) {
            return;
        }

        if (!this.editor.isValidJson()) {
            statusEl.className = 'schema-validation-status is-error';
            statusEl.textContent = 'Invalid JSON syntax';
            return;
        }

        const schema = this.editor.getSchema();
        if (!schema) {
            statusEl.className = 'schema-validation-status';
            statusEl.textContent = '';
            return;
        }

        statusEl.className = 'schema-validation-status is-success';
        statusEl.textContent = 'Valid JSON Schema';
    }

    /**
     * @param {string} collectionId
     * @param {string} endpointId
     */
    async loadSchema(collectionId, endpointId) {
        await this.flushPendingSave();

        this.currentCollectionId = collectionId;
        this.currentEndpointId = endpointId;
        this.lastResponseBody = null;

        if (!this.editor) {
            this.initialize();
        }

        try {
            const schema = await this.repository.getResponseSchema(collectionId, endpointId);
            this.editor.setSchema(schema, { emitChange: false });
            this._updateValidationStatus();
        } catch (error) {
            console.error('Failed to load schema:', error);
            this.editor.setSchema(null, { emitChange: false });
        }
    }

    async clearContext() {
        await this.flushPendingSave();

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
        if (!this.lastResponseBody) {
            this.statusDisplay.update('No response available to infer schema from', null);
            return;
        }

        if (!this.currentCollectionId || !this.currentEndpointId) {
            this.statusDisplay.update('No endpoint selected - schema will not be saved', null);
        }

        let data = this.lastResponseBody;
        
        if (typeof data === 'string') {
            try {
                data = JSON.parse(data);
            } catch {
                this.statusDisplay.update('Response is not valid JSON', null);
                return;
            }
        }

        const schema = this.validator.inferSchema(data);
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
    validateResponse(responseBody) {
        const schema = this.editor?.getSchema();
        
        if (!schema) {
            return { valid: true, errors: [], hasSchema: false };
        }

        let data = responseBody;
        if (typeof data === 'string') {
            try {
                data = JSON.parse(data);
            } catch {
                return {
                    valid: false,
                    errors: [{ path: '/', message: 'Response is not valid JSON', keyword: 'parse' }],
                    hasSchema: true
                };
            }
        }

        const result = this.validator.validate(data, schema);
        return { ...result, hasSchema: true };
    }

    /**
     * @param {string} collectionId
     * @param {string} endpointId
     * @param {Object} schema
     */
    async setSchemaForEndpoint(collectionId, endpointId, schema) {
        try {
            await this.repository.saveResponseSchema(collectionId, endpointId, schema);
            
            if (this.currentCollectionId === collectionId &&
                this.currentEndpointId === endpointId &&
                this.editor) {
                this.editor.setSchema(schema, { emitChange: false });
                this._updateValidationStatus();
            }
        } catch (error) {
            console.error('Failed to set schema for endpoint:', error);
        }
    }

    /** @param {boolean} isDark */
    updateTheme(isDark) {
        if (this.editor) {
            this.editor.updateTheme(isDark);
        }
    }

    destroy() {
        this._debouncedSave.cancel();
        if (this.editor) {
            this.editor.destroy();
        }
    }
}
