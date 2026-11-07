/**
 * @fileoverview DOM-free helpers for locating and describing `{{variable}}` tokens in text
 * @module variables/variableTokens
 * @typedef {Object} VariableToken
 * @property {number} start
 * @property {number} end
 * @property {string} raw
 * @property {string} name
 * @property {string|null} params
 * @property {boolean} dynamic
 */

export const TOKEN_PATTERN = /\{\{\s*(?:\$([A-Za-z_][A-Za-z0-9_]*)(?::([^}]*))?|([A-Za-z0-9_][A-Za-z0-9_.-]*))\s*\}\}/g;

export const SECRET_MASK = '••••••';

const MAX_VALUE_LENGTH = 48;
const MAX_COMPLETIONS = 12;

/**
 * @param {string} text
 * @returns {VariableToken[]}
 */
export function tokenize(text) {
    const tokens = [];
    if (typeof text !== 'string' || !text.includes('{{')) {
        return tokens;
    }
    const pattern = new RegExp(TOKEN_PATTERN.source, 'g');
    let match;
    while ((match = pattern.exec(text)) !== null) {
        const dynamic = match[1] !== undefined;
        tokens.push({
            start: match.index,
            end: match.index + match[0].length,
            raw: match[0],
            name: dynamic ? `$${match[1]}` : match[3],
            params: dynamic ? (match[2] ?? null) : null,
            dynamic
        });
    }
    return tokens;
}

/**
 * @param {{value?: string|null, secret?: boolean}} entry
 * @returns {string}
 */
export function maskValue(entry) {
    if (!entry) {
        return '';
    }
    if (entry.secret) {
        return SECRET_MASK;
    }
    const value = entry.value === null || entry.value === undefined ? '' : String(entry.value);
    const collapsed = value.replace(/\s+/g, ' ').trim();
    return collapsed.length > MAX_VALUE_LENGTH ? `${collapsed.slice(0, MAX_VALUE_LENGTH - 1)}…` : collapsed;
}

/**
 * @param {{scope?: string|null, envName?: string|null}} entry
 * @param {(key: string, fallback: string) => string} [translate]
 * @returns {string}
 */
export function scopeLabel(entry, translate = (key, fallback) => fallback) {
    switch (entry?.scope) {
        case 'environment':
            return entry.envName
                ? `${translate('variables.scope.environment', 'Environment')} "${entry.envName}"`
                : translate('variables.scope.environment', 'Environment');
        case 'collection':
            return translate('variables.scope.collection', 'Collection');
        case 'dynamic':
            return translate('variables.scope.dynamic', 'Dynamic');
        case 'path-param':
            return translate('variables.scope.path_param', 'Path parameter');
        default:
            return translate('variables.scope.undefined', 'Not defined');
    }
}

/**
 * @param {Array<{name: string, shadowed?: boolean}>} entries
 * @param {string} query
 * @param {number} [limit]
 * @returns {Array<Object>}
 */
export function filterEntries(entries, query, limit = MAX_COMPLETIONS) {
    const needle = (query || '').toLowerCase();
    const candidates = entries.filter((entry) => !entry.shadowed && entry.name.toLowerCase().includes(needle));
    candidates.sort((a, b) => {
        const aStarts = a.name.toLowerCase().startsWith(needle) ? 0 : 1;
        const bStarts = b.name.toLowerCase().startsWith(needle) ? 0 : 1;
        return aStarts - bStarts;
    });
    return candidates.slice(0, limit);
}
