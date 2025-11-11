/**
 * @fileoverview Proxy configuration and connection management for HTTP requests
 * @module main/proxyHandlers
 */

import axios from 'axios';

/**
 * Handler for managing proxy configurations and connections
 *
 * @class
 * @classdesc Manages proxy settings including manual and system proxy configurations,
 * authentication, bypass lists, and connection testing. Provides axios-compatible
 * proxy configuration objects for seamless integration with HTTP requests.
 */
class ProxyHandler {
    /**
     * Creates a ProxyHandler instance
     *
     * @param {Object} store - Electron-store instance for proxy settings persistence
     */
    constructor(store) {
        this.store = store;
        this.PROXY_KEY = 'proxySettings';
    }

    /**
     * Retrieves proxy settings from persistent storage
     *
     * Fetches proxy configuration from electron-store with automatic fallback
     * to defaults if settings are missing or invalid. Merges stored settings
     * with defaults to ensure all required fields are present.
     *
     * @returns {Object} Proxy settings object with enabled, host, port, auth, and bypass list
     */
    getProxySettings() {
        try {
            const settings = this.store.get(this.PROXY_KEY);

            if (!settings || typeof settings !== 'object') {
                console.warn('Proxy settings not found, returning defaults');
                return this._getDefaultProxySettings();
            }

            // Merge with defaults to ensure all fields exist
            return {
                ...this._getDefaultProxySettings(),
                ...settings,
                auth: {
                    ...this._getDefaultProxySettings().auth,
                    ...(settings.auth || {})
                }
            };
        } catch (error) {
            console.error('Error getting proxy settings:', error);
            return this._getDefaultProxySettings();
        }
    }

    /**
     * Saves proxy settings to persistent storage
     *
     * Persists the provided proxy configuration to electron-store for use
     * across application restarts.
     *
     * @param {Object} settings - Proxy configuration object to save
     * @returns {Object} The saved settings object
     * @throws {Error} If storage write fails
     */
    setProxySettings(settings) {
        try {
            this.store.set(this.PROXY_KEY, settings);
            return settings;
        } catch (error) {
            console.error('Error saving proxy settings:', error);
            throw error;
        }
    }

    /**
     * Tests the proxy connection by making a request to an external service
     *
     * Validates proxy configuration by attempting to connect to a public IP
     * checking service (api.ipify.org). Measures response time and reports
     * connection success or specific failure reasons.
     *
     * @async
     * @returns {Promise<Object>} Test result object with success status, message, IP, and response time
     */
    async testProxyConnection() {
        try {
            const settings = this.getProxySettings();

            if (!settings.enabled) {
                return {
                    success: false,
                    message: 'Proxy is not enabled'
                };
            }

            let proxyConfig;

            // Use system proxy if enabled
            if (settings.useSystemProxy) {
                proxyConfig = this._getSystemProxySettings();
                if (!proxyConfig) {
                    return {
                        success: false,
                        message: 'System proxy is enabled but no system proxy configuration found'
                    };
                }
            } else {
                // Manual proxy configuration
                if (!settings.host || !settings.port) {
                    return {
                        success: false,
                        message: 'Proxy host and port are required'
                    };
                }

                // Build proxy configuration for axios
                proxyConfig = {
                    protocol: settings.type,
                    host: settings.host,
                    port: settings.port
                };

                // Add authentication if enabled
                if (settings.auth?.enabled && settings.auth.username) {
                    proxyConfig.auth = {
                        username: settings.auth.username,
                        password: settings.auth.password || ''
                    };
                }
            }

            // Test connection to a public IP checker service
            // This helps verify the proxy is working by comparing IPs
            const testUrl = 'https://api.ipify.org?format=json';

            const axiosConfig = {
                url: testUrl,
                method: 'GET',
                timeout: settings.timeout || 10000,
                proxy: proxyConfig,
                validateStatus: (status) => status === 200
            };

            const startTime = Date.now();
            const response = await axios(axiosConfig);
            const responseTime = Date.now() - startTime;

            if (response.data && response.data.ip) {
                return {
                    success: true,
                    message: `Proxy connection successful (${responseTime}ms)`,
                    ip: response.data.ip,
                    responseTime: responseTime
                };
            }

            return {
                success: true,
                message: `Proxy connection successful (${responseTime}ms)`,
                responseTime: responseTime
            };

        } catch (error) {
            console.error('Proxy connection test failed:', error);

            let errorMessage = 'Connection failed';

            if (error.code === 'ECONNREFUSED') {
                errorMessage = 'Connection refused. Check proxy host and port.';
            } else if (error.code === 'ETIMEDOUT') {
                errorMessage = 'Connection timed out. Proxy may be unreachable.';
            } else if (error.code === 'ENOTFOUND') {
                errorMessage = 'Proxy host not found. Check the hostname.';
            } else if (error.code === 'ECONNRESET') {
                errorMessage = 'Connection reset by proxy server.';
            } else if (error.response?.status === 407) {
                errorMessage = 'Proxy authentication required. Check username and password.';
            } else if (error.message) {
                errorMessage = error.message;
            }

            return {
                success: false,
                message: errorMessage,
                error: error.code || 'UNKNOWN_ERROR'
            };
        }
    }

