/**
 * @fileoverview Service for managing collection business logic and request handling
 * @module services/CollectionService
 */

import { setRequestBodyContent, getRequestBodyContent } from '../requestBodyHelper.js';

/**
 * Service for managing API collection business logic
 *
 * @class
 * @classdesc Provides high-level collection operations including CRUD operations,
 * endpoint management, request body generation, and form population. Handles
 * OpenAPI schema processing and coordinates with repository layer for persistence.
 * Manages request state including path parameters, query parameters, headers, and
 * authentication configuration.
 */
export class CollectionService {
    /**
     * Creates a CollectionService instance
     *
     * @param {CollectionRepository} repository - Data access layer for collections
     * @param {SchemaProcessor} schemaProcessor - OpenAPI schema processor
     * @param {IStatusDisplay} statusDisplay - Status display interface
     */
    constructor(repository, schemaProcessor, statusDisplay) {
        this.repository = repository;
        this.schemaProcessor = schemaProcessor;
        this.statusDisplay = statusDisplay;
        this.originalBodyValues = new Map();
    }

    /**
     * Loads all collections from storage
     *
     * @async
     * @returns {Promise<Array<Object>>} Array of collection objects
     * @throws {Error} If storage access fails
     */
    async loadCollections() {
        try {
            const collections = await this.repository.getAll();
            return collections;
        } catch (error) {
            this.statusDisplay.update('Error loading collections', null);
            throw error;
        }
    }

    /**
     * Imports a collection into storage
     *
     * Updates status display with progress and completion status.
     *
     * @async
     * @param {Object} collection - The collection object to import
     * @param {string} collection.name - Collection name
     * @param {string} [collection.baseUrl] - Base URL for the collection
     * @param {Array<Object>} [collection.endpoints] - Collection endpoints
     * @returns {Promise<Object>} The imported collection with generated ID
     * @throws {Error} If import or storage operation fails
     */
    async importCollection(collection) {
        try {
            this.statusDisplay.update('Importing collection...', null);
            
            const importedCollection = await this.repository.add(collection);
            
            this.statusDisplay.update(`Imported collection: ${collection.name}`, null);
            return importedCollection;
        } catch (error) {
            this.statusDisplay.update(`Import error: ${error.message}`, null);
            throw error;
        }
    }

    /**
     * Renames an existing collection
     *
     * @async
     * @param {string} collectionId - The ID of the collection to rename
     * @param {string} newName - The new name for the collection
     * @returns {Promise<Object>} The updated collection object
     * @throws {Error} If collection is not found or update fails
     */
    async renameCollection(collectionId, newName) {
        try {
            this.statusDisplay.update('Renaming collection...', null);

            const updatedCollection = await this.repository.update(collectionId, { name: newName });

            this.statusDisplay.update(`Collection renamed to "${newName}"`, null);
            return updatedCollection;
        } catch (error) {
            this.statusDisplay.update(`Error renaming collection: ${error.message}`, null);
            throw error;
        }
    }

    /**
     * Deletes a collection from storage
     *
     * @async
     * @param {string} collectionId - The ID of the collection to delete
     * @returns {Promise<boolean>} True if deletion was successful
     * @throws {Error} If collection is not found or deletion fails
     */
    async deleteCollection(collectionId) {
        try {
            this.statusDisplay.update('Deleting collection...', null);

            await this.repository.delete(collectionId);

            this.statusDisplay.update('Collection deleted successfully', null);
            return true;
        } catch (error) {
            this.statusDisplay.update(`Error deleting collection: ${error.message}`, null);
            throw error;
        }
    }

