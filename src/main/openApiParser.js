/**
 * @fileoverview OpenAPI specification parser for converting OpenAPI/Swagger files into API collections
 * @module main/openApiParser
 */

import fs from 'fs/promises';
import path from 'path';
import yaml from 'js-yaml';

/**
 * Parser for OpenAPI 3.0 specifications
 *
 * @class
 * @classdesc Handles parsing of OpenAPI/Swagger files (YAML/JSON) and converts them into
 * structured API collections with endpoints, parameters, and authentication configurations.
 * Supports schema reference resolution and automatic endpoint grouping.
 */
class OpenApiParser {
    /**
     * Creates an OpenApiParser instance
     *
     * @param {Object} schemaProcessor - Schema processor for handling OpenAPI schema references and request bodies
     * @param {Object} store - Electron-store instance for persistent storage
     */
    constructor(schemaProcessor, store) {
        this.schemaProcessor = schemaProcessor;
        this.store = store;
    }

    /**
     * Validates an OpenAPI specification object
     *
     * Checks that the specification has the required structure including
     * openapi version field and info object with title.
     *
     * @param {Object} openApiSpec - The OpenAPI specification to validate
     * @returns {Object} Validation result with isValid boolean and error message if invalid
     */
    validateOpenApiSpec(openApiSpec) {
        if (!openApiSpec || typeof openApiSpec !== 'object') {
            return { isValid: false, error: 'OpenAPI specification must be an object' };
        }

        // Check for OpenAPI version (supports both OpenAPI 3.x and Swagger 2.x)
        const hasOpenApiVersion = openApiSpec.openapi && typeof openApiSpec.openapi === 'string';
        const hasSwaggerVersion = openApiSpec.swagger && typeof openApiSpec.swagger === 'string';

        if (!hasOpenApiVersion && !hasSwaggerVersion) {
            return {
                isValid: false,
                error: 'Missing OpenAPI/Swagger version. Expected "openapi" or "swagger" field'
            };
        }

        // Validate OpenAPI 3.x version format
        if (hasOpenApiVersion && !openApiSpec.openapi.match(/^3\.\d+\.\d+$/)) {
            return {
                isValid: false,
                error: `Unsupported OpenAPI version "${openApiSpec.openapi}". Expected 3.x.x format`
            };
        }

        // Validate Swagger 2.x version format
        if (hasSwaggerVersion && !openApiSpec.swagger.match(/^2\.\d+$/)) {
            return {
                isValid: false,
                error: `Unsupported Swagger version "${openApiSpec.swagger}". Expected 2.x format`
            };
        }

        // Check for info object
        if (!openApiSpec.info || typeof openApiSpec.info !== 'object') {
            return { isValid: false, error: 'Missing or invalid "info" object in OpenAPI specification' };
        }

        // Check for paths object (optional but warn if missing)
        if (openApiSpec.paths && typeof openApiSpec.paths !== 'object') {
            return { isValid: false, error: '"paths" must be an object if provided' };
        }

        // Validate servers array if present
        if (openApiSpec.servers !== undefined) {
            if (!Array.isArray(openApiSpec.servers)) {
                return { isValid: false, error: '"servers" must be an array if provided' };
            }

            // Validate each server has a url
            for (let i = 0; i < openApiSpec.servers.length; i++) {
                const server = openApiSpec.servers[i];
                if (!server || typeof server !== 'object') {
                    return { isValid: false, error: `Invalid server at index ${i}: must be an object` };
                }
                if (!server.url || typeof server.url !== 'string') {
                    return { isValid: false, error: `Invalid server at index ${i}: missing or invalid "url" field` };
                }
            }
        }

        return { isValid: true };
    }

