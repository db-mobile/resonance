/**
 * @fileoverview Service for building resolved request configurations from raw UI/form inputs
 * @module services/RequestBuilderService
 */

import { VariableProcessor } from '../variables/VariableProcessor.js';
import { buildMockPath } from '../collections/endpointUrl.js';

/** @type {RegExp} */
const URL_SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//;

/** @type {Readonly<Object<string, string>>} */
const DEFAULT_PORTS = Object.freeze({ 'https:': '443', 'http:': '80' });

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
     * @param {Object} opts
     * @param {Object} opts.requestConfig
     * @param {Object} opts.snapshot
     * @param {string} opts.rawUrl
     * @param {Object} opts.variables
     * @param {VariableProcessor} opts.processor
     * @param {{baseUrl: string, pathTemplate: string}|null} opts.mockRewrite
     * @returns {string}
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
                base = `${mockRewrite.baseUrl}${buildMockPath(mockRewrite.pathTemplate, pathParams)}`;
            } else {
                base = ensureScheme(processor.processTemplate(rawUrl, { ...variables, ...pathParams }));
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
     * @param {Object} opts
     * @param {Object} opts.requestConfig
     * @param {string} opts.originalUrl
     * @param {Object} opts.authData
     * @returns {boolean}
     */
    stripCrossOriginAuth({ requestConfig, originalUrl, authData }) {
        if (this._sameOrigin(originalUrl, requestConfig.url)) {
            return false;
        }

        let stripped = false;
        const authHeaders = authData?.headers || {};
        if (requestConfig.headers) {
            for (const key of Object.keys(authHeaders)) {
                if (requestConfig.headers[key] === authHeaders[key]) {
                    delete requestConfig.headers[key];
                    stripped = true;
                }
            }
        }

        const authQuery = authData?.queryParams || {};
        if (requestConfig.queryParams) {
            for (const key of Object.keys(authQuery)) {
                if (requestConfig.queryParams[key] === authQuery[key]) {
                    delete requestConfig.queryParams[key];
                    stripped = true;
                }
            }
        }

        if (requestConfig.auth) {
            delete requestConfig.auth;
            stripped = true;
        }
        if (requestConfig.awsAuth) {
            delete requestConfig.awsAuth;
            stripped = true;
        }
        if (requestConfig.ntlm) {
            delete requestConfig.ntlm;
            stripped = true;
        }

        return stripped;
    }

    /**
     * @param {string} a
     * @param {string} b
     * @returns {boolean}
     */
    _sameOrigin(a, b) {
        try {
            return this._originKey(a) === this._originKey(b);
        } catch {
            return false;
        }
    }

    /**
     * @param {string} url
     * @returns {string}
     */
    _originKey(url) {
        const parsed = new URL(url);
        const port = parsed.port || DEFAULT_PORTS[parsed.protocol] || '';
        return `${parsed.protocol}//${parsed.hostname}:${port}`;
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
     * @param {*} map
     * @returns {Object}
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
     * @param {Object} a
     * @param {Object} b
     * @returns {boolean}
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
