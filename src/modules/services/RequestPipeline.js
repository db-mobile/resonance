/**
 * @fileoverview One request pipeline shared by the editor send path and the collection runner:
 * @module services/RequestPipeline
 */

import { resolveEffectiveAuthWithSource } from '../auth/authInheritance.js';
import { ensureFreshOAuthToken, oauthRefreshKey } from '../auth/oauthRefresh.js';
import { resolveAuthConfigVariables, withBearerFallback } from '../auth/authVariables.js';
import { generateAuthData } from '../auth/authData.js';
import { findRequest } from '../collections/collectionTree.js';
import { buildMockPath } from '../collections/endpointUrl.js';

const REQUIRED_DEPS = Object.freeze([
    'backendAPI',
    'collectionRepository',
    'variableRepository',
    'environmentRepository',
    'requestBuilder',
    'mockServerService'
]);

const BODY_TYPES = new Set(['formdata', 'urlencoded', 'text', 'binary']);

/**
 * @typedef {Object} EndpointRef
 * @property {string} collectionId
 * @property {string} endpointId
 */

export class RequestPipeline {
    /**
     * @param {Object} deps
     * @param {Object} deps.backendAPI
     * @param {Object} deps.collectionRepository
     * @param {Object} deps.variableRepository
     * @param {Object} deps.environmentRepository
     * @param {Object} deps.requestBuilder
     * @param {Object} deps.mockServerService
     * @param {{getForHost: function(string): (Object|null), getItems?: function(): Promise<*>}|null} [deps.certificates]
     * @param {{getCookieHeader: function(string): Promise<string|null>}|null} [deps.cookies]
     */
    constructor(deps = {}) {
        for (const name of REQUIRED_DEPS) {
            if (!deps[name]) {
                throw new Error(`RequestPipeline: missing dependency "${name}"`);
            }
        }
        this.backendAPI = deps.backendAPI;
        this.collectionRepository = deps.collectionRepository;
        this.variableRepository = deps.variableRepository;
        this.environmentRepository = deps.environmentRepository;
        this.requestBuilder = deps.requestBuilder;
        this.mockServerService = deps.mockServerService;
        this.certificates = deps.certificates || null;
        this.cookies = deps.cookies || null;
    }

    /**
     * @param {Object} options
     * @param {Object|null} options.authConfig
     * @param {EndpointRef|null} [options.endpoint]
     * @param {Object} options.variables
     * @param {Object} options.processor
     * @param {boolean} [options.refreshOAuth]
     * @param {boolean} [options.bearerFallback]
     * @param {(function(Object, Object): (void|Promise<void>))|null} [options.persistRequestAuth]
     * @returns {Promise<{authData: Object, source: Object|null, warnings: string[]}>}
     */
    async resolveAuth({ authConfig, endpoint = null, variables, processor, refreshOAuth = true, bearerFallback = false, persistRequestAuth = null }) {
        const { authConfig: inherited, source } = await resolveEffectiveAuthWithSource(authConfig, {
            collectionId: endpoint?.collectionId,
            endpointId: endpoint?.endpointId,
            repository: this.collectionRepository
        });
        const resolved = bearerFallback ? withBearerFallback(inherited, variables) : inherited;
        const substituted = resolveAuthConfigVariables(resolved, variables, processor);
        let effective = substituted.authConfig;
        const warnings = [];

        if (refreshOAuth && source && resolved === inherited) {
            const renewal = await ensureFreshOAuthToken({
                rawAuth: resolved,
                resolvedAuth: effective,
                key: oauthRefreshKey(endpoint, source),
                getToken: (request) => this.backendAPI.oauth2.getToken(request),
                persist: async (nextRaw, result) => {
                    if (source.kind === 'request' && persistRequestAuth) {
                        await persistRequestAuth(nextRaw, result);
                    } else if (endpoint?.collectionId) {
                        await this.collectionRepository.saveAuthConfigAtSource(endpoint.collectionId, endpoint.endpointId, source, nextRaw);
                    }
                }
            });
            effective = renewal.resolvedAuth;
            if (renewal.error) {
                warnings.push(renewal.error);
            }
        }

        const authData = generateAuthData(effective);
        authData.unresolvedVariables = substituted.unresolved;
        return { authData, source, warnings };
    }

    /**
     * @param {string} collectionId
     * @returns {Promise<string|null>}
     */
    async mockBaseUrlFor(collectionId) {
        try {
            const { shouldUseMock, mockBaseUrl } = await this.mockServerService.shouldUseMockServer(collectionId);
            return shouldUseMock && mockBaseUrl ? mockBaseUrl : null;
        } catch (error) {
            console.warn('Mock server check failed, sending to the real URL:', error);
            return null;
        }
    }

    /**
     * @param {EndpointRef|null} endpoint
     * @returns {Promise<string|null>}
     */
    async endpointPathFor(endpoint) {
        if (!endpoint?.collectionId) {
            return null;
        }
        try {
            const collection = await this.collectionRepository.getById(endpoint.collectionId);
            return collection ? (findRequest(collection, endpoint.endpointId)?.path || null) : null;
        } catch {
            return null;
        }
    }

