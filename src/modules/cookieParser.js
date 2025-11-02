/**
 * Parses Set-Cookie headers and extracts cookie information
 */

/**
 * Parse a single Set-Cookie header value
 * @param {string} cookieString - The Set-Cookie header value
 * @returns {Object} Parsed cookie object
 */
function parseCookie(cookieString) {
    const parts = cookieString.split(';').map(part => part.trim());

    // First part is the name=value pair
    const [nameValue, ...attributes] = parts;
    const [name, value] = nameValue.split('=').map(s => s.trim());

    const cookie = {
        name: name || '',
        value: value || '',
        domain: null,
        path: null,
        expires: null,
        maxAge: null,
        httpOnly: false,
        secure: false,
        sameSite: null
    };

    // Parse attributes
    attributes.forEach(attr => {
        const [key, val] = attr.split('=').map(s => s ? s.trim() : '');
        const lowerKey = key.toLowerCase();

        switch (lowerKey) {
            case 'domain':
                cookie.domain = val;
                break;
            case 'path':
                cookie.path = val;
                break;
            case 'expires':
                cookie.expires = val;
                break;
            case 'max-age':
                cookie.maxAge = val;
                break;
            case 'httponly':
                cookie.httpOnly = true;
                break;
            case 'secure':
                cookie.secure = true;
                break;
            case 'samesite':
                cookie.sameSite = val || 'None';
                break;
        }
    });

    return cookie;
}

/**
 * Extract cookies from response headers
 * @param {Object} headers - Response headers object
 * @returns {Array} Array of parsed cookie objects
 */
export function extractCookies(headers) {
    if (!headers) {
        return [];
    }

    const cookies = [];

    // Check for set-cookie header (case-insensitive)
    const setCookieKey = Object.keys(headers).find(
        key => key.toLowerCase() === 'set-cookie'
    );

    if (!setCookieKey) {
        return cookies;
    }

    const setCookieValue = headers[setCookieKey];

    // set-cookie can be a string or an array
    if (Array.isArray(setCookieValue)) {
        setCookieValue.forEach(cookieString => {
            cookies.push(parseCookie(cookieString));
        });
    } else if (typeof setCookieValue === 'string') {
        cookies.push(parseCookie(setCookieValue));
    }

    return cookies;
}

/**
 * Format cookies as HTML table
 * @param {Array} cookies - Array of parsed cookie objects
 * @returns {string} HTML string
 */
export function formatCookiesAsHtml(cookies) {
    if (!cookies || cookies.length === 0) {
        return '<div class="cookies-empty">No cookies in response</div>';
    }

    let html = '<table class="cookies-table"><thead><tr>';
    html += '<th>Name</th>';
    html += '<th>Value</th>';
    html += '<th>Domain</th>';
    html += '<th>Path</th>';
    html += '<th>Expires</th>';
    html += '<th>Max-Age</th>';
    html += '<th>Flags</th>';
    html += '</tr></thead><tbody>';

    cookies.forEach(cookie => {
        html += '<tr>';
        html += `<td class="cookie-name">${escapeHtml(cookie.name)}</td>`;
        html += `<td class="cookie-value">${escapeHtml(cookie.value)}</td>`;
        html += `<td>${cookie.domain ? escapeHtml(cookie.domain) : '-'}</td>`;
        html += `<td>${cookie.path ? escapeHtml(cookie.path) : '-'}</td>`;
        html += `<td>${cookie.expires ? escapeHtml(cookie.expires) : '-'}</td>`;
        html += `<td>${cookie.maxAge ? escapeHtml(cookie.maxAge) : '-'}</td>`;

        // Build flags column
        const flags = [];
        if (cookie.httpOnly) flags.push('HttpOnly');
        if (cookie.secure) flags.push('Secure');
        if (cookie.sameSite) flags.push(`SameSite=${cookie.sameSite}`);

        html += `<td>${flags.length > 0 ? escapeHtml(flags.join(', ')) : '-'}</td>`;
        html += '</tr>';
    });

    html += '</tbody></table>';
    return html;
}

/**
 * Escape HTML special characters
 * @param {string} str - String to escape
 * @returns {string} Escaped string
 */
function escapeHtml(str) {
    if (str == null) return '';

    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}
