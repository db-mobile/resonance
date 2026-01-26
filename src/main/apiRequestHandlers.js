/**
 * @fileoverview HTTP API request handler with support for multiple protocols and authentication methods
 * @module main/apiRequestHandlers
 */

import axios from 'axios';
import http from 'http';
import https from 'https';
import { handleDigestAuth } from './digestAuthHandler.js';
import { createHTTP2Adapter } from 'axios-http2-adapter';

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
     * @param {Object} store - Store instance for settings retrieval
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
     * Supported HTTP methods for API requests
     * @private
     * @type {string[]}
     */
    static VALID_HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

    /**
     * Validates a URL string for HTTP/HTTPS requests
     *
     * Checks that the URL is a valid, well-formed HTTP or HTTPS URL.
     * Rejects other protocols (file://, ftp://, etc.) for security.
     *
     * @param {string} url - The URL to validate
     * @returns {Object} Validation result with isValid boolean and error message if invalid
     */
    validateUrl(url) {
        if (!url || typeof url !== 'string') {
            return { isValid: false, error: 'URL is required and must be a string' };
        }

        const trimmedUrl = url.trim();
        if (trimmedUrl.length === 0) {
            return { isValid: false, error: 'URL cannot be empty' };
        }

        try {
            const urlObj = new URL(trimmedUrl);

            // Only allow HTTP and HTTPS protocols
            if (!['http:', 'https:'].includes(urlObj.protocol)) {
                return {
                    isValid: false,
                    error: `Invalid protocol "${urlObj.protocol}". Only HTTP and HTTPS are supported`
                };
            }

            // Validate hostname exists
            if (!urlObj.hostname || urlObj.hostname.length === 0) {
                return { isValid: false, error: 'URL must include a valid hostname' };
            }

            return { isValid: true };
        } catch (error) {
            return { isValid: false, error: `Invalid URL format: ${error.message}` };
        }
    }

    /**
     * Validates request options before making an API request
     *
     * Ensures all required fields are present and valid, including
     * URL validation and HTTP method validation.
     *
     * @param {Object} requestOptions - The request options to validate
     * @returns {Object} Validation result with isValid boolean and error message if invalid
     */
    validateRequestOptions(requestOptions) {
        if (!requestOptions || typeof requestOptions !== 'object') {
            return { isValid: false, error: 'Request options must be an object' };
        }

        // Validate URL
        const urlValidation = this.validateUrl(requestOptions.url);
        if (!urlValidation.isValid) {
            return urlValidation;
        }

        // Validate HTTP method
        if (!requestOptions.method || typeof requestOptions.method !== 'string') {
            return { isValid: false, error: 'HTTP method is required' };
        }

        const method = requestOptions.method.toUpperCase();
        if (!ApiRequestHandler.VALID_HTTP_METHODS.includes(method)) {
            return {
                isValid: false,
                error: `Invalid HTTP method "${requestOptions.method}". Supported methods: ${ApiRequestHandler.VALID_HTTP_METHODS.join(', ')}`
            };
        }

        // Validate headers if provided
        if (requestOptions.headers !== undefined && requestOptions.headers !== null) {
            if (typeof requestOptions.headers !== 'object' || Array.isArray(requestOptions.headers)) {
                return { isValid: false, error: 'Headers must be an object' };
            }
        }

        // Validate auth if provided
        if (requestOptions.auth !== undefined && requestOptions.auth !== null) {
            if (typeof requestOptions.auth !== 'object') {
                return { isValid: false, error: 'Auth configuration must be an object' };
            }
        }

        return { isValid: true };
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
     * Creates HTTP/2 adapter with timing awareness
     *
     * Note: HTTP/2 uses multiplexed streams over persistent connections.
     * Socket-level timings (DNS, TCP, TLS) only occur once per session,
     * not per request, so they cannot be measured per-request.
     *
     * We can still capture:
     * - TTFB (Time To First Byte): Request start to first response data
     * - Total request time: Captured by handleApiRequest
     *
     * @private
     * @param {Object} timings - Timings object to populate
     * @param {number} startTime - Request start timestamp
     * @returns {Function} Configured HTTP/2 adapter function
     */
    _createHttp2Adapter(timings, startTime) {
        // Socket-level timings aren't available per-request in HTTP/2
        // These only occur once when the session is established
        timings.dnsLookup = 0;
        timings.tcpConnection = 0;
        timings.tlsHandshake = 0;

        const adapter = createHTTP2Adapter();

        // Wrap adapter to capture TTFB
        return async (config) => {
            try {
                const response = await adapter(config);

                // Capture time to first byte
                if (!timings.firstByte) {
                    timings.firstByte = Date.now() - startTime;
                }

                return response;
            } catch (error) {
                // Capture timing even on error
                if (!timings.firstByte) {
                    timings.firstByte = Date.now() - startTime;
                }
                throw error;
            }
        };
    }

    /**
     * Determines if an error is HTTP/2 specific
     *
     * @private
     * @param {Error} error - The error object
     * @returns {boolean} True if error is HTTP/2-related
     */
    _isHttp2Error(error) {
        const http2ErrorCodes = [
            'ERR_HTTP2_',
            'NGHTTP2_',
            'HTTP2WRAPPER_'
        ];

        return http2ErrorCodes.some(code =>
            error.code && error.code.includes(code)
        );
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
            void error;
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
        // Validate request options before proceeding
        const validation = this.validateRequestOptions(requestOptions);
        if (!validation.isValid) {
            return {
                success: false,
                message: validation.error,
                status: null,
                statusText: 'Validation Error',
                data: null,
                headers: {},
                timings: {
                    startTime: Date.now(),
                    dnsLookup: 0,
                    tcpConnection: 0,
                    tlsHandshake: 0,
                    firstByte: 0,
                    download: 0,
                    total: 0
                }
            };
        }

        // Check if we should route to mock server
        const mockServerUrl = this._getMockServerUrl(requestOptions.method, requestOptions.url);
        if (mockServerUrl) {
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

        let httpVersion = 'auto'; // Declare outside try block for catch block access

        try {
            this.currentRequestController = new AbortController();

            const settings = this.store.get('settings', {});
            httpVersion = settings.httpVersion || 'auto';
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

            // Determine if we should use HTTP/2 adapter
            const useHttp2Adapter = httpVersion === 'http2';

            // For HTTP/1.x mode, use standard axios (no special config needed)
            // For 'auto' mode, let axios negotiate automatically
            // For 'http2' mode, we'll use the adapter (set below)

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

            // Only set up socket timing for HTTP/1.x (not available for HTTP/2 adapter)
            if (!useHttp2Adapter) {
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
            }

            startTime = Date.now();
            timings.startTime = startTime;

            let response;

            if (requestOptions.auth && requestOptions.auth.username) {
                const makeRequest = async (authHeader) => {
                    const config = { ...axiosConfig };
                    if (authHeader) {
                        config.headers = { ...config.headers, Authorization: authHeader };
                    }

                    // Use HTTP/2 adapter for http2 mode
                    if (useHttp2Adapter) {
                        config.adapter = this._createHttp2Adapter(timings, startTime);
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
                // Use HTTP/2 adapter for http2 mode
                if (useHttp2Adapter) {
                    axiosConfig.adapter = this._createHttp2Adapter(timings, startTime);
                }

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
            } catch {
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

            // Log HTTP/2-specific errors for debugging
            if (this._isHttp2Error(error)) {
                console.warn('HTTP/2 protocol error detected:', {
                    code: error.code,
                    message: error.message,
                    httpVersion: httpVersion
                });
            }

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
                } catch {
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