    /**
     * Exports a collection as OpenAPI specification
     *
     * Triggers the export process via IPC to the main process, which handles
     * file dialog and file writing. Updates status display with progress.
     *
     * @async
     * @param {string} collectionId - The ID of the collection to export
     * @param {string} format - Export format ('json' or 'yaml')
     * @returns {Promise<Object>} Result object with success status and file path
     * @throws {Error} If collection is not found or export fails
     */
    async exportCollectionAsOpenApi(collectionId, format) {
        try {
            this.statusDisplay.update('Exporting collection...', null);

            const result = await window.backendAPI.collections.exportOpenApi(collectionId, format);

            if (result.cancelled) {
                this.statusDisplay.update('Export cancelled', null);
                return { success: false, cancelled: true };
            }

            if (result.success) {
                let message = `Collection exported successfully to ${format.toUpperCase()}`;
                if (result.skipped && result.skipped.count > 0) {
                    message = `${message} (${result.skipped.count} items skipped)`;
                }
                this.statusDisplay.update(message, null);
                return result;
            }

            throw new Error('Export failed');
        } catch (error) {
            this.statusDisplay.update(`Export error: ${error.message}`, null);
            throw error;
        }
    }

    async exportCollectionAsPostman(collectionId) {
        try {
            this.statusDisplay.update('Exporting collection...', null);

            const result = await window.backendAPI.collections.exportPostman(collectionId);

            if (result.cancelled) {
                this.statusDisplay.update('Export cancelled', null);
                return { success: false, cancelled: true };
            }

            if (result.success) {
                let message = 'Collection exported successfully to Postman';
                if (result.skipped && result.skipped.count > 0) {
                    message = `${message} (${result.skipped.count} items skipped)`;
                }
                this.statusDisplay.update(message, null);
                return result;
            }

            throw new Error('Export failed');
        } catch (error) {
            this.statusDisplay.update(`Export error: ${error.message}`, null);
            throw error;
        }
    }

    /**
     * Creates a new empty collection
     *
     * Generates a unique collection ID and initializes default structure.
     *
     * @async
     * @param {string} name - The name for the new collection
     * @returns {Promise<Object>} The newly created collection object
     * @throws {Error} If creation or storage operation fails
     */
    async createCollection(name) {
        try {
            this.statusDisplay.update('Creating collection...', null);

            const newCollection = {
                id: this.generateCollectionId(),
                name: name,
                baseUrl: '',
                endpoints: [],
                folders: [],
                defaultHeaders: {},
                _openApiSpec: null
            };

            const createdCollection = await this.repository.add(newCollection);

            this.statusDisplay.update(`Collection "${name}" created successfully`, null);
            return createdCollection;
        } catch (error) {
            this.statusDisplay.update(`Error creating collection: ${error.message}`, null);
            throw error;
        }
    }

