/**
 * @fileoverview Parser for cURL commands to extract HTTP request data
 * @module CurlParser
 */

export class CurlParser {
    /**
     * @param {string} curlCommand
     * @returns {Object}
     */
    static parse(curlCommand) {
        if (!curlCommand || typeof curlCommand !== 'string') {
            throw new Error('Invalid cURL command');
        }

        const normalized = this.normalizeCommand(curlCommand);
        const tokens = this.tokenize(normalized);

        const result = {
            method: 'GET',
            url: '',
            headers: {},
            body: null,
            auth: null,
            queryParams: {},
            name: ''
        };

        let i = 0;
        while (i < tokens.length) {
            const token = tokens[i];

            if (token === 'curl') {
                i++;
                continue;
            }

            if (token === '-X' || token === '--request') {
                i++;
                if (i < tokens.length) {
                    result.method = tokens[i].toUpperCase();
                }
                i++;
                continue;
            }

            if (token === '-H' || token === '--header') {
                i++;
                if (i < tokens.length) {
                    const header = this.parseHeader(tokens[i]);
                    if (header) {
                        result.headers[header.key] = header.value;
                    }
                }
                i++;
                continue;
            }

            if (token === '-d' || token === '--data' || token === '--data-raw' || token === '--data-binary') {
                i++;
                if (i < tokens.length) {
                    result.body = result.body ? `${result.body}&${tokens[i]}` : tokens[i];
                    if (result.method === 'GET') {
                        result.method = 'POST';
                    }
                }
                i++;
                continue;
            }

            if (token === '--data-urlencode') {
                i++;
                if (i < tokens.length) {
                    const encoded = this.encodeDataUrlencodeToken(tokens[i]);
                    result.body = result.body ? `${result.body}&${encoded}` : encoded;
                    if (result.method === 'GET') {
                        result.method = 'POST';
                    }
                }
                i++;
                continue;
            }

            if (token === '-u' || token === '--user') {
                i++;
                if (i < tokens.length) {
                    const [username, password] = tokens[i].split(':');
                    result.auth = {
                        type: 'basic',
                        username: username || '',
                        password: password || ''
                    };
                }
                i++;
                continue;
            }

            if (token === '-A' || token === '--user-agent') {
                i++;
                if (i < tokens.length) {
                    result.headers['User-Agent'] = tokens[i];
                }
                i++;
                continue;
            }

            if (token === '-e' || token === '--referer') {
                i++;
                if (i < tokens.length) {
                    result.headers['Referer'] = tokens[i];
                }
                i++;
                continue;
            }

            if (token === '-b' || token === '--cookie') {
                i++;
                if (i < tokens.length) {
                    result.headers['Cookie'] = tokens[i];
                }
                i++;
                continue;
            }

            if (token === '--compressed') {
                if (!result.headers['Accept-Encoding']) {
                    result.headers['Accept-Encoding'] = 'gzip, deflate';
                }
                i++;
                continue;
            }

            if (token === '-L' || token === '--location') {
                i++;
                continue;
            }

            if (token === '-k' || token === '--insecure') {
                i++;
                continue;
            }

            if (token === '-s' || token === '--silent') {
                i++;
                continue;
            }

            if (token === '-v' || token === '--verbose') {
                i++;
                continue;
            }

            if (token === '-o' || token === '--output') {
                i += 2;
                continue;
            }

            if (token === '--url') {
                i++;
                if (i < tokens.length) {
                    result.url = tokens[i];
                }
                i++;
                continue;
            }

            if (token.startsWith('-')) {
                i++;
                if (
                    i < tokens.length &&
                    !tokens[i].startsWith('-') &&
                    !(!result.url && this.isUrl(tokens[i]))
                ) {
                    i++;
                }
                continue;
            }

            if (!result.url && this.isUrl(token)) {
                result.url = token;
            }

            i++;
        }

        if (!result.url) {
            throw new Error('No URL found in cURL command');
        }

        const urlParts = this.parseUrl(result.url);
        result.url = urlParts.baseUrl;
        result.queryParams = urlParts.queryParams;

        result.name = this.generateRequestName(result.url, result.method);

        return result;
    }

    /**
     * @param {string} token
     * @returns {string}
     */
    static encodeDataUrlencodeToken(token) {
        const eq = token.indexOf('=');
        const at = token.indexOf('@');

        if (eq >= 0 && (at < 0 || eq < at)) {
            const name = token.slice(0, eq);
            const content = token.slice(eq + 1);
            return name ? `${name}=${encodeURIComponent(content)}` : encodeURIComponent(content);
        }

        if (at >= 0) {
            return token;
        }

        return encodeURIComponent(token);
    }

