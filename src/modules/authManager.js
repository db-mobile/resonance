/**
 * @fileoverview Authentication manager for handling multiple authentication methods
 * @module modules/authManager
 */

import { templateLoader } from './templateLoader.js';
import { api } from './ipcBridge.js';
import { generateAuthData } from './auth/authData.js';

/**
 * @typedef {Object} AuthFieldSpec
 * @property {string} id
 * @property {string} key
 * @property {'value'|'checked'} [prop]
 * @property {string} [event]
 * @property {string} [fallback]
 * @property {boolean} [seed]
 * @property {string} [reveals]
 * @property {string} [dispatch]
 */

/** @type {Object<string, AuthFieldSpec[]>} */
const AUTH_FIELDS = {
    bearer: [
        { id: 'bearer-token', key: 'token', fallback: '{{bearerToken}}', seed: true }
    ],
    basic: [
        { id: 'basic-username', key: 'username' },
        { id: 'basic-password', key: 'password' }
    ],
    'api-key': [
        { id: 'api-key-name', key: 'keyName' },
        { id: 'api-key-value', key: 'keyValue' },
        { id: 'api-key-location', key: 'location', event: 'change', fallback: 'header', seed: true }
    ],
    oauth2: [
        { id: 'oauth2-grant-type', key: 'grantType', event: 'change', fallback: 'client_credentials', seed: true, dispatch: 'change' },
        { id: 'oauth2-token-url', key: 'tokenUrl' },
        { id: 'oauth2-auth-url', key: 'authorizationUrl' },
        { id: 'oauth2-client-id', key: 'clientId' },
        { id: 'oauth2-client-secret', key: 'clientSecret' },
        { id: 'oauth2-username', key: 'username' },
        { id: 'oauth2-password', key: 'password' },
        { id: 'oauth2-redirect-uri', key: 'redirectUri', fallback: 'http://localhost:8080/callback' },
        { id: 'oauth2-scope', key: 'scope' },
        { id: 'oauth2-audience', key: 'audience' },
        { id: 'oauth2-use-pkce', key: 'usePkce', prop: 'checked', event: 'change' },
        { id: 'oauth2-client-auth', key: 'clientAuthMethod', event: 'change', fallback: 'body', seed: true },
        { id: 'oauth2-token', key: 'token' },
        { id: 'oauth2-header-prefix', key: 'headerPrefix', fallback: 'Bearer', seed: true },
        { id: 'oauth2-refresh-token', key: 'refreshToken', reveals: 'oauth2-refresh-token-group' }
    ],
    digest: [
        { id: 'digest-username', key: 'username' },
        { id: 'digest-password', key: 'password' }
    ],
    ntlm: [
        { id: 'ntlm-username', key: 'username' },
        { id: 'ntlm-password', key: 'password' },
        { id: 'ntlm-domain', key: 'domain' },
        { id: 'ntlm-workstation', key: 'workstation' }
    ],
    'aws-v4': [
        { id: 'aws-access-key-id', key: 'accessKeyId' },
        { id: 'aws-secret-access-key', key: 'secretAccessKey' },
        { id: 'aws-region', key: 'region' },
        { id: 'aws-service', key: 'service' },
        { id: 'aws-session-token', key: 'sessionToken' }
    ]
};

export class AuthManager {
    /**
     * @param {Object} [options]
     * @param {HTMLSelectElement} [options.typeSelect]
     * @param {HTMLElement} [options.fieldsContainer]
     * @param {string} [options.idPrefix]
     */
    constructor(options = {}) {
        this.idPrefix = options.idPrefix || '';
        this.authTypeSelect = options.typeSelect || document.getElementById('auth-type-select');
        this.authFieldsContainer = options.fieldsContainer || document.getElementById('auth-fields-container');
        this.inheritSummary = options.inheritSummary || null;
        this.currentAuthConfig = {
            type: 'none',
            config: {}
        };

        this.initializeEventListeners();
    }

    /**
     * @param {string} id
     * @returns {HTMLElement|null}
     */
    _el(id) {
        if (!this.idPrefix) {
            return document.getElementById(id);
        }
        return this.authFieldsContainer?.querySelector(`#${CSS.escape(this.idPrefix + id)}`) || null;
    }