    /**
     * Generates a unique collection ID
     *
     * @private
     * @returns {string} A unique collection identifier
     */
    generateCollectionId() {
        return `collection_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    }

    /**
     * Adds a new request to an existing collection
     *
     * Automatically organizes the request into folders based on path structure.
     *
     * @async
     * @param {string} collectionId - The ID of the target collection
     * @param {Object} requestData - The request data
     * @param {string} requestData.name - Request name
     * @param {string} requestData.method - HTTP method (GET, POST, etc.)
     * @param {string} requestData.path - Request path/URL
     * @returns {Promise<Object>} The created endpoint object
     * @throws {Error} If collection is not found or request cannot be added
     */
    async addRequestToCollection(collectionId, requestData) {
        try {
            this.statusDisplay.update('Adding new request...', null);
            
            const collection = await this.repository.getById(collectionId);
            if (!collection) {
                throw new Error(`Collection with id ${collectionId} not found`);
            }

            const isGrpc = requestData.protocol === 'grpc';

            const newEndpoint = {
                id: this.generateEndpointId(collection),
                name: requestData.name,
                protocol: isGrpc ? 'grpc' : 'http',
                method: isGrpc ? 'GRPC' : requestData.method,
                path: isGrpc ? requestData.fullMethod : requestData.path,
                description: '',
                parameters: {
                    query: {},
                    header: {},
                    path: {}
                },
                requestBody: null,
                headers: {}
            };

            collection.endpoints = collection.endpoints || [];
            collection.endpoints.push(newEndpoint);

            if (collection.folders && collection.folders.length > 0) {
                const basePath = this.extractBasePath(isGrpc ? '/grpc' : requestData.path);
                
                let targetFolder = collection.folders.find(folder => folder.name === basePath);
                
                if (!targetFolder) {
                    targetFolder = {
                        id: `folder_${basePath}`.replace(/[^a-zA-Z0-9]/g, '_'),
                        name: basePath,
                        endpoints: []
                    };
                    collection.folders.push(targetFolder);
                }
                
                targetFolder.endpoints.push(newEndpoint);
            }

            await this.repository.update(collectionId, collection);

            if (isGrpc) {
                await this.repository.saveGrpcData(collectionId, newEndpoint.id, {
                    target: requestData.target || '',
                    service: requestData.service || '',
                    fullMethod: requestData.fullMethod || '',
                    requestJson: requestData.requestJson || '{}'
                });
            }
            
            this.statusDisplay.update(`Added new request: ${requestData.name}`, null);
            return newEndpoint;
        } catch (error) {
            this.statusDisplay.update(`Error adding request: ${error.message}`, null);
            throw error;
        }
    }

    /**
     * Generates a unique endpoint ID within a collection
     *
     * @private
     * @param {Object} collection - The collection object
     * @returns {string} A unique endpoint identifier
     */
    generateEndpointId(collection) {
        const existingIds = collection.endpoints.map(endpoint => endpoint.id);
        let counter = 1;
        let newId = `custom_${counter}`;

        while (existingIds.includes(newId)) {
            counter++;
            newId = `custom_${counter}`;
        }

        return newId;
    }

    /**
     * Extracts the base path segment from a URL path
     *
     * Used for automatic folder organization.
     *
     * @private
     * @param {string} pathKey - The full URL path
     * @returns {string} The first path segment or 'custom'
     */
    extractBasePath(pathKey) {
        const cleanPath = pathKey.replace(/^\//, '');
        const segments = cleanPath.split('/');

        return segments[0] || 'custom';
    }

    /**
     * Deletes a request from a collection
     *
     * Removes the endpoint from the collection and all folders, and cleans up
     * persisted endpoint data (headers, params, body, auth).
     *
     * @async
     * @param {string} collectionId - The collection ID
     * @param {string} endpointId - The endpoint ID to delete
     * @returns {Promise<boolean>} True if deletion was successful
     * @throws {Error} If collection is not found or deletion fails
     */
    async deleteRequestFromCollection(collectionId, endpointId) {
        try {
            this.statusDisplay.update('Deleting request...', null);

            const collection = await this.repository.getById(collectionId);
            if (!collection) {
                throw new Error(`Collection with id ${collectionId} not found`);
            }

            if (collection.endpoints) {
                collection.endpoints = collection.endpoints.filter(endpoint => endpoint.id !== endpointId);
            }

            if (collection.folders && collection.folders.length > 0) {
                collection.folders.forEach(folder => {
                    if (folder.endpoints) {
                        folder.endpoints = folder.endpoints.filter(endpoint => endpoint.id !== endpointId);
                    }
                });

                collection.folders = collection.folders.filter(folder => folder.endpoints && folder.endpoints.length > 0);
            }

            await this.repository.update(collectionId, collection);

            await this.repository.deletePersistedEndpointData(collectionId, endpointId);

            this.statusDisplay.update('Request deleted successfully', null);
            return true;
        } catch (error) {
            this.statusDisplay.update(`Error deleting request: ${error.message}`, null);
            throw error;
        }
    }

    /**
     * Loads an endpoint into the request form
     *
     * Saves current endpoint state before switching, then populates form with
     * endpoint data including URL, method, parameters, headers, body, and auth.
     * Uses persisted values if available, otherwise falls back to endpoint defaults.
     *
     * @async
     * @param {Object} collection - The collection containing the endpoint
     * @param {Object} endpoint - The endpoint to load
     * @param {Object} formElements - DOM form element references
     * @param {HTMLInputElement} formElements.urlInput - URL input field
     * @param {HTMLSelectElement} formElements.methodSelect - Method dropdown
     * @param {HTMLElement} formElements.pathParamsList - Path params container
     * @param {HTMLElement} formElements.queryParamsList - Query params container
     * @param {HTMLElement} formElements.headersList - Headers container
     * @param {HTMLTextAreaElement} formElements.bodyInput - Request body textarea
     * @returns {Promise<void>}
     * @throws {Error} If form population fails
     */
    async loadEndpointIntoForm(collection, endpoint, formElements) {
        try {
            this.schemaProcessor.setOpenApiSpec(collection._openApiSpec);

            if (window.currentEndpoint) {
                await this.saveRequestBodyModification(
                    window.currentEndpoint.collectionId,
                    window.currentEndpoint.endpointId,
                    formElements.bodyInput
                );
                await this.saveCurrentPathParams(window.currentEndpoint.collectionId, window.currentEndpoint.endpointId, formElements);
                await this.saveCurrentQueryParams(window.currentEndpoint.collectionId, window.currentEndpoint.endpointId, formElements);
                await this.saveCurrentHeaders(window.currentEndpoint.collectionId, window.currentEndpoint.endpointId, formElements);
                await this.saveCurrentAuthConfig(window.currentEndpoint.collectionId, window.currentEndpoint.endpointId);
            }
            window.currentEndpoint = { collectionId: collection.id, endpointId: endpoint.id };

            this.populateUrlAndMethod(collection, endpoint, formElements);
            await this.populatePathParams(endpoint, formElements);
            await this.populateHeaders(collection, endpoint, formElements);
            await this.populateQueryParams(endpoint, formElements);
            await this.populateRequestBody(collection, endpoint, formElements);
            await this.populateAuthConfig(collection.id, endpoint.id);

            this.statusDisplay.update(`Loaded endpoint: ${endpoint.name}`, null);
        } catch (error) {
            this.statusDisplay.update(`Error loading endpoint: ${error.message}`, null);
            throw error;
        }
    }

    /**
     * Populates URL and HTTP method fields
     *
     * Converts path parameters to variable template format ({{paramName}}).
     *
     * @private
     * @param {Object} collection - The collection
     * @param {Object} endpoint - The endpoint
     * @param {Object} formElements - Form element references
     * @returns {void}
     */
    populateUrlAndMethod(collection, endpoint, formElements) {
        let fullUrl = endpoint.path;
        if (collection.baseUrl && !endpoint.path.includes('{{baseUrl}}')) {
            fullUrl = `{{baseUrl}}${  endpoint.path}`;
        }

        if (endpoint.parameters?.path) {
            Object.entries(endpoint.parameters.path).forEach(([key, _param]) => {
                const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const singleBraceParamRegex = new RegExp(`(?<!\\{)\\{${escapedKey}\\}(?!\\})`, 'g');
                fullUrl = fullUrl.replace(singleBraceParamRegex, `{{${key}}}`);
            });
        }

        formElements.urlInput.value = fullUrl;
        formElements.methodSelect.value = endpoint.method;
    }

    /**
     * Populates path parameters from endpoint or persisted data
     *
     * @async
     * @private
     * @param {Object} endpoint - The endpoint object
     * @param {Object} formElements - Form element references
     * @returns {Promise<void>}
     */
    async populatePathParams(endpoint, formElements) {
        this.clearKeyValueList(formElements.pathParamsList);

        const persistedPathParams = await this.repository.getPersistedPathParams(window.currentEndpoint.collectionId, endpoint.id);

        if (persistedPathParams.length > 0) {
            persistedPathParams.forEach(param => {
                this.addKeyValueRow(formElements.pathParamsList, param.key, param.value);
            });
        } else if (endpoint.parameters?.path) {
                Object.entries(endpoint.parameters.path).forEach(([key, param]) => {
                    const value = param.example || '';
                    this.addKeyValueRow(formElements.pathParamsList, key, value);
                });
            }

        if (formElements.pathParamsList.children.length === 0) {
            this.addKeyValueRow(formElements.pathParamsList);
        }
    }

    /**
     * Populates headers from collection defaults, endpoint spec, or persisted data
     *
     * @async
     * @private
     * @param {Object} collection - The collection object
     * @param {Object} endpoint - The endpoint object
     * @param {Object} formElements - Form element references
     * @returns {Promise<void>}
     */
    async populateHeaders(collection, endpoint, formElements) {
        this.clearKeyValueList(formElements.headersList);

        const persistedHeaders = await this.repository.getPersistedHeaders(collection.id, endpoint.id);
        
        if (persistedHeaders.length > 0) {
            persistedHeaders.forEach(header => {
                this.addKeyValueRow(formElements.headersList, header.key, header.value);
            });
        } else {
            if (collection.defaultHeaders) {
                Object.entries(collection.defaultHeaders).forEach(([key, value]) => {
                    this.addKeyValueRow(formElements.headersList, key, value);
                });
            }

            if (endpoint.parameters?.header) {
                Object.entries(endpoint.parameters.header).forEach(([key, param]) => {
                    this.addKeyValueRow(formElements.headersList, key, param.example || '');
                });
            }

            if (['POST', 'PUT', 'PATCH'].includes(endpoint.method)) {
                const contentType = endpoint.requestBody?.contentType || 'application/json';
                const existingContentType = Array.from(formElements.headersList.children).find(row => {
                    const keyInput = row.querySelector('.key-input');
                    return keyInput && keyInput.value.toLowerCase() === 'content-type';
                });
                if (!existingContentType) {
                    this.addKeyValueRow(formElements.headersList, 'Content-Type', contentType);
                }
            }
        }

        if (formElements.headersList.children.length === 0) {
            this.addKeyValueRow(formElements.headersList);
        }
    }

    /**
     * Populates query parameters from endpoint spec or persisted data
     *
     * Also updates URL with encoded query string.
     *
     * @async
     * @private
     * @param {Object} endpoint - The endpoint object
     * @param {Object} formElements - Form element references
     * @returns {Promise<void>}
     */
    async populateQueryParams(endpoint, formElements) {
        this.clearKeyValueList(formElements.queryParamsList);

        const persistedQueryParams = await this.repository.getPersistedQueryParams(window.currentEndpoint.collectionId, endpoint.id);

        if (persistedQueryParams.length > 0) {
            persistedQueryParams.forEach(param => {
                this.addKeyValueRow(formElements.queryParamsList, param.key, param.value);
            });
        } else if (endpoint.parameters?.query) {
                Object.entries(endpoint.parameters.query).forEach(([key, param]) => {
                    this.addKeyValueRow(formElements.queryParamsList, key, param.example || '');
                });
            }

        if (formElements.queryParamsList.children.length === 0) {
            this.addKeyValueRow(formElements.queryParamsList);
        }

        // Update URL with query params (with flag to prevent circular updates)
        this.updateUrlWithQueryParams(formElements);
    }

    /**
     * Updates URL input field with encoded query parameters
     *
     * Preserves variable placeholders like {{variableName}} during encoding.
     * Prevents circular updates with setUrlUpdating flag.
     *
     * @private
     * @param {Object} formElements - Form element references
     * @returns {void}
     */
    updateUrlWithQueryParams(formElements) {
        try {
            const queryParams = this.parseKeyValuePairs(formElements.queryParamsList);
            const urlString = formElements.urlInput.value.trim();

            if (!urlString) {
                return;
            }

            const questionMarkIndex = urlString.indexOf('?');
            const baseUrl = questionMarkIndex >= 0 ? urlString.substring(0, questionMarkIndex) : urlString;

            // Build query string with encoding that preserves variable placeholders like {{variableName}}
            const queryPairs = [];
            queryParams.forEach(({ key, value }) => {
                if (key) {
                    // Use the same encoding function as keyValueManager to preserve {{...}} patterns
                    const encodedKey = this.encodeValuePreservingPlaceholders(key);
                    const encodedValue = this.encodeValuePreservingPlaceholders(value);
                    queryPairs.push(`${encodedKey}=${encodedValue}`);
                }
            });

            const queryString = queryPairs.join('&');

            // Import setUrlUpdating to prevent circular update
            // Set flag before updating URL to prevent triggering updateQueryParamsFromUrl
            if (typeof window !== 'undefined' && window.setUrlUpdating) {
                window.setUrlUpdating(true);
            }

            formElements.urlInput.value = queryString ? `${baseUrl}?${queryString}` : baseUrl;

            // Clear flag after event loop
            if (typeof window !== 'undefined' && window.setUrlUpdating) {
                setTimeout(() => {
                    window.setUrlUpdating(false);
                }, 0);
            }
        } catch (error) {
            if (typeof window !== 'undefined' && window.setUrlUpdating) {
                window.setUrlUpdating(false);
            }
        }
    }

    /**
     * URL encodes a value while preserving variable placeholders
     *
     * Temporarily replaces {{variableName}} patterns before encoding,
     * then restores them after encoding.
     *
     * @private
     * @param {string} value - The value to encode
     * @returns {string} URL-encoded value with preserved placeholders
     */
    encodeValuePreservingPlaceholders(value) {
        // Find all {{...}} patterns and temporarily replace them with placeholders
        const placeholders = [];
        let index = 0;

        const withPlaceholders = value.replace(/\{\{[^}]+\}\}/g, (match) => {
            const placeholder = `__PLACEHOLDER_${index}__`;
            placeholders.push({ placeholder, original: match });
            index++;
            return placeholder;
        });

        // URL encode the value (this encodes special chars but not our placeholders)
        const encoded = encodeURIComponent(withPlaceholders);

        // Restore the original {{...}} patterns
        let result = encoded;
        placeholders.forEach(({ placeholder, original }) => {
            result = result.replace(placeholder, original);
        });

        return result;
    }

    /**
     * Populates request body from persisted data, generated example, or defaults
     *
     * @async
     * @private
     * @param {Object} collection - The collection object
     * @param {Object} endpoint - The endpoint object
     * @param {Object} _formElements - Form element references (unused, kept for API compatibility)
     * @returns {Promise<void>}
     */
    async populateRequestBody(collection, endpoint, _formElements) {
        // Check if this endpoint has GraphQL data
        const graphqlData = await this.repository.getGraphQLData(collection.id, endpoint.id);

        if (graphqlData && graphqlData.mode === 'graphql') {
            // Switch to GraphQL mode and populate GraphQL editors
            if (window.graphqlBodyManager) {
                window.graphqlBodyManager.setGraphQLModeEnabled(true);
                window.graphqlBodyManager.setGraphQLQuery(graphqlData.query || '');
                window.graphqlBodyManager.setGraphQLVariables(graphqlData.variables || '');
            }

            const key = `${collection.id}_${endpoint.id}`;
            this.originalBodyValues.set(key, graphqlData.query || '');
        } else {
            // Switch to JSON mode and populate JSON editor
            if (window.graphqlBodyManager) {
                window.graphqlBodyManager.setGraphQLModeEnabled(false);
            }

            const persistedBody = await this.repository.getModifiedRequestBody(collection.id, endpoint.id);

            let bodyContent;
            if (persistedBody) {
                bodyContent = persistedBody;
            } else if (endpoint.requestBody) {
                bodyContent = this.generateRequestBody(endpoint.requestBody);
            } else if (['POST', 'PUT', 'PATCH'].includes(endpoint.method)) {
                bodyContent = JSON.stringify({ 'data': 'example' }, null, 2);
            } else {
                bodyContent = '';
            }

            // Set the body content in both textarea and CodeMirror editor
            setRequestBodyContent(bodyContent);

            const key = `${collection.id}_${endpoint.id}`;
            this.originalBodyValues.set(key, bodyContent);
        }
    }

    async saveRequestBodyModification(collectionId, endpointId, _bodyInput) {
        await this.saveModifiedRequestBody(collectionId, endpointId);
    }

    /**
     * Generates request body from OpenAPI schema or examples
     *
     * @private
     * @param {Object} requestBody - The request body spec from OpenAPI
     * @returns {string} Generated JSON request body
     */
    generateRequestBody(requestBody) {
        if (requestBody.example && requestBody.example !== null && requestBody.example !== 'null') {
            return requestBody.example;
        }

        if (requestBody.schema) {
            const resolvedSchema = this.schemaProcessor.resolveSchemaRefs(requestBody.schema);
            const placeholder = this.schemaProcessor.generateExampleFromSchema(resolvedSchema);
            
            if (placeholder && placeholder !== 'null' && placeholder !== null && placeholder !== undefined) {
                return placeholder;
            }
        }

        if (requestBody.required) {
            return JSON.stringify({
                'note': 'Request body is required',
                'data': 'Please fill in the required fields'
            }, null, 2);
        }

        return JSON.stringify({ 'data': 'example' }, null, 2);
    }

    /**
     * Saves modified request body to persistence layer
     *
     * Only saves if body has changed from original value.
     *
     * @async
     * @private
     * @param {string} collectionId - The collection ID
     * @param {string} endpointId - The endpoint ID
     * @returns {Promise<void>}
     */
    async saveModifiedRequestBody(collectionId, endpointId) {
        try {
            // Check if we're in GraphQL mode
            if (window.graphqlBodyManager && window.graphqlBodyManager.isGraphQLMode()) {
                const query = window.graphqlBodyManager.getGraphQLQuery();
                const variables = window.graphqlBodyManager.getGraphQLVariables();

                // Save GraphQL data
                await this.saveGraphQLData(collectionId, endpointId, query, variables);
            } else {
                // JSON mode - save as regular request body
                const currentBody = getRequestBodyContent().trim();
                if (!currentBody) {
                    return;
                }

                // Always save the current body when explicitly called
                // This ensures the body is persisted even when using workspace tabs
                // where originalBodyValues may not be set
                await this.repository.saveModifiedRequestBody(collectionId, endpointId, currentBody);
            }
        } catch (error) {
            void error;
        }
    }

    /**
     * Saves GraphQL mode and content for an endpoint
     *
     * @async
     * @param {string} collectionId - The collection ID
     * @param {string} endpointId - The endpoint ID
     * @param {string} query - GraphQL query
     * @param {string} variables - GraphQL variables JSON
     * @returns {Promise<void>}
     */
    async saveGraphQLData(collectionId, endpointId, query, variables) {
        try {
            await this.repository.saveGraphQLData(collectionId, endpointId, {
                mode: 'graphql',
                query,
                variables
            });
        } catch (error) {
            void error;
        }
    }

    /**
     * Gets saved GraphQL data for an endpoint
     *
     * @async
     * @param {string} collectionId - The collection ID
     * @param {string} endpointId - The endpoint ID
     * @returns {Promise<Object|null>} GraphQL data or null if not found
     */
    async getGraphQLData(collectionId, endpointId) {
        try {
            return await this.repository.getGraphQLData(collectionId, endpointId);
        } catch (error) {
            return null;
        }
    }

    /**
     * Saves current path parameters to persistence layer
     *
     * @async
     * @private
     * @param {string} collectionId - The collection ID
     * @param {string} endpointId - The endpoint ID
     * @param {Object} formElements - Form element references
     * @returns {Promise<void>}
     */
    async saveCurrentPathParams(collectionId, endpointId, formElements) {
        try {
            const pathParams = this.parseKeyValuePairs(formElements.pathParamsList);
            await this.repository.savePersistedPathParams(collectionId, endpointId, pathParams);
        } catch (error) {
            void error;
        }
    }

    /**
     * Saves current query parameters to persistence layer
     *
     * @async
     * @private
     * @param {string} collectionId - The collection ID
     * @param {string} endpointId - The endpoint ID
     * @param {Object} formElements - Form element references
     * @returns {Promise<void>}
     */
    async saveCurrentQueryParams(collectionId, endpointId, formElements) {
        try {
            const queryParams = this.parseKeyValuePairs(formElements.queryParamsList);
            await this.repository.savePersistedQueryParams(collectionId, endpointId, queryParams);
        } catch (error) {
            void error;
        }
    }

    /**
     * Saves current headers to persistence layer
     *
     * @async
     * @private
     * @param {string} collectionId - The collection ID
     * @param {string} endpointId - The endpoint ID
     * @param {Object} formElements - Form element references
     * @returns {Promise<void>}
     */
    async saveCurrentHeaders(collectionId, endpointId, formElements) {
        try {
            const headers = this.parseKeyValuePairs(formElements.headersList);
            await this.repository.savePersistedHeaders(collectionId, endpointId, headers);
        } catch (error) {
            void error;
        }
    }

    /**
     * Saves current authentication configuration to persistence layer
     *
     * @async
     * @private
     * @param {string} collectionId - The collection ID
     * @param {string} endpointId - The endpoint ID
     * @returns {Promise<void>}
     */
    async saveCurrentAuthConfig(collectionId, endpointId) {
        try {
            if (window.authManager) {
                const authConfig = window.authManager.getAuthConfig();
                await this.repository.savePersistedAuthConfig(collectionId, endpointId, authConfig);
            }
        } catch (error) {
            void error;
        }
    }

    /**
     * Populates authentication configuration from persisted data or endpoint defaults
     *
     * @async
     * @private
     * @param {string} collectionId - The collection ID
     * @param {string} endpointId - The endpoint ID
     * @returns {Promise<void>}
     */
    async populateAuthConfig(collectionId, endpointId) {
        try {
            if (window.authManager) {
                const authConfig = await this.repository.getPersistedAuthConfig(collectionId, endpointId);
                if (authConfig) {
                    window.authManager.loadAuthConfig(authConfig);
                } else {
                    const collection = await this.repository.getById(collectionId);
                    const endpoint = collection?.endpoints?.find(ep => ep.id === endpointId);

                    if (endpoint?.security) {
                        window.authManager.loadAuthConfig(endpoint.security);
                    } else {
                        window.authManager.resetAuthConfig();
                    }
                }
            }
        } catch (error) {
            void error;
        }
    }

    /**
     * Parses key-value pairs from a container element
     *
     * @private
     * @param {HTMLElement} container - Container with key-value rows
     * @returns {Array<Object>} Array of {key, value} objects
     */
    parseKeyValuePairs(container) {
        const pairs = [];
        const rows = container.querySelectorAll('.key-value-row');

        rows.forEach(row => {
            const keyInput = row.querySelector('.key-input');
            const valueInput = row.querySelector('.value-input');

            if (keyInput && valueInput && keyInput.value.trim()) {
                pairs.push({
                    key: keyInput.value.trim(),
                    value: valueInput.value.trim()
                });
            }
        });

        return pairs;
    }

    /**
     * Clears all child elements from a container
     *
     * @private
     * @param {HTMLElement} container - Container to clear
     * @returns {void}
     */
    clearKeyValueList(container) {
        while (container.firstChild) {
            container.removeChild(container.firstChild);
        }
    }

    /**
     * Adds a key-value row to a container
     *
     * Creates input fields and remove button.
     *
     * @private
     * @param {HTMLElement} container - Container to add row to
     * @param {string} [key=''] - Initial key value
     * @param {string} [value=''] - Initial value
     * @returns {void}
     */
    addKeyValueRow(container, key = '', value = '') {
        const row = document.createElement('div');
        row.className = 'key-value-row';

        const keyInput = document.createElement('input');
        keyInput.type = 'text';
        keyInput.className = 'key-input';
        keyInput.placeholder = 'Key';
        keyInput.value = key;

        const valueInput = document.createElement('input');
        valueInput.type = 'text';
        valueInput.className = 'value-input';
        valueInput.placeholder = 'Value';
        valueInput.value = value;

        const removeBtn = document.createElement('button');
        removeBtn.className = 'btn-xs btn-danger remove-row-btn';
        removeBtn.textContent = 'Remove';

        row.appendChild(keyInput);
        row.appendChild(valueInput);
        row.appendChild(removeBtn);

        container.appendChild(row);
    }
}