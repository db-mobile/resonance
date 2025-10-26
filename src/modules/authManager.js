export class AuthManager {
    constructor() {
        this.authTypeSelect = document.getElementById('auth-type-select');
        this.authFieldsContainer = document.getElementById('auth-fields-container');
        this.currentAuthConfig = {
            type: 'none',
            config: {}
        };

        this.initializeEventListeners();
    }

    initializeEventListeners() {
        if (this.authTypeSelect) {
            this.authTypeSelect.addEventListener('change', (e) => {
                this.handleAuthTypeChange(e.target.value);
            });
        }
    }

    handleAuthTypeChange(authType) {
        this.currentAuthConfig.type = authType;
        this.currentAuthConfig.config = {};
        this.renderAuthFields(authType);
    }

    renderAuthFields(authType) {
        if (!this.authFieldsContainer) return;

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

    renderBearerTokenFields() {
        const defaultToken = this.currentAuthConfig.config.token || '{{bearerToken}}';

        const html = `
            <div class="auth-field-group">
                <label for="bearer-token">Token</label>
                <input type="text"
                       id="bearer-token"
                       class="auth-input"
                       placeholder="Enter bearer token"
                       value="${defaultToken}"
                       aria-label="Bearer Token">
                <small class="auth-field-hint">The token will be sent in the Authorization header as "Bearer {token}". You can use variables like {{bearerToken}}.</small>
            </div>
        `;
        this.authFieldsContainer.innerHTML = html;

        const tokenInput = document.getElementById('bearer-token');
        if (tokenInput) {
            this.currentAuthConfig.config.token = tokenInput.value;

            tokenInput.addEventListener('input', (e) => {
                this.currentAuthConfig.config.token = e.target.value;
            });
        }
    }

    renderBasicAuthFields() {
        const html = `
            <div class="auth-field-group">
                <label for="basic-username">Username</label>
                <input type="text"
                       id="basic-username"
                       class="auth-input"
                       placeholder="Enter username"
                       aria-label="Username">
            </div>
            <div class="auth-field-group">
                <label for="basic-password">Password</label>
                <input type="password"
                       id="basic-password"
                       class="auth-input"
                       placeholder="Enter password"
                       aria-label="Password">
            </div>
            <small class="auth-field-hint">Credentials will be base64 encoded and sent in the Authorization header</small>
        `;
        this.authFieldsContainer.innerHTML = html;

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

    renderApiKeyFields() {
        const html = `
            <div class="auth-field-group">
                <label for="api-key-name">Key Name</label>
                <input type="text"
                       id="api-key-name"
                       class="auth-input"
                       placeholder="e.g., X-API-Key"
                       aria-label="API Key Name">
            </div>
            <div class="auth-field-group">
                <label for="api-key-value">Key Value</label>
                <input type="text"
                       id="api-key-value"
                       class="auth-input"
                       placeholder="Enter API key"
                       aria-label="API Key Value">
            </div>
            <div class="auth-field-group">
                <label for="api-key-location">Add To</label>
                <select id="api-key-location" class="auth-select" aria-label="API Key Location">
                    <option value="header">Header</option>
                    <option value="query">Query Parameters</option>
                </select>
            </div>
            <small class="auth-field-hint">The API key will be added to the request as specified</small>
        `;
        this.authFieldsContainer.innerHTML = html;

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

    renderOAuth2Fields() {
        const html = `
            <div class="auth-field-group">
                <label for="oauth2-token">Access Token</label>
                <input type="text"
                       id="oauth2-token"
                       class="auth-input"
                       placeholder="Enter access token"
                       aria-label="OAuth 2.0 Access Token">
                <small class="auth-field-hint">The token will be sent in the Authorization header as "Bearer {token}"</small>
            </div>
            <div class="auth-field-group">
                <label for="oauth2-header-prefix">Header Prefix</label>
                <input type="text"
                       id="oauth2-header-prefix"
                       class="auth-input"
                       placeholder="Bearer"
                       value="Bearer"
                       aria-label="OAuth 2.0 Header Prefix">
            </div>
        `;
        this.authFieldsContainer.innerHTML = html;

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
            this.currentAuthConfig.config.headerPrefix = 'Bearer';
        }
    }

    renderDigestAuthFields() {
        const html = `
            <div class="auth-field-group">
                <label for="digest-username">Username</label>
                <input type="text"
                       id="digest-username"
                       class="auth-input"
                       placeholder="Enter username"
                       aria-label="Digest Auth Username">
            </div>
            <div class="auth-field-group">
                <label for="digest-password">Password</label>
                <input type="password"
                       id="digest-password"
                       class="auth-input"
                       placeholder="Enter password"
                       aria-label="Digest Auth Password">
            </div>
            <small class="auth-field-hint">Digest authentication will be handled automatically by the HTTP client</small>
        `;
        this.authFieldsContainer.innerHTML = html;

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
                    console.warn('Bearer token is empty or undefined');
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

    populateAuthFields(authConfig) {
        const { type, config } = authConfig;

        if (!config) return;

        switch (type) {
            case 'bearer':
                const bearerToken = document.getElementById('bearer-token');
                if (bearerToken && config.token) {
                    bearerToken.value = config.token;
                }
                break;

            case 'basic':
                const basicUsername = document.getElementById('basic-username');
                const basicPassword = document.getElementById('basic-password');
                if (basicUsername && config.username) {
                    basicUsername.value = config.username;
                }
                if (basicPassword && config.password) {
                    basicPassword.value = config.password;
                }
                break;

            case 'api-key':
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

            case 'oauth2':
                const oauth2Token = document.getElementById('oauth2-token');
                const oauth2Prefix = document.getElementById('oauth2-header-prefix');
                if (oauth2Token && config.token) {
                    oauth2Token.value = config.token;
                }
                if (oauth2Prefix && config.headerPrefix) {
                    oauth2Prefix.value = config.headerPrefix;
                }
                break;

            case 'digest':
                const digestUsername = document.getElementById('digest-username');
                const digestPassword = document.getElementById('digest-password');
                if (digestUsername && config.username) {
                    digestUsername.value = config.username;
                }
                if (digestPassword && config.password) {
                    digestPassword.value = config.password;
                }
                break;

            default:
                break;
        }
    }

    getAuthConfig() {
        return this.currentAuthConfig;
    }

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

export const authManager = new AuthManager();
