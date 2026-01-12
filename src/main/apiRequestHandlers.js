/**
 * @fileoverview HTTP API request handler with support for multiple protocols and authentication methods
 * @module main/apiRequestHandlers
 */

import axios from 'axios';
import http from 'http';
import https from 'https';
import { handleDigestAuth } from './digestAuthHandler.js';

/**
 * Handler for making HTTP API requests with detailed timing and metrics
 *
 * @class
 * @classdesc Manages HTTP requests to external APIs using axios with support for
 * multiple HTTP versions (1.1, 2, 3), custom timeouts, proxy configuration,
 * digest authentication, and detailed performance timing metrics. Tracks socket-level
 * events for precise DNS, TCP, and TLS timing measurements.
 */
class ApiRequestHandler {
    /**
     * Creates an ApiRequestHandler instance
     *
     * @param {Object} store - Electron-store instance for settings retrieval
     * @param {Object} proxyHandler - ProxyHandler instance for proxy configuration
     * @param {Object} mockServerHandler - MockServerHandler instance for mock server routing
     * @param {string} appVersion - Application version for User-Agent header
     */
    constructor(store, proxyHandler, mockServerHandler = null, appVersion = '1.0.0') {
        this.store = store;
        this.proxyHandler = proxyHandler;
        this.mockServerHandler = mockServerHandler;
        this.currentRequestController = null;
        this.appVersion = appVersion;
    }

    /**
     * Calculates the byte size of response data
     *
     * Uses TextEncoder to accurately measure the size of string data in bytes,
     * accounting for multi-byte UTF-8 characters.
     *
     * @param {string|null} rawData - The raw response data
     * @returns {number} Size in bytes, or 0 if data is null/undefined
     */
    calculateResponseSize(rawData) {
        if (!rawData) {
            return 0;
        }

        return new TextEncoder().encode(rawData).length;
    }

    /**
     * Creates a custom HTTP/HTTPS agent with DNS timing capture
     *
     * This method is currently unused but provides an alternative approach for
     * capturing DNS lookup timing using a custom agent with lookup override.
     *
     * @private
     * @param {boolean} isHttps - Whether to create an HTTPS agent or HTTP agent
     * @param {Object} timings - Timings object to populate with DNS lookup duration
     * @returns {Object} Custom http.Agent or https.Agent instance
     */
    createTimingAgent(isHttps, timings) {
        const Agent = isHttps ? https.Agent : http.Agent;

        return new Agent({
            keepAlive: false,
            lookup: (hostname, options, callback) => {
                const dnsStart = Date.now();
                const _originalLookup = isHttps ? https.Agent.prototype.constructor.super_.prototype.lookup : http.Agent.prototype.constructor.super_.prototype.lookup;

                require('dns').lookup(hostname, options, (err, address, family) => {
                    timings.dnsLookup = Date.now() - dnsStart;
                    callback(err, address, family);
                });
            }
        });
    }

    /**
     * Checks if request should be routed to mock server
     *
     * @private
     * @param {string} method - HTTP method
     * @param {string} url - Request URL
     * @returns {string|null} Mock server URL if should route, null otherwise
     */
    _getMockServerUrl(method, url) {
        if (!this.mockServerHandler) {
            return null;
        }

        const status = this.mockServerHandler.getStatus();
        if (!status.running) {
            return null;
        }

        try {
            // Extract path from URL
            const urlObj = new URL(url);
            const path = urlObj.pathname;

            // Check if this endpoint is mocked
            for (const [_key, route] of this.mockServerHandler.endpoints.entries()) {
                if (route.method !== method.toUpperCase()) {
                    continue;
                }

                const match = path.match(route.regex);
                if (match) {
                    // Found a matching endpoint - route to mock server
                    return `http://localhost:${status.port}${path}${urlObj.search}`;
                }
            }
        } catch (error) {
            console.error('Error checking mock server routing:', error);
        }

        return null;
    }

