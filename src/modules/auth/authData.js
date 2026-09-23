/**
 * @fileoverview Request auth fields generated from a resolved auth config
 * @module auth/authData
 */

import { textToBase64 } from '../utils/encoding.js';

/**
 * @param {Object|null} authConfig
 * @returns {Object}
 */
export function generateAuthData(authConfig) {
    const authData = {
        headers: {},
        queryParams: {},
        authConfig: null
    };

    const { type, config = {} } = authConfig || {};

    switch (type) {
        case 'none':
            break;

        case 'bearer':
            if (config.token) {
                authData.headers['Authorization'] = `Bearer ${config.token}`;
            } else {
                void config;
            }
            break;

        case 'basic':
            if (config.username || config.password) {
                const credentials = textToBase64(`${config.username || ''}:${config.password || ''}`);
                authData.headers['Authorization'] = `Basic ${credentials}`;
            }
            break;

        case 'api-key':
            if (config.keyName && config.keyValue) {
                if (config.location === 'header') {
                    authData.headers[config.keyName] = config.keyValue;
                } else if (config.location === 'query') {
                    authData.queryParams[config.keyName] = config.keyValue;
                }
            }
            break;

        case 'oauth2':
            if (config.token) {
                const prefix = config.headerPrefix || 'Bearer';
                authData.headers['Authorization'] = `${prefix} ${config.token}`;
            }
            break;

        case 'digest':
            if (config.username || config.password) {
                authData.authConfig = {
                    username: config.username || '',
                    password: config.password || ''
                };
            }
            break;

        case 'ntlm':
            if (config.username || config.password) {
                authData.ntlmAuth = {
                    username: config.username || '',
                    password: config.password || '',
                    domain: config.domain || '',
                    workstation: config.workstation || ''
                };
            }
            break;

        case 'aws-v4':
            if (config.accessKeyId && config.secretAccessKey) {
                authData.awsAuth = {
                    accessKeyId: config.accessKeyId,
                    secretAccessKey: config.secretAccessKey,
                    region: config.region || 'us-east-1',
                    service: config.service || '',
                    sessionToken: config.sessionToken || null
                };
            }
            break;

        default:
            break;
    }

    return authData;

}
