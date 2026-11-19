/**
 * @fileoverview Parser for cURL commands to extract HTTP request data
 * @module CurlParser
 */

import { parseUrlQueryPairs } from './utils/queryString.js';

const JSON_TYPE = 'application/json';

const ANSI_C_ESCAPES = {
    n: '\n', t: '\t', r: '\r', a: '\x07', b: '\b', e: '\x1b', E: '\x1b', f: '\f', v: '\v',
    '\\': '\\', "'": "'", '"': '"', '?': '?'
};

const DOUBLE_QUOTE_ESCAPABLE = new Set(['"', '\\', '$', '`']);

/**
 * @param {Object} draft
 * @param {string} name
 * @returns {boolean}
 */
function hasHeader(draft, name) {
    return Object.keys(draft.headers).some(key => key.toLowerCase() === name.toLowerCase());
}

/**
 * @param {Object} draft
 * @param {string} chunk
 * @returns {void}
 */
function appendBody(draft, chunk) {
    draft.body = draft.body === null ? chunk : `${draft.body}&${chunk}`;
}

/**
 * @param {Object} draft
 * @param {string} chunk
 * @returns {void}
 */
function appendJson(draft, chunk) {
    draft.body = draft.body === null ? chunk : draft.body + chunk;
    draft.json = true;
}

/**
 * @param {string} headerName
 * @returns {function(Object, string): void}
 */
function setHeader(headerName) {
    return (draft, value) => {
        draft.headers[headerName] = value;
    };
}

/**
 * @param {string} value
 * @returns {string}
 */
function unquote(value) {
    return value.length >= 2 && value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value;
}

/**
 * @param {string} token
 * @param {boolean} literal
 * @returns {{key: string, value: string, type: string, filePath: string, contentType: string, enabled: boolean}}
 */
function formField(token, literal) {
    const eq = token.indexOf('=');
    const key = eq === -1 ? token : token.slice(0, eq);
    const content = eq === -1 ? '' : token.slice(eq + 1);
    const row = { key, value: content, type: 'text', filePath: '', contentType: '', enabled: true };
    if (literal) {
        return row;
    }
    const [main, ...attributes] = content.startsWith('"') ? [content] : content.split(';');
    attributes.forEach((attribute) => {
        const [name, attributeValue = ''] = attribute.split('=');
        if (name.trim().toLowerCase() === 'type') {
            row.contentType = unquote(attributeValue.trim());
        }
    });
    if (main.startsWith('@')) {
        return { ...row, value: '', type: 'file', filePath: unquote(main.slice(1)) };
    }
    return { ...row, value: unquote(main) };
}

/**
 * @param {boolean} literal
 * @returns {function(Object, string): void}
 */
function addFormField(literal) {
    return (draft, value) => {
        draft.formFields.push(formField(value, literal));
    };
}

/** @type {Object<string, function(Object, string, typeof CurlParser): void>} */
const VALUE_OPTIONS = {
    '-X': (draft, value) => { draft.explicitMethod = value.toUpperCase(); },
    '-H': (draft, value, parser) => {
        const header = parser.parseHeader(value);
        if (header) {
            draft.headers[header.key] = header.value;
        }
    },
    '-d': appendBody,
    '--data-raw': appendBody,
    '--data-binary': appendBody,
    '--data-ascii': appendBody,
    '--data-urlencode': (draft, value, parser) => appendBody(draft, parser.encodeDataUrlencodeToken(value)),
    '--json': appendJson,
    '-F': addFormField(false),
    '--form-string': addFormField(true),
    '-u': (draft, value) => {
        const separator = value.indexOf(':');
        draft.auth = {
            type: 'basic',
            config: {
                username: separator === -1 ? value : value.slice(0, separator),
                password: separator === -1 ? '' : value.slice(separator + 1)
            }
        };
    },
    '-A': setHeader('User-Agent'),
    '-e': setHeader('Referer'),
    '-b': setHeader('Cookie'),
    '--url': (draft, value) => { draft.url = value; }
};
VALUE_OPTIONS['--request'] = VALUE_OPTIONS['-X'];
VALUE_OPTIONS['--header'] = VALUE_OPTIONS['-H'];
VALUE_OPTIONS['--data'] = VALUE_OPTIONS['-d'];
VALUE_OPTIONS['--form'] = VALUE_OPTIONS['-F'];
VALUE_OPTIONS['--user'] = VALUE_OPTIONS['-u'];
VALUE_OPTIONS['--user-agent'] = VALUE_OPTIONS['-A'];
VALUE_OPTIONS['--referer'] = VALUE_OPTIONS['-e'];
VALUE_OPTIONS['--cookie'] = VALUE_OPTIONS['-b'];

