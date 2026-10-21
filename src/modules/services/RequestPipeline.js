/**
 * @fileoverview Request preparation helpers for previews, introspection, and streaming protocols.
 * @module services/RequestPipeline
 */

import { resolveEffectiveAuthWithSource } from '../auth/authInheritance.js';
import { ensureFreshOAuthToken, oauthRefreshKey } from '../auth/oauthRefresh.js';
import { resolveAuthConfigVariables, withBearerFallback } from '../auth/authVariables.js';
import { generateAuthData } from '../auth/authData.js';

const REQUIRED_DEPS = Object.freeze([
    'backendAPI',
    'collectionRepository',
    'variableRepository',
    'environmentRepository',
    'requestBuilder',
    'mockServerService'
]);

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

}
