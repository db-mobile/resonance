/**
 * @fileoverview Resolves the effective auth config for a request, mapping the
 * 'inherit' auth type to the owning folder's or collection's auth config
 * (endpoint → folder → collection, Postman semantics).
 * @module auth/authInheritance
 */

const NONE = Object.freeze({ type: 'none', config: Object.freeze({}) });

/**
 * Resolves an auth config to the one that should actually be applied.
 * Non-inherit configs pass through untouched. 'inherit' resolves to the
 * endpoint's folder auth when the folder defines one (an explicit folder
 * "none" opts its requests out), otherwise the collection's auth. Without a
 * collection (ad-hoc tab) or when nothing is configured, the result is none.
 *
 * @param {Object|null} authConfig - `{ type, config }` as held by AuthManager
 * @param {Object} context - Resolution context
 * @param {string|null|undefined} context.collectionId - Owning collection, if any
 * @param {string|null|undefined} [context.endpointId] - Endpoint ID for folder lookup
 * @param {Object|null} context.repository - CollectionRepository (getInheritedAuthConfig)
 * @returns {Promise<Object>} The effective `{ type, config }` (never 'inherit')
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
