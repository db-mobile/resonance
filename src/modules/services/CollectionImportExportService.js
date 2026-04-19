/**
 * @fileoverview Import, export, and documentation workflows for collections
 * @module services/CollectionImportExportService
 */

import { toast } from '../ui/Toast.js';

/**
 * Handles collection import/export flows and documentation generation.
 */
export class CollectionImportExportService {
    /**
     * @param {Object} options - Workflow dependencies
     * @param {Object} options.backendAPI - Backend IPC API
     * @param {CollectionRepository} options.repository - Collection repository
     * @param {CollectionService} options.collectionService - Collection service
     * @param {DocGeneratorService} options.docGeneratorService - Documentation generator
     * @param {IStatusDisplay} options.statusDisplay - Status display adapter
     * @param {CollectionDialogs} options.collectionDialogs - Collection dialogs helper
     * @param {CurlImportDialog} options.curlImportDialog - cURL import dialog
     * @param {Function} options.refreshCollections - Callback to reload collections
     */
    constructor({
        backendAPI,
        repository,
        collectionService,
        docGeneratorService,
        statusDisplay,
        collectionDialogs,
        curlImportDialog,
        refreshCollections
    }) {
        this.backendAPI = backendAPI;
        this.repository = repository;
        this.collectionService = collectionService;
        this.docGeneratorService = docGeneratorService;
        this.statusDisplay = statusDisplay;
        this.collectionDialogs = collectionDialogs;
        this.curlImportDialog = curlImportDialog;
        this.refreshCollections = refreshCollections;
    }

    async handleExportOpenApiJson(collection) {
        try {
            await this.collectionService.exportCollectionAsOpenApi(collection.id, 'json');
        } catch (error) {
            void error;
        }
    }

    async handleExportOpenApiYaml(collection) {
        try {
            await this.collectionService.exportCollectionAsOpenApi(collection.id, 'yaml');
        } catch (error) {
            void error;
        }
    }

    async handleExportPostman(collection) {
        try {
            await this.collectionService.exportCollectionAsPostman(collection.id);
        } catch (error) {
            void error;
        }
    }

    async handleGenerateDocumentation(collection) {
        try {
            if (!this.docGeneratorService.hasHttpEndpoints(collection)) {
                toast.error(window.i18n?.t('docs.no_http_endpoints') || 'This collection has no HTTP requests to document');
                return;
            }

            const options = await this.collectionDialogs.showDocOptionsDialog();
            if (!options) {
                return;
            }

            this.statusDisplay.update('Generating documentation...', null);

            let content;
            let fileExtension;
            let mimeType;

            if (options.format === 'html') {
                content = await this.docGeneratorService.generateHtml(collection, {
                    includePersistedData: options.includeExamples,
                    languages: options.languages
                });
                fileExtension = 'html';
                mimeType = 'text/html';
            } else {
                content = await this.docGeneratorService.generateMarkdown(collection, {
                    includePersistedData: options.includeExamples,
                    languages: options.languages
                });
                fileExtension = 'md';
                mimeType = 'text/markdown';
            }

            const defaultFileName = `${collection.name.replace(/[^a-zA-Z0-9]/g, '_')}_docs.${fileExtension}`;
            const result = await this.backendAPI.docs.save(defaultFileName, content, mimeType);

            if (result && result.success) {
                toast.success(window.i18n?.t('docs.success') || 'Documentation generated successfully');
            } else if (result && !result.cancelled) {
                toast.error(window.i18n?.t('docs.error') || 'Failed to generate documentation');
            }

            this.statusDisplay.update('', null);
        } catch (error) {
            this.statusDisplay.update('', null);
            toast.error(`Documentation generation failed: ${error.message}`);
        }
    }

    async importOpenApiFile() {
        try {
            const importOptions = await this.collectionDialogs.showCollectionImportDialog({
                importKind: 'openapi'
            });
            if (!importOptions) {
                this.statusDisplay.update('Import cancelled', null);
                return null;
            }

            const collection = await this.backendAPI.collections.importOpenApiFile(
                importOptions.filePath,
                importOptions.storageParentPath
            );

            if (!collection) {
                this.statusDisplay.update('Import cancelled', null);
                return null;
            }

            await this.refreshCollections(false);
            await this.saveResponseSchemasFromImport(collection);
            toast.success(`Imported "${collection.name}"`);
            return collection;
        } catch (error) {
            const errorMessage = typeof error === 'string' ? error : (error.message || 'Unknown error');
            toast.error(`Import failed: ${errorMessage}`);
            throw error;
        }
    }

