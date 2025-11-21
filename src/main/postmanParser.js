/**
 * @fileoverview Postman collection parser for converting Postman collections into API collections
 * @module main/postmanParser
 */

import fs from 'fs/promises';
import path from 'path';

/**
 * Parser for Postman Collection Format v2.0 and v2.1
 *
 * @class
 * @classdesc Handles parsing of Postman collection files (JSON) and converts them into
 * structured API collections with endpoints, parameters, and authentication configurations.
 * Supports both v2.0 and v2.1 collection formats, folder hierarchies, and variable extraction.
 */
class PostmanParser {
    /**
     * Creates a PostmanParser instance
     *
     * @param {Object} store - Electron-store instance for persistent storage
     */
    constructor(store) {
        this.store = store;
    }

    /**
     * Converts a Postman collection into a collection object
     *
     * Parses the Postman collection and creates a structured collection with endpoints
     * organized into folders based on the first path segment (like OpenAPI parser).
     * Extracts variables, authentication configurations, and request details.
     *
     * @param {Object} postmanCollection - The parsed Postman collection object
     * @param {string} fileName - The original filename for fallback naming
     * @returns {Object} Collection object with endpoints, folders, and metadata
     */
    parsePostmanToCollection(postmanCollection, fileName) {
        const collection = {
            id: Date.now().toString(),
            name: postmanCollection.info?.name || fileName,
            version: postmanCollection.info?.version || '1.0.0',
            description: postmanCollection.info?.description || '',
            baseUrl: '',
            defaultHeaders: {},
            endpoints: [],
            folders: [],
            _postmanCollection: postmanCollection
        };

        if (postmanCollection.auth) {
            collection.defaultAuth = this._parseAuth(postmanCollection.auth);
        }

        if (postmanCollection.item && Array.isArray(postmanCollection.item)) {
            this._processItems(postmanCollection.item, collection, null);
        }

        this._regroupEndpointsByPath(collection);

        return collection;
    }

    /**
     * Recursively processes Postman items (requests and folders)
     *
     * Handles both individual requests and folder hierarchies, extracting
     * all endpoints. Folder structure is ignored and endpoints will be
     * re-grouped by path segment later.
     *
     * @private
     * @param {Array<Object>} items - Array of Postman items
     * @param {Object} collection - The collection object to populate
     * @param {string|null} _parentFolderId - Unused, kept for compatibility
     * @returns {void}
     */
    _processItems(items, collection, _parentFolderId) {
        items.forEach(item => {
            if (item.item && Array.isArray(item.item)) {
                this._processItems(item.item, collection, null);
            } else if (item.request) {
                const endpoint = this._parseRequest(item);

                if (endpoint) {
                    collection.endpoints.push(endpoint);
                }
            }
        });
    }

    /**
     * Parses a Postman request item into an endpoint object
     *
     * Extracts method, URL, headers, body, authentication, and parameters
     * from a Postman request object.
     *
     * @private
     * @param {Object} item - Postman item containing a request
     * @returns {Object|null} Endpoint object, or null if invalid
     */
    _parseRequest(item) {
        const request = item.request;
        if (!request) {
            return null;
        }

        const urlObj = this._parseUrl(request.url);
        const endpoint = {
            id: `${item.name}`.replace(/[^a-zA-Z0-9]/g, '_') + `_${Date.now()}`,
            name: item.name || 'Unnamed Request',
            description: item.description || '',
            method: (request.method || 'GET').toUpperCase(),
            path: urlObj.path,
            parameters: {
                query: urlObj.query || {},
                path: urlObj.pathVariables || {},
                header: {}
            },
            headers: this._parseHeaders(request.header),
            requestBody: this._parseBody(request.body)
        };

        if (request.auth) {
            endpoint.security = this._parseAuth(request.auth);
        }

        return endpoint;
    }

    /**
     * Parses a Postman URL object
     *
     * Handles both string URLs and Postman URL objects with protocol, host, path, and query.
     * Extracts path variables and query parameters.
     *
     * @private
     * @param {string|Object} url - Postman URL string or object
     * @returns {Object} Parsed URL with path, query, and pathVariables
     */
    _parseUrl(url) {
        const result = {
            path: '',
            query: {},
            pathVariables: {}
        };

        if (typeof url === 'string') {
            try {
                const urlObj = new URL(url);
                result.path = urlObj.pathname;

                urlObj.searchParams.forEach((value, key) => {
                    result.query[key] = {
                        required: false,
                        type: 'string',
                        description: '',
                        example: value
                    };
                });
            } catch {
                result.path = url;
            }
        } else if (url && typeof url === 'object') {
            if (url.path && Array.isArray(url.path)) {
                result.path = '/' + url.path.join('/');
            } else if (url.raw) {
                try {
                    const urlObj = new URL(url.raw);
                    result.path = urlObj.pathname;
                } catch {
                    result.path = url.raw;
                }
            }

            if (url.query && Array.isArray(url.query)) {
                url.query.forEach(param => {
                    if (param.key && param.disabled !== true) {
                        result.query[param.key] = {
                            required: false,
                            type: 'string',
                            description: param.description || '',
                            example: param.value || ''
                        };
                    }
                });
            }

            if (url.variable && Array.isArray(url.variable)) {
                url.variable.forEach(variable => {
                    if (variable.key) {
                        result.pathVariables[variable.key] = {
                            required: true,
                            type: 'string',
                            description: variable.description || '',
                            example: variable.value || ''
                        };

                        result.path = result.path.replace(`:${variable.key}`, `{${variable.key}}`);
                    }
                });
            }
        }

        return result;
    }

