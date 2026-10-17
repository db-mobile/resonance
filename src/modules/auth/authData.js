/**
 * @fileoverview Request auth fields generated from a resolved auth config
 * @module auth/authData
 */

import { getAuthType } from './authTypes.js';

/**
 * @param {{type?: string, config?: Object}|null|undefined} authConfig
 * @returns {{headers: Object, queryParams: Object, authConfig: ?Object, awsAuth?: Object, ntlmAuth?: Object}}
 */
export function generateAuthData(authConfig) {
    const authData = {
        headers: {},
        queryParams: {},
        authConfig: null
    };

    const { type, config = {} } = authConfig || {};
    getAuthType(type)?.apply(config, authData);

    return authData;
}
