/**
 * DynamicVariableGenerator - Generates dynamic values for variables with $ prefix
 * Supports per-request caching to ensure same variable resolves to same value within a request
 */
export class DynamicVariableGenerator {
    constructor() {
        this.requestCache = new Map();

        this.firstNames = [
            'James', 'Mary', 'John', 'Patricia', 'Robert', 'Jennifer', 'Michael', 'Linda',
            'William', 'Elizabeth', 'David', 'Barbara', 'Richard', 'Susan', 'Joseph', 'Jessica',
            'Thomas', 'Sarah', 'Charles', 'Karen', 'Christopher', 'Lisa', 'Daniel', 'Nancy',
            'Matthew', 'Betty', 'Anthony', 'Margaret', 'Mark', 'Sandra', 'Donald', 'Ashley',
            'Steven', 'Kimberly', 'Paul', 'Emily', 'Andrew', 'Donna', 'Joshua', 'Michelle'
        ];

        this.lastNames = [
            'Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis',
            'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Gonzalez', 'Wilson', 'Anderson',
            'Thomas', 'Taylor', 'Moore', 'Jackson', 'Martin', 'Lee', 'Perez', 'Thompson',
            'White', 'Harris', 'Sanchez', 'Clark', 'Ramirez', 'Lewis', 'Robinson', 'Walker',
            'Young', 'Allen', 'King', 'Wright', 'Scott', 'Torres', 'Nguyen', 'Hill', 'Flores'
        ];

        this.emailDomains = [
            'example.com', 'test.com', 'mail.test', 'demo.org', 'sample.net'
        ];

        this.urlTlds = ['com', 'org', 'net', 'io', 'dev'];

        this.loremWords = [
            'lorem', 'ipsum', 'dolor', 'sit', 'amet', 'consectetur', 'adipiscing', 'elit',
            'sed', 'do', 'eiusmod', 'tempor', 'incididunt', 'ut', 'labore', 'et',
            'dolore', 'magna', 'aliqua', 'enim', 'ad', 'minim', 'veniam', 'quis',
            'nostrud', 'exercitation', 'ullamco', 'laboris', 'nisi', 'aliquip'
        ];

        this.generators = {
            'timestamp': () => Math.floor(Date.now() / 1000),
            'timestampMs': () => Date.now(),
            'isoTimestamp': () => new Date().toISOString(),
            'uuid': () => this._generateUUID(),
            'randomInt': (params) => this._generateRandomInt(params),
            'randomString': (params) => this._generateRandomString(params),
            'randomEmail': () => this._generateRandomEmail(),
            'randomName': () => this._generateRandomName(),
            'randomBoolean': () => Math.random() < 0.5,
            'randomIPv4': () => this._generateRandomIPv4(),
            'randomDate': (params) => this._generateRandomDate(params),
            'randomDatePast': (params) => this._generateRandomDatePast(params),
            'randomDateFuture': (params) => this._generateRandomDateFuture(params),
            'randomUrl': () => this._generateRandomUrl(),
            'randomLoremWords': (params) => this._generateRandomLoremWords(params),
            'randomPrice': (params) => this._generateRandomPrice(params),
            'randomPhoneNumber': () => this._generateRandomPhoneNumber()
        };
    }

    /**
     * Generate a value for a dynamic variable, using cache if available
     * @param {string} name - Variable name (without $ prefix)
     * @param {string} params - Optional parameters (e.g., "1:100" for randomInt)
     * @returns {string|number} Generated value
     */
    generate(name, params = null) {
        const cacheKey = params ? `${name}:${params}` : name;

        if (this.requestCache.has(cacheKey)) {
            return this.requestCache.get(cacheKey);
        }

        const generator = this.generators[name];
        if (!generator) {
            return null;
        }

        const value = generator(params);

        this.requestCache.set(cacheKey, value);

        return value;
    }

    /**
     * Clear the request cache - call before each new request
     */
    clearCache() {
        this.requestCache.clear();
    }

    /**
     * Check if a variable name is a supported dynamic variable
     * @param {string} name - Variable name (without $ prefix)
     * @returns {boolean}
     */
    isDynamicVariable(name) {
        return name in this.generators;
    }

    /**
     * Get a placeholder string for preview purposes
     * @param {string} name - Variable name (without $ prefix)
     * @param {string} params - Optional parameters
     * @returns {string} Placeholder like "[uuid]" or "[randomInt:1:100]"
     */
    getPlaceholder(name, params = null) {
        if (params) {
            return `[${name}:${params}]`;
        }
        return `[${name}]`;
    }

    /**
     * Get list of all supported dynamic variable names
     * @returns {string[]}
     */
    getSupportedVariables() {
        return Object.keys(this.generators);
    }

