/**
 * @fileoverview Authentication manager for handling multiple authentication methods
 * @module modules/authManager
 */

/**
 * Manages authentication configuration for API requests
 *
 * @class
 * @classdesc Handles multiple authentication types including Bearer, Basic Auth,
 * API Key, OAuth2, and Digest authentication. Provides UI for configuring and
 * managing authentication credentials.
 */
import { templateLoader } from './templateLoader.js';
import { api } from './ipcBridge.js';

export class AuthManager {
    /**
     * Creates an AuthManager instance
     */
    constructor() {
        this.authTypeSelect = document.getElementById('auth-type-select');
        this.authFieldsContainer = document.getElementById('auth-fields-container');
        this.currentAuthConfig = {
            type: 'none',
            config: {}
        };

        this.initializeEventListeners();
    }

    /**
     * Initializes event listeners for authentication controls
     *
     * @private
     * @returns {void}
     */
    initializeEventListeners() {
        if (this.authTypeSelect) {
            this.authTypeSelect.addEventListener('change', (e) => {
                this.handleAuthTypeChange(e.target.value);
            });
        }
    }

    /**
     * Handles authentication type change
     *
     * @param {string} authType - The selected authentication type
     * @returns {void}
     */
    handleAuthTypeChange(authType) {
        this.currentAuthConfig.type = authType;
        this.currentAuthConfig.config = {};
        this.renderAuthFields(authType);
    }

    /**
     * Renders authentication fields based on selected type
     *
     * @param {string} authType - The authentication type ('none', 'bearer', 'basic', 'api-key', 'oauth2', 'digest')
     * @returns {void}
     */
    renderAuthFields(authType) {
        if (!this.authFieldsContainer) {return;}

        this.authFieldsContainer.innerHTML = '';

        switch (authType) {
            case 'none':
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

            default:
                break;
        }
    }

    /**
     * Renders Bearer token authentication fields
     *
     * @private
     * @returns {void}
     */
    renderBearerTokenFields() {
        const defaultToken = this.currentAuthConfig.config.token || '{{bearerToken}}';

        const fragment = templateLoader.cloneSync(
            './src/templates/auth/authFields.html',
            'tpl-auth-bearer'
        );
        this.authFieldsContainer.innerHTML = '';
        this.authFieldsContainer.appendChild(fragment);

        const tokenInput = document.getElementById('bearer-token');
        if (tokenInput) {
            tokenInput.value = defaultToken;
            this.currentAuthConfig.config.token = tokenInput.value;

            tokenInput.addEventListener('input', (e) => {
                this.currentAuthConfig.config.token = e.target.value;
            });
        }
    }

    /**
     * Renders Basic authentication fields
     *
     * @private
     * @returns {void}
     */
    renderBasicAuthFields() {
        const fragment = templateLoader.cloneSync(
            './src/templates/auth/authFields.html',
            'tpl-auth-basic'
        );
        this.authFieldsContainer.innerHTML = '';
        this.authFieldsContainer.appendChild(fragment);

        const usernameInput = document.getElementById('basic-username');
        const passwordInput = document.getElementById('basic-password');

        if (usernameInput) {
            usernameInput.addEventListener('input', (e) => {
                this.currentAuthConfig.config.username = e.target.value;
            });
        }

        if (passwordInput) {
            passwordInput.addEventListener('input', (e) => {
                this.currentAuthConfig.config.password = e.target.value;
            });
        }
    }

    /**
     * Renders API Key authentication fields
     *
     * @private
     * @returns {void}
     */
    renderApiKeyFields() {
        const fragment = templateLoader.cloneSync(
            './src/templates/auth/authFields.html',
            'tpl-auth-api-key'
        );
        this.authFieldsContainer.innerHTML = '';
        this.authFieldsContainer.appendChild(fragment);

        const keyNameInput = document.getElementById('api-key-name');
        const keyValueInput = document.getElementById('api-key-value');
        const keyLocationSelect = document.getElementById('api-key-location');

        if (keyNameInput) {
            keyNameInput.addEventListener('input', (e) => {
                this.currentAuthConfig.config.keyName = e.target.value;
            });
        }

        if (keyValueInput) {
            keyValueInput.addEventListener('input', (e) => {
                this.currentAuthConfig.config.keyValue = e.target.value;
            });
        }

        if (keyLocationSelect) {
            keyLocationSelect.addEventListener('change', (e) => {
                this.currentAuthConfig.config.location = e.target.value;
            });
            this.currentAuthConfig.config.location = 'header';
        }
    }

