/**
 * @fileoverview Registry of every auth type: label, form template, bound fields, secret fields and how it turns into request auth data
 * @module auth/authTypes
 */

import { textToBase64 } from '../utils/encoding.js';

export const DEFAULT_REDIRECT_URI = 'http://localhost:8080/callback';

/**
 * @typedef {Object} AuthFieldSpec
 * @property {string} id
 * @property {string} key
 * @property {string} [prop]
 * @property {string} [event]
 * @property {string} [fallback]
 * @property {boolean} [seed]
 * @property {string} [reveals]
 * @property {string} [dispatch]
 */

/**
 * @typedef {Object} AuthTypeDescriptor
 * @property {string} id
 * @property {string} label
 * @property {?string} template
 * @property {AuthFieldSpec[]} fields
 * @property {string[]} secretFields
 * @property {(config: Object, authData: Object) => void} apply
 * @property {?string} mount
 */

/**
 * @param {Object} config
 * @param {Object} authData
 * @returns {void}
 */
function applyNone(config, authData) {
    void config;
    void authData;
}

/**
 * @param {Object} config
 * @param {Object} authData
 * @returns {void}
 */
function applyBearer(config, authData) {
    if (config.token) {
        authData.headers['Authorization'] = `Bearer ${config.token}`;
    }
}

/**
 * @param {Object} config
 * @param {Object} authData
 * @returns {void}
 */
function applyBasic(config, authData) {
    if (config.username || config.password) {
        const credentials = textToBase64(`${config.username || ''}:${config.password || ''}`);
        authData.headers['Authorization'] = `Basic ${credentials}`;
    }
}

/**
 * @param {Object} config
 * @param {Object} authData
 * @returns {void}
 */
function applyApiKey(config, authData) {
    if (config.keyName && config.keyValue) {
        if (config.location === 'header') {
            authData.headers[config.keyName] = config.keyValue;
        } else if (config.location === 'query') {
            authData.queryParams[config.keyName] = config.keyValue;
        }
    }
}

/**
 * @param {Object} config
 * @param {Object} authData
 * @returns {void}
 */
function applyOAuth2(config, authData) {
    if (config.token) {
        const prefix = config.headerPrefix || 'Bearer';
        authData.headers['Authorization'] = `${prefix} ${config.token}`;
    }
}

/**
 * @param {Object} config
 * @param {Object} authData
 * @returns {void}
 */
function applyDigest(config, authData) {
    if (config.username || config.password) {
        authData.authConfig = {
            username: config.username || '',
            password: config.password || ''
        };
    }
}

/**
 * @param {Object} config
 * @param {Object} authData
 * @returns {void}
 */
function applyNtlm(config, authData) {
    if (config.username || config.password) {
        authData.ntlmAuth = {
            username: config.username || '',
            password: config.password || '',
            domain: config.domain || '',
            workstation: config.workstation || ''
        };
    }
}

/**
 * @param {Object} config
 * @param {Object} authData
 * @returns {void}
 */
function applyAwsV4(config, authData) {
    if (config.accessKeyId && config.secretAccessKey) {
        authData.awsAuth = {
            accessKeyId: config.accessKeyId,
            secretAccessKey: config.secretAccessKey,
            region: config.region || 'us-east-1',
            service: config.service || '',
            sessionToken: config.sessionToken || null
        };
    }
}