    /**
     * @param {AuthFieldSpec} field
     * @param {Object} config
     * @returns {string|boolean}
     */
    _fieldValue(field, config) {
        if (field.prop === 'checked') {
            return config[field.key] !== false;
        }
        return config[field.key] || field.fallback || '';
    }

    /**
     * @param {AuthFieldSpec} field
     * @param {*} value
     * @returns {void}
     */
    _revealGroup(field, value) {
        if (!field.reveals || !value) {
            return;
        }
        const group = this._el(field.reveals);
        if (group) {
            group.classList.remove('u-hidden');
        }
    }

    /**
     * @param {string} type
     * @param {Object<string, Function>} [hooks]
     * @returns {void}
     */
    _bindFields(type, hooks = {}) {
        const fields = AUTH_FIELDS[type] || [];
        const { config } = this.currentAuthConfig;

        fields.forEach((field) => {
            if (field.seed && !config[field.key]) {
                config[field.key] = field.fallback;
            }

            const element = this._el(field.id);
            if (!element) {
                return;
            }

            const prop = field.prop || 'value';
            element[prop] = this._fieldValue(field, config);
            this._revealGroup(field, element[prop]);

            const hook = hooks[field.id];
            if (hook) {
                hook(element[prop], element);
            }

            element.addEventListener(field.event || 'input', (e) => {
                const next = prop === 'checked' ? e.target.checked : e.target.value;
                this.currentAuthConfig.config[field.key] = next;
                if (hook) {
                    hook(next, e.target);
                }
            });
        });
    }

    /**
     * @param {string} type
     * @param {Object} config
     * @returns {void}
     */
    _populateFields(type, config) {
        const fields = AUTH_FIELDS[type] || [];
        const pending = [];

        fields.forEach((field) => {
            const prop = field.prop || 'value';
            if (prop !== 'checked' && !config[field.key]) {
                return;
            }

            const element = this._el(field.id);
            if (!element) {
                return;
            }

            element[prop] = this._fieldValue(field, config);
            this._revealGroup(field, element[prop]);

            if (field.dispatch) {
                pending.push([element, field.dispatch]);
            }
        });

        pending.forEach(([element, eventName]) => {
            element.dispatchEvent(new Event(eventName));
        });
    }

    /**
     * @param {string} templateId
     * @returns {DocumentFragment}
     */
    _cloneAuthTemplate(templateId) {
        const fragment = templateLoader.cloneSync(
            './src/templates/auth/authFields.html',
            templateId
        );
        if (this.idPrefix) {
            fragment.querySelectorAll('[id]').forEach((el) => {
                el.id = this.idPrefix + el.id;
            });
            fragment.querySelectorAll('label[for]').forEach((el) => {
                el.setAttribute('for', this.idPrefix + el.getAttribute('for'));
            });
        }
        return fragment;
    }

    /** @returns {void} */
    initializeEventListeners() {
        if (this.authTypeSelect) {
            this.authTypeSelect.addEventListener('change', (e) => {
                this.handleAuthTypeChange(e.target.value);
            });
        }
    }

    /**
     * @param {string} authType
     * @returns {void}
     */
    handleAuthTypeChange(authType) {
        this.currentAuthConfig.type = authType;
        this.currentAuthConfig.config = {};
        this.renderAuthFields(authType);
    }

    /**
     * @param {string} authType
     * @returns {void}
     */
    renderAuthFields(authType) {
        if (!this.authFieldsContainer) {return;}

        this.authFieldsContainer.innerHTML = '';

        switch (authType) {
            case 'none':
                break;

            case 'inherit':
                this.renderInheritFields();
                break;

            case 'bearer':
                this.renderBearerTokenFields();
                break;

            case 'basic':
                this.renderBasicAuthFields();
                break;

            case 'api-key':
                this.renderApiKeyFields();
                break;

            case 'oauth2':
                this.renderOAuth2Fields();
                break;

            case 'digest':
                this.renderDigestAuthFields();
                break;

            case 'ntlm':
                this.renderNtlmFields();
                break;

            case 'aws-v4':
                this.renderAwsV4Fields();
                break;

            default:
                break;
        }
    }