    /**
     * Renders OAuth2 authentication fields
     *
     * @private
     * @returns {void}
     */
    renderOAuth2Fields() {
        const fragment = templateLoader.cloneSync(
            './src/templates/auth/authFields.html',
            'tpl-auth-oauth2'
        );
        this.authFieldsContainer.innerHTML = '';
        this.authFieldsContainer.appendChild(fragment);

        // Initialize default config values
        if (!this.currentAuthConfig.config.grantType) {
            this.currentAuthConfig.config.grantType = 'client_credentials';
        }
        if (!this.currentAuthConfig.config.headerPrefix) {
            this.currentAuthConfig.config.headerPrefix = 'Bearer';
        }
        if (!this.currentAuthConfig.config.clientAuthMethod) {
            this.currentAuthConfig.config.clientAuthMethod = 'body';
        }

        // Get all elements
        const grantTypeSelect = document.getElementById('oauth2-grant-type');
        const tokenUrlInput = document.getElementById('oauth2-token-url');
        const authUrlInput = document.getElementById('oauth2-auth-url');
        const clientIdInput = document.getElementById('oauth2-client-id');
        const clientSecretInput = document.getElementById('oauth2-client-secret');
        const usernameInput = document.getElementById('oauth2-username');
        const passwordInput = document.getElementById('oauth2-password');
        const redirectUriInput = document.getElementById('oauth2-redirect-uri');
        const scopeInput = document.getElementById('oauth2-scope');
        const audienceInput = document.getElementById('oauth2-audience');
        const usePkceCheckbox = document.getElementById('oauth2-use-pkce');
        const clientAuthSelect = document.getElementById('oauth2-client-auth');
        const getTokenBtn = document.getElementById('oauth2-get-token-btn');
        const refreshBtn = document.getElementById('oauth2-refresh-btn');
        const tokenInput = document.getElementById('oauth2-token');
        const prefixInput = document.getElementById('oauth2-header-prefix');

        // Group elements for visibility toggling
        const authUrlGroup = document.getElementById('oauth2-auth-url-group');
        const usernameGroup = document.getElementById('oauth2-username-group');
        const passwordGroup = document.getElementById('oauth2-password-group');
        const redirectUriGroup = document.getElementById('oauth2-redirect-uri-group');
        const pkceGroup = document.getElementById('oauth2-pkce-group');
        const tokenUrlGroup = document.getElementById('oauth2-token-url-group');
        const clientIdGroup = document.getElementById('oauth2-client-id-group');
        const clientSecretGroup = document.getElementById('oauth2-client-secret-group');
        const scopeGroup = document.getElementById('oauth2-scope-group');
        const audienceGroup = document.getElementById('oauth2-audience-group');
        const clientAuthGroup = document.getElementById('oauth2-client-auth-group');
        const getTokenGroup = document.getElementById('oauth2-get-token-group');
        const errorGroup = document.getElementById('oauth2-error-group');
        const errorMessage = document.getElementById('oauth2-error-message');

        // Update UI visibility based on grant type
        const updateGrantTypeUI = (grantType) => {
            // Hide all optional groups first
            [authUrlGroup, usernameGroup, passwordGroup, redirectUriGroup, pkceGroup].forEach(g => {
                if (g) {g.classList.add('u-hidden');}
            });

            // Show/hide based on grant type
            if (grantType === 'authorization_code') {
                if (authUrlGroup) {authUrlGroup.classList.remove('u-hidden');}
                if (redirectUriGroup) {redirectUriGroup.classList.remove('u-hidden');}
                if (pkceGroup) {pkceGroup.classList.remove('u-hidden');}
            } else if (grantType === 'password') {
                if (usernameGroup) {usernameGroup.classList.remove('u-hidden');}
                if (passwordGroup) {passwordGroup.classList.remove('u-hidden');}
            } else if (grantType === 'manual') {
                // Hide most fields for manual token entry
                [tokenUrlGroup, clientIdGroup, clientSecretGroup, scopeGroup, 
                 audienceGroup, clientAuthGroup, getTokenGroup].forEach(g => {
                    if (g) {g.classList.add('u-hidden');}
                });
                // Make token input editable
                if (tokenInput) {tokenInput.removeAttribute('readonly');}
                return;
            }

            // For non-manual modes, show standard fields and make token readonly
            [tokenUrlGroup, clientIdGroup, clientSecretGroup, scopeGroup, 
             audienceGroup, clientAuthGroup, getTokenGroup].forEach(g => {
                if (g) {g.classList.remove('u-hidden');}
            });
            if (tokenInput) {tokenInput.setAttribute('readonly', 'readonly');}
        };

        // Grant type change handler
        if (grantTypeSelect) {
            grantTypeSelect.value = this.currentAuthConfig.config.grantType || 'client_credentials';
            updateGrantTypeUI(grantTypeSelect.value);

            grantTypeSelect.addEventListener('change', (e) => {
                this.currentAuthConfig.config.grantType = e.target.value;
                updateGrantTypeUI(e.target.value);
            });
        }

        // Input event handlers
        if (tokenUrlInput) {
            tokenUrlInput.value = this.currentAuthConfig.config.tokenUrl || '';
            tokenUrlInput.addEventListener('input', (e) => {
                this.currentAuthConfig.config.tokenUrl = e.target.value;
            });
        }

        if (authUrlInput) {
            authUrlInput.value = this.currentAuthConfig.config.authorizationUrl || '';
            authUrlInput.addEventListener('input', (e) => {
                this.currentAuthConfig.config.authorizationUrl = e.target.value;
            });
        }

        if (clientIdInput) {
            clientIdInput.value = this.currentAuthConfig.config.clientId || '';
            clientIdInput.addEventListener('input', (e) => {
                this.currentAuthConfig.config.clientId = e.target.value;
            });
        }

        if (clientSecretInput) {
            clientSecretInput.value = this.currentAuthConfig.config.clientSecret || '';
            clientSecretInput.addEventListener('input', (e) => {
                this.currentAuthConfig.config.clientSecret = e.target.value;
            });
        }

        if (usernameInput) {
            usernameInput.value = this.currentAuthConfig.config.username || '';
            usernameInput.addEventListener('input', (e) => {
                this.currentAuthConfig.config.username = e.target.value;
            });
        }

        if (passwordInput) {
            passwordInput.value = this.currentAuthConfig.config.password || '';
            passwordInput.addEventListener('input', (e) => {
                this.currentAuthConfig.config.password = e.target.value;
            });
        }

        if (redirectUriInput) {
            redirectUriInput.value = this.currentAuthConfig.config.redirectUri || 'http://localhost:8080/callback';
            redirectUriInput.addEventListener('input', (e) => {
                this.currentAuthConfig.config.redirectUri = e.target.value;
            });
        }

        if (scopeInput) {
            scopeInput.value = this.currentAuthConfig.config.scope || '';
            scopeInput.addEventListener('input', (e) => {
                this.currentAuthConfig.config.scope = e.target.value;
            });
        }

        if (audienceInput) {
            audienceInput.value = this.currentAuthConfig.config.audience || '';
            audienceInput.addEventListener('input', (e) => {
                this.currentAuthConfig.config.audience = e.target.value;
            });
        }

        if (usePkceCheckbox) {
            usePkceCheckbox.checked = this.currentAuthConfig.config.usePkce !== false;
            usePkceCheckbox.addEventListener('change', (e) => {
                this.currentAuthConfig.config.usePkce = e.target.checked;
            });
        }

        if (clientAuthSelect) {
            clientAuthSelect.value = this.currentAuthConfig.config.clientAuthMethod || 'body';
            clientAuthSelect.addEventListener('change', (e) => {
                this.currentAuthConfig.config.clientAuthMethod = e.target.value;
            });
        }

        if (tokenInput) {
            tokenInput.value = this.currentAuthConfig.config.token || '';
            tokenInput.addEventListener('input', (e) => {
                this.currentAuthConfig.config.token = e.target.value;
            });
        }

        if (prefixInput) {
            prefixInput.value = this.currentAuthConfig.config.headerPrefix || 'Bearer';
            prefixInput.addEventListener('input', (e) => {
                this.currentAuthConfig.config.headerPrefix = e.target.value;
            });
        }

        // Get Token button handler
        if (getTokenBtn) {
            getTokenBtn.addEventListener('click', async () => {
                await this._handleGetToken(errorGroup, errorMessage);
            });
        }

        // Refresh Token button handler
        if (refreshBtn) {
            refreshBtn.addEventListener('click', async () => {
                await this._handleRefreshToken(errorGroup, errorMessage);
            });
        }
    }

