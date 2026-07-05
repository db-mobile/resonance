/**
 * @fileoverview Service for building resolved request configurations from raw UI/form inputs
 * @module services/RequestBuilderService
 */

import { VariableProcessor } from '../variables/VariableProcessor.js';

/**
 * Service for building resolved request configurations
 *
 * @class
 * @classdesc Extracts the shared request-building logic used by both
 * handleSendRequest and handleGenerateCurl (and the WebSocket path).
 * Handles variable resolution, URL construction, query-string encoding,
 * auth merging, and default-header injection.  Stateless per invocation —
 * call {@link build} for each new request to get a fresh VariableProcessor
 * (which guarantees fresh dynamic-variable values such as {{$uuid}}).
 */
export class RequestBuilderService {
    /**
     * Creates a RequestBuilderService instance
     *
     * @param {Function} getVariableService - Getter for the VariableService singleton
     * @param {Function} getCollectionRepository - Getter for the CollectionRepository singleton
     */
    constructor(getVariableService, getCollectionRepository) {
        this._getVariableService = getVariableService;
        this._getCollectionRepository = getCollectionRepository;
    }

    /**
     * Resolves variables for the current context (collection + environment or
     * environment-only) and returns a fresh VariableProcessor.
     *
     * @async
     * @param {Object|null} currentEndpoint - { collectionId, endpointId } or null
     * @param {Object}      headers         - Mutable header map — collection
     *                                        defaultHeaders will be merged in-place
     * @returns {Promise<{variables: Object, processor: VariableProcessor}>}
     */
    async resolveVariables(currentEndpoint, headers) {
        const variableService = this._getVariableService();
        const processor = new VariableProcessor();
        processor.clearDynamicCache();

        let variables = {};

        if (currentEndpoint) {
            const collection = await this._getCollectionRepository()
                .getById(currentEndpoint.collectionId);

            if (collection && collection.defaultHeaders) {
                const mergedHeaders = { ...collection.defaultHeaders, ...headers };
                Object.assign(headers, mergedHeaders);
            }

            variables = await variableService.getVariablesForCollection(
                currentEndpoint.collectionId
            );
        } else {
            variables = await variableService.getVariables();
        }

        return { variables, processor };
    }

