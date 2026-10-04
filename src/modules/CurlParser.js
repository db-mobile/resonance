/**
 * @fileoverview Parser for cURL commands to extract HTTP request data
 * @module CurlParser
 */

/**
 * @param {Object} request
 * @param {string} chunk
 * @returns {void}
 */
function appendBody(request, chunk) {
    request.body = request.body ? `${request.body}&${chunk}` : chunk;
    if (request.method === 'GET') {
        request.method = 'POST';
    }
}

/**
 * @param {string} headerName
 * @returns {(request: Object, value: string) => void}
 */
function setHeader(headerName) {
    return (request, value) => {
        request.headers[headerName] = value;
    };
}

/** @type {Object<string, (request: Object, value: string, parser: typeof CurlParser) => void>} */
const VALUE_OPTIONS = {
    '-X': (request, value) => { request.method = value.toUpperCase(); },
    '-H': (request, value, parser) => {
        const header = parser.parseHeader(value);
        if (header) {
            request.headers[header.key] = header.value;
        }
    },
    '-d': appendBody,
    '--data-raw': appendBody,
    '--data-binary': appendBody,
    '--data-urlencode': (request, value, parser) => appendBody(request, parser.encodeDataUrlencodeToken(value)),
    '-u': (request, value) => {
        const [username, password] = value.split(':');
        request.auth = {
            type: 'basic',
            username: username || '',
            password: password || ''
        };
    },
    '-A': setHeader('User-Agent'),
    '-e': setHeader('Referer'),
    '-b': setHeader('Cookie'),
    '-o': () => {},
    '--url': (request, value) => { request.url = value; }
};
VALUE_OPTIONS['--request'] = VALUE_OPTIONS['-X'];
VALUE_OPTIONS['--header'] = VALUE_OPTIONS['-H'];
VALUE_OPTIONS['--data'] = VALUE_OPTIONS['-d'];
VALUE_OPTIONS['--user'] = VALUE_OPTIONS['-u'];
VALUE_OPTIONS['--user-agent'] = VALUE_OPTIONS['-A'];
VALUE_OPTIONS['--referer'] = VALUE_OPTIONS['-e'];
VALUE_OPTIONS['--cookie'] = VALUE_OPTIONS['-b'];
VALUE_OPTIONS['--output'] = VALUE_OPTIONS['-o'];

const IGNORED_FLAGS = new Set(['curl', '-L', '--location', '-k', '--insecure', '-s', '--silent', '-v', '--verbose']);

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

        const request = {
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

            if (IGNORED_FLAGS.has(token)) {
                i++;
                continue;
            }

            if (token === '--compressed') {
                if (!request.headers['Accept-Encoding']) {
                    request.headers['Accept-Encoding'] = 'gzip, deflate';
                }
                i++;
                continue;
            }

            const applyOption = VALUE_OPTIONS[token];
            if (applyOption) {
                i++;
                if (i < tokens.length) {
                    applyOption(request, tokens[i], this);
                }
                i++;
                continue;
            }

            if (token.startsWith('-')) {
                i++;
                if (
                    i < tokens.length &&
                    !tokens[i].startsWith('-') &&
                    !(!request.url && this.isUrl(tokens[i]))
                ) {
                    i++;
                }
                continue;
            }

            if (!request.url && this.isUrl(token)) {
                request.url = token;
            }

            i++;
        }

        if (!request.url) {
            throw new Error('No URL found in cURL command');
        }

        const urlParts = this.parseUrl(request.url);
        request.url = urlParts.baseUrl;
        request.queryParams = urlParts.queryParams;

        request.name = this.generateRequestName(request.url, request.method);

        return request;
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