    /**
     * Parses Postman headers into header object
     *
     * Converts Postman header array into a key-value object,
     * filtering out disabled headers.
     *
     * @private
     * @param {Array<Object>} headers - Array of Postman header objects
     * @returns {Object} Headers as key-value pairs
     */
    _parseHeaders(headers) {
        const result = {};

        if (!headers || !Array.isArray(headers)) {
            return result;
        }

        headers.forEach(header => {
            if (header.key && header.disabled !== true) {
                result[header.key] = header.value || '';
            }
        });

        return result;
    }

    /**
     * Parses Postman request body
     *
     * Handles different body modes: raw, urlencoded, formdata, file, graphql.
     * Converts to appropriate format for the application.
     *
     * @private
     * @param {Object} body - Postman body object
     * @returns {string|null} Request body as string, or null if no body
     */
    _parseBody(body) {
        if (!body) {
            return null;
        }

        switch (body.mode) {
            case 'raw':
                return body.raw || '';

            case 'urlencoded':
                if (body.urlencoded && Array.isArray(body.urlencoded)) {
                    const params = body.urlencoded
                        .filter(param => param.disabled !== true)
                        .map(param => `${encodeURIComponent(param.key)}=${encodeURIComponent(param.value || '')}`)
                        .join('&');
                    return params;
                }
                return '';

            case 'formdata':
                if (body.formdata && Array.isArray(body.formdata)) {
                    const formObj = {};
                    body.formdata
                        .filter(param => param.disabled !== true)
                        .forEach(param => {
                            formObj[param.key] = param.value || '';
                        });
                    return JSON.stringify(formObj, null, 2);
                }
                return '';

            case 'graphql':
                if (body.graphql) {
                    return JSON.stringify({
                        query: body.graphql.query || '',
                        variables: body.graphql.variables || {}
                    }, null, 2);
                }
                return '';

            case 'file':
                return '';

            default:
                return '';
        }
    }

    /**
     * Parses Postman authentication into application auth format
     *
     * Converts Postman auth objects (Bearer, Basic, API Key, OAuth2, Digest, etc.)
     * into the application's internal authentication configuration format.
     *
     * @private
     * @param {Object} auth - Postman auth object
     * @returns {Object|null} Authentication configuration object, or null if unsupported
     */
    _parseAuth(auth) {
        if (!auth || !auth.type) {
            return null;
        }

        const authType = auth.type.toLowerCase();
        const result = {
            type: 'none',
            config: {}
        };

        switch (authType) {
            case 'bearer':
                result.type = 'bearer';
                result.config = {
                    token: this._getAuthValue(auth.bearer, 'token') || ''
                };
                break;

            case 'basic':
                result.type = 'basic';
                result.config = {
                    username: this._getAuthValue(auth.basic, 'username') || '',
                    password: this._getAuthValue(auth.basic, 'password') || ''
                };
                break;

            case 'apikey':
                result.type = 'api-key';
                result.config = {
                    keyName: this._getAuthValue(auth.apikey, 'key') || 'api-key',
                    keyValue: this._getAuthValue(auth.apikey, 'value') || '',
                    location: this._getAuthValue(auth.apikey, 'in') === 'query' ? 'query' : 'header'
                };
                break;

            case 'oauth2':
                result.type = 'oauth2';
                result.config = {
                    token: this._getAuthValue(auth.oauth2, 'accessToken') || '',
                    headerPrefix: 'Bearer'
                };
                break;

            case 'digest':
                result.type = 'digest';
                result.config = {
                    username: this._getAuthValue(auth.digest, 'username') || '',
                    password: this._getAuthValue(auth.digest, 'password') || ''
                };
                break;

            default:
                return null;
        }

        return result;
    }