    /**
     * Handles the "Get New Access Token" button click
     *
     * @private
     * @async
     * @param {HTMLElement} errorGroup - Error display group element
     * @param {HTMLElement} errorMessage - Error message element
     * @returns {Promise<void>}
     */
    async _handleGetToken(errorGroup, errorMessage) {
        const {config} = this.currentAuthConfig;
        const grantType = config.grantType || 'client_credentials';

        // Hide any previous errors
        if (errorGroup) {errorGroup.classList.add('u-hidden');}

        // Show loading state
        const getTokenText = document.getElementById('oauth2-get-token-text');
        const getTokenLoading = document.getElementById('oauth2-get-token-loading');
        if (getTokenText) {getTokenText.classList.add('u-hidden');}
        if (getTokenLoading) {getTokenLoading.classList.remove('u-hidden');}

        try {
            if (grantType === 'authorization_code') {
                await this._handleAuthorizationCodeFlow();
            } else {
                // Client credentials or password grant
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
            // Reset loading state
            if (getTokenText) {getTokenText.classList.remove('u-hidden');}
            if (getTokenLoading) {getTokenLoading.classList.add('u-hidden');}
        }
    }

    /**
     * Handles the Authorization Code flow
     *
     * @private
     * @async
     * @returns {Promise<void>}
     */
    async _handleAuthorizationCodeFlow() {
        const {config} = this.currentAuthConfig;

        // Generate state for CSRF protection
        const state = await api.oauth2.generateState();

        // Generate PKCE if enabled
        let pkceParams = null;
        if (config.usePkce !== false) {
            pkceParams = await api.oauth2.generatePkce();
            // Store the verifier for later use
            await api.oauth2.storePkceVerifier(state, pkceParams.codeVerifier);
        }

        // Build authorization URL
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

        // Store state in config for callback handling
        this.currentAuthConfig.config._pendingState = state;
        this.currentAuthConfig.config._pendingPkce = pkceParams;

        // Open authorization URL in browser
        window.open(authUrl, '_blank', 'width=600,height=700');

        // Show instructions to user
        this._showAuthCodeInstructions();
    }

    /**
     * Shows instructions for completing authorization code flow
     *
     * @private
     * @returns {void}
     */
    _showAuthCodeInstructions() {
        const errorGroup = document.getElementById('oauth2-error-group');
        const errorMessage = document.getElementById('oauth2-error-message');

        if (errorGroup && errorMessage) {
            errorGroup.classList.remove('u-hidden');
            errorMessage.className = 'alert alert-info';
            errorMessage.innerHTML = `
                <strong>Authorization Required</strong><br>
                A browser window has opened for you to authorize the application.<br>
                After authorizing, you will be redirected. Copy the authorization code from the URL and paste it below:<br>
                <input type="text" id="oauth2-auth-code-input" class="input-base form-input u-mt-2" placeholder="Paste authorization code here">
                <button type="button" id="oauth2-exchange-code-btn" class="btn btn-primary btn-sm u-mt-2">Exchange Code for Token</button>
            `;

            // Add handler for code exchange
            const exchangeBtn = document.getElementById('oauth2-exchange-code-btn');
            if (exchangeBtn) {
                exchangeBtn.addEventListener('click', async () => {
                    const codeInput = document.getElementById('oauth2-auth-code-input');
                    if (codeInput && codeInput.value) {
                        await this._exchangeAuthorizationCode(codeInput.value);
                    }
                });
            }
        }
    }

    /**
     * Exchanges authorization code for tokens
     *
     * @private
     * @async
     * @param {string} code - The authorization code
     * @returns {Promise<void>}
     */
    async _exchangeAuthorizationCode(code) {
        const {config} = this.currentAuthConfig;
        const errorGroup = document.getElementById('oauth2-error-group');
        const errorMessage = document.getElementById('oauth2-error-message');

        try {
            // Get stored PKCE verifier if used
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

            // Clean up pending state
            delete config._pendingState;
            delete config._pendingPkce;
        } catch (error) {
            this._showError(errorGroup, errorMessage, error.message || 'Failed to exchange code');
        }
    }

    /**
     * Handles the refresh token flow
     *
     * @private
     * @async
     * @param {HTMLElement} errorGroup - Error display group element
     * @param {HTMLElement} errorMessage - Error message element
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
     * Handles the token response from OAuth 2.0 server
     *
     * @private
     * @param {Object} result - Token response
     * @param {HTMLElement} errorGroup - Error display group element
     * @param {HTMLElement} errorMessage - Error message element
     * @returns {void}
     */
    _handleTokenResponse(result, errorGroup, errorMessage) {
        if (result.success && result.accessToken) {
            // Update config with new token
            this.currentAuthConfig.config.token = result.accessToken;

            // Update UI
            const tokenInput = document.getElementById('oauth2-token');
            if (tokenInput) {tokenInput.value = result.accessToken;}

            // Handle token type
            const tokenType = document.getElementById('oauth2-token-type');
            if (tokenType && result.tokenType) {
                tokenType.textContent = result.tokenType;
                tokenType.classList.remove('u-hidden');
            }

            // Handle expiration
            const tokenExpires = document.getElementById('oauth2-token-expires');
            if (tokenExpires && result.expiresIn) {
                const expiresAt = new Date(Date.now() + result.expiresIn * 1000);
                tokenExpires.textContent = `Expires: ${expiresAt.toLocaleTimeString()}`;
                tokenExpires.classList.remove('u-hidden');
                this.currentAuthConfig.config.expiresAt = expiresAt.getTime();
            }

            // Handle refresh token
            if (result.refreshToken) {
                this.currentAuthConfig.config.refreshToken = result.refreshToken;
                const refreshTokenInput = document.getElementById('oauth2-refresh-token');
                const refreshTokenGroup = document.getElementById('oauth2-refresh-token-group');
                if (refreshTokenInput) {refreshTokenInput.value = result.refreshToken;}
                if (refreshTokenGroup) {refreshTokenGroup.classList.remove('u-hidden');}
            }

            // Hide error group
            if (errorGroup) {errorGroup.classList.add('u-hidden');}
        } else {
            const errorDesc = result.errorDescription || result.error || 'Unknown error';
            this._showError(errorGroup, errorMessage, errorDesc);
        }
    }

    /**
     * Shows an error message in the OAuth 2.0 UI
     *
     * @private
     * @param {HTMLElement} errorGroup - Error display group element
     * @param {HTMLElement} errorMessage - Error message element
     * @param {string} message - Error message to display
     * @returns {void}
     */
    _showError(errorGroup, errorMessage, message) {
        if (errorGroup && errorMessage) {
            errorGroup.classList.remove('u-hidden');
            errorMessage.className = 'alert alert-error';
            errorMessage.textContent = message;
        }
    }

    /**
     * Renders Digest authentication fields
     *
     * @private
     * @returns {void}
     */
    renderDigestAuthFields() {
        const fragment = templateLoader.cloneSync(
            './src/templates/auth/authFields.html',
            'tpl-auth-digest'
        );
        this.authFieldsContainer.innerHTML = '';
        this.authFieldsContainer.appendChild(fragment);

        const usernameInput = document.getElementById('digest-username');
        const passwordInput = document.getElementById('digest-password');

        if (usernameInput) {
            usernameInput.addEventListener('input', (e) => {
                this.currentAuthConfig.config.username = e.target.value;
            });
        }

        if (passwordInput) {
            passwordInput.addEventListener('input', (e) => {
                this.currentAuthConfig.config.password = e.target.value;
            });
        }
    }

    /**
     * Generates authentication data for API requests
     *
     * Converts current authentication configuration into headers, query parameters,
     * and auth config that can be used in HTTP requests.
     *
     * @returns {Object} Authentication data
     * @returns {Object} return.headers - Headers to include in request
     * @returns {Object} return.queryParams - Query parameters to include in request
     * @returns {Object|null} return.authConfig - Auth configuration for digest auth
     */
    generateAuthData() {
        const authData = {
            headers: {},
            queryParams: {},
            authConfig: null
        };

        const { type, config } = this.currentAuthConfig;

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
                    const credentials = btoa(`${config.username || ''}:${config.password || ''}`);
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

            default:
                break;
        }

        return authData;
    }