    /**
     * Handles an HTTP API request with detailed timing metrics
     *
     * Executes an HTTP request with configurable options including method, URL, headers,
     * and body. Captures detailed performance metrics including DNS lookup, TCP connection,
     * TLS handshake, time to first byte, and download time. Supports HTTP version selection,
     * request timeouts, proxy configuration, and digest authentication.
     *
     * If the mock server is running and the endpoint matches a mocked endpoint, the request
     * will be automatically routed to the mock server.
     *
     * @async
     * @param {Object} requestOptions - Configuration for the HTTP request
     * @param {string} requestOptions.method - HTTP method (GET, POST, PUT, etc.)
     * @param {string} requestOptions.url - Target URL for the request
     * @param {Object} [requestOptions.headers] - HTTP headers to include
     * @param {Object|string} [requestOptions.body] - Request body for POST/PUT/PATCH
     * @param {Object} [requestOptions.auth] - Digest authentication credentials
     * @param {string} [requestOptions.auth.username] - Username for digest auth
     * @param {string} [requestOptions.auth.password] - Password for digest auth
     * @returns {Promise<Object>} Response object with data, status, headers, and timing metrics
     */
    async handleApiRequest(requestOptions) {
        // Check if we should route to mock server
        const mockServerUrl = this._getMockServerUrl(requestOptions.method, requestOptions.url);
        if (mockServerUrl) {
            console.log(`Routing request to mock server: ${mockServerUrl}`);
            requestOptions = { ...requestOptions, url: mockServerUrl };
        }

        let startTime = Date.now();
        const timings = {
            startTime: startTime,
            dnsLookup: 0,
            tcpConnection: 0,
            tlsHandshake: 0,
            firstByte: 0,
            download: 0,
            total: 0
        };

        try {
            this.currentRequestController = new AbortController();

            const settings = this.store.get('settings', {});
            const httpVersion = settings.httpVersion || 'auto';
            const requestTimeout = settings.requestTimeout !== undefined ? settings.requestTimeout : 0;

            const isHttps = requestOptions.url.startsWith('https://');

            const axiosConfig = {
                method: requestOptions.method,
                url: requestOptions.url,
                headers: {
                    'User-Agent': `resonance/${this.appVersion}`,
                    ...(requestOptions.headers || {})
                },
                signal: this.currentRequestController.signal,

                transformResponse: [(data) => data]
            };

            if (requestTimeout > 0) {
                axiosConfig.timeout = requestTimeout;
            }

            switch (httpVersion) {
                case 'http1':
                    axiosConfig.httpVersion = '1.1';
                    axiosConfig.http2 = false;
                    break;
                case 'http2':
                    axiosConfig.http2 = true;
                    break;
                case 'auto':
                default:
                    break;
            }

            if (this.proxyHandler) {
                const proxyConfig = this.proxyHandler.getAxiosProxyConfig(requestOptions.url);
                if (proxyConfig) {
                    axiosConfig.proxy = proxyConfig;
                }
            }

            if (requestOptions.body && ['POST', 'PUT', 'PATCH'].includes(requestOptions.method.toUpperCase())) {
                if (typeof requestOptions.body === 'object') {
                    axiosConfig.data = JSON.stringify(requestOptions.body);
                    if (!axiosConfig.headers['Content-Type'] && !axiosConfig.headers['content-type']) {
                        axiosConfig.headers['Content-Type'] = 'application/json';
                    }
                } else {
                    axiosConfig.data = requestOptions.body;
                }
            }

            const Agent = isHttps ? https.Agent : http.Agent;
            const agent = new Agent({ keepAlive: false });

            let socketAssigned = false;
            let dnsStart = 0;
            let tcpStart = 0;
            let tlsStart = 0;
            let firstByteReceived = false;

            axiosConfig.httpAgent = !isHttps ? agent : undefined;
            axiosConfig.httpsAgent = isHttps ? agent : undefined;

            const originalCreateConnection = agent.createConnection;
            agent.createConnection = function(options, callback) {
                dnsStart = Date.now();

                const socket = originalCreateConnection.call(this, options, callback);

                if (!socketAssigned) {
                    socketAssigned = true;

                    socket.once('lookup', () => {
                        timings.dnsLookup = Date.now() - dnsStart;
                        tcpStart = Date.now();
                    });

                    socket.once('connect', () => {
                        timings.tcpConnection = Date.now() - tcpStart;
                        if (isHttps) {
                            tlsStart = Date.now();
                        }
                    });

                    if (isHttps) {
                        socket.once('secureConnect', () => {
                            timings.tlsHandshake = Date.now() - tlsStart;
                        });
                    }

                    socket.once('data', () => {
                        if (!firstByteReceived) {
                            firstByteReceived = true;
                            timings.firstByte = Date.now() - startTime;
                        }
                    });
                }

                return socket;
            };

            startTime = Date.now();
            timings.startTime = startTime;

            let response;

            if (requestOptions.auth && requestOptions.auth.username) {
                const makeRequest = async (authHeader) => {
                    const config = { ...axiosConfig };
                    if (authHeader) {
                        config.headers = { ...config.headers, Authorization: authHeader };
                    }
                    return axios(config);
                };

                response = await handleDigestAuth(
                    makeRequest,
                    requestOptions.auth,
                    requestOptions.method,
                    requestOptions.url
                );
            } else {
                response = await axios(axiosConfig);
            }

            const endTime = Date.now();

            timings.total = endTime - startTime;
            timings.download = endTime - startTime - timings.firstByte;
            const ttfb = timings.firstByte || timings.total;

            this.currentRequestController = null;

            const serializedHeaders = JSON.parse(JSON.stringify(response.headers));

            const rawData = response.data;
            const responseSize = this.calculateResponseSize(rawData);

            let parsedData;
            try {
                parsedData = typeof rawData === 'string' ? JSON.parse(rawData) : rawData;
            } catch (e) {
                parsedData = rawData;
            }

            return {
                success: true,
                data: parsedData,
                status: response.status,
                statusText: response.statusText,
                headers: serializedHeaders,
                ttfb: ttfb,
                size: responseSize,
                timings: timings
            };
        } catch (error) {
            console.error('API request error:', error);

            timings.total = Date.now() - startTime;
            const ttfb = Date.now() - startTime;
            this.currentRequestController = null;

            if (error.code === 'ERR_CANCELED' || error.name === 'CanceledError') {
                return {
                    success: false,
                    message: 'Request was cancelled',
                    status: null,
                    statusText: 'Cancelled',
                    data: null,
                    headers: {},
                    cancelled: true,
                    timings: timings
                };
            }

            let serializedError;

            if (error.response) {
                const rawData = error.response.data;
                const responseSize = this.calculateResponseSize(rawData);

                let parsedData;
                try {
                    parsedData = typeof rawData === 'string' ? JSON.parse(rawData) : rawData;
                } catch (e) {
                    parsedData = rawData;
                }

                serializedError = {
                    success: false,
                    message: error.message || `HTTP Error ${error.response.status}`,
                    status: error.response.status,
                    statusText: error.response.statusText,
                    data: parsedData,
                    headers: {},
                    ttfb: ttfb,
                    size: responseSize,
                    timings: timings
                };

                try {
                    if (error.response.headers) {
                        serializedError.headers = JSON.parse(JSON.stringify(error.response.headers));
                    }
                } catch (headerError) {
                    console.warn('Failed to serialize response headers:', headerError);
                    serializedError.headers = {};
                }
            } else if (error.request) {
                serializedError = {
                    success: false,
                    message: 'No response received from server.',
                    status: null,
                    statusText: null,
                    data: null,
                    headers: {},
                    ttfb: ttfb,
                    timings: timings
                };
            } else {
                serializedError = {
                    success: false,
                    message: `Error setting up request: ${error.message}`,
                    status: null,
                    statusText: null,
                    data: null,
                    headers: {},
                    ttfb: ttfb,
                    timings: timings
                };
            }

            console.error('Returning error result:', serializedError);
            return serializedError;
        }
    }

    /**
     * Cancels the currently active HTTP request
     *
     * Aborts the in-flight request using the AbortController signal if one exists.
     * Safe to call even when no request is active.
     *
     * @returns {Object} Result object with success status and message
     */
    cancelRequest() {
        if (this.currentRequestController) {
            this.currentRequestController.abort();
            this.currentRequestController = null;
            return { success: true, message: 'Request cancelled' };
        }
        return { success: false, message: 'No active request to cancel' };
    }
}

export default ApiRequestHandler;
