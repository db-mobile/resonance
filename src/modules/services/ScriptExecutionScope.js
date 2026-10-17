/** Transient scope: never serialized to workspace or runner history. */
export function createExecutionScope({ runner = false, environment = {}, environmentId = null } = {}) {
    return { active: true, runner, environment: { ...environment }, environmentId,
        localVariables: {}, collections: new Map() };
}

export function applyVariableChanges(values, changes, removed = null) {
    const next = { ...values, ...changes };
    const deleted = removed ?? Object.keys(changes || {}).filter(key => changes[key] === null || changes[key] === undefined);
    for (const key of deleted) { delete next[key]; }
    return next;
}

export function resolvedScopeVariables(scope, collectionId, data = {}) {
    const variables = { ...scope.collections.get(collectionId), ...scope.environment, ...data, ...scope.localVariables };
    for (const [key, value] of Object.entries(scope.localVariables)) {
        if (value === null) { variables[key] = 'null'; }
    }
    return variables;
}