    /**
     * Generates axios-compatible proxy configuration for a specific request URL
     *
     * Creates a proxy configuration object suitable for axios requests, taking into
     * account proxy enable status, bypass list, system vs manual proxy settings,
     * and authentication requirements.
     *
     * @param {string} requestUrl - The target URL for the request
     * @returns {Object|null} Axios proxy config object with protocol, host, port, and auth, or null if proxy disabled/bypassed
     */
    getAxiosProxyConfig(requestUrl) {
        try {
            const settings = this.getProxySettings();

            // If proxy is disabled, return null
            if (!settings.enabled) {
                return null;
            }

            // Check if URL should bypass proxy
            if (this._shouldBypassProxy(requestUrl, settings.bypassList)) {
                return null;
            }

            // Use system proxy if enabled
            if (settings.useSystemProxy) {
                const systemProxy = this._getSystemProxySettings();
                if (systemProxy) {
                    return systemProxy;
                } 
                    console.warn('System proxy is enabled but no system proxy configuration found');
                    return null;
                
            }

            // Build manual proxy config
            const proxyConfig = {
                protocol: settings.type,
                host: settings.host,
                port: settings.port
            };

            // Add authentication if enabled
            if (settings.auth?.enabled && settings.auth.username) {
                proxyConfig.auth = {
                    username: settings.auth.username,
                    password: settings.auth.password || ''
                };
            }

            return proxyConfig;
        } catch (error) {
            console.error('Error getting axios proxy config:', error);
            return null;
        }
    }

    /**
     * Determines if a URL should bypass the proxy based on bypass list patterns
     *
     * Checks the URL's hostname against bypass patterns including exact matches,
     * wildcard patterns (*.example.com), and suffix patterns (.example.com).
     *
     * @private
     * @param {string} url - The full URL to check
     * @param {Array<string>} bypassList - Array of bypass patterns
     * @returns {boolean} True if URL should bypass proxy, false otherwise
     */
    _shouldBypassProxy(url, bypassList) {
        if (!url || !Array.isArray(bypassList) || bypassList.length === 0) {
            return false;
        }

        try {
            const urlObj = new URL(url);
            const {hostname} = urlObj;

            return bypassList.some(pattern => {
                const cleanPattern = pattern.trim();
                if (!cleanPattern) {return false;}

                // Exact match
                if (cleanPattern === hostname) {return true;}

                // Wildcard match (*.example.com)
                if (cleanPattern.startsWith('*.')) {
                    const domain = cleanPattern.substring(2);
                    return hostname.endsWith(domain);
                }

                // Suffix match (.example.com matches subdomain.example.com)
                if (cleanPattern.startsWith('.')) {
                    return hostname.endsWith(cleanPattern);
                }

                return false;
            });
        } catch (error) {
            console.error('Error checking bypass list:', error);
            return false;
        }
    }

    /**
     * Returns default proxy settings structure
     *
     * Provides the default configuration used when no proxy settings exist
     * or when settings are invalid.
     *
     * @private
     * @returns {Object} Default proxy settings with all fields initialized
     */
    _getDefaultProxySettings() {
        return {
            enabled: false,
            useSystemProxy: false,
            type: 'http',
            host: '',
            port: 8080,
            auth: {
                enabled: false,
                username: '',
                password: ''
            },
            bypassList: [],
            timeout: 10000
        };
    }

    /**
     * Retrieves system proxy settings from environment variables
     *
     * Reads proxy configuration from standard environment variables (HTTP_PROXY,
     * HTTPS_PROXY, http_proxy, https_proxy). Parses the proxy URL to extract
     * protocol, host, port, and authentication credentials if present.
     *
     * @private
     * @returns {Object|null} Proxy configuration object, or null if no system proxy is configured
     */
    _getSystemProxySettings() {
        // Check environment variables for proxy configuration
        const httpProxy = process.env.HTTP_PROXY || process.env.http_proxy;
        const httpsProxy = process.env.HTTPS_PROXY || process.env.https_proxy;
        const _noProxy = process.env.NO_PROXY || process.env.no_proxy;

        // Use HTTPS proxy if available, otherwise HTTP proxy
        const proxyUrl = httpsProxy || httpProxy;

        if (!proxyUrl) {
            return null;
        }

        try {
            const url = new URL(proxyUrl);
            const proxyConfig = {
                protocol: url.protocol.replace(':', ''),
                host: url.hostname,
                port: parseInt(url.port, 10) || (url.protocol === 'https:' ? 443 : 8080)
            };

            // Add authentication if present in URL
            if (url.username) {
                proxyConfig.auth = {
                    username: url.username,
                    password: url.password || ''
                };
            }

            return proxyConfig;
        } catch (error) {
            console.error('Error parsing system proxy URL:', error);
            return null;
        }
    }
}

export default ProxyHandler;