    /** @returns {void} */
    renderInheritFields() {
        const fragment = this._cloneAuthTemplate('tpl-auth-inherit');
        this.authFieldsContainer.innerHTML = '';
        this.authFieldsContainer.appendChild(fragment);

        const summary = this._el('inherit-auth-summary');
        const editButton = this._el('inherit-edit-collection-auth');

        if (summary && this.inheritSummary) {
            summary.textContent = this.inheritSummary;
        }

        if (typeof this.getInheritedAuthInfo === 'function') {
            Promise.resolve(this.getInheritedAuthInfo()).then((info) => {
                if (!summary || !summary.isConnected) {
                    return;
                }
                if (info === null) {
                    return;
                }
                const source = info.folderName
                    ? `folder "${info.folderName}"`
                    : (info.collectionName ? `collection "${info.collectionName}"` : 'the collection');
                if (!info.authType || info.authType === 'none') {
                    summary.textContent = info.folderName
                        ? `Folder "${info.folderName}" opts out of collection auth — this request is sent unauthenticated.`
                        : (info.collectionName
                            ? `Collection "${info.collectionName}" has no auth configured — this request is sent unauthenticated.`
                            : 'The collection has no auth configured — this request is sent unauthenticated.');
                } else {
                    summary.textContent = `Inheriting ${this.getAuthTypeLabel(info.authType)} from ${source}.`;
                }
                if (editButton && typeof this.onOpenCollectionAuth === 'function' && info.collectionId) {
                    editButton.hidden = false;
                    editButton.textContent = info.folderName ? 'Edit folder auth' : 'Edit collection auth';
                    editButton.addEventListener('click', () => {
                        this.onOpenCollectionAuth(info.collectionId, info.folderId || null);
                    });
                }
            }).catch(() => {});
        }
    }

    /**
     * @param {string} type
     * @returns {string}
     */
    getAuthTypeLabel(type) {
        const labels = {
            none: 'No Auth',
            inherit: 'Inherit from Parent',
            bearer: 'Bearer Token',
            basic: 'Basic Auth',
            'api-key': 'API Key',
            oauth2: 'OAuth 2.0',
            digest: 'Digest Auth',
            ntlm: 'NTLM',
            'aws-v4': 'AWS Signature'
        };
        return labels[type] || type;
    }

    /** @returns {void} */
    renderBearerTokenFields() {
        const fragment = this._cloneAuthTemplate('tpl-auth-bearer');
        this.authFieldsContainer.innerHTML = '';
        this.authFieldsContainer.appendChild(fragment);

        this._bindFields('bearer');
    }

    /** @returns {void} */
    renderBasicAuthFields() {
        const fragment = this._cloneAuthTemplate('tpl-auth-basic');
        this.authFieldsContainer.innerHTML = '';
        this.authFieldsContainer.appendChild(fragment);

        this._bindFields('basic');
    }

    /** @returns {void} */
    renderApiKeyFields() {
        const fragment = this._cloneAuthTemplate('tpl-auth-api-key');
        this.authFieldsContainer.innerHTML = '';
        this.authFieldsContainer.appendChild(fragment);

        this._bindFields('api-key');
    }

