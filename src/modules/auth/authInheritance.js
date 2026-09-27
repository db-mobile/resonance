/**
 * @fileoverview Resolves the effective auth config for a request, mapping the
 * @module auth/authInheritance
 */

const NONE = Object.freeze({ type: 'none', config: Object.freeze({}) });

/**
 * @param {Object|null} authConfig
 * @param {Object} context
 * @param {string|null|undefined} context.collectionId
 * @param {string|null|undefined} [context.endpointId]
 * @param {Object|null} context.repository
 * @returns {Promise<Object>}
 */
export async function resolveEffectiveAuthConfig(authConfig, context = {}) {
    return (await resolveEffectiveAuthWithSource(authConfig, context)).authConfig;
}

/**
 * @param {Object|null} authConfig
 * @param {Object} context
 * @param {string|null|undefined} context.collectionId
 * @param {string|null|undefined} [context.endpointId]
 * @param {Object|null} context.repository
 * @returns {Promise<{authConfig: Object, source: ({kind: string, folderId?: string}|null)}>}
 */
export async function resolveEffectiveAuthWithSource(authConfig, { collectionId, endpointId, repository } = {}) {
    if (!authConfig) {
        return { authConfig: NONE, source: null };
    }
    if (authConfig.type !== 'inherit') {
        return { authConfig, source: { kind: 'request' } };
    }
    if (!collectionId || !repository) {
        return { authConfig: NONE, source: null };
    }
    const source = typeof repository.getInheritedAuthSource === 'function'
        ? await repository.getInheritedAuthSource(collectionId, endpointId)
        : null;
    const inherited = await repository.getInheritedAuthConfig(collectionId, endpointId);
    if (!inherited || inherited.type === 'none' || inherited.type === 'inherit') {
        return { authConfig: NONE, source: null };
    }
    return { authConfig: inherited, source };
}