    /**
     * Converts an OpenAPI specification into a collection object
     *
     * Parses the OpenAPI spec and creates a structured collection with endpoints
     * organized into folders based on path hierarchy. Extracts server URLs,
     * default headers, and security configurations.
     *
     * @param {Object} openApiSpec - The parsed OpenAPI 3.0 specification object
     * @param {string} fileName - The original filename for fallback naming
     * @returns {Object} Collection object with endpoints, folders, and metadata
     * @throws {Error} If the OpenAPI specification is invalid
     */
    parseOpenApiToCollection(openApiSpec, fileName) {
        // Validate spec before processing
        const validation = this.validateOpenApiSpec(openApiSpec);
        if (!validation.isValid) {
            throw new Error(`Invalid OpenAPI specification: ${validation.error}`);
        }

        this.schemaProcessor.setOpenApiSpec(openApiSpec);

        const collection = {
            id: Date.now().toString(),
            name: openApiSpec.info?.title || fileName,
            version: openApiSpec.info?.version || '1.0.0',
            baseUrl: '',
            defaultHeaders: {},
            endpoints: [],
            _openApiSpec: openApiSpec
        };

        if (openApiSpec.servers && openApiSpec.servers.length > 0) {
            collection.baseUrl = openApiSpec.servers[0].url;
        }

        this._extractDefaultHeaders(openApiSpec, collection);

        if (openApiSpec.paths) {
            this._parsePaths(openApiSpec, collection);
        }

        return collection;
    }

    /**
     * Extracts default headers from OpenAPI specification
     *
     * Searches for default headers in multiple locations within the spec:
     * component headers, custom x-default-headers extension at root level,
     * and x-default-headers in the info section.
     *
     * @private
     * @param {Object} openApiSpec - The OpenAPI specification object
     * @param {Object} collection - The collection object to populate with headers
     * @returns {void}
     */
    _extractDefaultHeaders(openApiSpec, collection) {
        if (openApiSpec.components?.headers) {
            for (const [headerName, headerSpec] of Object.entries(openApiSpec.components.headers)) {
                if (headerSpec.schema?.default || headerSpec.example) {
                    collection.defaultHeaders[headerName] = headerSpec.schema?.default || headerSpec.example;
                }
            }
        }

        if (openApiSpec['x-default-headers']) {
            Object.assign(collection.defaultHeaders, openApiSpec['x-default-headers']);
        }

        if (openApiSpec.info?.['x-default-headers']) {
            Object.assign(collection.defaultHeaders, openApiSpec.info['x-default-headers']);
        }
    }

    /**
     * Parses all paths from OpenAPI spec and groups endpoints into folders
     *
     * Iterates through all paths and HTTP methods, creating endpoint objects
     * with parsed parameters, request bodies, and security configurations.
     * Groups endpoints by their base path into folders for organization.
     *
     * @private
     * @param {Object} openApiSpec - The OpenAPI specification object
     * @param {Object} collection - The collection object to populate with endpoints and folders
     * @returns {void}
     */
    _parsePaths(openApiSpec, collection) {
        const groupedEndpoints = {};

        for (const [pathKey, pathValue] of Object.entries(openApiSpec.paths)) {
            for (const [method, methodValue] of Object.entries(pathValue)) {
                if (['get', 'post', 'put', 'delete', 'patch', 'head', 'options'].includes(method.toLowerCase())) {
                    const endpoint = {
                        id: `${method.toUpperCase()}_${pathKey}`.replace(/[^a-zA-Z0-9]/g, '_'),
                        name: methodValue.summary || methodValue.operationId || `${method.toUpperCase()} ${pathKey}`,
                        method: method.toUpperCase(),
                        path: pathKey,
                        description: methodValue.description || '',
                        parameters: this._parseParameters(methodValue.parameters || []),
                        requestBody: this.schemaProcessor.parseRequestBody(methodValue.requestBody),
                        headers: {},
                        security: this._parseSecurity(methodValue.security, openApiSpec),
                        bodyMode: 'json' // default to JSON mode
                    };

                    // Detect GraphQL endpoint from OpenAPI metadata
                    if (this._isGraphQLEndpoint(pathKey, methodValue)) {
                        endpoint.bodyMode = 'graphql';
                    }

                    const basePath = this._extractBasePath(pathKey);

                    if (!groupedEndpoints[basePath]) {
                        groupedEndpoints[basePath] = [];
                    }
                    groupedEndpoints[basePath].push(endpoint);
                }
            }
        }

        collection.folders = [];
        for (const [basePath, endpoints] of Object.entries(groupedEndpoints)) {
            const folder = {
                id: `folder_${basePath}`.replace(/[^a-zA-Z0-9]/g, '_'),
                name: basePath,
                endpoints: endpoints
            };
            collection.folders.push(folder);
        }

        collection.endpoints = Object.values(groupedEndpoints).flat();
    }

