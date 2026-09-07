/**
 * @fileoverview Identifies and redacts secret fields in auth configs so credentials
 * @module auth/authSecrets
 */

/** @type {Object<string, string[]>} */
export const SECRET_AUTH_FIELDS = {
    bearer: ['token'],
    basic: ['password'],
    'api-key': ['keyValue'],
    oauth2: ['clientSecret', 'password', 'token', 'refreshToken'],
    digest: ['password'],
    ntlm: ['password'],
    'aws-v4': ['secretAccessKey', 'sessionToken']
};

/**
 * @param {*} value
 * @returns {boolean}
 */
function isTemplateRef(value) {
    return typeof value === 'string' && /\{\{.*\}\}/.test(value);
}

/**
 * @param {string} type
 * @returns {string[]}
 */
export function getSecretAuthFields(type) {
    if (!type) {
        return [];
    }
    return SECRET_AUTH_FIELDS[type] || [];
}

/**
 * @param {Object} authConfig
 * @returns {{ redacted: Object, secrets: Object }}
 */
export function splitAuthSecrets(authConfig) {
    if (!authConfig || typeof authConfig !== 'object' || !authConfig.config) {
        return { redacted: authConfig, secrets: {} };
    }

    const fields = getSecretAuthFields(authConfig.type);
    if (fields.length === 0) {
        return { redacted: authConfig, secrets: {} };
    }

    const secrets = {};
    const config = { ...authConfig.config };
    for (const field of fields) {
        const value = config[field];
        if (typeof value === 'string' && value !== '' && !isTemplateRef(value)) {
            secrets[field] = value;
            config[field] = '';
        }
    }

    return { redacted: { ...authConfig, config }, secrets };
}

/**
 * @param {Object} authConfig
 * @param {Object} secrets
 * @returns {Object}
 */
export function mergeAuthSecrets(authConfig, secrets) {
    if (!authConfig || typeof authConfig !== 'object' || !secrets || Object.keys(secrets).length === 0) {
        return authConfig;
    }

    const config = { ...(authConfig.config || {}) };
    let changed = false;
    for (const [field, value] of Object.entries(secrets)) {
        if (config[field] === '' || config[field] === undefined || config[field] === null) {
            config[field] = value;
            changed = true;
        }
    }

    return changed ? { ...authConfig, config } : authConfig;
}

/**
 * @param {string} collectionId
 * @param {string} endpointId
 * @returns {string}
 */
export function authSecretScope(collectionId, endpointId) {
    return `auth:${collectionId}:${endpointId}`;
}

/** @type {string} */
export const COLLECTION_AUTH_SCOPE_ID = '__collection__';

/**
 * @param {string} collectionId
 * @returns {string}
 */
export function collectionAuthSecretScope(collectionId) {
    return authSecretScope(collectionId, COLLECTION_AUTH_SCOPE_ID);
}

/**
 * @param {string} collectionId
 * @param {string} folderId
 * @returns {string}
 */
export function folderAuthSecretScope(collectionId, folderId) {
    return authSecretScope(collectionId, `__folder__:${folderId}`);
}
