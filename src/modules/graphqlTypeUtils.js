/**
 * @fileoverview Shared helpers for classifying printed GraphQL type strings into
 * @module graphqlTypeUtils
 */

import { isEnumType, isScalarType } from 'graphql';

export const NUMBER_SCALARS = new Set(['Int', 'Float']);
export const TEXT_SCALARS = new Set(['ID', 'String']);

/**
 * @param {string} typeString
 * @returns {string}
 */
export function baseTypeName(typeString) {
    return (typeString || '').replace(/[[\]!]/g, '').trim();
}

/**
 * @param {string} typeString
 * @returns {boolean}
 */
export function isListType(typeString) {
    return (typeString || '').includes('[');
}

/**
 * @param {string} typeString
 * @param {import('graphql').GraphQLSchema|null} [schema]
 * @returns {'number'|'boolean'|'enum'|'text'|'json'}
 */
export function inputKindForType(typeString, schema = null) {
    if (isListType(typeString)) {
        return 'json';
    }
    const base = baseTypeName(typeString);
    if (NUMBER_SCALARS.has(base)) {
        return 'number';
    }
    if (base === 'Boolean') {
        return 'boolean';
    }
    if (TEXT_SCALARS.has(base)) {
        return 'text';
    }
    const named = schema?.getType?.(base);
    if (named && isEnumType(named)) {
        return 'enum';
    }
    if (named && isScalarType(named)) {
        return 'text';
    }
    return 'json';
}

/**
 * @param {string} typeString
 * @param {import('graphql').GraphQLSchema|null} [schema]
 * @returns {string[]}
 */
export function enumValuesForType(typeString, schema = null) {
    const named = schema?.getType?.(baseTypeName(typeString));
    if (!named || !isEnumType(named)) {
        return [];
    }
    return named.getValues().map(v => v.name);
}

/**
 * @param {*} raw
 * @param {string} typeString
 * @returns {*}
 */
export function coerceInputValue(raw, typeString) {
    const base = baseTypeName(typeString);
    if (!isListType(typeString) && base === 'Boolean') {
        return raw === true || raw === 'true';
    }
    if (typeof raw !== 'string') {
        return raw;
    }
    const trimmed = raw.trim();
    if (!isListType(typeString) && NUMBER_SCALARS.has(base)) {
        if (trimmed === '') {
            return '';
        }
        const n = Number(trimmed);
        return Number.isFinite(n) ? n : raw;
    }
    if (!isListType(typeString) && TEXT_SCALARS.has(base)) {
        return raw;
    }
    if (trimmed === '') {
        return '';
    }
    try {
        return JSON.parse(trimmed);
    } catch (_e) {
        return raw;
    }
}
