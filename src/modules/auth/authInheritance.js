/**
 * @fileoverview Resolves the effective auth config for a request, following 'inherit' up to the owning folder or collection.
 * @module auth/authInheritance
 */

const NONE = Object.freeze({ type: 'none', config: Object.freeze({}) });

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
    const { authConfig: inherited, source } = await repository.getInheritedAuth(collectionId, endpointId);
    if (!inherited || inherited.type === 'none' || inherited.type === 'inherit') {
        return { authConfig: NONE, source: null };
    }
    return { authConfig: inherited, source };
}
