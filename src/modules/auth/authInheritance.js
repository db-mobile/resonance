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
export async function resolveEffectiveAuthConfig(authConfig, { collectionId, endpointId, repository } = {}) {
    if (!authConfig) {
        return NONE;
    }
    if (authConfig.type !== 'inherit') {
        return authConfig;
    }
    if (!collectionId || !repository) {
        return NONE;
    }
    const inherited = await repository.getInheritedAuthConfig(collectionId, endpointId);
    if (!inherited || inherited.type === 'none' || inherited.type === 'inherit') {
        return NONE;
    }
    return inherited;
}