[
    '-o', '--output', '-x', '--proxy', '-U', '--proxy-user', '--proxy-header', '--noproxy',
    '-m', '--max-time', '--connect-timeout', '-w', '--write-out', '-c', '--cookie-jar',
    '-E', '--cert', '--cert-type', '--key', '--key-type', '--pass', '--cacert', '--capath',
    '-D', '--dump-header', '-K', '--config', '-r', '--range', '-C', '--continue-at',
    '-z', '--time-cond', '-y', '--speed-time', '-Y', '--speed-limit', '-T', '--upload-file',
    '--retry', '--retry-delay', '--retry-max-time', '--resolve', '--connect-to', '--interface',
    '--limit-rate', '--max-redirs', '--max-filesize', '--unix-socket', '--oauth2-bearer',
    '--aws-sigv4', '--trace', '--trace-ascii', '--stderr', '--proto', '--ciphers', '--tls-max',
    '--dns-servers', '--request-target', '--output-dir', '--etag-save', '--etag-compare',
    '--netrc-file', '--keepalive-time', '--expect100-timeout', '--local-port'
].forEach((option) => {
    VALUE_OPTIONS[option] = () => {};
});

/** @type {Object<string, function(Object): void>} */
const FLAG_OPTIONS = {
    '-I': (draft) => { draft.head = true; },
    '-G': (draft) => { draft.get = true; },
    '--compressed': (draft) => {
        if (!hasHeader(draft, 'Accept-Encoding')) {
            draft.headers['Accept-Encoding'] = 'gzip, deflate';
        }
    }
};
FLAG_OPTIONS['--head'] = FLAG_OPTIONS['-I'];
FLAG_OPTIONS['--get'] = FLAG_OPTIONS['-G'];

export class CurlParser {
    /**
     * @param {string} curlCommand
     * @returns {Object}
     */
    static parse(curlCommand) {
        if (!curlCommand || typeof curlCommand !== 'string') {
            throw new Error('Invalid cURL command');
        }

        const tokens = this.tokenize(curlCommand);
        const draft = {
            url: '',
            headers: {},
            body: null,
            auth: null,
            formFields: [],
            positionals: [],
            explicitMethod: null,
            head: false,
            get: false,
            json: false
        };

        let optionsEnded = false;
        for (let i = 0; i < tokens.length; i++) {
            const token = tokens[i];
            if (optionsEnded || !token.startsWith('-') || token === '-') {
                if (token !== 'curl' || draft.positionals.length > 0) {
                    draft.positionals.push(token);
                }
            } else if (token === '--') {
                optionsEnded = true;
            } else if (token.startsWith('--')) {
                i += this.applyLongOption(draft, token, tokens[i + 1]);
            } else {
                i += this.applyShortOptions(draft, token, tokens[i + 1]);
            }
        }

        const rawUrl = draft.url || draft.positionals.find(value => this.isUrl(value)) || draft.positionals[0];
        if (!rawUrl) {
            throw new Error('No URL found in cURL command');
        }

        if (draft.json) {
            if (!hasHeader(draft, 'Content-Type')) {
                draft.headers['Content-Type'] = JSON_TYPE;
            }
            if (!hasHeader(draft, 'Accept')) {
                draft.headers.Accept = JSON_TYPE;
            }
        }

        const sendsData = draft.body !== null && !draft.get;
        const sendsForm = draft.formFields.length > 0;
        const urlParts = this.parseUrl(draft.get && draft.body !== null ? this.appendQuery(rawUrl, draft.body) : rawUrl);
        let method = sendsData || sendsForm ? 'POST' : 'GET';
        if (draft.head) {
            method = 'HEAD';
        }
        method = draft.explicitMethod || method;

        return {
            method,
            url: urlParts.baseUrl,
            headers: draft.headers,
            body: sendsData ? draft.body : null,
            formBody: sendsForm ? { mode: 'formdata', fields: draft.formFields } : null,
            auth: draft.auth,
            queryParams: urlParts.queryParams,
            name: this.generateRequestName(urlParts.baseUrl, method)
        };
    }

    /**
     * @param {Object} draft
     * @param {string} token
     * @param {string|undefined} next
     * @returns {number}
     */
    static applyLongOption(draft, token, next) {
        const eq = token.indexOf('=');
        const name = eq === -1 ? token : token.slice(0, eq);
        const applyValue = VALUE_OPTIONS[name];
        if (applyValue && eq !== -1) {
            applyValue(draft, token.slice(eq + 1), this);
            return 0;
        }
        if (applyValue) {
            if (next !== undefined) {
                applyValue(draft, next, this);
            }
            return 1;
        }
        FLAG_OPTIONS[token]?.(draft);
        return 0;
    }

    /**
     * @param {Object} draft
     * @param {string} token
     * @param {string|undefined} next
     * @returns {number}
     */
    static applyShortOptions(draft, token, next) {
        for (let j = 1; j < token.length; j++) {
            const option = `-${token[j]}`;
            const applyValue = VALUE_OPTIONS[option];
            if (applyValue) {
                const attached = token.slice(j + 1);
                if (attached) {
                    applyValue(draft, attached, this);
                    return 0;
                }
                if (next !== undefined) {
                    applyValue(draft, next, this);
                }
                return 1;
            }
            FLAG_OPTIONS[option]?.(draft);
        }
        return 0;
    }

