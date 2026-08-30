/**
 * @fileoverview Variable substitution for auth configurations
 * @module auth/authVariables
 */

/**
 * Substitutes {{variable}} references in an auth config's credential fields.
 * @param {Object|null} authConfig - Auth config ({ type, config }) to resolve
 * @param {Object} variables - Variable name/value map
 * @param {Object} processor - VariableProcessor instance shared with the request pipeline
 * @returns {{authConfig: Object|null, unresolved: string[]}} Resolved copy and unresolved variable names
 */
export function resolveAuthConfigVariables(authConfig, variables, processor) {
    if (!authConfig || !authConfig.config || !processor) {
        return { authConfig, unresolved: [] };
    }

    const unresolved = processor.extractUnresolvedVariableNames(authConfig.config, variables || {});
    return {
        authConfig: {
            ...authConfig,
            config: processor.processObject(authConfig.config, variables || {})
        },
        unresolved
    };
}
