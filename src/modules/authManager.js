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

        const tokenInput = document.getElementById('oauth2-token');
        const prefixInput = document.getElementById('oauth2-header-prefix');

        if (tokenInput) {
            tokenInput.addEventListener('input', (e) => {
                this.currentAuthConfig.config.token = e.target.value;
            });
        }

        if (prefixInput) {
            prefixInput.addEventListener('input', (e) => {
                this.currentAuthConfig.config.headerPrefix = e.target.value;
            });
            if (!prefixInput.value) {
                prefixInput.value = 'Bearer';
            }
            this.currentAuthConfig.config.headerPrefix = prefixInput.value;
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
                if (oauth2Token && config.token) {
                    oauth2Token.value = config.token;
                }
                if (oauth2Prefix && config.headerPrefix) {
                    oauth2Prefix.value = config.headerPrefix;
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
