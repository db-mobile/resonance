/**
 * @fileoverview Collection-runner request overrides: only the fields a user changed away from the endpoint
 * @module utils/requestOverrides
 */

export const OVERRIDES_VERSION = 2;

/** @type {ReadonlyArray<string>} */
const ROW_FIELDS = Object.freeze(['pathParams', 'queryParams', 'headers']);

/**
 * @param {Array<Object>|undefined} rows
 * @param {boolean} [activeOnly]
 * @returns {Array<{key: string, value: string}>}
 */
function toPairs(rows, activeOnly = false) {
    return (rows || [])
        .filter(row => !activeOnly || row.enabled !== false)
        .map(row => ({ key: row.key || '', value: row.value || '' }))
        .filter(row => row.key);
}

/**
 * @param {Object|null|undefined} config
 * @returns {{pathParams: Array<Object>, queryParams: Array<Object>, headers: Array<Object>, body: string}}
 */
export function endpointDefaults(config) {
    return {
        pathParams: toPairs(config?.pathParams),
        queryParams: toPairs(config?.queryParams, true),
        headers: toPairs(config?.headers, true),
        body: config?.body || ''
    };
}

/**
 * @param {Object|null|undefined} overrides
 * @param {Object} defaults
 * @returns {Object}
 */
export function effectiveOverrides(overrides, defaults) {
    const effective = {};
    for (const field of ROW_FIELDS) {
        effective[field] = Array.isArray(overrides?.[field]) ? toPairs(overrides[field]) : defaults[field];
    }
    effective.body = typeof overrides?.body === 'string' ? overrides.body : defaults.body;
    return effective;
}

/**
 * @param {Object|null|undefined} overrides
 * @param {Object} defaults
 * @returns {Object}
 */
export function stripUnchangedOverrides(overrides, defaults) {
    const changed = {};
    for (const field of ROW_FIELDS) {
        if (!Array.isArray(overrides?.[field])) {
            continue;
        }
        const pairs = toPairs(overrides[field]);
        if (JSON.stringify(pairs) !== JSON.stringify(defaults[field])) {
            changed[field] = pairs;
        }
    }
    if (typeof overrides?.body === 'string' && overrides.body.trim() !== defaults.body.trim()) {
        changed.body = overrides.body;
    }
    return changed;
}
