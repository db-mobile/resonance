import axios from 'axios';

class ApiRequestHandler {
    constructor(store) {
        this.store = store;
        this.currentRequestController = null;
    }

    calculateResponseSize(rawData) {
        if (!rawData) {
            return 0;
        }

        return new TextEncoder().encode(rawData).length;
    }

    async handleApiRequest(requestOptions) {
        let startTime = Date.now();

        try {
            this.currentRequestController = new AbortController();

            const settings = this.store.get('settings', {});
            const httpVersion = settings.httpVersion || 'auto';
            const requestTimeout = settings.requestTimeout !== undefined ? settings.requestTimeout : 0;

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

            startTime = Date.now();
            const response = await axios(axiosConfig);
            const ttfb = Date.now() - startTime;

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
                size: responseSize
            };
        } catch (error) {
            console.error('API request error:', error);

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
                    cancelled: true
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
                    size: responseSize
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
                    ttfb: ttfb
                };
            } else {
                serializedError = {
                    success: false,
                    message: `Error setting up request: ${error.message}`,
                    status: null,
                    statusText: null,
                    data: null,
                    headers: {},
                    ttfb: ttfb
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
