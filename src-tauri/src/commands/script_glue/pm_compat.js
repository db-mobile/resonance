// Postman-compatible scripting surface, evaluated after the core globals
// (request, response, environment, pm, test, expect, cookies, sendRequest)
// and the native primitives registered by setup_crypto / setup_pm_compat.
(function () {
    'use strict';

    // ----- bytes and encodings --------------------------------------------

    function utf8Bytes(text) {
        var bytes = [];
        for (var i = 0; i < text.length; i++) {
            var code = text.codePointAt(i);
            if (code > 0xffff) {
                i++;
            }
            if (code < 0x80) {
                bytes.push(code);
            } else if (code < 0x800) {
                bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
            } else if (code < 0x10000) {
                bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
            } else {
                bytes.push(
                    0xf0 | (code >> 18),
                    0x80 | ((code >> 12) & 0x3f),
                    0x80 | ((code >> 6) & 0x3f),
                    0x80 | (code & 0x3f)
                );
            }
        }
        return bytes;
    }

    function utf8Decode(bytes) {
        var out = '';
        var i = 0;
        while (i < bytes.length) {
            var b = bytes[i++];
            var code;
            if (b < 0x80) {
                code = b;
            } else if (b >= 0xf0) {
                code = ((b & 0x07) << 18) | ((bytes[i++] & 0x3f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f);
            } else if (b >= 0xe0) {
                code = ((b & 0x0f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f);
            } else {
                code = ((b & 0x1f) << 6) | (bytes[i++] & 0x3f);
            }
            out += String.fromCodePoint(code);
        }
        return out;
    }

    function bytesToHex(bytes) {
        var hex = '';
        for (var i = 0; i < bytes.length; i++) {
            hex += (bytes[i] < 16 ? '0' : '') + bytes[i].toString(16);
        }
        return hex;
    }

    function hexToBytes(hex) {
        var bytes = [];
        for (var i = 0; i < hex.length; i += 2) {
            bytes.push(parseInt(hex.slice(i, i + 2), 16));
        }
        return bytes;
    }

    function latin1Bytes(text) {
        var bytes = [];
        for (var i = 0; i < text.length; i++) {
            var code = text.charCodeAt(i);
            if (code > 0xff) {
                throw new Error('InvalidCharacterError: the string contains characters outside the Latin1 range');
            }
            bytes.push(code);
        }
        return bytes;
    }

    function latin1String(bytes) {
        var out = '';
        for (var i = 0; i < bytes.length; i++) {
            out += String.fromCharCode(bytes[i]);
        }
        return out;
    }

    // ----- CryptoJS subset ------------------------------------------------

    function WordArray(hex) {
        this._hex = hex || '';
        this.sigBytes = this._hex.length / 2;
    }
    WordArray.prototype.toString = function (encoder) {
        return (encoder || Hex).stringify(this);
    };
    WordArray.prototype.concat = function (other) {
        this._hex += toHex(other);
        this.sigBytes = this._hex.length / 2;
        return this;
    };
    WordArray.prototype.clone = function () {
        return new WordArray(this._hex);
    };

    var Hex = {
        stringify: function (wordArray) { return wordArray._hex; },
        parse: function (text) { return new WordArray(String(text).toLowerCase()); }
    };
    var Base64 = {
        stringify: function (wordArray) { return __base64Encode__(wordArray._hex, false); },
        parse: function (text) { return new WordArray(__base64Decode__(String(text))); }
    };
    var Base64url = {
        stringify: function (wordArray) { return __base64Encode__(wordArray._hex, true); },
        parse: function (text) { return new WordArray(__base64Decode__(String(text))); }
    };
    var Utf8 = {
        stringify: function (wordArray) { return utf8Decode(hexToBytes(wordArray._hex)); },
        parse: function (text) { return new WordArray(bytesToHex(utf8Bytes(String(text)))); }
    };
    var Latin1 = {
        stringify: function (wordArray) { return latin1String(hexToBytes(wordArray._hex)); },
        parse: function (text) { return new WordArray(bytesToHex(latin1Bytes(String(text)))); }
    };

    function toHex(value) {
        if (value instanceof WordArray) {
            return value._hex;
        }
        return bytesToHex(utf8Bytes(String(value === undefined || value === null ? '' : value)));
    }

    var CryptoJS = {
        enc: { Hex: Hex, Base64: Base64, Base64url: Base64url, Utf8: Utf8, Latin1: Latin1 },
        lib: {
            WordArray: {
                create: function (bytes) {
                    return new WordArray(bytes ? bytesToHex(bytes) : '');
                },
                random: function (count) {
                    var hex = '';
                    while (hex.length < count * 2) {
                        hex += __randomUUID__().replace(/-/g, '');
                    }
                    return new WordArray(hex.slice(0, count * 2));
                }
            }
        }
    };
    [['MD5', 'md5'], ['SHA1', 'sha1'], ['SHA256', 'sha256'], ['SHA384', 'sha384'], ['SHA512', 'sha512']]
        .forEach(function (pair) {
            CryptoJS[pair[0]] = function (message) {
                return new WordArray(__cryptoDigest__(pair[1], toHex(message)));
            };
            CryptoJS['Hmac' + pair[0]] = function (message, key) {
                return new WordArray(__cryptoHmac__(pair[1], toHex(key), toHex(message)));
            };
        });

    function encodeHex(hex, encoding) {
        switch ((encoding || 'hex').toLowerCase()) {
            case 'hex': return hex;
            case 'base64': return __base64Encode__(hex, false);
            case 'base64url': return __base64Encode__(hex, true);
            default: throw new TypeError('unsupported encoding: ' + encoding);
        }
    }

    var cryptoObject = {
        randomUUID: function () { return __randomUUID__(); },
        hash: function (algorithm, data, encoding) {
            return encodeHex(__cryptoDigest__(String(algorithm).toLowerCase(), toHex(data)), encoding);
        },
        hmac: function (algorithm, key, data, encoding) {
            return encodeHex(__cryptoHmac__(String(algorithm).toLowerCase(), toHex(key), toHex(data)), encoding);
        }
    };

    function btoa(text) {
        return __base64Encode__(bytesToHex(latin1Bytes(String(text))), false);
    }

    function atob(text) {
        return latin1String(hexToBytes(__base64Decode__(String(text))));
    }

    function requireModule(name) {
        if (name === 'crypto-js') {
            return CryptoJS;
        }
        throw new Error('require("' + name + '") is not available; only "crypto-js" is bundled');
    }

    // ----- chai-style assertions (pm.expect) --------------------------------

    function fmt(value) {
        if (value === undefined) {
            return 'undefined';
        }
        try {
            return JSON.stringify(value);
        } catch (e) {
            return String(value);
        }
    }

    function typeName(value) {
        if (value === null) {
            return 'null';
        }
        if (Array.isArray(value)) {
            return 'array';
        }
        if (value instanceof RegExp) {
            return 'regexp';
        }
        if (value instanceof Date) {
            return 'date';
        }
        return typeof value;
    }

    function deepEqual(a, b) {
        if (a === b) {
            return true;
        }
        if (typeof a === 'number' && typeof b === 'number' && isNaN(a) && isNaN(b)) {
            return true;
        }
        if (typeName(a) !== typeName(b) || typeof a !== 'object' || a === null) {
            return false;
        }
        if (Array.isArray(a)) {
            if (a.length !== b.length) {
                return false;
            }
            for (var i = 0; i < a.length; i++) {
                if (!deepEqual(a[i], b[i])) {
                    return false;
                }
            }
            return true;
        }
        var keysA = Object.keys(a);
        var keysB = Object.keys(b);
        if (keysA.length !== keysB.length) {
            return false;
        }
        for (var k = 0; k < keysA.length; k++) {
            if (!Object.prototype.hasOwnProperty.call(b, keysA[k]) || !deepEqual(a[keysA[k]], b[keysA[k]])) {
                return false;
            }
        }
        return true;
    }

    function assertionError(message) {
        var error = new Error(message);
        error.name = 'AssertionError';
        return error;
    }

    function Assertion(actual, message) {
        this._actual = actual;
        this._message = message;
        this._negate = false;
        this._deep = false;
    }

    Assertion.prototype._assert = function (pass, message, negatedMessage) {
        var ok = this._negate ? !pass : pass;
        if (!ok) {
            var text = this._negate ? negatedMessage : message;
            throw assertionError(this._message ? this._message + ': ' + text : text);
        }
        return this;
    };

    ['to', 'be', 'been', 'is', 'that', 'which', 'and', 'has', 'have', 'with', 'at', 'of', 'same', 'does', 'but', 'still', 'own', 'any', 'all']
        .forEach(function (word) {
            Object.defineProperty(Assertion.prototype, word, { get: function () { return this; } });
        });
    Object.defineProperty(Assertion.prototype, 'not', {
        get: function () { this._negate = !this._negate; return this; }
    });
    Object.defineProperty(Assertion.prototype, 'deep', {
        get: function () { this._deep = true; return this; }
    });

    function defineFlagAssertion(name, test, describe) {
        Object.defineProperty(Assertion.prototype, name, {
            get: function () {
                var actual = this._actual;
                return this._assert(
                    test(actual),
                    'expected ' + fmt(actual) + ' to be ' + describe,
                    'expected ' + fmt(actual) + ' not to be ' + describe
                );
            }
        });
    }

    defineFlagAssertion('ok', function (v) { return !!v; }, 'truthy');
    defineFlagAssertion('true', function (v) { return v === true; }, 'true');
    defineFlagAssertion('false', function (v) { return v === false; }, 'false');
    defineFlagAssertion('null', function (v) { return v === null; }, 'null');
    defineFlagAssertion('undefined', function (v) { return v === undefined; }, 'undefined');
    defineFlagAssertion('NaN', function (v) { return typeof v === 'number' && isNaN(v); }, 'NaN');
    defineFlagAssertion('exist', function (v) { return v !== null && v !== undefined; }, 'present');
    defineFlagAssertion('empty', function (v) {
        if (typeof v === 'string' || Array.isArray(v)) {
            return v.length === 0;
        }
        if (v && typeof v === 'object') {
            return Object.keys(v).length === 0;
        }
        return false;
    }, 'empty');

    function addMethod(names, fn) {
        names.forEach(function (name) { Assertion.prototype[name] = fn; });
    }

    addMethod(['equal', 'equals', 'eq'], function (expected) {
        var pass = this._deep ? deepEqual(this._actual, expected) : this._actual === expected;
        return this._assert(
            pass,
            'expected ' + fmt(this._actual) + ' to equal ' + fmt(expected),
            'expected ' + fmt(this._actual) + ' not to equal ' + fmt(expected)
        );
    });
    addMethod(['eql', 'eqls'], function (expected) {
        return this._assert(
            deepEqual(this._actual, expected),
            'expected ' + fmt(this._actual) + ' to deeply equal ' + fmt(expected),
            'expected ' + fmt(this._actual) + ' not to deeply equal ' + fmt(expected)
        );
    });
    addMethod(['a', 'an'], function (type) {
        var expected = String(type).toLowerCase();
        return this._assert(
            typeName(this._actual) === expected,
            'expected ' + fmt(this._actual) + ' to be a ' + expected,
            'expected ' + fmt(this._actual) + ' not to be a ' + expected
        );
    });
    addMethod(['include', 'includes', 'contain', 'contains'], function (value) {
        var actual = this._actual;
        var deep = this._deep;
        var pass = false;
        if (typeof actual === 'string') {
            pass = actual.indexOf(value) !== -1;
        } else if (Array.isArray(actual)) {
            pass = actual.some(function (item) { return deep ? deepEqual(item, value) : item === value; });
        } else if (actual && typeof actual === 'object' && value && typeof value === 'object') {
            pass = Object.keys(value).every(function (key) {
                return deep ? deepEqual(actual[key], value[key]) : actual[key] === value[key];
            });
        }
        return this._assert(
            pass,
            'expected ' + fmt(actual) + ' to include ' + fmt(value),
            'expected ' + fmt(actual) + ' not to include ' + fmt(value)
        );
    });
    addMethod(['property'], function (name, value) {
        var actual = this._actual;
        var has = actual !== null && actual !== undefined && Object(actual)[name] !== undefined;
        if (arguments.length < 2) {
            this._assert(
                has,
                'expected ' + fmt(actual) + ' to have property ' + fmt(name),
                'expected ' + fmt(actual) + ' not to have property ' + fmt(name)
            );
            if (has && !this._negate) {
                this._actual = actual[name];
            }
            return this;
        }
        var matches = has && (this._deep ? deepEqual(actual[name], value) : actual[name] === value);
        return this._assert(
            matches,
            'expected ' + fmt(actual) + ' to have property ' + fmt(name) + ' of ' + fmt(value),
            'expected ' + fmt(actual) + ' not to have property ' + fmt(name) + ' of ' + fmt(value)
        );
    });
    addMethod(['lengthOf', 'length'], function (expected) {
        var actual = this._actual;
        var size = actual === null || actual === undefined ? undefined : actual.length;
        return this._assert(
            size === expected,
            'expected ' + fmt(actual) + ' to have length ' + expected + ' but got ' + size,
            'expected ' + fmt(actual) + ' not to have length ' + expected
        );
    });
    addMethod(['keys', 'key'], function () {
        var expected = Array.isArray(arguments[0]) ? arguments[0] : Array.prototype.slice.call(arguments);
        var actual = this._actual;
        var pass = !!actual && typeof actual === 'object' &&
            expected.every(function (key) { return Object.prototype.hasOwnProperty.call(actual, key); });
        return this._assert(
            pass,
            'expected ' + fmt(actual) + ' to have keys ' + fmt(expected),
            'expected ' + fmt(actual) + ' not to have keys ' + fmt(expected)
        );
    });
    function comparison(names, test, word) {
        addMethod(names, function (expected) {
            return this._assert(
                test(this._actual, expected),
                'expected ' + fmt(this._actual) + ' to be ' + word + ' ' + fmt(expected),
                'expected ' + fmt(this._actual) + ' not to be ' + word + ' ' + fmt(expected)
            );
        });
    }
    comparison(['above', 'gt', 'greaterThan'], function (a, b) { return a > b; }, 'above');
    comparison(['below', 'lt', 'lessThan'], function (a, b) { return a < b; }, 'below');
    comparison(['least', 'gte', 'greaterThanOrEqual'], function (a, b) { return a >= b; }, 'at least');
    comparison(['most', 'lte', 'lessThanOrEqual'], function (a, b) { return a <= b; }, 'at most');
    addMethod(['within'], function (low, high) {
        return this._assert(
            this._actual >= low && this._actual <= high,
            'expected ' + fmt(this._actual) + ' to be within ' + low + '..' + high,
            'expected ' + fmt(this._actual) + ' not to be within ' + low + '..' + high
        );
    });
    addMethod(['match', 'matches'], function (pattern) {
        var regex = pattern instanceof RegExp ? pattern : new RegExp(pattern);
        return this._assert(
            regex.test(String(this._actual)),
            'expected ' + fmt(this._actual) + ' to match ' + regex,
            'expected ' + fmt(this._actual) + ' not to match ' + regex
        );
    });
    addMethod(['oneOf'], function (list) {
        var actual = this._actual;
        var deep = this._deep;
        return this._assert(
            list.some(function (item) { return deep ? deepEqual(item, actual) : item === actual; }),
            'expected ' + fmt(actual) + ' to be one of ' + fmt(list),
            'expected ' + fmt(actual) + ' not to be one of ' + fmt(list)
        );
    });
    addMethod(['string'], function (fragment) {
        return this._assert(
            typeof this._actual === 'string' && this._actual.indexOf(fragment) !== -1,
            'expected ' + fmt(this._actual) + ' to contain ' + fmt(fragment),
            'expected ' + fmt(this._actual) + ' not to contain ' + fmt(fragment)
        );
    });

    function pmExpect(actual, message) {
        return new Assertion(actual, message);
    }

    // ----- headers helpers ----------------------------------------------

    function findHeaderKey(headers, name) {
        var wanted = String(name).toLowerCase();
        var keys = Object.keys(headers || {});
        for (var i = 0; i < keys.length; i++) {
            if (keys[i].toLowerCase() === wanted) {
                return keys[i];
            }
        }
        return undefined;
    }

    function hidden(target, name, value) {
        Object.defineProperty(target, name, { value: value, enumerable: false, configurable: true, writable: true });
    }

    function decorateHeaders(headers, writable) {
        if (!headers || typeof headers !== 'object') {
            return;
        }
        hidden(headers, 'get', function (name) {
            var key = findHeaderKey(headers, name);
            return key === undefined ? undefined : headers[key];
        });
        hidden(headers, 'has', function (name, value) {
            var key = findHeaderKey(headers, name);
            return key !== undefined && (arguments.length < 2 || headers[key] === value);
        });
        hidden(headers, 'toObject', function () {
            var out = {};
            Object.keys(headers).forEach(function (key) { out[key] = headers[key]; });
            return out;
        });
        hidden(headers, 'each', function (fn) {
            Object.keys(headers).forEach(function (key) { fn({ key: key, value: headers[key] }); });
        });
        if (!writable) {
            return;
        }
        function upsert(entry) {
            var key = findHeaderKey(headers, entry.key);
            headers[key === undefined ? entry.key : key] = String(entry.value);
        }
        hidden(headers, 'add', upsert);
        hidden(headers, 'upsert', upsert);
        hidden(headers, 'remove', function (name) {
            var key = findHeaderKey(headers, name);
            if (key !== undefined) {
                delete headers[key];
            }
        });
    }

    // ----- pm.response --------------------------------------------------

    function statusInRange(code, low, high) {
        return typeof code === 'number' && code >= low && code <= high;
    }

    function responseAssertions(res, negate) {
        function check(pass, message, negatedMessage) {
            var ok = negate ? !pass : pass;
            if (!ok) {
                throw assertionError(negate ? negatedMessage : message);
            }
        }
        var have = {
            status: function (expected) {
                var pass = typeof expected === 'number' ? res.code === expected : res.statusText === expected;
                check(pass,
                    'expected response to have status ' + fmt(expected) + ' but got ' + res.code + ' ' + (res.statusText || ''),
                    'expected response not to have status ' + fmt(expected));
            },
            header: function (name, value) {
                var actual = res.headers && res.headers.get ? res.headers.get(name) : undefined;
                var pass = arguments.length < 2 ? actual !== undefined : actual === value;
                check(pass,
                    'expected response to have header ' + name + (arguments.length < 2 ? '' : ' = ' + fmt(value)),
                    'expected response not to have header ' + name);
            },
            body: function (expected) {
                var text = res.text();
                var pass = arguments.length === 0 ? text.length > 0 : text === String(expected);
                check(pass,
                    'expected response body ' + (arguments.length === 0 ? 'not to be empty' : 'to equal ' + fmt(expected)),
                    'expected response body ' + (arguments.length === 0 ? 'to be empty' : 'not to equal ' + fmt(expected)));
            },
            jsonBody: function (path, value) {
                var body;
                try {
                    body = res.json();
                } catch (e) {
                    check(false, 'expected response body to be JSON', 'expected response body not to be JSON');
                    return;
                }
                if (arguments.length === 0) {
                    check(true, '', 'expected response body not to be JSON');
                    return;
                }
                var current = body;
                String(path).split('.').forEach(function (part) {
                    current = current === null || current === undefined ? undefined : current[part];
                });
                var pass = arguments.length < 2 ? current !== undefined : deepEqual(current, value);
                check(pass,
                    'expected JSON body to have ' + path + (arguments.length < 2 ? '' : ' = ' + fmt(value)),
                    'expected JSON body not to have ' + path);
            }
        };
        var be = {};
        function statusGetter(name, test, word) {
            Object.defineProperty(be, name, {
                get: function () {
                    check(test(res.code), 'expected response to be ' + word + ' but got ' + res.code,
                        'expected response not to be ' + word);
                    return true;
                }
            });
        }
        statusGetter('ok', function (c) { return c === 200; }, 'ok (200)');
        statusGetter('success', function (c) { return statusInRange(c, 200, 299); }, 'successful (2xx)');
        statusGetter('accepted', function (c) { return c === 202; }, 'accepted (202)');
        statusGetter('redirection', function (c) { return statusInRange(c, 300, 399); }, 'a redirection (3xx)');
        statusGetter('clientError', function (c) { return statusInRange(c, 400, 499); }, 'a client error (4xx)');
        statusGetter('serverError', function (c) { return statusInRange(c, 500, 599); }, 'a server error (5xx)');
        statusGetter('error', function (c) { return statusInRange(c, 400, 599); }, 'an error (4xx/5xx)');
        statusGetter('badRequest', function (c) { return c === 400; }, 'bad request (400)');
        statusGetter('unauthorized', function (c) { return c === 401; }, 'unauthorized (401)');
        statusGetter('forbidden', function (c) { return c === 403; }, 'forbidden (403)');
        statusGetter('notFound', function (c) { return c === 404; }, 'not found (404)');
        Object.defineProperty(be, 'json', {
            get: function () {
                var pass = true;
                try {
                    res.json();
                } catch (e) {
                    pass = false;
                }
                check(pass, 'expected response body to be JSON', 'expected response body not to be JSON');
                return true;
            }
        });
        var to = { have: have, be: be };
        if (!negate) {
            Object.defineProperty(to, 'not', { get: function () { return responseAssertions(res, true).to; } });
        }
        return { to: to };
    }

    function decorateResponse(res) {
        if (!res || typeof res !== 'object' || res.status === undefined) {
            return;
        }
        decorateHeaders(res.headers || (res.headers = {}), false);
        hidden(res, 'code', res.status);
        hidden(res, 'responseTime', res.timings && typeof res.timings.total === 'number' ? res.timings.total : undefined);
        hidden(res, 'reason', function () { return res.statusText; });
        hidden(res, 'text', function () {
            if (typeof res.body === 'string') {
                return res.body;
            }
            return res.body === null || res.body === undefined ? '' : JSON.stringify(res.body);
        });
        hidden(res, 'json', function () {
            return typeof res.body === 'string' ? JSON.parse(res.body) : res.body;
        });
        hidden(res, 'to', responseAssertions(res, false).to);
    }

    // ----- variable scopes ----------------------------------------------

    function replaceIn(template, lookup) {
        return String(template).replace(/\{\{\s*([^{}]+?)\s*\}\}/g, function (match, name) {
            var value = lookup(name);
            return value === undefined ? match : String(value);
        });
    }

    function snapshotScope(read) {
        return {
            has: function (key) { return Object.prototype.hasOwnProperty.call(read(), key); },
            toObject: function () { return read(); },
            replaceIn: function (template) {
                var values = read();
                return replaceIn(template, function (name) { return values[name]; });
            }
        };
    }

    function environmentValues() {
        return JSON.parse(__environmentVariables__());
    }

    function collectionValues() {
        return JSON.parse(__collectionVariables__());
    }

    var collectionVariables = snapshotScope(collectionValues);
    collectionVariables.get = function (key) { return collectionValues()[key]; };
    collectionVariables.set = function (key, value) { __setCollectionVariable__(String(key), String(value)); };
    collectionVariables.unset = function (key) { __setCollectionVariable__(String(key), null); };
    collectionVariables.clear = function () {
        Object.keys(collectionValues()).forEach(function (key) { __setCollectionVariable__(key, null); });
    };

    var locals = {};
    function iterationValue(key) {
        var data = pm.iterationData;
        return data && data.has && data.has(key) ? data.get(key) : undefined;
    }
    var variables = {
        get: function (key) {
            if (Object.prototype.hasOwnProperty.call(locals, key)) {
                return locals[key];
            }
            var fromData = iterationValue(key);
            if (fromData !== undefined) {
                return fromData;
            }
            var env = environmentValues();
            if (Object.prototype.hasOwnProperty.call(env, key)) {
                return env[key];
            }
            return collectionValues()[key];
        },
        set: function (key, value) { locals[String(key)] = value; },
        unset: function (key) { delete locals[key]; },
        has: function (key) { return variables.get(key) !== undefined; },
        toObject: function () {
            var out = {};
            [collectionValues(), environmentValues(), pm.iterationData ? pm.iterationData.toObject() : {}, locals]
                .forEach(function (scope) {
                    Object.keys(scope).forEach(function (key) { out[key] = scope[key]; });
                });
            return out;
        },
        replaceIn: function (template) { return replaceIn(template, variables.get); }
    };

    // ----- wire into pm and the global object -----------------------------

    var environmentApi = pm.environment;
    var envExtras = snapshotScope(environmentValues);
    environmentApi.has = envExtras.has;
    environmentApi.toObject = envExtras.toObject;
    environmentApi.replaceIn = envExtras.replaceIn;
    environmentApi.clear = function () {
        Object.keys(environmentValues()).forEach(function (key) { environmentApi.unset(key); });
    };

    var globalsWarned = false;
    var globalsApi = {};
    ['get', 'set', 'unset', 'has', 'toObject', 'replaceIn', 'clear'].forEach(function (name) {
        globalsApi[name] = function () {
            if (!globalsWarned) {
                globalsWarned = true;
                console.warn('pm.globals is mapped to the active environment; Resonance has no global variable scope');
            }
            return environmentApi[name].apply(environmentApi, arguments);
        };
    });

    decorateResponse(pm.response);
    if (pm.request && typeof pm.request === 'object') {
        if (!pm.request.headers || typeof pm.request.headers !== 'object') {
            pm.request.headers = {};
        }
        decorateHeaders(pm.request.headers, true);
    }

    pm.test = function (name, fn) { test(name, fn); };
    pm.test.skip = function () {};
    pm.expect = pmExpect;
    pm.variables = variables;
    pm.collectionVariables = collectionVariables;
    pm.globals = globalsApi;

    globalThis.CryptoJS = CryptoJS;
    globalThis.crypto = cryptoObject;
    globalThis.btoa = btoa;
    globalThis.atob = atob;
    globalThis.require = requireModule;
})();
