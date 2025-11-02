import axios from 'axios';
import http from 'http';
import https from 'https';

class ApiRequestHandler {
    constructor(store, proxyHandler) {
        this.store = store;
        this.proxyHandler = proxyHandler;
        this.currentRequestController = null;
    }

    calculateResponseSize(rawData) {
        if (!rawData) {
            return 0;
        }

        return new TextEncoder().encode(rawData).length;
    }

    createTimingAgent(isHttps, timings) {
        const Agent = isHttps ? https.Agent : http.Agent;

        return new Agent({
            keepAlive: false,
            lookup: (hostname, options, callback) => {
                const dnsStart = Date.now();
                const originalLookup = isHttps ? https.Agent.prototype.constructor.super_.prototype.lookup : http.Agent.prototype.constructor.super_.prototype.lookup;

                require('dns').lookup(hostname, options, (err, address, family) => {
                    timings.dnsLookup = Date.now() - dnsStart;
                    callback(err, address, family);
                });
            }
        });
    }

    async handleApiRequest(requestOptions) {
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
                headers: requestOptions.headers || {},
                signal: this.currentRequestController.signal,

                transformResponse: [(data) => data]
            };

            // Only set timeout if it's greater than 0 (0 means no timeout)
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

            // Add proxy configuration if available
            if (this.proxyHandler) {
                const proxyConfig = this.proxyHandler.getAxiosProxyConfig(requestOptions.url);
                if (proxyConfig) {
                    axiosConfig.proxy = proxyConfig;
                    console.log(`Using proxy: ${proxyConfig.protocol}://${proxyConfig.host}:${proxyConfig.port}`);
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

            // Custom agent to capture timing metrics
            const Agent = isHttps ? https.Agent : http.Agent;
            const agent = new Agent({ keepAlive: false });

            let socketAssigned = false;
            let dnsStart = 0;
            let tcpStart = 0;
            let tlsStart = 0;
            let firstByteReceived = false;

            axiosConfig.httpAgent = !isHttps ? agent : undefined;
            axiosConfig.httpsAgent = isHttps ? agent : undefined;

            // Intercept socket events for detailed timing
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
            const response = await axios(axiosConfig);
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
                    message: "Request was cancelled",
                    status: null,
                    statusText: "Cancelled",
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
                    message: "No response received from server.",
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
