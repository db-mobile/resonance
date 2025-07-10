/**
 * Service layer for collection business logic
 * Follows Single Responsibility Principle - only handles collection business logic
 * Follows Dependency Inversion Principle - depends on abstractions (repository interface)
 */
export class CollectionService {
    constructor(repository, schemaProcessor, statusDisplay) {
        this.repository = repository;
        this.schemaProcessor = schemaProcessor;
        this.statusDisplay = statusDisplay;
        this.originalBodyValues = new Map();
    }

    async loadCollections() {
        try {
            const collections = await this.repository.getAll();
            return collections;
        } catch (error) {
            this.statusDisplay.update('Error loading collections', null);
            throw error;
        }
    }

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

    async addRequestToCollection(collectionId, requestData) {
        try {
            this.statusDisplay.update('Adding new request...', null);
            
            const collection = await this.repository.getById(collectionId);
            if (!collection) {
                throw new Error(`Collection with id ${collectionId} not found`);
            }

            // Generate a unique ID for the new endpoint
            const newEndpoint = {
                id: this.generateEndpointId(collection),
                name: requestData.name,
                method: requestData.method,
                path: requestData.path,
                description: '',
                parameters: {
                    query: {},
                    header: {},
                    path: {}
                },
                requestBody: null,
                headers: {}
            };

            // Add the new endpoint to the collection
            collection.endpoints = collection.endpoints || [];
            collection.endpoints.push(newEndpoint);

            // If collection has folder structure, add to appropriate folder
            if (collection.folders && collection.folders.length > 0) {
                // Extract base path for grouping (first segment after leading slash)
                const basePath = this.extractBasePath(requestData.path);
                
                // Find existing folder or create new one
                let targetFolder = collection.folders.find(folder => folder.name === basePath);
                
                if (!targetFolder) {
                    // Create new folder for this path
                    targetFolder = {
                        id: `folder_${basePath}`.replace(/[^a-zA-Z0-9]/g, '_'),
                        name: basePath,
                        endpoints: []
                    };
                    collection.folders.push(targetFolder);
                }
                
                // Add endpoint to the folder
                targetFolder.endpoints.push(newEndpoint);
            }

            // Save the updated collection
            await this.repository.update(collectionId, collection);
            
            this.statusDisplay.update(`Added new request: ${requestData.name}`, null);
            return newEndpoint;
        } catch (error) {
            this.statusDisplay.update(`Error adding request: ${error.message}`, null);
            throw error;
        }
    }

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

