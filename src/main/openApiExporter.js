/**
 * @fileoverview OpenAPI 3.0 exporter for converting collections to OpenAPI specifications
 * @module main/openApiExporter
 */

import yaml from 'js-yaml';

/**
 * Exporter for OpenAPI 3.0 specifications
 *
 * @class
 * @classdesc Handles conversion of internal collections to OpenAPI 3.0 format.
 * Supports both JSON and YAML output formats. Can handle collections originally
 * imported from OpenAPI (preserves structure) or Postman (infers schemas from examples).
 */
class OpenApiExporter {
    /**
     * Exports a collection to OpenAPI 3.0 format
     *
     * @param {Object} collection - The collection object to export
     * @param {string} [format='json'] - Output format ('json' or 'yaml')
     * @returns {string} OpenAPI specification as JSON or YAML string
     */
    exportToOpenApi(collection, format = 'json') {
        const spec = this._buildOpenApiSpec(collection);

        if (format === 'yaml') {
            return yaml.dump(spec, {
                indent: 2,
                lineWidth: -1,
                noRefs: true
            });
        }

        return JSON.stringify(spec, null, 2);
    }

    /**
     * Builds the complete OpenAPI 3.0 specification object
     *
     * @private
     * @param {Object} collection - The collection object
     * @returns {Object} OpenAPI 3.0 specification object
     */
    _buildOpenApiSpec(collection) {
        const spec = {
            openapi: '3.0.0',
            info: this._generateInfo(collection),
            paths: {}
        };

        const servers = this._generateServers(collection);
        if (servers.length > 0) {
            spec.servers = servers;
        }

        spec.paths = this._generatePaths(collection);

        const securitySchemes = this._generateSecuritySchemes(collection);
        if (Object.keys(securitySchemes).length > 0) {
            spec.components = spec.components || {};
            spec.components.securitySchemes = securitySchemes;
        }

        return spec;
    }

    /**
     * Generates the info object for OpenAPI spec
     *
     * @private
     * @param {Object} collection - The collection object
     * @returns {Object} OpenAPI info object
     */
    _generateInfo(collection) {
        const info = {
            title: collection.name || 'API Collection',
            version: collection.version || '1.0.0'
        };

        if (collection.description) {
            info.description = collection.description;
        }

        return info;
    }

    /**
     * Generates the servers array from collection baseUrl
     *
     * @private
     * @param {Object} collection - The collection object
     * @returns {Array<Object>} Array of server objects
     */
    _generateServers(collection) {
        const servers = [];

        if (collection.baseUrl) {
            servers.push({
                url: collection.baseUrl
            });
        }

        return servers;
    }

    /**
     * Generates the paths object from collection endpoints
     *
     * @private
     * @param {Object} collection - The collection object
     * @returns {Object} OpenAPI paths object
     */
    _generatePaths(collection) {
        const paths = {};

        const endpoints = collection.endpoints || [];

        endpoints.forEach(endpoint => {
            const { path: endpointPath, method: endpointMethod } = endpoint;
            const method = (endpointMethod || 'get').toLowerCase();

            if (!paths[endpointPath]) {
                paths[endpointPath] = {};
            }

            paths[endpointPath][method] = this._generateOperation(endpoint);
        });

        return paths;
    }

    /**
     * Generates an operation object for an endpoint
     *
     * @private
     * @param {Object} endpoint - The endpoint object
     * @returns {Object} OpenAPI operation object
     */
    _generateOperation(endpoint) {
        const { name, method, path, description, id } = endpoint;
        const operation = {
            summary: name || `${method} ${path}`
        };

        if (description) {
            operation.description = description;
        }

        operation.operationId = id || `${method}_${path}`.replace(/[^a-zA-Z0-9]/g, '_');

        const parameters = this._generateParameters(endpoint);
        if (parameters.length > 0) {
            operation.parameters = parameters;
        }

        const requestBody = this._generateRequestBody(endpoint);
        if (requestBody) {
            operation.requestBody = requestBody;
        }

        if (endpoint.security) {
            const security = this._generateOperationSecurity(endpoint.security);
            if (security) {
                operation.security = [security];
            }
        }

        operation.responses = {
            '200': {
                description: 'Successful response'
            }
        };

        return operation;
    }

    /**
     * Generates parameters array for an operation
     *
     * @private
     * @param {Object} endpoint - The endpoint object
     * @returns {Array<Object>} Array of parameter objects
     */
    _generateParameters(endpoint) {
        const parameters = [];

        if (!endpoint.parameters) {
            return parameters;
        }

        if (endpoint.parameters.path) {
            Object.entries(endpoint.parameters.path).forEach(([name, param]) => {
                parameters.push({
                    name: name,
                    in: 'path',
                    required: param.required !== false, // Path params are required by default
                    description: param.description || '',
                    schema: {
                        type: param.type || 'string'
                    },
                    example: param.example || ''
                });
            });
        }

        if (endpoint.parameters.query) {
            Object.entries(endpoint.parameters.query).forEach(([name, param]) => {
                parameters.push({
                    name: name,
                    in: 'query',
                    required: param.required || false,
                    description: param.description || '',
                    schema: {
                        type: param.type || 'string'
                    },
                    example: param.example || ''
                });
            });
        }

        if (endpoint.parameters.header) {
            Object.entries(endpoint.parameters.header).forEach(([name, param]) => {
                parameters.push({
                    name: name,
                    in: 'header',
                    required: param.required || false,
                    description: param.description || '',
                    schema: {
                        type: param.type || 'string'
                    },
                    example: param.example || ''
                });
            });
        }

        return parameters;
    }