    /**
     * Loads authentication configuration into the UI
     *
     * @param {Object} authConfig - Authentication configuration
     * @param {string} authConfig.type - Authentication type
     * @param {Object} authConfig.config - Authentication configuration details
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
     * Populates authentication fields with configuration values
     *
     * @private
     * @param {Object} authConfig - Authentication configuration
     * @returns {void}
     */
    populateAuthFields(authConfig) {
        const { type, config } = authConfig;

        if (!config) {return;}

        switch (type) {
            case 'bearer': {
                const bearerToken = document.getElementById('bearer-token');
                if (bearerToken && config.token) {
                    bearerToken.value = config.token;
                }
                break;
            }

            case 'basic': {
                const basicUsername = document.getElementById('basic-username');
                const basicPassword = document.getElementById('basic-password');
                if (basicUsername && config.username) {
                    basicUsername.value = config.username;
                }
                if (basicPassword && config.password) {
                    basicPassword.value = config.password;
                }
                break;
            }

            case 'api-key': {
                const keyName = document.getElementById('api-key-name');
                const keyValue = document.getElementById('api-key-value');
                const keyLocation = document.getElementById('api-key-location');
                if (keyName && config.keyName) {
                    keyName.value = config.keyName;
                }
                if (keyValue && config.keyValue) {
                    keyValue.value = config.keyValue;
                }
                if (keyLocation && config.location) {
                    keyLocation.value = config.location;
                }
                break;
            }

            case 'oauth2': {
                const oauth2Token = document.getElementById('oauth2-token');
                const oauth2Prefix = document.getElementById('oauth2-header-prefix');
                const oauth2GrantType = document.getElementById('oauth2-grant-type');
                const oauth2TokenUrl = document.getElementById('oauth2-token-url');
                const oauth2AuthUrl = document.getElementById('oauth2-auth-url');
                const oauth2ClientId = document.getElementById('oauth2-client-id');
                const oauth2ClientSecret = document.getElementById('oauth2-client-secret');
                const oauth2Username = document.getElementById('oauth2-username');
                const oauth2Password = document.getElementById('oauth2-password');
                const oauth2RedirectUri = document.getElementById('oauth2-redirect-uri');
                const oauth2Scope = document.getElementById('oauth2-scope');
                const oauth2Audience = document.getElementById('oauth2-audience');
                const oauth2UsePkce = document.getElementById('oauth2-use-pkce');
                const oauth2ClientAuth = document.getElementById('oauth2-client-auth');
                const oauth2RefreshToken = document.getElementById('oauth2-refresh-token');

                if (oauth2Token && config.token) {oauth2Token.value = config.token;}
                if (oauth2Prefix && config.headerPrefix) {oauth2Prefix.value = config.headerPrefix;}
                if (oauth2GrantType && config.grantType) {oauth2GrantType.value = config.grantType;}
                if (oauth2TokenUrl && config.tokenUrl) {oauth2TokenUrl.value = config.tokenUrl;}
                if (oauth2AuthUrl && config.authorizationUrl) {oauth2AuthUrl.value = config.authorizationUrl;}
                if (oauth2ClientId && config.clientId) {oauth2ClientId.value = config.clientId;}
                if (oauth2ClientSecret && config.clientSecret) {oauth2ClientSecret.value = config.clientSecret;}
                if (oauth2Username && config.username) {oauth2Username.value = config.username;}
                if (oauth2Password && config.password) {oauth2Password.value = config.password;}
                if (oauth2RedirectUri && config.redirectUri) {oauth2RedirectUri.value = config.redirectUri;}
                if (oauth2Scope && config.scope) {oauth2Scope.value = config.scope;}
                if (oauth2Audience && config.audience) {oauth2Audience.value = config.audience;}
                if (oauth2UsePkce) {oauth2UsePkce.checked = config.usePkce !== false;}
                if (oauth2ClientAuth && config.clientAuthMethod) {oauth2ClientAuth.value = config.clientAuthMethod;}
                if (oauth2RefreshToken && config.refreshToken) {
                    oauth2RefreshToken.value = config.refreshToken;
                    const refreshGroup = document.getElementById('oauth2-refresh-token-group');
                    if (refreshGroup) {refreshGroup.classList.remove('u-hidden');}
                }

                // Trigger grant type UI update
                if (oauth2GrantType && config.grantType) {
                    oauth2GrantType.dispatchEvent(new Event('change'));
                }
                break;
            }

            case 'digest': {
                const digestUsername = document.getElementById('digest-username');
                const digestPassword = document.getElementById('digest-password');
                if (digestUsername && config.username) {
                    digestUsername.value = config.username;
                }
                if (digestPassword && config.password) {
                    digestPassword.value = config.password;
                }
                break;
            }

            default:
                break;
        }
    }