    /** @returns {void} */
    renderOAuth2Fields() {
        const fragment = this._cloneAuthTemplate('tpl-auth-oauth2');
        this.authFieldsContainer.innerHTML = '';
        this.authFieldsContainer.appendChild(fragment);

        const tokenInput = this._el('oauth2-token');
        const getTokenBtn = this._el('oauth2-get-token-btn');
        const refreshBtn = this._el('oauth2-refresh-btn');

        const authUrlGroup = this._el('oauth2-auth-url-group');
        const usernamePasswordPairGroup = this._el('oauth2-username-password-pair');
        const redirectUriGroup = this._el('oauth2-redirect-uri-group');
        const pkceGroup = this._el('oauth2-pkce-group');
        const tokenUrlGroup = this._el('oauth2-token-url-group');
        const credentialsPairGroup = this._el('oauth2-credentials-pair');
        const scopeGroup = this._el('oauth2-scope-group');
        const audienceGroup = this._el('oauth2-audience-group');
        const clientAuthGroup = this._el('oauth2-client-auth-group');
        const getTokenGroup = this._el('oauth2-get-token-group');
        const errorGroup = this._el('oauth2-error-group');
        const errorMessage = this._el('oauth2-error-message');

        const updateGrantTypeUI = (grantType) => {
            [authUrlGroup, usernamePasswordPairGroup, redirectUriGroup, pkceGroup].forEach(g => {
                if (g) {g.classList.add('u-hidden');}
            });

            if (grantType === 'authorization_code') {
                if (authUrlGroup) {authUrlGroup.classList.remove('u-hidden');}
                if (redirectUriGroup) {redirectUriGroup.classList.remove('u-hidden');}
                if (pkceGroup) {pkceGroup.classList.remove('u-hidden');}
            } else if (grantType === 'password') {
                if (usernamePasswordPairGroup) {usernamePasswordPairGroup.classList.remove('u-hidden');}
            } else if (grantType === 'manual') {
                [tokenUrlGroup, credentialsPairGroup, scopeGroup,
                 audienceGroup, clientAuthGroup, getTokenGroup].forEach(g => {
                    if (g) {g.classList.add('u-hidden');}
                });
                if (tokenInput) {tokenInput.removeAttribute('readonly');}
                return;
            }

            [tokenUrlGroup, credentialsPairGroup, scopeGroup,
             audienceGroup, clientAuthGroup, getTokenGroup].forEach(g => {
                if (g) {g.classList.remove('u-hidden');}
            });
            if (tokenInput) {tokenInput.setAttribute('readonly', 'readonly');}
        };

        this._bindFields('oauth2', {
            'oauth2-grant-type': (grantType) => updateGrantTypeUI(grantType)
        });

        if (getTokenBtn) {
            getTokenBtn.addEventListener('click', async () => {
                await this._handleGetToken(errorGroup, errorMessage);
            });
        }

        if (refreshBtn) {
            refreshBtn.addEventListener('click', async () => {
                await this._handleRefreshToken(errorGroup, errorMessage);
            });
        }
    }

    /**
     * @param {HTMLElement} errorGroup
     * @param {HTMLElement} errorMessage
     * @returns {Promise<void>}
     */
    async _handleGetToken(errorGroup, errorMessage) {
        const {config} = this.currentAuthConfig;
        const grantType = config.grantType || 'client_credentials';

        if (errorGroup) {errorGroup.classList.add('u-hidden');}

        const getTokenText = this._el('oauth2-get-token-text');
        const getTokenLoading = this._el('oauth2-get-token-loading');
        if (getTokenText) {getTokenText.classList.add('u-hidden');}
        if (getTokenLoading) {getTokenLoading.classList.remove('u-hidden');}

        try {
            if (grantType === 'authorization_code') {
                await this._handleAuthorizationCodeFlow();
            } else {
                const tokenConfig = {
                    grantType: grantType,
                    tokenUrl: config.tokenUrl,
                    clientId: config.clientId,
                    clientSecret: config.clientSecret || null,
                    scope: config.scope || null,
                    audience: config.audience || null,
                    clientAuthMethod: config.clientAuthMethod || 'body'
                };

                if (grantType === 'password') {
                    tokenConfig.username = config.username;
                    tokenConfig.password = config.password;
                }

                const result = await api.oauth2.getToken(tokenConfig);
                this._handleTokenResponse(result, errorGroup, errorMessage);
            }
        } catch (error) {
            this._showError(errorGroup, errorMessage, error.message || 'Failed to get token');
        } finally {
            if (getTokenText) {getTokenText.classList.remove('u-hidden');}
            if (getTokenLoading) {getTokenLoading.classList.add('u-hidden');}
        }
    }