    /**
     * Applies variable substitution to all request components and builds the
     * final URL with encoded query-string.
     *
     * Mutates `headers` and `queryParams` in place (clears then re-populates
     * with processed values) so callers see the resolved values.
     *
     * @param {Object} opts
     * @param {string}           opts.url         - Raw URL (may contain {{vars}})
     * @param {Object}           opts.pathParams  - Path parameter key-value pairs
     * @param {Object}           opts.headers     - Header key-value pairs (mutated in-place)
     * @param {Object}           opts.queryParams - Query parameter key-value pairs (mutated in-place)
     * @param {Object}           opts.variables   - Resolved variable map
     * @param {VariableProcessor} opts.processor  - VariableProcessor instance
     * @returns {{ url: string, queryString: string, pathParams: Object }} The
     *          resolved URL, the encoded query string, and the
     *          variable-resolved path parameter map
     */
    processRequestComponents({ url, pathParams, headers, queryParams, variables, processor }) {
        const processedPathParams = {};
        for (const [key, value] of Object.entries(pathParams)) {
            processedPathParams[key] = processor.processTemplate(value, variables);
        }

        const combinedVariables = { ...variables, ...processedPathParams };
        let resolvedUrl = processor.processTemplate(url, combinedVariables);

        if (resolvedUrl && !resolvedUrl.match(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//)) {
            resolvedUrl = `https://${resolvedUrl}`;
        }

        this._processKeyValuePairs(headers, variables, processor);

        this._processKeyValuePairs(queryParams, variables, processor);

        const queryString = this.buildQueryString(queryParams);
        const urlWithoutQuery = resolvedUrl.split('?')[0];
        resolvedUrl = queryString
            ? `${urlWithoutQuery}?${queryString}`
            : urlWithoutQuery;

        return { url: resolvedUrl, queryString, pathParams: processedPathParams };
    }

    /**
     * Applies query/path parameter mutations made by a pre-request script to
     * the request URL and returns the final URL to send.
     *
     * Rules:
     * - When `queryParams` changed, the query string is rebuilt from the
     *   mutated map onto the current URL base — an explicit `request.url`
     *   edit supplies scheme/host/path, the map supplies the query.
     * - When `pathParams` changed and the script did not edit `request.url`,
     *   the URL base is re-baked from the raw URL template (or from the
     *   mock-server rewrite when one is active) using the same processor and
     *   variables as the original bake, so dynamic variables keep their
     *   per-request values.
     * - An explicit `request.url` edit wins over `pathParams` changes.
     *
     * Also normalizes `requestConfig.queryParams`/`pathParams` in place to
     * flat string maps, since scripts may leave arbitrary JSON there.
     *
     * @param {Object} opts
     * @param {Object} opts.requestConfig - Post-script request config (param maps are normalized in place)
     * @param {Object} opts.snapshot      - Pre-script { url, queryParams, pathParams }
     * @param {string} opts.rawUrl        - Unresolved URL template (may contain {{vars}} and {params})
     * @param {Object} opts.variables     - Resolved variable map from the original bake
     * @param {VariableProcessor} opts.processor - Processor instance from the original bake
     * @param {{baseUrl: string, pathTemplate: string}|null} opts.mockRewrite - Active mock-server rewrite, if any
     * @returns {string} The final request URL
     */
    applyScriptParamMutations({ requestConfig, snapshot, rawUrl, variables, processor, mockRewrite }) {
        const queryParams = this._normalizeParamMap(requestConfig.queryParams);
        const pathParams = this._normalizeParamMap(requestConfig.pathParams);
        requestConfig.queryParams = queryParams;
        requestConfig.pathParams = pathParams;

        const urlEdited = requestConfig.url !== snapshot.url;
        const queryChanged = !this._paramMapsEqual(queryParams, snapshot.queryParams);
        const pathChanged = !this._paramMapsEqual(pathParams, snapshot.pathParams);

        if (!queryChanged && !pathChanged) {
            return requestConfig.url;
        }

        let base;
        if (pathChanged && !urlEdited) {
            if (mockRewrite) {
                let mockPath = mockRewrite.pathTemplate;
                for (const [key, value] of Object.entries(pathParams)) {
                    mockPath = mockPath.replace(`{${key}}`, value);
                }
                base = `${mockRewrite.baseUrl}${mockPath}`;
            } else {
                base = processor.processTemplate(rawUrl, { ...variables, ...pathParams });
                if (base && !base.match(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//)) {
                    base = `https://${base}`;
                }
            }
        } else {
            base = requestConfig.url;
        }
        base = base.split('?')[0];

        let queryString;
        if (queryChanged) {
            queryString = this.buildQueryString(queryParams);
        } else {
            const queryIndex = requestConfig.url.indexOf('?');
            queryString = queryIndex >= 0 ? requestConfig.url.slice(queryIndex + 1) : '';
        }

        return queryString ? `${base}?${queryString}` : base;
    }

    /**
     * Merges auth data (headers and query params) into the existing maps.
     *
     * Auth headers always overwrite; auth query params only fill in missing keys.
     *
     * @param {Object} headers     - Header map (mutated in-place)
     * @param {Object} queryParams - Query param map (mutated in-place)
     * @param {Object} authData    - Result of authManager.generateAuthData()
     * @param {Object} authData.headers     - Auth headers
     * @param {Object} authData.queryParams - Auth query params
     */
    mergeAuthData(headers, queryParams, authData) {
        Object.keys(authData.headers).forEach(key => {
            headers[key] = authData.headers[key];
        });

        Object.keys(authData.queryParams).forEach(key => {
            if (!queryParams[key]) {
                queryParams[key] = authData.queryParams[key];
            }
        });
    }

    /**
     * Builds a query string from a key-value map, preserving already-encoded values.
     *
     * @param {Object} queryParams - Processed query parameter key-value pairs
     * @returns {string} Encoded query string (without leading '?')
     */
    buildQueryString(queryParams) {
        const queryPairs = [];
        for (const [key, value] of Object.entries(queryParams)) {
            if (!key) {
                continue;
            }
            const stringValue = value === null || value === undefined ? '' : String(value);
            const encodedKey = key.includes('%') ? key : encodeURIComponent(key);
            const encodedValue = stringValue.includes('%') ? stringValue : encodeURIComponent(stringValue);
            queryPairs.push(`${encodedKey}=${encodedValue}`);
        }
        return queryPairs.join('&');
    }

    /**
     * Coerces an arbitrary script-supplied parameter map into a flat map of
     * string keys to string values. Non-object shapes (null, arrays,
     * primitives) become an empty map; null/undefined entries are dropped
     * (a script deletes a parameter by setting it to null); object values
     * are JSON-stringified, all other values stringified.
     *
     * @private
     * @param {*} map - Value a script left in queryParams/pathParams
     * @returns {Object} Flat string-to-string map
     */
    _normalizeParamMap(map) {
        if (!map || typeof map !== 'object' || Array.isArray(map)) {
            return {};
        }
        const normalized = {};
        for (const [key, value] of Object.entries(map)) {
            if (value === null || value === undefined) {
                continue;
            }
            normalized[key] = typeof value === 'object' ? JSON.stringify(value) : String(value);
        }
        return normalized;
    }

    /**
     * Shallow equality check for two flat string maps.
     *
     * @private
     * @param {Object} a - First map
     * @param {Object} b - Second map
     * @returns {boolean} True when both maps hold the same key/value pairs
     */
    _paramMapsEqual(a, b) {
        const aKeys = Object.keys(a);
        if (aKeys.length !== Object.keys(b).length) {
            return false;
        }
        return aKeys.every(
            key => Object.prototype.hasOwnProperty.call(b, key) && a[key] === b[key]
        );
    }

    /**
     * Substitutes variables in a key-value map in-place (clears then re-populates).
     *
     * @private
     * @param {Object}            map       - The mutable key-value map
     * @param {Object}            variables - Resolved variable map
     * @param {VariableProcessor} processor - VariableProcessor instance
     */
    _processKeyValuePairs(map, variables, processor) {
        const processed = {};
        for (const [key, value] of Object.entries(map)) {
            const processedKey = processor.processTemplate(key, variables);
            const processedValue = processor.processTemplate(value, variables);
            if (processedKey) {
                processed[processedKey] = processedValue;
            }
        }
        for (const key in map) {
            delete map[key];
        }
        Object.assign(map, processed);
    }
}
