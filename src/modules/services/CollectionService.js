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

    generateCollectionId() {
        return `collection_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    }

    async addRequestToCollection(collectionId, requestData) {
        try {
            this.statusDisplay.update('Adding new request...', null);
            
            const collection = await this.repository.getById(collectionId);
            if (!collection) {
                throw new Error(`Collection with id ${collectionId} not found`);
            }

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

            collection.endpoints = collection.endpoints || [];
            collection.endpoints.push(newEndpoint);

            if (collection.folders && collection.folders.length > 0) {
                const basePath = this.extractBasePath(requestData.path);
                
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
        const cleanPath = pathKey.replace(/^\//, '');
        const segments = cleanPath.split('/');

        return segments[0] || 'custom';
    }

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

                collection.folders = collection.folders.filter(folder => {
                    return folder.endpoints && folder.endpoints.length > 0;
                });
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

    populateUrlAndMethod(collection, endpoint, formElements) {
        let fullUrl = endpoint.path;
        if (collection.baseUrl) {
            fullUrl = '{{baseUrl}}' + endpoint.path;
        }

        if (endpoint.parameters?.path) {
            Object.entries(endpoint.parameters.path).forEach(([key, param]) => {
                fullUrl = fullUrl.replace(`{${key}}`, `{{${key}}}`);
            });
        }

        formElements.urlInput.value = fullUrl;
        formElements.methodSelect.value = endpoint.method;
    }

    async populatePathParams(endpoint, formElements) {
        this.clearKeyValueList(formElements.pathParamsList);

        const persistedPathParams = await this.repository.getPersistedPathParams(window.currentEndpoint.collectionId, endpoint.id);

        if (persistedPathParams.length > 0) {
            persistedPathParams.forEach(param => {
                this.addKeyValueRow(formElements.pathParamsList, param.key, param.value);
            });
        } else {
            if (endpoint.parameters?.path) {
                Object.entries(endpoint.parameters.path).forEach(([key, param]) => {
                    const value = param.example || '';
                    this.addKeyValueRow(formElements.pathParamsList, key, value);
                });
            }
        }

        if (formElements.pathParamsList.children.length === 0) {
            this.addKeyValueRow(formElements.pathParamsList);
        }
    }

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

    async populateQueryParams(endpoint, formElements) {
        this.clearKeyValueList(formElements.queryParamsList);

        const persistedQueryParams = await this.repository.getPersistedQueryParams(window.currentEndpoint.collectionId, endpoint.id);

        if (persistedQueryParams.length > 0) {
            persistedQueryParams.forEach(param => {
                this.addKeyValueRow(formElements.queryParamsList, param.key, param.value);
            });
        } else {
            if (endpoint.parameters?.query) {
                Object.entries(endpoint.parameters.query).forEach(([key, param]) => {
                    this.addKeyValueRow(formElements.queryParamsList, key, param.example || '');
                });
            }
        }

        if (formElements.queryParamsList.children.length === 0) {
            this.addKeyValueRow(formElements.queryParamsList);
        }

        this.updateUrlWithQueryParams(formElements);
    }

    updateUrlWithQueryParams(formElements) {
        try {
            const queryParams = this.parseKeyValuePairs(formElements.queryParamsList);
            let urlString = formElements.urlInput.value.trim();

            if (!urlString) {
                return;
            }

            const questionMarkIndex = urlString.indexOf('?');
            const baseUrl = questionMarkIndex >= 0 ? urlString.substring(0, questionMarkIndex) : urlString;

            const params = new URLSearchParams();
            queryParams.forEach(({ key, value }) => {
                if (key) {
                    params.set(key, value);
                }
            });

            const queryString = params.toString();
            formElements.urlInput.value = queryString ? `${baseUrl}?${queryString}` : baseUrl;
        } catch (error) {
            console.error('Error updating URL with query params:', error);
        }
    }

    async populateRequestBody(collection, endpoint, formElements) {
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

            if (originalBody && currentBody !== originalBody) {
                await this.repository.saveModifiedRequestBody(collectionId, endpointId, currentBody);
            }
        } catch (error) {
            console.error('Error saving request body modification:', error);
        }
    }

    async saveCurrentPathParams(collectionId, endpointId, formElements) {
        try {
            const pathParams = this.parseKeyValuePairs(formElements.pathParamsList);
            await this.repository.savePersistedPathParams(collectionId, endpointId, pathParams);
        } catch (error) {
            console.error('Error saving path parameters:', error);
        }
    }

    async saveCurrentQueryParams(collectionId, endpointId, formElements) {
        try {
            const queryParams = this.parseKeyValuePairs(formElements.queryParamsList);
            await this.repository.savePersistedQueryParams(collectionId, endpointId, queryParams);
        } catch (error) {
            console.error('Error saving query parameters:', error);
        }
    }

    async saveCurrentHeaders(collectionId, endpointId, formElements) {
        try {
            const headers = this.parseKeyValuePairs(formElements.headersList);
            await this.repository.savePersistedHeaders(collectionId, endpointId, headers);
        } catch (error) {
            console.error('Error saving headers:', error);
        }
    }

    async saveCurrentAuthConfig(collectionId, endpointId) {
        try {
            if (window.authManager) {
                const authConfig = window.authManager.getAuthConfig();
                await this.repository.savePersistedAuthConfig(collectionId, endpointId, authConfig);
            }
        } catch (error) {
            console.error('Error saving auth config:', error);
        }
    }

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
            console.error('Error loading auth config:', error);
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

        row.appendChild(keyInput);
        row.appendChild(valueInput);
        row.appendChild(removeBtn);

        container.appendChild(row);
    }
}