    /**
     * Generate a UUID v4
     * @returns {string}
     */
    _generateUUID() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }

    /**
     * Generate a random integer
     * @param {string} params - Optional "min:max" format
     * @returns {number}
     */
    _generateRandomInt(params) {
        let min = 0;
        let max = 1000;

        if (params) {
            const parts = params.split(':');
            if (parts.length >= 2) {
                const parsedMin = parseInt(parts[0], 10);
                const parsedMax = parseInt(parts[1], 10);
                if (!isNaN(parsedMin) && !isNaN(parsedMax)) {
                    min = parsedMin;
                    max = parsedMax;
                }
            } else if (parts.length === 1) {
                const parsedMax = parseInt(parts[0], 10);
                if (!isNaN(parsedMax)) {
                    max = parsedMax;
                }
            }
        }

        if (min > max) {
            [min, max] = [max, min];
        }

        return Math.floor(Math.random() * (max - min + 1)) + min;
    }

    /**
     * Generate a random alphanumeric string
     * @param {string} params - Optional length as string
     * @returns {string}
     */
    _generateRandomString(params) {
        let length = 8;

        if (params) {
            const parsedLength = parseInt(params, 10);
            if (!isNaN(parsedLength) && parsedLength > 0) {
                length = Math.min(parsedLength, 1000);
            }
        }

        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        let result = '';
        for (let i = 0; i < length; i++) {
            result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return result;
    }

    /**
     * Generate a random email address
     * @returns {string}
     */
    _generateRandomEmail() {
        const username = this._generateRandomString('8').toLowerCase();
        const domain = this.emailDomains[Math.floor(Math.random() * this.emailDomains.length)];
        return `${username}@${domain}`;
    }

    /**
     * Generate a random full name
     * @returns {string}
     */
    _generateRandomName() {
        const firstName = this.firstNames[Math.floor(Math.random() * this.firstNames.length)];
        const lastName = this.lastNames[Math.floor(Math.random() * this.lastNames.length)];
        return `${firstName} ${lastName}`;
    }

    /**
     * Generate a random IPv4 address (first octet 1-254, others 0-255)
     * @returns {string}
     */
    _generateRandomIPv4() {
        const first = Math.floor(Math.random() * 254) + 1;
        const rest = Array.from({ length: 3 }, () => Math.floor(Math.random() * 256));
        return [first, ...rest].join('.');
    }

    /**
     * Parse a day-span parameter, falling back to a default on invalid input
     * @param {string} params - Optional day span as string
     * @param {number} defaultDays - Fallback day span
     * @returns {number}
     */
    _parseDaySpan(params, defaultDays = 365) {
        if (params) {
            const parsed = parseInt(params, 10);
            if (!isNaN(parsed) && parsed > 0) {
                return parsed;
            }
        }
        return defaultDays;
    }

    /**
     * Format a date as ISO YYYY-MM-DD
     * @param {Date} date - Date to format
     * @returns {string}
     */
    _formatDateISO(date) {
        return date.toISOString().slice(0, 10);
    }

    /**
     * Get a date offset from today by a number of days
     * @param {number} days - Day offset (negative for past)
     * @returns {Date}
     */
    _dateWithDayOffset(days) {
        const date = new Date();
        date.setDate(date.getDate() + days);
        return date;
    }

    /**
     * Generate a random ISO date within +/- N days of today
     * @param {string} params - Optional day span as string (default 365)
     * @returns {string}
     */
    _generateRandomDate(params) {
        const span = this._parseDaySpan(params);
        const offset = Math.floor(Math.random() * (span * 2 + 1)) - span;
        return this._formatDateISO(this._dateWithDayOffset(offset));
    }

    /**
     * Generate a random ISO date 1..N days in the past
     * @param {string} params - Optional day span as string (default 365)
     * @returns {string}
     */
    _generateRandomDatePast(params) {
        const span = this._parseDaySpan(params);
        const offset = -(Math.floor(Math.random() * span) + 1);
        return this._formatDateISO(this._dateWithDayOffset(offset));
    }

    /**
     * Generate a random ISO date 1..N days in the future
     * @param {string} params - Optional day span as string (default 365)
     * @returns {string}
     */
    _generateRandomDateFuture(params) {
        const span = this._parseDaySpan(params);
        const offset = Math.floor(Math.random() * span) + 1;
        return this._formatDateISO(this._dateWithDayOffset(offset));
    }

    /**
     * Generate a random https URL
     * @returns {string}
     */
    _generateRandomUrl() {
        const host = this._generateRandomString('8').toLowerCase();
        const path = this._generateRandomString('6').toLowerCase();
        const tld = this.urlTlds[Math.floor(Math.random() * this.urlTlds.length)];
        return `https://${host}.${tld}/${path}`;
    }

    /**
     * Generate random lorem ipsum words
     * @param {string} params - Optional word count as string (default 5, max 100)
     * @returns {string}
     */
    _generateRandomLoremWords(params) {
        let count = 5;

        if (params) {
            const parsed = parseInt(params, 10);
            if (!isNaN(parsed) && parsed > 0) {
                count = Math.min(parsed, 100);
            }
        }

        const words = [];
        for (let i = 0; i < count; i++) {
            words.push(this.loremWords[Math.floor(Math.random() * this.loremWords.length)]);
        }
        return words.join(' ');
    }

    /**
     * Generate a random price with two decimals
     * @param {string} params - Optional "min:max" format (default 1:1000)
     * @returns {string}
     */
    _generateRandomPrice(params) {
        let min = 1;
        let max = 1000;

        if (params) {
            const parts = params.split(':');
            if (parts.length >= 2) {
                const parsedMin = parseFloat(parts[0]);
                const parsedMax = parseFloat(parts[1]);
                if (!isNaN(parsedMin) && !isNaN(parsedMax)) {
                    min = parsedMin;
                    max = parsedMax;
                }
            } else if (parts.length === 1) {
                const parsedMax = parseFloat(parts[0]);
                if (!isNaN(parsedMax)) {
                    max = parsedMax;
                }
            }
        }

        if (min > max) {
            [min, max] = [max, min];
        }

        return (Math.random() * (max - min) + min).toFixed(2);
    }

    /**
     * Generate a random US-style phone number (+1-AAA-EEE-LLLL)
     * @returns {string}
     */
    _generateRandomPhoneNumber() {
        const area = Math.floor(Math.random() * 800) + 200;
        const exchange = Math.floor(Math.random() * 800) + 200;
        const line = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
        return `+1-${area}-${exchange}-${line}`;
    }
}