    /** @returns {Promise<void>} */
    async _handleAuthorizationCodeFlow() {
        const {config} = this.currentAuthConfig;

        const state = await api.oauth2.generateState();

        let pkceParams = null;
        if (config.usePkce !== false) {
            pkceParams = await api.oauth2.generatePkce();
            await api.oauth2.storePkceVerifier(state, pkceParams.codeVerifier);
        }

        const authUrlParams = {
            authorizationUrl: config.authorizationUrl,
            clientId: config.clientId,
            redirectUri: config.redirectUri || 'http://localhost:8080/callback',
            scope: config.scope || null,
            state: state,
            audience: config.audience || null
        };

        if (pkceParams) {
            authUrlParams.codeChallenge = pkceParams.codeChallenge;
            authUrlParams.codeChallengeMethod = pkceParams.codeChallengeMethod;
        }

        const authUrl = await api.oauth2.buildAuthorizationUrl(authUrlParams);

        this.currentAuthConfig.config._pendingState = state;
        this.currentAuthConfig.config._pendingPkce = pkceParams;

        window.open(authUrl, '_blank', 'width=600,height=700');

        this._showAuthCodeInstructions();
    }

    /** @returns {void} */
    _showAuthCodeInstructions() {
        const errorGroup = this._el('oauth2-error-group');
        const errorMessage = this._el('oauth2-error-message');

        if (errorGroup && errorMessage) {
            errorGroup.classList.remove('u-hidden');
            errorMessage.className = 'alert alert-info';
            errorMessage.innerHTML = `
                <strong>Authorization Required</strong><br>
                A browser window has opened for you to authorize the application.<br>
                After authorizing, you will be redirected. Copy the authorization code from the URL and paste it below:<br>
                <input type="text" id="${this.idPrefix}oauth2-auth-code-input" class="input-base form-input u-mt-2" placeholder="Paste authorization code here">
                <button type="button" id="${this.idPrefix}oauth2-exchange-code-btn" class="btn btn-primary btn-sm u-mt-2">Exchange Code for Token</button>
            `;

            const exchangeBtn = this._el('oauth2-exchange-code-btn');
            if (exchangeBtn) {
                exchangeBtn.addEventListener('click', async () => {
                    const codeInput = this._el('oauth2-auth-code-input');
                    if (codeInput && codeInput.value) {
                        await this._exchangeAuthorizationCode(codeInput.value);
                    }
                });
            }
        }
    }

    /**
     * @param {string} code
     * @returns {Promise<void>}
     */
    async _exchangeAuthorizationCode(code) {
        const {config} = this.currentAuthConfig;
        const errorGroup = this._el('oauth2-error-group');
        const errorMessage = this._el('oauth2-error-message');

        try {
            let codeVerifier = null;
            if (config._pendingState && config.usePkce !== false) {
                codeVerifier = await api.oauth2.getPkceVerifier(config._pendingState);
            }

            const tokenConfig = {
                grantType: 'authorization_code',
                tokenUrl: config.tokenUrl,
                clientId: config.clientId,
                clientSecret: config.clientSecret || null,
                authorizationCode: code,
                redirectUri: config.redirectUri || 'http://localhost:8080/callback',
                codeVerifier: codeVerifier,
                clientAuthMethod: config.clientAuthMethod || 'body'
            };

            const result = await api.oauth2.getToken(tokenConfig);
            this._handleTokenResponse(result, errorGroup, errorMessage);

            delete config._pendingState;
            delete config._pendingPkce;
        } catch (error) {
            this._showError(errorGroup, errorMessage, error.message || 'Failed to exchange code');
        }
    }

    /**
     * @param {HTMLElement} errorGroup
     * @param {HTMLElement} errorMessage
     * @returns {Promise<void>}
     */
    async _handleRefreshToken(errorGroup, errorMessage) {
        const {config} = this.currentAuthConfig;

        if (!config.refreshToken) {
            this._showError(errorGroup, errorMessage, 'No refresh token available');
            return;
        }

        try {
            const tokenConfig = {
                grantType: 'refresh_token',
                tokenUrl: config.tokenUrl,
                clientId: config.clientId,
                clientSecret: config.clientSecret || null,
                refreshToken: config.refreshToken,
                clientAuthMethod: config.clientAuthMethod || 'body'
            };

            const result = await api.oauth2.getToken(tokenConfig);
            this._handleTokenResponse(result, errorGroup, errorMessage);
        } catch (error) {
            this._showError(errorGroup, errorMessage, error.message || 'Failed to refresh token');
        }
    }

