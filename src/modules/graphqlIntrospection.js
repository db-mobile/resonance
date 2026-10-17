/**
 * @fileoverview GraphQL introspection fetch for the request form, building a client schema from the result
 * @module graphqlIntrospection
 */

import { getIntrospectionQuery, buildClientSchema } from 'graphql';
import { urlInput } from './domElements.js';
import { parseKeyValuePairs } from './keyValueManager.js';
import { resolveRequestSettings } from './state/settingsCache.js';
import { resolveRequestPipeline, getRequestPipeline } from './requestServices.js';

/** @returns {Promise<{schema?: import('graphql').GraphQLSchema, url?: string, error?: string}>} */
export async function fetchGraphQLIntrospection() {
    const url = urlInput?.value?.trim() || urlInput?.getAttribute('value') || '';
    if (!url) {
        return { error: 'Enter a URL before fetching the schema' };
    }

    const headers = parseKeyValuePairs(document.getElementById('headers-list'));
    const queryParams = parseKeyValuePairs(document.getElementById('query-params-list'));

    const prepared = await resolveRequestPipeline({ url, headers, queryParams });
    if (!prepared.ok) {
        return { error: prepared.error };
    }
    const { url: resolvedUrl, authData } = prepared;

    const { timeout, verifySsl, followRedirects } = await resolveRequestSettings();

    const requestConfig = {
        method: 'POST',
        url: resolvedUrl,
        rawUrl: url,
        headers: { 'Content-Type': 'application/json', ...headers },
        body: { query: getIntrospectionQuery(), variables: {} },
        timeout,
        verifySsl,
        followRedirects
    };

    const pipeline = getRequestPipeline();
    pipeline.attachAuthTransport(requestConfig, authData);
    pipeline.attachClientCert(requestConfig);

    let result;
    try {
        result = await window.backendAPI.sendApiRequest(requestConfig);
    } catch (error) {
        return { error: `Request failed: ${error.message || error}` };
    }

    if (!result || !result.success) {
        const status = result?.status ? ` (HTTP ${result.status})` : '';
        return { error: `${result?.message || 'Introspection request failed'}${status}` };
    }

    const payload = result.data;
    if (payload && Array.isArray(payload.errors) && payload.errors.length > 0) {
        return { error: `GraphQL error: ${payload.errors[0].message || 'introspection rejected'}` };
    }

    const introspection = payload?.data;
    if (!introspection || !introspection.__schema) {
        return { error: 'Response did not contain a GraphQL schema (introspection may be disabled)' };
    }

    try {
        return { schema: buildClientSchema(introspection), introspection, url: resolvedUrl };
    } catch (error) {
        return { error: `Could not parse schema: ${error.message}` };
    }
}

/**
 * @param {object} introspection
 * @returns {import('graphql').GraphQLSchema|null}
 */
export function buildSchemaFromIntrospection(introspection) {
    if (!introspection || !introspection.__schema) {
        return null;
    }
    try {
        return buildClientSchema(introspection);
    } catch (_error) {
        return null;
    }
}