    /**
     * @param {string} url
     * @param {string} query
     * @returns {string}
     */
    static appendQuery(url, query) {
        const hash = url.indexOf('#');
        const base = hash === -1 ? url : url.slice(0, hash);
        if (!query) {
            return base;
        }
        return `${base}${base.includes('?') ? '&' : '?'}${query}`;
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
     * @returns {Array<string>}
     */
    static tokenize(command) {
        const tokens = [];
        let current = '';
        let started = false;
        let i = 0;

        while (i < command.length) {
            const char = command[i];
            const next = command[i + 1];

            if (char === '\\' && next === '\r' && command[i + 2] === '\n') {
                i += 3;
            } else if (char === '\\' && next === '\n') {
                i += 2;
            } else if (char === '\\') {
                current += next ?? '';
                started = true;
                i += 2;
            } else if (char === '$' && next === "'") {
                const quoted = this.readAnsiCQuoted(command, i + 2);
                current += quoted.text;
                started = true;
                i = quoted.end;
            } else if (char === "'") {
                const close = command.indexOf("'", i + 1);
                const end = close === -1 ? command.length : close;
                current += command.slice(i + 1, end);
                started = true;
                i = end + 1;
            } else if (char === '"') {
                const quoted = this.readDoubleQuoted(command, i + 1);
                current += quoted.text;
                started = true;
                i = quoted.end;
            } else if (/\s/.test(char)) {
                if (started) {
                    tokens.push(current);
                }
                current = '';
                started = false;
                i += 1;
            } else {
                current += char;
                started = true;
                i += 1;
            }
        }

        if (started) {
            tokens.push(current);
        }

        return tokens;
    }

    /**
     * @param {string} command
     * @param {number} start
     * @returns {{text: string, end: number}}
     */
    static readDoubleQuoted(command, start) {
        let text = '';
        let i = start;
        while (i < command.length && command[i] !== '"') {
            const next = command[i + 1];
            if (command[i] !== '\\' || next === undefined) {
                text += command[i];
                i += 1;
            } else if (next === '\n') {
                i += 2;
            } else if (next === '\r' && command[i + 2] === '\n') {
                i += 3;
            } else {
                text += DOUBLE_QUOTE_ESCAPABLE.has(next) ? next : `\\${next}`;
                i += 2;
            }
        }
        return { text, end: i + 1 };
    }

    /**
     * @param {string} command
     * @param {number} start
     * @returns {{text: string, end: number}}
     */
    static readAnsiCQuoted(command, start) {
        let text = '';
        let i = start;
        while (i < command.length && command[i] !== "'") {
            if (command[i] !== '\\' || i + 1 >= command.length) {
                text += command[i];
                i += 1;
                continue;
            }
            const rest = command.slice(i + 1);
            const coded = /^(?:x([0-9a-fA-F]{1,2})|u([0-9a-fA-F]{1,4})|U([0-9a-fA-F]{1,8}))/.exec(rest);
            const octal = /^[0-7]{1,3}/.exec(rest);
            if (coded) {
                text += String.fromCodePoint(Math.min(parseInt(coded[1] || coded[2] || coded[3], 16), 0x10FFFF));
                i += 1 + coded[0].length;
            } else if (octal) {
                text += String.fromCharCode(parseInt(octal[0], 8));
                i += 1 + octal[0].length;
            } else {
                text += ANSI_C_ESCAPES[rest[0]] ?? `\\${rest[0]}`;
                i += 2;
            }
        }
        return { text, end: i + 1 };
    }

    /**
     * @param {string} headerStr
     * @returns {{key: string, value: string}|null}
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
     * @returns {{baseUrl: string, queryParams: Object<string, string>}}
     */
    static parseUrl(url) {
        const hash = url.indexOf('#');
        const withoutFragment = hash === -1 ? url : url.slice(0, hash);
        const questionIndex = withoutFragment.indexOf('?');
        if (questionIndex === -1) {
            return { baseUrl: withoutFragment, queryParams: {} };
        }

        const queryParams = {};
        parseUrlQueryPairs(withoutFragment).forEach(({ key, value }) => {
            if (key) {
                queryParams[key] = value;
            }
        });

        return { baseUrl: withoutFragment.substring(0, questionIndex), queryParams };
    }

    /**
     * @param {string} str
     * @returns {boolean}
     */
    static isUrl(str) {
        return /^https?:\/\//i.test(str) ||
               str.startsWith('{{') ||
               /^localhost(?:[:/?]|$)/i.test(str) ||
               /^\[?[0-9a-fA-F:.]+\]?:\d+(?:[/?]|$)/.test(str) ||
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

        if (parsed.formBody) {
            endpoint.formBody = parsed.formBody;
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
