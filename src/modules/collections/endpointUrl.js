/**
 * @fileoverview Editor URL template for an HTTP endpoint
 * @module collections/endpointUrl
 */

/**
 * @param {Object} endpoint
 * @param {string} endpoint.path
 * @param {string|null} [endpoint.persistedUrl]
 * @param {*} [endpoint.collectionBaseUrl]
 * @param {Object} [endpoint.parameters]
 * @returns {string}
 */
export function buildEndpointUrl(endpoint) {
    if (endpoint.persistedUrl) {
        return endpoint.persistedUrl;
    }

    let fullUrl = endpoint.path;
    if (endpoint.collectionBaseUrl && !endpoint.path.includes('{{baseUrl}}')) {
        fullUrl = `{{baseUrl}}${endpoint.path}`;
    }

    if (endpoint.parameters?.path) {
        Object.entries(endpoint.parameters.path).forEach(([key]) => {
            const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const singleBraceParamRegex = new RegExp(`(?<!\\{)\\{${escapedKey}\\}(?!\\})`, 'g');
            fullUrl = fullUrl.replace(singleBraceParamRegex, () => `{{${key}}}`);
        });
    }

    return fullUrl;
}

/**
 * @param {string} pathTemplate
 * @returns {string}
 */
export function normalizeMockPath(pathTemplate) {
    let path = String(pathTemplate || '').trim();
    const scheme = path.match(/^[a-zA-Z]+:\/\/[^/]*/);
    if (scheme) {
        path = path.slice(scheme[0].length);
    } else if (path.startsWith('{{')) {
        const close = path.indexOf('}}');
        const rest = close >= 0 ? path.slice(close + 2) : null;
        if (rest !== null && (rest === '' || rest.startsWith('/') || rest.startsWith('?'))) {
            path = rest;
        }
    }
    path = path.split(/[?#]/)[0];
    return path.startsWith('/') ? path : `/${path}`;
}

/**
 * @param {string} pathTemplate
 * @param {Object<string, string>} pathParams
 * @returns {string}
 */
export function buildMockPath(pathTemplate, pathParams = {}) {
    let path = normalizeMockPath(pathTemplate);
    for (const [key, value] of Object.entries(pathParams)) {
        path = path.split(`{{${key}}}`).join(value).split(`{${key}}`).join(value);
    }
    return path;
}
