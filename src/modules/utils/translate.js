/**
 * @fileoverview Translation lookup that falls back to English when a key is missing or i18n is not loaded
 * @module utils/translate
 */

import { app } from '../appContext.js';

/**
 * @param {string} text
 * @param {Object} params
 * @returns {string}
 */
function interpolate(text, params) {
    return text.replace(/\{\{(\w+)\}\}/g, (match, name) => (params[name] !== undefined ? String(params[name]) : match));
}

/**
 * @param {string} key
 * @param {string} fallback
 * @param {Object} [params]
 * @returns {string}
 */
export function translate(key, fallback, params = {}) {
    const value = app.i18n?.t(key, params);
    return value && value !== key ? value : interpolate(fallback, params);
}

/**
 * @param {string} key
 * @param {number} count
 * @param {{one: string, other: string}} fallbacks
 * @param {Object} [params]
 * @returns {string}
 */
export function translateCount(key, count, fallbacks, params = {}) {
    const form = count === 1 ? 'one' : 'other';
    return translate(`${key}_${form}`, fallbacks[form], { count, ...params });
}
