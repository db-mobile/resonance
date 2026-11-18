/**
 * @fileoverview Lenient parsing of a URL's query string into key/value pairs.
 * @module utils/queryString
 */

/**
 * @param {string} component
 * @returns {string}
 */
export function safeDecodeURIComponent(component) {
    try {
        return decodeURIComponent(component);
    } catch {
        return component;
    }
}

/**
 * @param {string} urlString
 * @returns {Array<{key: string, value: string}>}
 */
export function parseUrlQueryPairs(urlString) {
    const questionMarkIndex = urlString.indexOf('?');
    const queryString = questionMarkIndex >= 0 ? urlString.substring(questionMarkIndex + 1) : '';
    const pairs = [];

    for (const pair of queryString.split('&')) {
        if (!pair.trim()) {
            continue;
        }

        const equalIndex = pair.indexOf('=');
        if (equalIndex >= 0) {
            pairs.push({
                key: safeDecodeURIComponent(pair.substring(0, equalIndex)),
                value: safeDecodeURIComponent(pair.substring(equalIndex + 1))
            });
        } else {
            pairs.push({ key: safeDecodeURIComponent(pair), value: '' });
        }
    }
    return pairs;
}