/** @type {AuthTypeDescriptor[]} */
export const AUTH_TYPES = Object.freeze([
    {
        id: 'none',
        label: 'No Auth',
        template: null,
        fields: [],
        secretFields: [],
        apply: applyNone,
        mount: null
    },
    {
        id: 'inherit',
        label: 'Inherit from Parent',
        template: 'tpl-auth-inherit',
        fields: [],
        secretFields: [],
        apply: applyNone,
        mount: 'renderInheritFields'
    },
    {
        id: 'bearer',
        label: 'Bearer Token',
        template: 'tpl-auth-bearer',
        fields: [
            { id: 'bearer-token', key: 'token', fallback: '{{bearerToken}}', seed: true }
        ],
        secretFields: ['token'],
        apply: applyBearer,
        mount: null
    },
    {
        id: 'basic',
        label: 'Basic Auth',
        template: 'tpl-auth-basic',
        fields: [
            { id: 'basic-username', key: 'username' },
            { id: 'basic-password', key: 'password' }
        ],
        secretFields: ['password'],
        apply: applyBasic,
        mount: null
    },
    {
        id: 'api-key',
        label: 'API Key',
        template: 'tpl-auth-api-key',
        fields: [
            { id: 'api-key-name', key: 'keyName' },
            { id: 'api-key-value', key: 'keyValue' },
            { id: 'api-key-location', key: 'location', event: 'change', fallback: 'header', seed: true }
        ],
        secretFields: ['keyValue'],
        apply: applyApiKey,
        mount: null
    },
    {
        id: 'oauth2',
        label: 'OAuth 2.0',
        template: 'tpl-auth-oauth2',
        fields: [
            { id: 'oauth2-grant-type', key: 'grantType', event: 'change', fallback: 'client_credentials', seed: true, dispatch: 'change' },
            { id: 'oauth2-token-url', key: 'tokenUrl' },
            { id: 'oauth2-auth-url', key: 'authorizationUrl' },
            { id: 'oauth2-client-id', key: 'clientId' },
            { id: 'oauth2-client-secret', key: 'clientSecret' },
            { id: 'oauth2-username', key: 'username' },
            { id: 'oauth2-password', key: 'password' },
            { id: 'oauth2-redirect-uri', key: 'redirectUri', fallback: DEFAULT_REDIRECT_URI },
            { id: 'oauth2-scope', key: 'scope' },
            { id: 'oauth2-audience', key: 'audience' },
            { id: 'oauth2-use-pkce', key: 'usePkce', prop: 'checked', event: 'change' },
            { id: 'oauth2-client-auth', key: 'clientAuthMethod', event: 'change', fallback: 'body', seed: true },
            { id: 'oauth2-token', key: 'token' },
            { id: 'oauth2-header-prefix', key: 'headerPrefix', fallback: 'Bearer', seed: true },
            { id: 'oauth2-refresh-token', key: 'refreshToken', reveals: 'oauth2-refresh-token-group' }
        ],
        secretFields: ['clientSecret', 'password', 'token', 'refreshToken'],
        apply: applyOAuth2,
        mount: 'renderOAuth2Fields'
    },
    {
        id: 'digest',
        label: 'Digest Auth',
        template: 'tpl-auth-digest',
        fields: [
            { id: 'digest-username', key: 'username' },
            { id: 'digest-password', key: 'password' }
        ],
        secretFields: ['password'],
        apply: applyDigest,
        mount: null
    },
    {
        id: 'ntlm',
        label: 'NTLM',
        template: 'tpl-auth-ntlm',
        fields: [
            { id: 'ntlm-username', key: 'username' },
            { id: 'ntlm-password', key: 'password' },
            { id: 'ntlm-domain', key: 'domain' },
            { id: 'ntlm-workstation', key: 'workstation' }
        ],
        secretFields: ['password'],
        apply: applyNtlm,
        mount: null
    },
    {
        id: 'aws-v4',
        label: 'AWS Signature',
        template: 'tpl-auth-aws-v4',
        fields: [
            { id: 'aws-access-key-id', key: 'accessKeyId' },
            { id: 'aws-secret-access-key', key: 'secretAccessKey' },
            { id: 'aws-region', key: 'region' },
            { id: 'aws-service', key: 'service' },
            { id: 'aws-session-token', key: 'sessionToken' }
        ],
        secretFields: ['secretAccessKey', 'sessionToken'],
        apply: applyAwsV4,
        mount: null
    }
].map((entry) => Object.freeze({ ...entry, fields: Object.freeze(entry.fields), secretFields: Object.freeze(entry.secretFields) })));

/**
 * @param {*} id
 * @returns {?AuthTypeDescriptor}
 */
export function getAuthType(id) {
    return AUTH_TYPES.find((entry) => entry.id === id) || null;
}

/**
 * @param {string} id
 * @returns {string}
 */
export function getAuthTypeLabel(id) {
    return getAuthType(id)?.label || id;
}

/**
 * @param {string} id
 * @returns {string[]}
 */
export function getSecretAuthFields(id) {
    return [...(getAuthType(id)?.secretFields ?? [])];
}