    /**
     * @param {string} command
     * @returns {string}
     */
    static normalizeCommand(command) {
        return command
            .replace(/\\\r?\n/g, ' ')
            .replace(/\r?\n/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    /**
     * @param {string} command
     * @returns {Array<string>}
     */
    static tokenize(command) {
        const tokens = [];
        let current = '';
        let inSingleQuote = false;
        let inDoubleQuote = false;
        let escape = false;

        for (let i = 0; i < command.length; i++) {
            const char = command[i];

            if (escape) {
                current += char;
                escape = false;
                continue;
            }

            if (char === '\\' && !inSingleQuote) {
                escape = true;
                continue;
            }

            if (char === "'" && !inDoubleQuote) {
                inSingleQuote = !inSingleQuote;
                continue;
            }

            if (char === '"' && !inSingleQuote) {
                inDoubleQuote = !inDoubleQuote;
                continue;
            }

            if (char === ' ' && !inSingleQuote && !inDoubleQuote) {
                if (current) {
                    tokens.push(current);
                    current = '';
                }
                continue;
            }

            current += char;
        }

        if (current) {
            tokens.push(current);
        }

        return tokens;
    }

    /**
     * @param {string} headerStr
     * @returns {Object|null}
     */
    static parseHeader(headerStr) {
        const colonIndex = headerStr.indexOf(':');
        if (colonIndex === -1) {
            return null;
        }

        const key = headerStr.substring(0, colonIndex).trim();
        const value = headerStr.substring(colonIndex + 1).trim();

        return { key, value };
    }

    /**
     * @param {string} url
     * @returns {Object}
     */
    static parseUrl(url) {
        const questionIndex = url.indexOf('?');
        if (questionIndex === -1) {
            return { baseUrl: url, queryParams: {} };
        }

        const baseUrl = url.substring(0, questionIndex);
        const queryString = url.substring(questionIndex + 1);
        const queryParams = {};

        queryString.split('&').forEach(pair => {
            const [key, value] = pair.split('=');
            if (key) {
                queryParams[decodeURIComponent(key)] = value ? decodeURIComponent(value) : '';
            }
        });

        return { baseUrl, queryParams };
    }

    /**
     * @param {string} str
     * @returns {boolean}
     */
    static isUrl(str) {
        return str.startsWith('http://') || 
               str.startsWith('https://') || 
               str.startsWith('{{') ||
               /^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(str);
    }

    /**
     * @param {string} url
     * @param {string} method
     * @returns {string}
     */
    static generateRequestName(url, method) {
        try {
            let path = url;
            
            if (url.startsWith('http://') || url.startsWith('https://')) {
                const urlObj = new URL(url);
                path = urlObj.pathname;
            } else if (url.includes('/')) {
                const slashIndex = url.indexOf('/');
                path = url.substring(slashIndex);
            }

            path = path.replace(/^\/+|\/+$/g, '');

            if (!path) {
                return `${method} Request`;
            }

            const segments = path.split('/');
            const lastSegment = segments[segments.length - 1] || segments[segments.length - 2] || 'request';

            const name = lastSegment
                .replace(/[_-]/g, ' ')
                .replace(/\b\w/g, c => c.toUpperCase());

            return `${method} ${name}`;
        } catch {
            return `${method} Request`;
        }
    }

    /**
     * @param {Object} parsed
     * @returns {Object}
     */
    static toEndpoint(parsed) {
        const endpoint = {
            name: parsed.name,
            method: parsed.method,
            path: parsed.url,
            description: 'Imported from cURL',
            parameters: {
                query: {},
                header: {},
                path: {}
            },
            requestBody: null,
            headers: parsed.headers
        };

        if (Object.keys(parsed.queryParams).length > 0) {
            Object.entries(parsed.queryParams).forEach(([key, value]) => {
                endpoint.parameters.query[key] = {
                    example: value,
                    required: false
                };
            });
        }

        if (parsed.body) {
            const contentType = parsed.headers['Content-Type'] || parsed.headers['content-type'] || 'application/json';
            
            endpoint.requestBody = {
                contentType: contentType,
                example: parsed.body,
                required: true
            };
        }

        return endpoint;
    }
}
