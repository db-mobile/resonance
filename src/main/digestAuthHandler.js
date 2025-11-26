/**
 * @fileoverview HTTP Digest Authentication implementation following RFC 2617
 * @module main/digestAuthHandler
 */

import crypto from 'crypto';

/**
 * Handler for HTTP Digest Authentication
 *
 * @class
 * @classdesc Implements HTTP Digest Authentication (RFC 2617) using MD5 hashing
 * to securely authenticate without sending passwords in plain text. Supports
 * both legacy digest and modern qop-based authentication schemes.
 */
export class DigestAuthHandler {
    /**
     * Parses WWW-Authenticate header to extract digest challenge parameters
     *
     * Extracts authentication parameters like realm, nonce, qop, algorithm, and opaque
     * from the server's digest challenge.
     *
     * @param {string} wwwAuthenticateHeader - The WWW-Authenticate header value from server response
     * @returns {Object|null} Object containing digest challenge parameters, or null if invalid/missing
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
     * Calculates MD5 hash of a string
     *
     * Uses Node.js crypto module to generate an MD5 hash for digest authentication.
     * MD5 is required by RFC 2617 for digest authentication despite known vulnerabilities.
     *
     * @param {string} data - The string data to hash
     * @returns {string} MD5 hash as a hexadecimal string
     */
    static md5(data) {
        return crypto.createHash('md5').update(data).digest('hex');
    }

    /**
     * Generates a random client nonce for digest authentication
     *
     * Creates a cryptographically random 16-byte value used to prevent replay attacks
     * in digest authentication.
     *
     * @returns {string} Random 32-character hexadecimal nonce
     */
    static generateClientNonce() {
        return crypto.randomBytes(16).toString('hex');
    }

    /**
     * Builds the Authorization header value for digest authentication
     *
     * Constructs the complete digest authentication header by calculating HA1 (hash of
     * credentials), HA2 (hash of method and URI), and the response hash. Supports both
     * MD5 and MD5-SESS algorithms, and handles qop (quality of protection) modes.
     *
     * @param {Object} options - Authentication configuration options
     * @param {string} options.username - Username for authentication
     * @param {string} options.password - Password for authentication
     * @param {string} options.method - HTTP method (GET, POST, etc.)
     * @param {string} options.uri - Request URI path with query string
     * @param {Object} options.challenge - Parsed digest challenge from server (from parseDigestChallenge)
     * @param {number} [options.nc=1] - Nonce count for request tracking
     * @param {string} [options.cnonce] - Client nonce (auto-generated if not provided)
     * @returns {string} Complete Authorization header value
     * @throws {Error} If unsupported algorithm is specified in challenge
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

        let ha1;
        if (algorithm === 'MD5' || algorithm === 'MD5-SESS') {
            ha1 = this.md5(`${username}:${realm}:${password}`);
            if (algorithm === 'MD5-SESS') {
                ha1 = this.md5(`${ha1}:${nonce}:${cnonce}`);
            }
        } else {
            throw new Error(`Unsupported algorithm: ${algorithm}`);
        }

        const ha2 = this.md5(`${method}:${uri}`);

        let response;
        if (qop === 'auth' || qop === 'auth-int') {
            const ncHex = (`00000000${  nc.toString(16)}`).slice(-8);
            response = this.md5(`${ha1}:${nonce}:${ncHex}:${cnonce}:${qop}:${ha2}`);
        } else {
            response = this.md5(`${ha1}:${nonce}:${ha2}`);
        }

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
     * Extracts the URI path and query string from a full URL
     *
     * Parses the URL to extract just the pathname and search components needed
     * for digest authentication. Falls back to manual parsing if URL parsing fails.
     *
     * @param {string} url - The complete URL (e.g., "https://example.com/api/users?id=1")
     * @returns {string} URI path with query string (e.g., "/api/users?id=1"), or "/" if parsing fails
     */
    static extractUriFromUrl(url) {
        try {
            const urlObj = new URL(url);
            return urlObj.pathname + urlObj.search;
        } catch (error) {
            const match = url.match(/https?:\/\/[^/]+(\/.*)/);
            return match ? match[1] : '/';
        }
    }
}

/**
 * Handles digest authentication for HTTP requests using a two-step process
 *
 * Implements the digest authentication flow by making an initial request,
 * capturing the 401 challenge from the server, computing the digest response,
 * and retrying the request with proper authentication. This follows the standard
 * digest authentication handshake defined in RFC 2617.
 *
 * @async
 * @param {Function} axiosRequest - Function that executes the axios request, optionally accepting an Authorization header
 * @param {Object} authConfig - Authentication credentials
 * @param {string} authConfig.username - Username for authentication
 * @param {string} authConfig.password - Password for authentication
 * @param {string} method - HTTP method (GET, POST, etc.)
 * @param {string} url - Complete request URL
 * @returns {Promise<Object>} Axios response object from the authenticated request
 * @throws {Error} If authentication fails or request errors occur
 */
export async function handleDigestAuth(axiosRequest, authConfig, method, url) {
    try {
        return await axiosRequest();
    } catch (error) {
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

                    return axiosRequest(authHeader);
                }
            }
        }

        throw error;
    }
}
