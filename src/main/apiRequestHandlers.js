import axios from 'axios';

class ApiRequestHandler {
    constructor(store) {
        this.store = store;
        this.currentRequestController = null;
    }

    /**
     * Calculate the size of the response body in bytes from raw response data
     * (equivalent to cURL's size_download)
     */
    calculateResponseSize(rawData) {
        if (!rawData) {
            return 0;
        }

        // Measure the actual bytes of the raw response
        return new TextEncoder().encode(rawData).length;
    }

    /**
     * Handle API request with abort support
     */
    async handleApiRequest(requestOptions) {
        let startTime = Date.now();

        try {
            console.log('Received request options:', requestOptions);

            // Create a new AbortController for this request
            this.currentRequestController = new AbortController();

            // Get HTTP version settings
            const settings = this.store.get('settings', {});
            const httpVersion = settings.httpVersion || 'auto';

            // Prepare the axios config
            const axiosConfig = {
                method: requestOptions.method,
                url: requestOptions.url,
                headers: requestOptions.headers || {},
                timeout: 30000, // 30 second timeout
                signal: this.currentRequestController.signal,
                // Get raw response data to measure actual download size
                transformResponse: [(data) => data]
            };

            // Apply HTTP version configuration
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
                    // Let axios/Node.js decide (default behavior)
                    break;
            }

            // Handle request body for POST/PUT/PATCH requests
            if (requestOptions.body && ['POST', 'PUT', 'PATCH'].includes(requestOptions.method.toUpperCase())) {
                if (typeof requestOptions.body === 'object') {
                    axiosConfig.data = JSON.stringify(requestOptions.body);
                    // Ensure Content-Type is set for JSON
                    if (!axiosConfig.headers['Content-Type'] && !axiosConfig.headers['content-type']) {
                        axiosConfig.headers['Content-Type'] = 'application/json';
                    }
                } else {
                    axiosConfig.data = requestOptions.body;
                }
            }

            console.log('Axios config:', axiosConfig);

            startTime = Date.now();
            const response = await axios(axiosConfig);
            const ttfb = Date.now() - startTime;

            // Clear the controller on successful completion
            this.currentRequestController = null;

            const serializedHeaders = JSON.parse(JSON.stringify(response.headers));

            // Calculate size from raw response data (before parsing)
            const rawData = response.data;
            const responseSize = this.calculateResponseSize(rawData);

            // Parse the response data
            let parsedData;
            try {
                parsedData = typeof rawData === 'string' ? JSON.parse(rawData) : rawData;
            } catch (e) {
                // If JSON parsing fails, use raw data
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

            // Check if the error is due to cancellation
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
                // Calculate size from raw response data
                const rawData = error.response.data;
                const responseSize = this.calculateResponseSize(rawData);

                // Parse the error response data
                let parsedData;
                try {
                    parsedData = typeof rawData === 'string' ? JSON.parse(rawData) : rawData;
                } catch (e) {
                    // If JSON parsing fails, use raw data
                    parsedData = rawData;
                }

                // Server responded with error status
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

                // Safely serialize headers
                try {
                    if (error.response.headers) {
                        serializedError.headers = JSON.parse(JSON.stringify(error.response.headers));
                    }
                } catch (headerError) {
                    console.warn('Failed to serialize response headers:', headerError);
                    serializedError.headers = {};
                }
            } else if (error.request) {
                // Request was made but no response received
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
                // Something else happened
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

    /**
     * Cancel the current API request
     */
    cancelRequest() {
        if (this.currentRequestController) {
            console.log('Cancelling current request...');
            this.currentRequestController.abort();
            this.currentRequestController = null;
            return { success: true, message: 'Request cancelled' };
        }
        return { success: false, message: 'No active request to cancel' };
    }
}

export default ApiRequestHandler;
