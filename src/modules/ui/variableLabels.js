/**
 * @fileoverview Shared labels and badge classes for variable pills, tooltips and completion lists
 * @module ui/variableLabels
 */

import { app } from '../appContext.js';
import { scopeLabel, maskValue } from '../variables/variableTokens.js';

const SCOPE_BADGE = {
    environment: 'accent',
    collection: 'neutral',
    dynamic: 'warning',
    'path-param': 'accent'
};

/**
 * @param {string} key
 * @param {string} fallback
 * @returns {string}
 */
export function translateLabel(key, fallback) {
    const translated = app.i18n?.t?.(key);
    return typeof translated === 'string' && translated !== key ? translated : fallback;
}

/**
 * @param {Object} entry
 * @returns {string}
 */
export function describeScope(entry) {
    return scopeLabel(entry, translateLabel);
}

/**
 * @param {Object} entry
 * @returns {string}
 */
export function scopeBadgeClass(entry) {
    return SCOPE_BADGE[entry?.scope] ?? 'error';
}

/**
 * @param {Object} entry
 * @returns {string}
 */
export function describeValue(entry) {
    if (entry?.status === 'dynamic') {
        return entry.description ?? '';
    }
    return maskValue(entry);
}