    /**
     * Gets current authentication configuration
     *
     * @returns {Object} Current authentication configuration
     * @returns {string} return.type - Authentication type
     * @returns {Object} return.config - Authentication configuration details
     */
    getAuthConfig() {
        return this.currentAuthConfig;
    }

    /**
     * Sets authentication type
     *
     * @param {string} authType - Authentication type to set
     * @returns {void}
     */
    setAuthType(authType) {
        if (this.authTypeSelect) {
            this.authTypeSelect.value = authType;
        }
        this.currentAuthConfig.type = authType;
        this.renderAuthFields(authType);
    }

    /**
     * Sets authentication configuration
     *
     * @param {Object} authConfig - Authentication configuration
     * @param {string} authConfig.type - Authentication type
     * @param {Object} authConfig.config - Authentication configuration details
     * @returns {void}
     */
    setAuthConfig(authConfig) {
        this.currentAuthConfig = {
            type: authConfig.type || 'none',
            config: authConfig.config || {}
        };

        if (this.authTypeSelect) {
            this.authTypeSelect.value = this.currentAuthConfig.type;
        }

        this.renderAuthFields(this.currentAuthConfig.type);
    }

    /**
     * Resets authentication configuration to default (none)
     *
     * @returns {void}
     */
    resetAuthConfig() {
        this.currentAuthConfig = {
            type: 'none',
            config: {}
        };

        if (this.authTypeSelect) {
            this.authTypeSelect.value = 'none';
        }

        this.renderAuthFields('none');
    }
}

/**
 * Singleton instance of AuthManager
 *
 * @const {AuthManager}
 */
export const authManager = new AuthManager();