    /**
     * Generates request body object for an operation
     *
     * @private
     * @param {Object} endpoint - The endpoint object
     * @returns {Object|null} OpenAPI requestBody object or null
     */
    _generateRequestBody(endpoint) {
        if (!endpoint.requestBody) {
            return null;
        }

        const requestBody = {
            required: endpoint.requestBody.required || false,
            content: {}
        };

        const contentType = endpoint.requestBody.contentType || 'application/json';

        if (endpoint.requestBody.schema) {
            requestBody.content[contentType] = {
                schema: endpoint.requestBody.schema
            };
        } else if (endpoint.requestBody.example) {
            const schema = this._inferSchemaFromExample(endpoint.requestBody.example);
            requestBody.content[contentType] = {
                schema: schema,
                example: this._parseExample(endpoint.requestBody.example)
            };
        } else {
            requestBody.content[contentType] = {
                schema: {
                    type: 'object'
                }
            };
        }

        return requestBody;
    }

    /**
     * Infers a basic schema from an example value
     *
     * @private
     * @param {string} example - Example value (usually JSON string)
     * @returns {Object} Basic schema object
     */
    _inferSchemaFromExample(example) {
        try {
            const parsed = JSON.parse(example);
            return this._createSchemaFromValue(parsed);
        } catch {
            return {
                type: 'object'
            };
        }
    }

    /**
     * Creates a schema object from a parsed value
     *
     * @private
     * @param {*} value - Parsed value
     * @returns {Object} Schema object
     */
    _createSchemaFromValue(value) {
        if (value === null || value === undefined) {
            return { type: 'object' };
        }

        if (Array.isArray(value)) {
            return {
                type: 'array',
                items: value.length > 0 ? this._createSchemaFromValue(value[0]) : { type: 'object' }
            };
        }

        if (typeof value === 'object') {
            const properties = {};
            Object.keys(value).forEach(key => {
                properties[key] = this._createSchemaFromValue(value[key]);
            });

            return {
                type: 'object',
                properties: properties
            };
        }

        if (typeof value === 'number') {
            return { type: Number.isInteger(value) ? 'integer' : 'number' };
        }

        if (typeof value === 'boolean') {
            return { type: 'boolean' };
        }

        return { type: 'string' };
    }

    /**
     * Parses example string to value
     *
     * @private
     * @param {string} example - Example string
     * @returns {*} Parsed value or original string
     */
    _parseExample(example) {
        try {
            return JSON.parse(example);
        } catch {
            return example;
        }
    }

    /**
     * Generates security schemes from all endpoints in collection
     *
     * @private
     * @param {Object} collection - The collection object
     * @returns {Object} Security schemes object
     */
    _generateSecuritySchemes(collection) {
        const schemes = {};
        const endpoints = collection.endpoints || [];

        endpoints.forEach(endpoint => {
            if (endpoint.security) {
                const scheme = this._mapAuthToSecurityScheme(endpoint.security);
                if (scheme) {
                    const schemeName = endpoint.security.schemeName || this._getSchemeNameForType(endpoint.security.type);
                    if (!schemes[schemeName]) {
                        schemes[schemeName] = scheme;
                    }
                }
            }
        });

        return schemes;
    }

    /**
     * Maps internal auth configuration to OpenAPI security scheme
     *
     * @private
     * @param {Object} security - Internal security configuration
     * @returns {Object|null} OpenAPI security scheme object
     */
    _mapAuthToSecurityScheme(security) {
        if (!security || !security.type) {
            return null;
        }

        switch (security.type) {
            case 'bearer':
                return {
                    type: 'http',
                    scheme: 'bearer',
                    bearerFormat: 'JWT'
                };

            case 'basic':
                return {
                    type: 'http',
                    scheme: 'basic'
                };

            case 'api-key':
                return {
                    type: 'apiKey',
                    name: security.config?.keyName || 'X-API-Key',
                    in: security.config?.location || 'header'
                };

            case 'oauth2':
                return {
                    type: 'oauth2',
                    flows: {
                        implicit: {
                            authorizationUrl: 'https://example.com/oauth/authorize',
                            scopes: {}
                        }
                    }
                };

            default:
                return null;
        }
    }

    /**
     * Generates operation-level security requirement
     *
     * @private
     * @param {Object} security - Internal security configuration
     * @returns {Object|null} Security requirement object
     */
    _generateOperationSecurity(security) {
        if (!security || !security.type || security.type === 'none') {
            return null;
        }

        const schemeName = security.schemeName || this._getSchemeNameForType(security.type);
        return { [schemeName]: [] };
    }

    /**
     * Gets default scheme name for an auth type
     *
     * @private
     * @param {string} type - Auth type
     * @returns {string} Scheme name
     */
    _getSchemeNameForType(type) {
        const names = {
            'bearer': 'bearerAuth',
            'basic': 'basicAuth',
            'api-key': 'apiKeyAuth',
            'oauth2': 'oauth2Auth',
            'digest': 'digestAuth'
        };

        return names[type] || 'auth';
    }
}

export default OpenApiExporter;