    extractBasePath(pathKey) {
        // Remove leading slash and extract first path segment
        const cleanPath = pathKey.replace(/^\//, '');
        const segments = cleanPath.split('/');
        
        // Return the first segment, or 'custom' if no segments or root
        return segments[0] || 'custom';
    }

    async loadEndpointIntoForm(collection, endpoint, formElements) {
        try {
            // Set the OpenAPI spec for schema processing
            this.schemaProcessor.setOpenApiSpec(collection._openApiSpec);
            
            // Store current endpoint info for persistence
            if (window.currentEndpoint) {
                await this.saveRequestBodyModification(
                    window.currentEndpoint.collectionId, 
                    window.currentEndpoint.endpointId,
                    formElements.bodyInput
                );
                await this.saveCurrentQueryParams(window.currentEndpoint.collectionId, window.currentEndpoint.endpointId, formElements);
                await this.saveCurrentHeaders(window.currentEndpoint.collectionId, window.currentEndpoint.endpointId, formElements);
            }
            window.currentEndpoint = { collectionId: collection.id, endpointId: endpoint.id };

            // Build and populate form
            this.populateUrlAndMethod(collection, endpoint, formElements);
            await this.populateHeaders(collection, endpoint, formElements);
            await this.populateQueryParams(endpoint, formElements);
            await this.populateRequestBody(collection, endpoint, formElements);

            this.statusDisplay.update(`Loaded endpoint: ${endpoint.name}`, null);
        } catch (error) {
            this.statusDisplay.update(`Error loading endpoint: ${error.message}`, null);
            throw error;
        }
    }

    populateUrlAndMethod(collection, endpoint, formElements) {
        let fullUrl = endpoint.path;
        if (collection.baseUrl) {
            fullUrl = '{{baseUrl}}' + endpoint.path;
        }

        // Replace path parameters with example values or placeholders
        if (endpoint.parameters?.path) {
            Object.entries(endpoint.parameters.path).forEach(([key, param]) => {
                const placeholder = param.example || `{${key}}`;
                fullUrl = fullUrl.replace(`{${key}}`, placeholder);
            });
        }

        formElements.urlInput.value = fullUrl;
        formElements.methodSelect.value = endpoint.method;
    }

    async populateHeaders(collection, endpoint, formElements) {
        this.clearKeyValueList(formElements.headersList);

        // Check for persisted headers first
        const persistedHeaders = await this.repository.getPersistedHeaders(collection.id, endpoint.id);
        
        if (persistedHeaders.length > 0) {
            // Load persisted headers
            persistedHeaders.forEach(header => {
                this.addKeyValueRow(formElements.headersList, header.key, header.value);
            });
        } else {
            // Add default headers from collection first
            if (collection.defaultHeaders) {
                Object.entries(collection.defaultHeaders).forEach(([key, value]) => {
                    this.addKeyValueRow(formElements.headersList, key, value);
                });
            }

            // Add endpoint-specific headers (will override defaults if same key)
            if (endpoint.parameters?.header) {
                Object.entries(endpoint.parameters.header).forEach(([key, param]) => {
                    this.addKeyValueRow(formElements.headersList, key, param.example || '');
                });
            }

            // Add default Content-Type for POST/PUT/PATCH (if not already set)
            if (['POST', 'PUT', 'PATCH'].includes(endpoint.method)) {
                const contentType = endpoint.requestBody?.contentType || 'application/json';
                // Check if Content-Type is already set from defaults or endpoint headers
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

    async populateQueryParams(endpoint, formElements) {
        console.log('RENDERER: populateQueryParams called with endpoint:', endpoint);
        console.log('RENDERER: endpoint.parameters:', endpoint.parameters);
        
        this.clearKeyValueList(formElements.queryParamsList);

        // Check for persisted query params first
        const persistedQueryParams = await this.repository.getPersistedQueryParams(window.currentEndpoint.collectionId, endpoint.id);
        
        if (persistedQueryParams.length > 0) {
            // Load persisted query parameters
            persistedQueryParams.forEach(param => {
                this.addKeyValueRow(formElements.queryParamsList, param.key, param.value);
            });
        } else {
            // Add path parameters first (from YAML file)
            if (endpoint.parameters?.path) {
                console.log('RENDERER: Found path parameters:', endpoint.parameters.path);
                Object.entries(endpoint.parameters.path).forEach(([key, param]) => {
                    // Provide a better default value if example is empty
                    const value = param.example || `{${key}}`;
                    console.log(`RENDERER: Adding path parameter ${key} with value:`, value);
                    this.addKeyValueRow(formElements.queryParamsList, key, value);
                });
            } else {
                console.log('RENDERER: No path parameters found');
            }

            // Add regular query parameters
            if (endpoint.parameters?.query) {
                console.log('RENDERER: Found query parameters:', endpoint.parameters.query);
                Object.entries(endpoint.parameters.query).forEach(([key, param]) => {
                    console.log(`RENDERER: Adding query parameter ${key} with value:`, param.example || '');
                    this.addKeyValueRow(formElements.queryParamsList, key, param.example || '');
                });
            } else {
                console.log('RENDERER: No query parameters found');
            }
        }

        if (formElements.queryParamsList.children.length === 0) {
            console.log('RENDERER: No parameters added, adding empty row');
            this.addKeyValueRow(formElements.queryParamsList);
        }
    }

    async populateRequestBody(collection, endpoint, formElements) {
        // Check for persisted user modifications first
        const persistedBody = await this.repository.getModifiedRequestBody(collection.id, endpoint.id);
        
        if (persistedBody) {
            formElements.bodyInput.value = persistedBody;
        } else if (endpoint.requestBody) {
            const generatedBody = this.generateRequestBody(endpoint.requestBody);
            formElements.bodyInput.value = generatedBody;
        } else if (['POST', 'PUT', 'PATCH'].includes(endpoint.method)) {
            formElements.bodyInput.value = JSON.stringify({ "data": "example" }, null, 2);
        } else {
            formElements.bodyInput.value = '';
        }

        // Store the original body value for modification tracking
        const key = `${collection.id}_${endpoint.id}`;
        this.originalBodyValues.set(key, formElements.bodyInput.value);
    }

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

        // Fallback
        if (requestBody.required) {
            return JSON.stringify({
                "note": "Request body is required",
                "data": "Please fill in the required fields"
            }, null, 2);
        }

        return JSON.stringify({ "data": "example" }, null, 2);
    }

    async saveRequestBodyModification(collectionId, endpointId, bodyInput) {
        try {
            if (!bodyInput || !bodyInput.value.trim()) {
                return;
            }

            const currentBody = bodyInput.value.trim();
            const key = `${collectionId}_${endpointId}`;
            const originalBody = this.originalBodyValues.get(key);

            // Only save if the body was modified from the original
            if (originalBody && currentBody !== originalBody) {
                await this.repository.saveModifiedRequestBody(collectionId, endpointId, currentBody);
                console.log('Saved modified request body for endpoint:', endpointId);
            }
        } catch (error) {
            console.error('Error saving request body modification:', error);
        }
    }

    async saveCurrentQueryParams(collectionId, endpointId, formElements) {
        try {
            const queryParams = this.parseKeyValuePairs(formElements.queryParamsList);
            // Only save if there are non-empty query parameters
            if (queryParams.length > 0) {
                await this.repository.savePersistedQueryParams(collectionId, endpointId, queryParams);
                console.log('Saved query parameters for endpoint:', endpointId);
            }
        } catch (error) {
            console.error('Error saving query parameters:', error);
        }
    }

    async saveCurrentHeaders(collectionId, endpointId, formElements) {
        try {
            const headers = this.parseKeyValuePairs(formElements.headersList);
            // Only save if there are non-empty headers
            if (headers.length > 0) {
                await this.repository.savePersistedHeaders(collectionId, endpointId, headers);
                console.log('Saved headers for endpoint:', endpointId);
            }
        } catch (error) {
            console.error('Error saving headers:', error);
        }
    }

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

    clearKeyValueList(container) {
        while (container.firstChild) {
            container.removeChild(container.firstChild);
        }
    }

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
        removeBtn.className = 'remove-btn remove-row-btn';
        removeBtn.textContent = 'Remove';
        removeBtn.addEventListener('click', () => {
            row.remove();
        });

        row.appendChild(keyInput);
        row.appendChild(valueInput);
        row.appendChild(removeBtn);

        container.appendChild(row);
    }
}