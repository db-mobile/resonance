import axios from 'axios';

class ProxyHandler {
    constructor(store) {
        this.store = store;
        this.PROXY_KEY = 'proxySettings';
    }

    /**
     * Get proxy settings from store
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
     * Save proxy settings to store
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
     * Test proxy connection
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
     * Get axios-compatible proxy configuration for a request URL
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
     * Check if URL should bypass proxy
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
     * Get default proxy settings
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
     * Get system proxy settings
     * Returns null if no system proxy is configured
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
