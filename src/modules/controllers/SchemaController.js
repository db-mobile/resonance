/**
 * @fileoverview Controller for response schema validation feature
 * @module controllers/SchemaController
 */

import { SchemaEditor } from '../schemaEditor.bundle.js';
import { SchemaValidator } from '../schema/SchemaValidator.js';

/**
 * Controller for managing response schema validation
 */
export class SchemaController {
    /**
     * Creates a SchemaController instance
     * 
     * @param {Object} options - Controller options
     * @param {Object} options.repository - CollectionRepository instance
     * @param {Object} options.statusDisplay - Status display adapter
     */
    constructor({ repository, statusDisplay }) {
        this.repository = repository;
        this.statusDisplay = statusDisplay;
        this.validator = new SchemaValidator();
        this.editor = null;
        this.currentCollectionId = null;
        this.currentEndpointId = null;
        this.lastResponseBody = null;
        this._saveDebounceTimer = null;
        this._initialized = false;
    }

    /**
     * Initializes the schema editor and event listeners
     */
    initialize() {
        if (this._initialized) {
            return;
        }

        const container = document.getElementById('schema-editor-container');
        if (!container) {
            return;
        }

        this.editor = new SchemaEditor(container, {
            onChange: (value) => this._handleSchemaChange(value)
        });

        this._setupEventListeners();
        this._initialized = true;
    }

    /**
     * Sets up event listeners for schema tab buttons
     * @private
     */
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

    /**
     * Handles schema content changes with debounced save
     * @private
     */
    _handleSchemaChange(_value) {
        if (!this.currentCollectionId || !this.currentEndpointId) {
            return;
        }

        // Update validation status
        this._updateValidationStatus();

        // Debounced save
        if (this._saveDebounceTimer) {
            clearTimeout(this._saveDebounceTimer);
        }

        this._saveDebounceTimer = setTimeout(() => {
            this._saveSchema();
        }, 1000);
    }

    /**
     * Saves the current schema to storage
     * @private
     */
    async _saveSchema() {
        if (!this.currentCollectionId || !this.currentEndpointId) {
            return;
        }

        const schema = this.editor.getSchema();
        
        try {
            await this.repository.saveResponseSchema(
                this.currentCollectionId,
                this.currentEndpointId,
                schema
            );
        } catch (error) {
            console.error('Failed to save schema:', error);
        }
    }

    /**
     * Updates the validation status display
     * @private
     */
    _updateValidationStatus() {
        const statusEl = document.getElementById('schema-validation-status');
        if (!statusEl) {
            return;
        }

        if (!this.editor.isValidJson()) {
            statusEl.className = 'schema-validation-status schema-status-error';
            statusEl.textContent = 'Invalid JSON syntax';
            return;
        }

        const schema = this.editor.getSchema();
        if (!schema) {
            statusEl.className = 'schema-validation-status';
            statusEl.textContent = '';
            return;
        }

        statusEl.className = 'schema-validation-status schema-status-valid';
        statusEl.textContent = 'Valid JSON Schema';
    }

    /**
     * Loads schema for the specified endpoint
     * 
     * @param {string} collectionId - Collection ID
     * @param {string} endpointId - Endpoint ID
     */
    async loadSchema(collectionId, endpointId) {
        this.currentCollectionId = collectionId;
        this.currentEndpointId = endpointId;
        this.lastResponseBody = null; // Clear previous response when switching endpoints

        if (!this.editor) {
            this.initialize();
        }

        try {
            const schema = await this.repository.getResponseSchema(collectionId, endpointId);
            this.editor.setSchema(schema);
            this._updateValidationStatus();
        } catch (error) {
            console.error('Failed to load schema:', error);
            this.editor.setSchema(null);
        }
    }

    /**
     * Clears the current endpoint context (when no endpoint is selected)
     */
    clearContext() {
        this.currentCollectionId = null;
        this.currentEndpointId = null;
        this.lastResponseBody = null;
        if (this.editor) {
            this.editor.setSchema(null);
        }
        this._updateValidationStatus();
    }

    /**
     * Stores the last response body for schema inference
     * 
     * @param {*} responseBody - The response body to store
     */
    setLastResponseBody(responseBody) {
        this.lastResponseBody = responseBody;
    }

    /**
     * Infers schema from the last response body
     */
    inferSchemaFromResponse() {
        if (!this.lastResponseBody) {
            this.statusDisplay.update('No response available to infer schema from', null);
            return;
        }

        if (!this.currentCollectionId || !this.currentEndpointId) {
            this.statusDisplay.update('No endpoint selected - schema will not be saved', null);
        }

        let data = this.lastResponseBody;
        
        // Parse if string
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

        // Save immediately
        this._saveSchema();
    }

    /**
     * Clears the current schema
     */
    clearSchema() {
        this.editor.setSchema(null);
        this._updateValidationStatus();
        this._saveSchema();
        this.statusDisplay.update('Schema cleared', null);
    }

    /**
     * Validates response data against the current schema
     * 
     * @param {*} responseBody - Response body to validate
     * @returns {Object} Validation result { valid: boolean, errors: Array }
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
     * Sets a schema directly (used by OpenAPI import)
     * 
     * @param {string} collectionId - Collection ID
     * @param {string} endpointId - Endpoint ID
     * @param {Object} schema - JSON Schema to set
     */
    async setSchemaForEndpoint(collectionId, endpointId, schema) {
        try {
            await this.repository.saveResponseSchema(collectionId, endpointId, schema);
            
            // If this is the currently loaded endpoint, update the editor
            if (this.currentCollectionId === collectionId && 
                this.currentEndpointId === endpointId && 
                this.editor) {
                this.editor.setSchema(schema);
                this._updateValidationStatus();
            }
        } catch (error) {
            console.error('Failed to set schema for endpoint:', error);
        }
    }

    /**
     * Updates the editor theme
     * 
     * @param {boolean} isDark - Whether to use dark theme
     */
    updateTheme(isDark) {
        if (this.editor) {
            this.editor.updateTheme(isDark);
        }
    }

    /**
     * Destroys the controller and cleans up resources
     */
    destroy() {
        if (this._saveDebounceTimer) {
            clearTimeout(this._saveDebounceTimer);
        }
        if (this.editor) {
            this.editor.destroy();
        }
    }
}
