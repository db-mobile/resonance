import crypto from 'crypto';

/**
 * DigestAuthHandler - Implements HTTP Digest Authentication (RFC 2617)
 *
 * Digest authentication uses MD5 hashing to securely authenticate without
 * sending passwords in plain text over the network.
 */
export class DigestAuthHandler {
    /**
     * Parse WWW-Authenticate header for Digest challenge
     * @param {string} wwwAuthenticateHeader - The WWW-Authenticate header value
     * @returns {Object|null} Parsed digest parameters or null if invalid
     */
    static parseDigestChallenge(wwwAuthenticateHeader) {
        if (!wwwAuthenticateHeader || !wwwAuthenticateHeader.includes('Digest')) {
            return null;
        }

        const challenge = {};
        const regex = /(\w+)=["']?([^"',]+)["']?/g;
        let match;

        while ((match = regex.exec(wwwAuthenticateHeader)) !== null) {
            challenge[match[1]] = match[2];
        }

        return challenge;
    }

    /**
     * Calculate MD5 hash of a string
     * @param {string} data - Data to hash
     * @returns {string} MD5 hash in hexadecimal
     */
    static md5(data) {
        return crypto.createHash('md5').update(data).digest('hex');
    }

    /**
     * Generate client nonce for digest authentication
     * @returns {string} Random nonce
     */
    static generateClientNonce() {
        return crypto.randomBytes(16).toString('hex');
    }

    /**
     * Build Authorization header for Digest authentication
     * @param {Object} options - Authentication options
     * @param {string} options.username - Username
     * @param {string} options.password - Password
     * @param {string} options.method - HTTP method (GET, POST, etc.)
     * @param {string} options.uri - Request URI
     * @param {Object} options.challenge - Parsed digest challenge from server
     * @param {number} options.nc - Nonce count (default: 1)
     * @param {string} options.cnonce - Client nonce (auto-generated if not provided)
     * @returns {string} Authorization header value
     */
    static buildAuthorizationHeader(options) {
        const {
            username,
            password,
            method,
            uri,
            challenge,
            nc = 1,
            cnonce = this.generateClientNonce()
        } = options;

        const realm = challenge.realm || '';
        const nonce = challenge.nonce || '';
        const qop = challenge.qop || '';
        const algorithm = (challenge.algorithm || 'MD5').toUpperCase();
        const opaque = challenge.opaque || '';

        // Calculate HA1 - hash of username:realm:password
        let ha1;
        if (algorithm === 'MD5' || algorithm === 'MD5-SESS') {
            ha1 = this.md5(`${username}:${realm}:${password}`);
            if (algorithm === 'MD5-SESS') {
                ha1 = this.md5(`${ha1}:${nonce}:${cnonce}`);
            }
        } else {
            throw new Error(`Unsupported algorithm: ${algorithm}`);
        }

        // Calculate HA2 - hash of method:uri
        const ha2 = this.md5(`${method}:${uri}`);

        // Calculate response hash
        let response;
        if (qop === 'auth' || qop === 'auth-int') {
            // Format nc as 8-digit hex
            const ncHex = (`00000000${  nc.toString(16)}`).slice(-8);
            response = this.md5(`${ha1}:${nonce}:${ncHex}:${cnonce}:${qop}:${ha2}`);
        } else {
            // Legacy digest without qop
            response = this.md5(`${ha1}:${nonce}:${ha2}`);
        }

        // Build authorization header
        let authHeader = `Digest username="${username}", realm="${realm}", nonce="${nonce}", uri="${uri}", response="${response}"`;

        if (algorithm) {
            authHeader += `, algorithm=${algorithm}`;
        }

        if (opaque) {
            authHeader += `, opaque="${opaque}"`;
        }

        if (qop) {
            const ncHex = (`00000000${  nc.toString(16)}`).slice(-8);
            authHeader += `, qop=${qop}, nc=${ncHex}, cnonce="${cnonce}"`;
        }

        return authHeader;
    }

    /**
     * Extract URI path from full URL
     * @param {string} url - Full URL
     * @returns {string} URI path
     */
    static extractUriFromUrl(url) {
        try {
            const urlObj = new URL(url);
            return urlObj.pathname + urlObj.search;
        } catch (error) {
            // If URL parsing fails, try to extract path manually
            const match = url.match(/https?:\/\/[^/]+(\/.*)/);
            return match ? match[1] : '/';
        }
    }
}

/**
 * Handle Digest authentication for axios requests
 * This function makes an initial request, handles the 401 challenge,
 * and retries with the proper Digest authentication header.
 *
 * @param {Function} axiosRequest - Function that makes the axios request
 * @param {Object} authConfig - Authentication configuration
 * @param {string} authConfig.username - Username
 * @param {string} authConfig.password - Password
 * @param {string} method - HTTP method
 * @param {string} url - Request URL
 * @returns {Promise<Object>} Axios response
 */
export async function handleDigestAuth(axiosRequest, authConfig, method, url) {
    try {
        // First attempt - will likely get 401
        return await axiosRequest();
    } catch (error) {
        // Check if it's a 401 with Digest challenge
        if (error.response && error.response.status === 401) {
            const wwwAuthenticate = error.response.headers['www-authenticate'];

            if (wwwAuthenticate && wwwAuthenticate.includes('Digest')) {
                const challenge = DigestAuthHandler.parseDigestChallenge(wwwAuthenticate);

                if (challenge) {
                    const uri = DigestAuthHandler.extractUriFromUrl(url);

                    const authHeader = DigestAuthHandler.buildAuthorizationHeader({
                        username: authConfig.username,
                        password: authConfig.password,
                        method: method.toUpperCase(),
                        uri: uri,
                        challenge: challenge
                    });

                    // Retry request with digest auth header
                    return axiosRequest(authHeader);
                }
            }
        }

        // If it's not a digest auth challenge or retry failed, re-throw the error
        throw error;
    }
}
