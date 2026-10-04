/** @fileoverview Range and type checks shared by the proxy service and repository */

/** @type {ReadonlyArray<string>} */
const VALID_PROXY_TYPES = Object.freeze(['http', 'https', 'socks4', 'socks5']);

/**
 * @param {string} type
 * @returns {boolean}
 */
export function isValidProxyType(type) {
    return VALID_PROXY_TYPES.includes(type);
}

/**
 * @param {number|string} port
 * @returns {boolean}
 */
export function isValidPort(port) {
    const portNum = parseInt(port, 10);
    return !isNaN(portNum) && portNum >= 1 && portNum <= 65535;
}

/**
 * @param {number|string} timeout
 * @returns {boolean}
 */
export function isValidTimeout(timeout) {
    const timeoutNum = parseInt(timeout, 10);
    return !isNaN(timeoutNum) && timeoutNum >= 0 && timeoutNum <= 300000;
}
