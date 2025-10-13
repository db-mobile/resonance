import axios from 'axios';

class ApiRequestHandler {
    constructor(store) {
        this.store = store;
        this.currentRequestController = null;
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

            return {
                success: true,
                data: response.data,
                status: response.status,
                statusText: response.statusText,
                headers: JSON.parse(JSON.stringify(response.headers)),
                ttfb: ttfb
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
                // Server responded with error status
                serializedError = {
                    success: false,
                    message: error.message || `HTTP Error ${error.response.status}`,
                    status: error.response.status,
                    statusText: error.response.statusText,
                    data: error.response.data,
                    headers: {},
                    ttfb: ttfb
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
