import fs from 'fs/promises';
import path from 'path';
import yaml from 'js-yaml';

/**
 * Handles OpenAPI file import and parsing
 */
class OpenApiParser {
    constructor(schemaProcessor, store) {
        this.schemaProcessor = schemaProcessor;
        this.store = store;
    }

    /**
     * Parse OpenAPI specification into collection format
     */
    parseOpenApiToCollection(openApiSpec, fileName) {
        // Set the global spec for $ref resolution
        this.schemaProcessor.setCurrentSpec(openApiSpec);

        const collection = {
            id: Date.now().toString(),
            name: openApiSpec.info?.title || fileName,
            version: openApiSpec.info?.version || '1.0.0',
            baseUrl: '',
            defaultHeaders: {},
            endpoints: [],
            // Store the full spec for $ref resolution
            _openApiSpec: openApiSpec
        };

        // Extract base URL from servers
        if (openApiSpec.servers && openApiSpec.servers.length > 0) {
            collection.baseUrl = openApiSpec.servers[0].url;
        }

        // Extract default headers
        this._extractDefaultHeaders(openApiSpec, collection);

        // Parse paths to create endpoints grouped by URL structure
        if (openApiSpec.paths) {
            this._parsePaths(openApiSpec, collection);
        }

        return collection;
    }

    /**
     * Extract default headers from OpenAPI spec
     */
    _extractDefaultHeaders(openApiSpec, collection) {
        // Extract default headers from components.headers
        if (openApiSpec.components?.headers) {
            for (const [headerName, headerSpec] of Object.entries(openApiSpec.components.headers)) {
                if (headerSpec.schema?.default || headerSpec.example) {
                    collection.defaultHeaders[headerName] = headerSpec.schema?.default || headerSpec.example;
                }
            }
        }

        // Support custom x-default-headers extension
        if (openApiSpec['x-default-headers']) {
            Object.assign(collection.defaultHeaders, openApiSpec['x-default-headers']);
        }

        // Support default headers in info section
        if (openApiSpec.info?.['x-default-headers']) {
            Object.assign(collection.defaultHeaders, openApiSpec.info['x-default-headers']);
        }
    }

    /**
     * Parse OpenAPI paths into endpoints
     */
    _parsePaths(openApiSpec, collection) {
        const groupedEndpoints = {};

        // First pass: create endpoints and group them by base path
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
                        security: this._parseSecurity(methodValue.security, openApiSpec)
                    };

                    // Extract base path for grouping (first segment after leading slash)
                    const basePath = this._extractBasePath(pathKey);

                    if (!groupedEndpoints[basePath]) {
                        groupedEndpoints[basePath] = [];
                    }
                    groupedEndpoints[basePath].push(endpoint);
                }
            }
        }

        // Second pass: create folder structure
        collection.folders = [];
        for (const [basePath, endpoints] of Object.entries(groupedEndpoints)) {
            const folder = {
                id: `folder_${basePath}`.replace(/[^a-zA-Z0-9]/g, '_'),
                name: basePath,
                endpoints: endpoints
            };
            collection.folders.push(folder);
        }

        // Keep backwards compatibility - flatten all endpoints
        collection.endpoints = Object.values(groupedEndpoints).flat();
    }

    /**
     * Extract base path from a full path
     */
    _extractBasePath(pathKey) {
        // Remove leading slash and extract first path segment
        const cleanPath = pathKey.replace(/^\//, '');
        const segments = cleanPath.split('/');

        // Return the first segment, or 'root' if no segments
        return segments[0] || 'root';
    }

    /**
     * Parse OpenAPI parameters
     */
    _parseParameters(parameters) {
        const parsed = {
            query: {},
            path: {},
            header: {}
        };

        parameters.forEach(param => {
            // Resolve $ref if present
            const resolvedParam = param.$ref ? this.schemaProcessor.resolveSchemaRef(param) : param;
            if (!resolvedParam) return; // Skip if $ref couldn't be resolved

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
     * Generate sensible default examples for common headers
     */
    _generateHeaderExample(resolvedParam) {
        let defaultExample = resolvedParam.example || resolvedParam.schema?.example || '';

        // Check for enum values in schema
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
                    // Use parameter name as hint for meaningful defaults
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
     * Parse security requirements
     */
    _parseSecurity(securityRequirements, openApiSpec) {
        // If no security defined at endpoint level, return null
        if (!securityRequirements || !Array.isArray(securityRequirements) || securityRequirements.length === 0) {
            return null;
        }

        // Get security schemes from OpenAPI spec
        const securitySchemes = openApiSpec?.components?.securitySchemes;
        if (!securitySchemes) {
            return null;
        }

        // Process the first security requirement (most common case)
        const firstRequirement = securityRequirements[0];
        const schemeName = Object.keys(firstRequirement)[0];

        if (!schemeName || !securitySchemes[schemeName]) {
            return null;
        }

        const scheme = securitySchemes[schemeName];

        // Map OpenAPI security scheme to auth type
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
     * Import and parse an OpenAPI file
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

        // Get collections with fallback to empty array if undefined
        // In Flatpak environments, store.get() might return undefined even with defaults
        let collections = this.store.get('collections');
        if (!Array.isArray(collections)) {
            console.warn('Collections data is invalid or undefined (possible Flatpak sandbox issue), initializing with empty array');
            collections = [];
            // Try to initialize the store with the default value
            try {
                this.store.set('collections', collections);
            } catch (error) {
                console.error('Unable to initialize collections in store:', error);
            }
        }

        collections.push(collection);
        this.store.set('collections', collections);

        // Create baseUrl variable if a base URL was found
        if (collection.baseUrl) {
            let variables = this.store.get('collectionVariables');
            if (!variables || typeof variables !== 'object') {
                console.warn('Collection variables data is invalid or undefined (possible Flatpak sandbox issue), initializing with empty object');
                variables = {};
                // Try to initialize the store with the default value
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
}

export default OpenApiParser;