    async importPostmanCollection() {
        try {
            const importOptions = await this.collectionDialogs.showCollectionImportDialog({
                importKind: 'postman'
            });
            if (!importOptions) {
                this.statusDisplay.update('Import cancelled', null);
                return null;
            }

            const collection = await this.backendAPI.collections.importPostmanCollection(
                importOptions.filePath,
                importOptions.storageParentPath
            );

            if (!collection) {
                this.statusDisplay.update('Import cancelled', null);
                return null;
            }

            await this.refreshCollections(false);
            toast.success(`Imported "${collection.name}"`);
            return collection;
        } catch (error) {
            const errorMessage = typeof error === 'string' ? error : (error.message || 'Unknown error');
            toast.error(`Import failed: ${errorMessage}`);
            throw error;
        }
    }

    async importPostmanEnvironment() {
        try {
            const environment = await this.backendAPI.collections.importPostmanEnvironment();

            if (!environment) {
                this.statusDisplay.update('Import cancelled', null);
                return null;
            }

            if (window.environmentController) {
                await window.environmentController.handleImportEnvironment(environment);
            }
            return environment;
        } catch (error) {
            this.statusDisplay.update(`Import error: ${error.message}`, null);
            throw error;
        }
    }

    async handleImportCurl(collection) {
        try {
            const collections = await this.collectionService.loadCollections();
            const targetCollectionId = collection ? collection.id : null;

            const result = await this.curlImportDialog.show(collections, {
                targetCollectionId
            });

            if (!result) {
                return;
            }

            let targetCollection;

            if (result.newCollectionName) {
                targetCollection = await this.collectionService.createCollection({
                    name: result.newCollectionName,
                    storageParentPath: result.newCollectionLocation
                });
            } else {
                targetCollection = collections.find(current => current.id === result.collectionId);
                if (!targetCollection) {
                    this.statusDisplay.update('Collection not found', null);
                    return;
                }
            }

            const requestData = {
                name: result.endpoint.name,
                method: result.endpoint.method,
                path: result.endpoint.path,
                protocol: 'http'
            };

            const newEndpoint = await this.collectionService.addRequestToCollection(targetCollection.id, requestData);

            if (result.endpoint.requestBody) {
                await this.repository.saveModifiedRequestBody(
                    targetCollection.id,
                    newEndpoint.id,
                    result.endpoint.requestBody.example
                );
            }

            if (Object.keys(result.endpoint.headers).length > 0) {
                const headers = Object.entries(result.endpoint.headers).map(([key, value]) => ({
                    key,
                    value
                }));
                await this.repository.savePersistedHeaders(targetCollection.id, newEndpoint.id, headers);
            }

            if (Object.keys(result.endpoint.parameters.query).length > 0) {
                const queryParams = Object.entries(result.endpoint.parameters.query).map(([key, param]) => ({
                    key,
                    value: param.example || ''
                }));
                await this.repository.savePersistedQueryParams(targetCollection.id, newEndpoint.id, queryParams);
            }

            if (result.auth) {
                await this.repository.savePersistedAuthConfig(targetCollection.id, newEndpoint.id, result.auth);
            }

            await this.refreshCollections(false);
            toast.success(`Imported cURL as "${result.endpoint.name}"`);
        } catch (error) {
            toast.error(`cURL import failed: ${error.message}`);
        }
    }

    async saveResponseSchemasFromImport(collection) {
        if (!collection) {
            return;
        }

        const allEndpoints = [
            ...(collection.endpoints || []),
            ...(collection.folders || []).flatMap(folder => folder.endpoints || [])
        ];

        for (const endpoint of allEndpoints) {
            await this.saveEndpointResponseSchema(collection.id, endpoint);
        }
    }

    async saveEndpointResponseSchema(collectionId, endpoint) {
        if (!endpoint.responses) {
            return;
        }

        const responseSchema = this.extractResponseSchema(endpoint.responses);
        if (!responseSchema) {
            return;
        }

        try {
            await this.repository.saveResponseSchema(collectionId, endpoint.id, responseSchema);
        } catch (error) {
            console.error(`Failed to save response schema for ${endpoint.name}:`, error);
        }
    }

    extractResponseSchema(responses) {
        const statusCodes = ['200', '201', '202', 'default'];

        for (const code of statusCodes) {
            const response = responses[code];
            if (!response) {
                continue;
            }

            if (response.content && response.content['application/json'] && response.content['application/json'].schema) {
                return response.content['application/json'].schema;
            }

            if (response.schema) {
                return response.schema;
            }
        }

        return null;
    }
}
