/**
 * @fileoverview Cookie jar key helpers shared by the cookie service and repository
 * @module utils/cookieId
 */

/**
 * @param {string|null|undefined} environmentId
 * @returns {string}
 */
export function cookieEnvironmentId(environmentId) {
    return environmentId || 'default';
}

/**
 * @param {string} environmentId
 * @param {string} domain
 * @param {string} path
 * @param {string} name
 * @returns {string}
 */
export function cookieId(environmentId, domain, path, name) {
    return `${environmentId}|${domain}|${path}|${name}`;
}
