/**
 * @fileoverview Service for building resolved request configurations from raw UI/form inputs
 * @module services/RequestBuilderService
 */

import { VariableProcessor } from '../variables/VariableProcessor.js';

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
        let resolvedUrl = processor.processTemplate(url, combinedVariables);

        if (resolvedUrl && !resolvedUrl.match(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//)) {
            resolvedUrl = `https://${resolvedUrl}`;
        }

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
            const encodedKey = key.includes('%') ? key : encodeURIComponent(key);
            const encodedValue = value.includes('%') ? value : encodeURIComponent(value);
            queryPairs.push(`${encodedKey}=${encodedValue}`);
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
                let mockPath = mockRewrite.pathTemplate;
                for (const [key, value] of Object.entries(pathParams)) {
                    mockPath = mockPath.replace(`{${key}}`, () => value);
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
        } catch (e) {
            void e;
            return false;
        }
    }

    /**
     * @param {string} url
     * @returns {string}
     */
    _originKey(url) {
        const parsed = new URL(url);
        const defaultPort = parsed.protocol === 'https:' ? '443' : parsed.protocol === 'http:' ? '80' : '';
        const port = parsed.port || defaultPort;
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
            const encodedKey = key.includes('%') ? key : encodeURIComponent(key);
            const encodedValue = stringValue.includes('%') ? stringValue : encodeURIComponent(stringValue);
            queryPairs.push(`${encodedKey}=${encodedValue}`);
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