    /**
     * @param {Object} result
     * @param {HTMLElement} errorGroup
     * @param {HTMLElement} errorMessage
     * @returns {void}
     */
    _handleTokenResponse(result, errorGroup, errorMessage) {
        if (result.success && result.accessToken) {
            this.currentAuthConfig.config.token = result.accessToken;

            const tokenInput = this._el('oauth2-token');
            if (tokenInput) {tokenInput.value = result.accessToken;}

            const tokenType = this._el('oauth2-token-type');
            if (tokenType && result.tokenType) {
                tokenType.textContent = result.tokenType;
                tokenType.classList.remove('u-hidden');
            }

            const tokenExpires = this._el('oauth2-token-expires');
            if (tokenExpires && result.expiresIn) {
                const expiresAt = new Date(Date.now() + result.expiresIn * 1000);
                tokenExpires.textContent = `Expires: ${expiresAt.toLocaleTimeString()}`;
                tokenExpires.classList.remove('u-hidden');
                this.currentAuthConfig.config.expiresAt = expiresAt.getTime();
            }

            if (result.refreshToken) {
                this.currentAuthConfig.config.refreshToken = result.refreshToken;
                const refreshTokenInput = this._el('oauth2-refresh-token');
                const refreshTokenGroup = this._el('oauth2-refresh-token-group');
                if (refreshTokenInput) {refreshTokenInput.value = result.refreshToken;}
                if (refreshTokenGroup) {refreshTokenGroup.classList.remove('u-hidden');}
            }

            if (errorGroup) {errorGroup.classList.add('u-hidden');}
        } else {
            const errorDesc = result.errorDescription || result.error || 'Unknown error';
            this._showError(errorGroup, errorMessage, errorDesc);
        }
    }

    /**
     * @param {HTMLElement} errorGroup
     * @param {HTMLElement} errorMessage
     * @param {string} message
     * @returns {void}
     */
    _showError(errorGroup, errorMessage, message) {
        if (errorGroup && errorMessage) {
            errorGroup.classList.remove('u-hidden');
            errorMessage.className = 'alert alert-error';
            errorMessage.textContent = message;
        }
    }

    /** @returns {void} */
    renderDigestAuthFields() {
        const fragment = this._cloneAuthTemplate('tpl-auth-digest');
        this.authFieldsContainer.innerHTML = '';
        this.authFieldsContainer.appendChild(fragment);

        this._bindFields('digest');
    }

    /** @returns {void} */
    renderNtlmFields() {
        const fragment = this._cloneAuthTemplate('tpl-auth-ntlm');
        this.authFieldsContainer.innerHTML = '';
        this.authFieldsContainer.appendChild(fragment);

        this._bindFields('ntlm');
    }

    /** @returns {void} */
    renderAwsV4Fields() {
        const fragment = this._cloneAuthTemplate('tpl-auth-aws-v4');
        this.authFieldsContainer.innerHTML = '';
        this.authFieldsContainer.appendChild(fragment);

        this._bindFields('aws-v4');
    }

    /**
     * @param {Object} [authConfig]
     * @returns {Object}
     */
    generateAuthData(authConfig = this.currentAuthConfig) {
        return generateAuthData(authConfig);
    }

    /**
     * @param {Object} authConfig
     * @param {string} authConfig.type
     * @param {Object} authConfig.config
     * @returns {void}
     */
    loadAuthConfig(authConfig) {
        if (!authConfig) {
            authConfig = { type: 'none', config: {} };
        }

        this.currentAuthConfig = authConfig;

        if (this.authTypeSelect) {
            this.authTypeSelect.value = authConfig.type || 'none';
        }

        this.renderAuthFields(authConfig.type || 'none');

        this.populateAuthFields(authConfig);
    }

    /**
     * @param {Object} authConfig
     * @returns {void}
     */
    populateAuthFields(authConfig) {
        const { type, config } = authConfig;

        if (!config) {return;}

        this._populateFields(type, config);
    }

    /** @returns {Object} */
    getAuthConfig() {
        return this.currentAuthConfig;
    }

}

export const authManager = new AuthManager();
