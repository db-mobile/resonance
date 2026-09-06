/**
 * @fileoverview Variable substitution for auth configurations
 * @module auth/authVariables
 */

/**
 * @param {Object|null} authConfig
 * @param {Object} variables
 * @param {Object} processor
 * @returns {{authConfig: Object|null, unresolved: string[]}}
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
