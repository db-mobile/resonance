/**
 * @fileoverview Editor-side adapter over the shared RequestPipeline: reads the auth form and current endpoint, reports through toasts
 * @module requestServices
 */

import { getCurrentEndpoint } from './state/currentEndpoint.js';
import { toast } from './ui/Toast.js';
import { app } from './appContext.js';
import { setOAuthVariableResolver } from './authManager.js';
import { scheduleEndpointSave } from './endpointSave.js';
import { appendAuthQueryRows } from './utils/keyValueRows.js';

let _pipeline = null;

/**
 * @param {import('./services/RequestPipeline.js').RequestPipeline|null} pipeline
 * @returns {void}
 */
export function setRequestPipeline(pipeline) {
    _pipeline = pipeline;
}

/** @returns {import('./services/RequestPipeline.js').RequestPipeline} */
export function getRequestPipeline() {
    if (!_pipeline) {
        throw new Error('Request pipeline is not initialised');
    }
    return _pipeline;
}

/** @returns {Object} */
export function getRequestBuilderService() {
    return getRequestPipeline().requestBuilder;
}

setOAuthVariableResolver((collectionId) => {
    const endpoint = collectionId ? { collectionId } : getCurrentEndpoint();
    return getRequestBuilderService().resolveVariables(endpoint, {});
});

/**
 * @param {{variables?: Object, processor?: Object, refreshOAuth?: boolean}} [substitution]
 * @returns {Promise<Object>}
 */
export async function generateEffectiveAuthData({ variables, processor, refreshOAuth = true, endpoint = getCurrentEndpoint(), authConfig = app.authManager.getAuthConfig(), onAuthRenewed } = {}) {
    const { authData, warnings } = await getRequestPipeline().resolveAuth({
        authConfig,
        endpoint,
        variables,
        processor,
        refreshOAuth,
        persistRequestAuth: async (nextRaw, result) => {
            onAuthRenewed?.(nextRaw);
            if (endpoint?.collectionId && endpoint?.endpointId) {
                await getRequestPipeline().collectionRepository.saveAuthConfigAtSource(endpoint.collectionId, endpoint.endpointId, { kind: 'request' }, nextRaw);
            }
            if (getCurrentEndpoint()?.endpointId === endpoint?.endpointId && getCurrentEndpoint()?.collectionId === endpoint?.collectionId) {
                app.authManager.applyTokenResult(result);
                scheduleEndpointSave();
            }
        }
    });
    warnings.forEach((warning) => toast.warning(warning));
    return authData;
}

/**
 * @param {Object} processor
 * @param {Object} requestConfig
 * @param {string[]} [extraNames]
 * @returns {void}
 */
export function warnUnresolvedVariables(processor, requestConfig, extraNames = []) {
    try {
        const unresolved = [...new Set([
            ...processor.extractUnresolvedVariableNames({
                url: requestConfig.url,
                headers: requestConfig.headers,
                queryParams: requestConfig.queryParams,
                pathParams: requestConfig.pathParams,
                body: requestConfig.body
            }),
            ...extraNames
        ])];

        if (unresolved.length === 0) {
            return;
        }

        const shown = unresolved.slice(0, 5).map(name => `{{${name}}}`).join(', ');
        const more = unresolved.length > 5 ? ` and ${unresolved.length - 5} more` : '';
        toast.warning(`Request sent with unresolved variables: ${shown}${more}`);
    } catch {}
}

/**
 * @param {Error} error
 * @returns {string}
 */
export function variableProcessingError(error) {
    return `Variable processing error: ${error.message}`;
}

/**
 * @param {{url: string, pathParams?: Object, headers: Object, queryParams: Object, queryRows?: Array<Object>, useAuth?: boolean, refreshOAuth?: boolean}} request
 * @returns {Promise<{ok: true, url: string, queryString: string, pathParams: Object, headers: Object, queryParams: Object, variables: Object, processor: Object, authData: Object|null}|{ok: false, error: string}>}
 */
export async function resolveRequestPipeline({ url, pathParams = {}, headers, queryParams, queryRows, useAuth = true, refreshOAuth = true, endpoint = getCurrentEndpoint(), authConfig, variablesOverride, onAuthRenewed }) {
    const builder = getRequestBuilderService();

    try {
        const resolved = await builder.resolveVariables(endpoint, headers);
        const variables = variablesOverride ?? resolved.variables;
        const { processor } = resolved;

        let authData = null;
        if (useAuth) {
            authData = await generateEffectiveAuthData({ variables, processor, refreshOAuth, endpoint, onAuthRenewed, ...(authConfig ? { authConfig } : {}) });
            builder.mergeAuthData(headers, queryParams, authData);
            if (queryRows) {
                appendAuthQueryRows(queryRows, authData.queryParams);
            }
        }

        const processed = builder.processRequestComponents({
            url, pathParams, headers, queryParams, queryRows, variables, processor
        });

        return { ok: true, ...processed, headers, queryParams, variables, processor, authData };
    } catch (error) {
        return { ok: false, error: variableProcessingError(error) };
    }
}
