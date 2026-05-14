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

    // -------------------------------------------------------------------------
    //  Public API
    // -------------------------------------------------------------------------

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

            // Inject collection-level default headers (user-set headers take precedence)
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
     * @returns {{ url: string, queryString: string }}
     */
    processRequestComponents({ url, pathParams, headers, queryParams, variables, processor }) {
        // 1. Substitute variables in path param VALUES
        const processedPathParams = {};
        for (const [key, value] of Object.entries(pathParams)) {
            processedPathParams[key] = processor.processTemplate(value, variables);
        }

        // 2. Substitute variables in URL (include processed path params)
        const combinedVariables = { ...variables, ...processedPathParams };
        let resolvedUrl = processor.processTemplate(url, combinedVariables);

        // 3. Auto-prepend https:// if no protocol is specified
        if (resolvedUrl && !resolvedUrl.match(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//)) {
            resolvedUrl = `https://${resolvedUrl}`;
        }

        // 4. Substitute variables in headers (mutate in-place)
        this._processKeyValuePairs(headers, variables, processor);

        // 5. Substitute variables in query params (mutate in-place)
        this._processKeyValuePairs(queryParams, variables, processor);

        // 6. Build final URL with query string
        const queryString = this.buildQueryString(queryParams);
        const urlWithoutQuery = resolvedUrl.split('?')[0];
        resolvedUrl = queryString
            ? `${urlWithoutQuery}?${queryString}`
            : urlWithoutQuery;

        return { url: resolvedUrl, queryString };
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
            // Only encode if not already encoded (heuristic: contains %)
            const encodedKey = key.includes('%') ? key : encodeURIComponent(key);
            const encodedValue = value.includes('%') ? value : encodeURIComponent(value);
            queryPairs.push(`${encodedKey}=${encodedValue}`);
        }
        return queryPairs.join('&');
    }

    // -------------------------------------------------------------------------
    //  Private helpers
    // -------------------------------------------------------------------------

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
