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
            }
            window.currentEndpoint = { collectionId: collection.id, endpointId: endpoint.id };

            // Build and populate form
            this.populateUrlAndMethod(collection, endpoint, formElements);
            this.populateHeaders(endpoint, formElements);
            this.populateQueryParams(endpoint, formElements);
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
            fullUrl = collection.baseUrl.replace(/\/$/, '') + endpoint.path;
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

    populateHeaders(endpoint, formElements) {
        this.clearKeyValueList(formElements.headersList);

        if (endpoint.parameters?.header) {
            Object.entries(endpoint.parameters.header).forEach(([key, param]) => {
                this.addKeyValueRow(formElements.headersList, key, param.example || '');
            });
        }

        // Add default Content-Type for POST/PUT/PATCH
        if (['POST', 'PUT', 'PATCH'].includes(endpoint.method)) {
            const contentType = endpoint.requestBody?.contentType || 'application/json';
            this.addKeyValueRow(formElements.headersList, 'Content-Type', contentType);
        }

        if (formElements.headersList.children.length === 0) {
            this.addKeyValueRow(formElements.headersList);
        }
    }

    populateQueryParams(endpoint, formElements) {
        this.clearKeyValueList(formElements.queryParamsList);

        if (endpoint.parameters?.query) {
            Object.entries(endpoint.parameters.query).forEach(([key, param]) => {
                this.addKeyValueRow(formElements.queryParamsList, key, param.example || '');
            });
        }

        if (formElements.queryParamsList.children.length === 0) {
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