    /**
     * Extracts a value from Postman auth configuration array
     *
     * Postman stores auth configuration as an array of {key, value, type} objects.
     * This helper finds the matching key and returns its value.
     *
     * @private
     * @param {Array<Object>} authArray - Array of auth configuration objects
     * @param {string} key - The key to search for
     * @returns {string|null} The value, or null if not found
     */
    _getAuthValue(authArray, key) {
        if (!authArray || !Array.isArray(authArray)) {
            return null;
        }

        const item = authArray.find(a => a.key === key);
        return item ? item.value : null;
    }

    /**
     * Re-groups endpoints by first path segment to match OpenAPI parser behavior
     *
     * Discards the Postman folder structure and creates a flat folder organization
     * based on the first segment of each endpoint's path (e.g., /posts, /comments).
     * This ensures consistency with OpenAPI imports.
     *
     * @private
     * @param {Object} collection - The collection object to reorganize
     * @returns {void}
     */
    _regroupEndpointsByPath(collection) {
        const groupedEndpoints = {};

        collection.endpoints.forEach(endpoint => {
            const basePath = this._extractBasePath(endpoint.path);

            if (!groupedEndpoints[basePath]) {
                groupedEndpoints[basePath] = [];
            }
            groupedEndpoints[basePath].push(endpoint);
        });

        collection.folders = [];
        for (const [basePath, endpoints] of Object.entries(groupedEndpoints)) {
            const folder = {
                id: `folder_${basePath}`.replace(/[^a-zA-Z0-9]/g, '_'),
                name: basePath,
                endpoints: endpoints
            };
            collection.folders.push(folder);
        }
    }

    /**
     * Extracts the base path segment from a full path for folder grouping
     *
     * Takes the first segment of the path to use as a folder name.
     * For example, "/users/123/profile" becomes "users".
     * Matches the behavior of the OpenAPI parser.
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
     * Extracts Postman collection variables
     *
     * Converts Postman collection variables into application variable format
     * for use in environments.
     *
     * @param {Object} postmanCollection - The Postman collection object
     * @returns {Object} Variables as key-value pairs
     */
    extractVariables(postmanCollection) {
        const variables = {};

        if (postmanCollection.variable && Array.isArray(postmanCollection.variable)) {
            postmanCollection.variable.forEach(variable => {
                if (variable.key) {
                    variables[variable.key] = variable.value || '';
                }
            });
        }

        return variables;
    }

    /**
     * Imports a Postman collection file and stores it as a collection
     *
     * Reads and parses Postman collection files in JSON format, converts them to
     * collections, and persists them to electron-store. Automatically initializes
     * storage if undefined (handles packaged app first-run scenarios). Also extracts
     * and stores collection variables.
     *
     * @async
     * @param {string} filePath - Absolute path to the Postman collection file (.json)
     * @returns {Promise<Object>} The created collection object with variables
     * @throws {Error} If file reading or parsing fails
     */
    async importPostmanFile(filePath) {
        const fileContent = await fs.readFile(filePath, 'utf8');
        const postmanCollection = JSON.parse(fileContent);

        if (!postmanCollection.info || !postmanCollection.info.schema) {
            throw new Error('Invalid Postman collection format: missing info.schema');
        }

        const collection = this.parsePostmanToCollection(postmanCollection, path.basename(filePath));

        const variables = this.extractVariables(postmanCollection);

        if (variables.baseUrl) {
            collection.baseUrl = variables.baseUrl;
        }

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

        if (Object.keys(variables).length > 0) {
            let collectionVariables = this.store.get('collectionVariables');
            if (!collectionVariables || typeof collectionVariables !== 'object') {
                console.warn('Collection variables data is invalid or undefined (possible Flatpak sandbox issue), initializing with empty object');
                collectionVariables = {};
                try {
                    this.store.set('collectionVariables', collectionVariables);
                } catch (error) {
                    console.error('Unable to initialize collectionVariables in store:', error);
                }
            }
            collectionVariables[collection.id] = variables;
            this.store.set('collectionVariables', collectionVariables);
        }

        return {
            collection,
            variables
        };
    }

    /**
     * Imports a Postman environment file and creates an environment
     *
     * Reads and parses Postman environment files in JSON format and extracts
     * the variables for use in Resonance environments.
     *
     * @async
     * @param {string} filePath - Absolute path to the Postman environment file (.json)
     * @returns {Promise<Object>} Object with environment name and variables
     * @throws {Error} If file reading or parsing fails
     */
    async importPostmanEnvironment(filePath) {
        const fileContent = await fs.readFile(filePath, 'utf8');
        const postmanEnv = JSON.parse(fileContent);

        if (!postmanEnv.name || !postmanEnv.values) {
            throw new Error('Invalid Postman environment format: missing name or values');
        }

        const variables = {};
        postmanEnv.values.forEach(variable => {
            if (variable.key && variable.enabled !== false) {
                variables[variable.key] = variable.value || '';
            }
        });

        return {
            name: postmanEnv.name,
            variables
        };
    }
}

export default PostmanParser;
