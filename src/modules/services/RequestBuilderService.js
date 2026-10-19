/**
 * @fileoverview Service for building resolved request configurations from raw UI/form inputs
 * @module services/RequestBuilderService
 */

import { VariableProcessor } from '../variables/VariableProcessor.js';

/** @type {RegExp} */
const URL_SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//;

/**
 * @param {string} url
 * @returns {string}
 */
function ensureScheme(url) {
    return url && !URL_SCHEME.test(url) ? `https://${url}` : url;
}

/**
 * @param {string} text
 * @returns {string}
 */
function encodeUnlessEncoded(text) {
    return text.includes('%') ? text : encodeURIComponent(text);
}

export class RequestBuilderService {
    /**
     * @param {Function} getVariableService
     * @param {Function} getCollectionRepository
     */
    constructor(getVariableService, getCollectionRepository) {
        this._getVariableService = getVariableService;
        this._getCollectionRepository = getCollectionRepository;
    }

    /**
     * @param {Object|null} currentEndpoint
     * @param {Object} headers
     * @returns {Promise<{variables: Object, processor: VariableProcessor}>}
     */
    async resolveVariables(currentEndpoint, headers) {
        const variableService = this._getVariableService();
        const processor = new VariableProcessor();
        processor.clearDynamicCache();

        let variables;

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
     * @param {Object} opts
     * @param {string} opts.url
     * @param {Object} opts.pathParams
     * @param {Object} opts.headers
     * @param {Object} opts.queryParams
     * @param {Array<{key: string, value: string}>} [opts.queryRows]
     * @param {Object} opts.variables
     * @param {VariableProcessor} opts.processor
     * @returns {{ url: string, queryString: string, pathParams: Object }}
     */
    processRequestComponents({ url, pathParams, headers, queryParams, queryRows, variables, processor }) {
        const processedPathParams = {};
        for (const [key, value] of Object.entries(pathParams)) {
            processedPathParams[key] = processor.processTemplate(value, variables);
        }

        const combinedVariables = { ...variables, ...processedPathParams };
        let resolvedUrl = ensureScheme(processor.processTemplate(url, combinedVariables));

        this._processKeyValuePairs(headers, variables, processor);

        this._processKeyValuePairs(queryParams, variables, processor);

        const queryString = Array.isArray(queryRows)
            ? this._buildQueryStringFromRows(queryRows, variables, processor)
            : this.buildQueryString(queryParams);
        const urlWithoutQuery = resolvedUrl.split('?')[0];
        resolvedUrl = queryString
            ? `${urlWithoutQuery}?${queryString}`
            : urlWithoutQuery;

        return { url: resolvedUrl, queryString, pathParams: processedPathParams };
    }

    /**
     * @param {Array<{key: string, value: string}>} rows
     * @param {Object} variables
     * @param {VariableProcessor} processor
     * @returns {string}
     */
    _buildQueryStringFromRows(rows, variables, processor) {
        const queryPairs = [];
        for (const row of rows) {
            const key = processor.processTemplate(row.key || '', variables);
            if (!key) {
                continue;
            }
            const value = processor.processTemplate(row.value || '', variables);
            queryPairs.push(`${encodeUnlessEncoded(key)}=${encodeUnlessEncoded(value)}`);
        }
        return queryPairs.join('&');
    }

    /**
     * @param {Object} headers
     * @param {Object} queryParams
     * @param {Object} authData
     * @param {Object} authData.headers
     * @param {Object} authData.queryParams
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
     * @param {Object} queryParams
     * @returns {string}
     */
    buildQueryString(queryParams) {
        const queryPairs = [];
        for (const [key, value] of Object.entries(queryParams)) {
            if (!key) {
                continue;
            }
            const stringValue = value === null || value === undefined ? '' : String(value);
            queryPairs.push(`${encodeUnlessEncoded(key)}=${encodeUnlessEncoded(stringValue)}`);
        }
        return queryPairs.join('&');
    }

    /**
     * @param {Object} map
     * @param {Object} variables
     * @param {VariableProcessor} processor
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