    /**
     * @param {Object} options
     * @param {EndpointRef|null} options.endpoint
     * @param {string} options.url
     * @param {string} options.queryString
     * @param {Object} options.pathParams
     * @param {string|null} [options.mockBaseUrl]
     * @param {string|null} [options.endpointPath]
     * @returns {Promise<{url: string, mockRewrite: {baseUrl: string, pathTemplate: string}|null}>}
     */
    async resolveMockRewrite({ endpoint, url, queryString, pathParams, mockBaseUrl, endpointPath }) {
        if (!endpoint?.collectionId) {
            return { url, mockRewrite: null };
        }
        const baseUrl = mockBaseUrl === undefined ? await this.mockBaseUrlFor(endpoint.collectionId) : mockBaseUrl;
        if (!baseUrl) {
            return { url, mockRewrite: null };
        }
        const pathTemplate = endpointPath === undefined ? await this.endpointPathFor(endpoint) : endpointPath;
        if (!pathTemplate) {
            return { url, mockRewrite: null };
        }
        const mockPath = buildMockPath(pathTemplate, pathParams);
        return {
            url: queryString ? `${baseUrl}${mockPath}?${queryString}` : `${baseUrl}${mockPath}`,
            mockRewrite: { baseUrl, pathTemplate }
        };
    }

    /**
     * @param {Object} requestConfig
     * @param {{authConfig?: Object, awsAuth?: Object, ntlmAuth?: Object}} authData
     * @returns {void}
     */
    attachAuthTransport(requestConfig, authData) {
        if (authData.authConfig) {
            requestConfig.auth = authData.authConfig;
        }
        if (authData.awsAuth) {
            requestConfig.awsAuth = authData.awsAuth;
        }
        if (authData.ntlmAuth) {
            requestConfig.ntlm = authData.ntlmAuth;
        }
    }

    /**
     * @param {Object} parts
     * @param {string} parts.protocol
     * @param {string} parts.method
     * @param {string} parts.url
     * @param {string} parts.rawUrl
     * @param {Object} parts.headers
     * @param {Object} parts.queryParams
     * @param {Object} parts.pathParams
     * @param {*} parts.body
     * @param {string|undefined} parts.bodyType
     * @param {{httpVersion: string, timeout: number|null, verifySsl: boolean, followRedirects: boolean}} parts.settings
     * @param {Object} parts.authData
     * @returns {Object}
     */
    assembleRequestConfig({ protocol, method, url, rawUrl, headers, queryParams, pathParams, body, bodyType, settings, authData }) {
        const requestConfig = {
            protocol,
            method,
            url,
            rawUrl,
            headers,
            queryParams,
            pathParams,
            body,
            bodyType: BODY_TYPES.has(bodyType) ? bodyType : undefined,
            httpVersion: settings.httpVersion,
            timeout: settings.timeout,
            verifySsl: settings.verifySsl,
            followRedirects: settings.followRedirects
        };
        this.attachAuthTransport(requestConfig, authData);
        return requestConfig;
    }

    /**
     * @param {Object} requestConfig
     * @param {{snapshot: Object, rawUrl: string, variables: Object, processor: Object, mockRewrite: Object|null, authData: Object}} ctx
     * @returns {boolean}
     */
    applyScriptMutations(requestConfig, { snapshot, rawUrl, variables, processor, mockRewrite, authData, originalAuthData }) {
        requestConfig.url = this.requestBuilder.applyScriptParamMutations({
            requestConfig, snapshot, rawUrl, variables, processor, mockRewrite
        });
        let stripped = false;
        for (const credentials of [originalAuthData, authData]) {
            if (credentials) {
                stripped = this.requestBuilder.stripCrossOriginAuth({ requestConfig, originalUrl: snapshot.url, authData: credentials }) || stripped;
            }
        }
        return stripped;
    }

    /**
     * @param {{url: string, clientCert?: Object}} requestConfig
     * @returns {void}
     */
    attachClientCert(requestConfig) {
        if (!this.certificates) {
            return;
        }
        try {
            const clientCert = this.certificates.getForHost(new URL(requestConfig.url).host);
            if (clientCert) {
                requestConfig.clientCert = clientCert;
            }
        } catch {}
    }

    /**
     * @param {Object} requestConfig
     * @returns {Promise<void>}
     */
    async attachCookieHeader(requestConfig) {
        if (!this.cookies) {
            return;
        }
        const cookieHeader = await this.cookies.getCookieHeader(requestConfig.url);
        if (!cookieHeader) {
            return;
        }
        requestConfig.headers = requestConfig.headers || {};
        if (!requestConfig.headers['Cookie'] && !requestConfig.headers['cookie']) {
            requestConfig.headers['Cookie'] = cookieHeader;
        }
    }

    /**
     * @param {Object} requestConfig
     * @returns {Promise<void>}
     */
    async finalize(requestConfig) {
        this.attachClientCert(requestConfig);
        await this.attachCookieHeader(requestConfig);
    }
}
