/**
 * @fileoverview Controller for coordinating mock server operations between UI and service
 * @module controllers/MockServerController
 */

import { SchemaProcessor } from '../schema/SchemaProcessor.js';
import { findRequest } from '../collections/collectionTree.js';

export class MockServerController {
    /**
     * @param {MockServerService} service
     * @param {CollectionRepository} collectionRepository
     */
    constructor(service, collectionRepository) {
        this.service = service;
        this.collectionRepository = collectionRepository;
    }

    /** @returns {Promise<void>} */
    async initialize() {
        this.service.addChangeListener((event) => {
            this._handleServiceEvent(event);
        });
    }

    /** @param {Object} event */
    _handleServiceEvent(_event) {
    }

    /** @returns {Promise<Object>} */
    async handleStart() {
        try {
            const collections = await this.collectionRepository.getAll();

            if (collections.length === 0) {
                return {
                    success: false,
                    message: 'No collections available. Please import an OpenAPI or Postman collection first.'
                };
            }

            return await this.service.startServer(collections);
        } catch (error) {
            return {
                success: false,
                message: error.message || 'Failed to start mock server'
            };
        }
    }

    /** @returns {Promise<Object>} */
    async handleStop() {
        try {
            return await this.service.stopServer();
        } catch (error) {
            return {
                success: false,
                message: error.message || 'Failed to stop mock server'
            };
        }
    }

    /** @returns {Promise<Object>} */
    async getStatus() {
        return this.service.getStatus();
    }

    /** @returns {Promise<Object>} */
    async getSettings() {
        return this.service.getSettings();
    }

    /**
     * @param {number} port
     * @returns {Promise<Object>}
     */
    async handleUpdatePort(port) {
        try {
            const errors = this.service.validatePort(port);
            if (errors.length > 0) {
                return {
                    success: false,
                    message: errors.join(', ')
                };
            }

            await this.service.updateSettings({ port: parseInt(port, 10) });
            return {
                success: true,
                message: 'Port updated successfully'
            };
        } catch (error) {
            return {
                success: false,
                message: error.message || 'Failed to update port'
            };
        }
    }

    /**
     * @param {string} collectionId
     * @returns {Promise<Object>}
     */
    async handleToggleCollection(collectionId) {
        try {
            const isEnabled = await this.service.toggleCollectionEnabled(collectionId);
            return {
                success: true,
                enabled: isEnabled,
                message: isEnabled ? 'Collection enabled' : 'Collection disabled'
            };
        } catch (error) {
            return {
                success: false,
                message: error.message || 'Failed to toggle collection'
            };
        }
    }

    /**
     * @param {string} collectionId
     * @param {string} endpointId
     * @param {number} delayMs
     * @returns {Promise<Object>}
     */
    async handleSetDelay(collectionId, endpointId, delayMs) {
        try {
            const errors = this.service.validateDelay(delayMs);
            if (errors.length > 0) {
                return {
                    success: false,
                    message: errors.join(', ')
                };
            }

            await this.service.setEndpointDelay(collectionId, endpointId, parseInt(delayMs, 10));
            return {
                success: true,
                message: 'Delay updated successfully'
            };
        } catch (error) {
            return {
                success: false,
                message: error.message || 'Failed to set delay'
            };
        }
    }

    /**
     * @param {string} collectionId
     * @param {string} endpointId
     * @param {Object|string|null} response
     * @returns {Promise<Object>}
     */
    async handleSetCustomResponse(collectionId, endpointId, response) {
        try {
            if (typeof response === 'string' && response.trim()) {
                try {
                    response = JSON.parse(response);
                } catch {
                    return {
                        success: false,
                        message: 'Invalid JSON format'
                    };
                }
            }

            await this.service.setCustomResponse(collectionId, endpointId, response);
            return {
                success: true,
                message: 'Custom response updated successfully'
            };
        } catch (error) {
            return {
                success: false,
                message: error.message || 'Failed to set custom response'
            };
        }
    }

    /**
     * @param {string} collectionId
     * @param {string} endpointId
     * @returns {Promise<Object|null>}
     */
    async getCustomResponse(collectionId, endpointId) {
        try {
            return await this.service.getCustomResponse(collectionId, endpointId);
        } catch (error) {
            return null;
        }
    }

    /**
     * @param {string} collectionId
     * @param {string} endpointId
     * @returns {Promise<Object|null>}
     */
    async getDefaultResponse(collectionId, endpointId) {
        try {
            const collection = await this.collectionRepository.getById(collectionId);
            if (!collection) {return null;}

            const endpoint = this._findEndpoint(collection, endpointId);
            if (!endpoint) {return null;}

            const schema = this._extractResponseSchema(endpoint);
            if (!schema) {return null;}

            const schemaProcessor = new SchemaProcessor();
            if (collection._openApiSpec) {
                schemaProcessor.setOpenApiSpec(collection._openApiSpec);
            }

            const resolvedSchema = schemaProcessor.resolveSchemaRefs(schema);
            const generated = schemaProcessor.generateExampleFromSchema(resolvedSchema);

            if (typeof generated === 'string') {
                try {return JSON.parse(generated);} catch {return null;}
            }
            return generated;
        } catch (error) {
            return null;
        }
    }

    _findEndpoint(collection, endpointId) {
        return findRequest(collection, endpointId);
    }

    _extractResponseSchema(endpoint) {
        const method = endpoint.method?.toUpperCase();
        const { responses } = endpoint;
        if (!responses) {return null;}

        if (responses['200']?.content?.['application/json']?.schema) {
            return responses['200'].content['application/json'].schema;
        }
        if (['POST', 'PUT'].includes(method) && responses['201']?.content?.['application/json']?.schema) {
            return responses['201'].content['application/json'].schema;
        }
        for (const code of Object.keys(responses)) {
            if (code.startsWith('2') && responses[code]?.content?.['application/json']?.schema) {
                return responses[code].content['application/json'].schema;
            }
        }
        return null;
    }

    /**
     * @param {string} collectionId
     * @param {string} endpointId
     * @param {number|null} statusCode
     * @returns {Promise<Object>}
     */
    async handleSetCustomStatusCode(collectionId, endpointId, statusCode) {
        try {
            if (statusCode !== null) {
                const errors = this.service.validateStatusCode(statusCode);
                if (errors.length > 0) {
                    return {
                        success: false,
                        message: errors.join(', ')
                    };
                }
            }

            await this.service.setCustomStatusCode(collectionId, endpointId, statusCode);
            return {
                success: true,
                message: 'Custom status code updated successfully'
            };
        } catch (error) {
            return {
                success: false,
                message: error.message || 'Failed to set custom status code'
            };
        }
    }

    /**
     * @param {string} collectionId
     * @param {string} endpointId
     * @returns {Promise<number|null>}
     */
    async getCustomStatusCode(collectionId, endpointId) {
        try {
            return await this.service.getCustomStatusCode(collectionId, endpointId);
        } catch (error) {
            return null;
        }
    }

    /** @returns {Promise<Array>} */
    async getCollections() {
        try {
            return await this.collectionRepository.getAll();
        } catch (error) {
            return [];
        }
    }

    /**
     * @param {number} limit
     * @returns {Promise<Array>}
     */
    async getRequestLogs(limit = 20) {
        return this.service.getRequestLogs(limit);
    }

    /** @returns {Promise<Object>} */
    async clearRequestLogs() {
        try {
            await this.service.clearRequestLogs();
            return {
                success: true,
                message: 'Logs cleared successfully'
            };
        } catch (error) {
            return {
                success: false,
                message: error.message || 'Failed to clear logs'
            };
        }
    }
}