    /**
     * Extracts the base path segment from a full path for folder grouping
     *
     * Takes the first segment of the path to use as a folder name.
     * For example, "/users/123/profile" becomes "users".
     *
     * @private
     * @param {string} pathKey - The full path string (e.g., "/users/{id}")
     * @returns {string} The base path segment, or "root" if empty
     */
    _extractBasePath(pathKey) {
        const cleanPath = pathKey.replace(/^\//, '');
        const segments = cleanPath.split('/');

        return segments[0] || 'root';
    }

    /**
     * Parses parameter definitions from OpenAPI specification
     *
     * Resolves parameter references and organizes them by location (query, path, header).
     * Extracts type information, requirements, descriptions, and example values.
     *
     * @private
     * @param {Array<Object>} parameters - Array of parameter objects from OpenAPI spec
     * @returns {Object} Object with query, path, and header parameter maps
     */
    _parseParameters(parameters) {
        const parsed = {
            query: {},
            path: {},
            header: {}
        };

        parameters.forEach(param => {
            const resolvedParam = param.$ref ? this.schemaProcessor.resolveSchemaRef(param) : param;
            if (!resolvedParam) {return;}

            if (resolvedParam.in === 'query') {
                parsed.query[resolvedParam.name] = {
                    required: resolvedParam.required || false,
                    type: resolvedParam.schema?.type || 'string',
                    description: resolvedParam.description || '',
                    example: resolvedParam.example || resolvedParam.schema?.example || ''
                };
            } else if (resolvedParam.in === 'path') {
                parsed.path[resolvedParam.name] = {
                    required: true,
                    type: resolvedParam.schema?.type || 'string',
                    description: resolvedParam.description || '',
                    example: resolvedParam.example || resolvedParam.schema?.example || ''
                };
            } else if (resolvedParam.in === 'header') {
                parsed.header[resolvedParam.name] = {
                    required: resolvedParam.required || false,
                    type: resolvedParam.schema?.type || 'string',
                    description: resolvedParam.description || '',
                    example: this._generateHeaderExample(resolvedParam)
                };
            }
        });

        return parsed;
    }

    /**
     * Generates example values for header parameters
     *
     * Uses explicit examples from the spec if available, otherwise generates
     * sensible defaults based on common header names. Supports variable
     * templating for sensitive values like tokens and API keys.
     *
     * @private
     * @param {Object} resolvedParam - The resolved parameter object
     * @returns {string} Example value for the header
     */
    _generateHeaderExample(resolvedParam) {
        let defaultExample = resolvedParam.example || resolvedParam.schema?.example || '';

        if (!defaultExample && resolvedParam.schema?.enum && resolvedParam.schema.enum.length > 0) {
            defaultExample = resolvedParam.schema.enum[0];
        }

        if (!defaultExample) {
            switch (resolvedParam.name.toLowerCase()) {
                case 'accept-language':
                    defaultExample = 'en-US';
                    break;
                case 'authorization':
                    defaultExample = 'Bearer {{ token }}';
                    break;
                case 'content-type':
                    defaultExample = 'application/json';
                    break;
                case 'accept':
                    defaultExample = 'application/json';
                    break;
                case 'user-agent':
                    defaultExample = 'MyApp/1.0';
                    break;
                case 'x-api-key':
                    defaultExample = '{{ apiKey }}';
                    break;
                case 'x-api-version':
                    defaultExample = 'v1';
                    break;
                default:
                    if (resolvedParam.name.toLowerCase().includes('token')) {
                        defaultExample = '{{ token }}';
                    } else if (resolvedParam.name.toLowerCase().includes('key')) {
                        defaultExample = '{{ apiKey }}';
                    } else {
                        defaultExample = 'example-value';
                    }
                    break;
            }
        }

        return defaultExample;
    }

    /**
     * Parses security requirements into authentication configuration
     *
     * Converts OpenAPI security schemes (Bearer, Basic, API Key, OAuth2) into
     * the application's internal authentication configuration format. Only
     * processes the first security requirement if multiple are defined.
     *
     * @private
     * @param {Array<Object>} securityRequirements - Array of security requirement objects
     * @param {Object} openApiSpec - The full OpenAPI specification for scheme lookup
     * @returns {Object|null} Authentication configuration object, or null if no valid security found
     */
    _parseSecurity(securityRequirements, openApiSpec) {
        if (!securityRequirements || !Array.isArray(securityRequirements) || securityRequirements.length === 0) {
            return null;
        }

        const securitySchemes = openApiSpec?.components?.securitySchemes;
        if (!securitySchemes) {
            return null;
        }

        const firstRequirement = securityRequirements[0];
        const schemeName = Object.keys(firstRequirement)[0];

        if (!schemeName || !securitySchemes[schemeName]) {
            return null;
        }

        const scheme = securitySchemes[schemeName];

        let authType = 'none';
        let authConfig = {};

        switch (scheme.type) {
            case 'http':
                if (scheme.scheme === 'bearer') {
                    authType = 'bearer';
                    authConfig = {
                        token: '{{bearerToken}}'
                    };
                } else if (scheme.scheme === 'basic') {
                    authType = 'basic';
                    authConfig = {
                        username: '',
                        password: ''
                    };
                }
                break;

            case 'apiKey':
                authType = 'api-key';
                authConfig = {
                    keyName: scheme.name || 'api-key',
                    keyValue: '',
                    location: scheme.in === 'header' ? 'header' : 'query'
                };
                break;

            case 'oauth2':
                authType = 'oauth2';
                authConfig = {
                    token: '',
                    headerPrefix: 'Bearer'
                };
                break;

            default:
                return null;
        }

        return {
            type: authType,
            config: authConfig,
            schemeName: schemeName
        };
    }

    /**
     * Imports an OpenAPI file and stores it as a collection
     *
     * Reads and parses OpenAPI files in JSON or YAML format, converts them to
     * collections, and persists them to electron-store. Automatically initializes
     * storage if undefined (handles packaged app first-run scenarios). Also stores
     * the base URL as a collection variable if present.
     *
     * @async
     * @param {string} filePath - Absolute path to the OpenAPI file (.json or .yaml/.yml)
     * @returns {Promise<Object>} The created collection object
     * @throws {Error} If file reading or parsing fails
     */
    async importOpenApiFile(filePath) {
        const fileContent = await fs.readFile(filePath, 'utf8');

        let openApiSpec;
        if (filePath.endsWith('.json')) {
            openApiSpec = JSON.parse(fileContent);
        } else {
            openApiSpec = yaml.load(fileContent);
        }

        const collection = this.parseOpenApiToCollection(openApiSpec, path.basename(filePath));

        let collections = this.store.get('collections');
        if (!Array.isArray(collections)) {
            console.warn('Collections data is invalid or undefined (possible Flatpak sandbox issue), initializing with empty array');
            collections = [];
            try {
                this.store.set('collections', collections);
            } catch (error) {
                console.error('Unable to initialize collections in store:', error);
            }
        }

        collections.push(collection);
        this.store.set('collections', collections);

        if (collection.baseUrl) {
            let variables = this.store.get('collectionVariables');
            if (!variables || typeof variables !== 'object') {
                console.warn('Collection variables data is invalid or undefined (possible Flatpak sandbox issue), initializing with empty object');
                variables = {};
                try {
                    this.store.set('collectionVariables', variables);
                } catch (error) {
                    console.error('Unable to initialize collectionVariables in store:', error);
                }
            }
            if (!variables[collection.id]) {
                variables[collection.id] = {};
            }
            variables[collection.id].baseUrl = collection.baseUrl;
            this.store.set('collectionVariables', variables);
        }

        return collection;
    }

    /**
     * Detect if endpoint is a GraphQL endpoint based on metadata
     *
     * @private
     * @param {string} path - The endpoint path
     * @param {Object} operation - The operation object
     * @returns {boolean} True if GraphQL endpoint is detected
     */
    _isGraphQLEndpoint(path, operation) {
        // Check path contains /graphql
        if (path.toLowerCase().includes('/graphql')) {
            return true;
        }

        // Check Content-Type for application/graphql
        if (operation.requestBody && operation.requestBody.content) {
            if (operation.requestBody.content['application/graphql']) {
                return true;
            }
        }

        // Check description mentions GraphQL
        const description = (operation.description || operation.summary || '').toLowerCase();
        if (description.includes('graphql')) {
            return true;
        }

        return false;
    }
}

export default OpenApiParser;
