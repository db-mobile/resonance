/**
 * @fileoverview Identifies and redacts secret fields in auth configs so credentials
 * never reach git-friendly collection files or exports.
 * @module auth/authSecrets
 */

/**
 * Secret config fields per auth type. Kept in sync with the field names written by
 * `authManager.js` and with the Rust-side redaction list in `collections.rs`.
 *
 * @type {Object<string, string[]>}
 */
export const SECRET_AUTH_FIELDS = {
    bearer: ['token'],
    basic: ['password'],
    'api-key': ['keyValue'],
    oauth2: ['clientSecret', 'password', 'token', 'refreshToken'],
    digest: ['password'],
    'aws-v4': ['secretAccessKey', 'sessionToken']
};

/**
 * A value that is a `{{ template }}` reference resolves from a variable at request
 * time and carries no secret itself, so it is safe to leave on disk.
 *
 * @param {*} value
 * @returns {boolean}
 */
function isTemplateRef(value) {
    return typeof value === 'string' && /\{\{.*\}\}/.test(value);
}

/**
 * Returns the secret field names for an auth type ([] if none/unknown).
 *
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
 * Splits an auth config into a git-safe copy (literal secret fields blanked) and the
 * extracted secret values. Template references and empty fields are left untouched, so
 * users relying on `{{ secretVar }}` keep their configuration.
 *
 * @param {Object} authConfig - `{ type, config }`
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
 * Merges extracted secret values back into an auth config read from disk. Only fills
 * fields the on-disk config left empty, so a template reference is never clobbered.
 *
 * @param {Object} authConfig - `{ type, config }`
 * @param {Object} secrets - Map of field -> value
 * @returns {Object} The auth config with secrets restored
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
 * Builds the SecretStore scope string for an endpoint's auth secrets.
 *
 * @param {string} collectionId
 * @param {string} endpointId
 * @returns {string}
 */
export function authSecretScope(collectionId, endpointId) {
    return `auth:${collectionId}:${endpointId}`;
}

/**
 * Pseudo endpoint ID for collection-level auth secrets. Endpoint IDs are
 * UUIDs or slugs, so this sentinel cannot collide with a real endpoint scope.
 *
 * @type {string}
 */
export const COLLECTION_AUTH_SCOPE_ID = '__collection__';

/**
 * Builds the SecretStore scope string for a collection's own auth secrets.
 * Lives under the same `auth:<collectionId>:` prefix as endpoint scopes so
 * collection deletion prunes it automatically.
 *
 * @param {string} collectionId
 * @returns {string}
 */
export function collectionAuthSecretScope(collectionId) {
    return authSecretScope(collectionId, COLLECTION_AUTH_SCOPE_ID);
}

/**
 * Builds the SecretStore scope string for a folder's auth secrets. Shares the
 * `auth:<collectionId>:` prefix so collection deletion prunes it automatically;
 * the `__folder__` segment cannot collide with endpoint IDs.
 *
 * @param {string} collectionId
 * @param {string} folderId
 * @returns {string}
 */
export function folderAuthSecretScope(collectionId, folderId) {
    return authSecretScope(collectionId, `__folder__:${folderId}`);
}
