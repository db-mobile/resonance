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
     * @param {string} name
     * @param {string} params
     * @returns {string|number}
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

    clearCache() {
        this.requestCache.clear();
    }

    /**
     * @param {string} name
     * @returns {boolean}
     */
    isDynamicVariable(name) {
        return name in this.generators;
    }

    /**
     * @param {string} name
     * @param {string} params
     * @returns {string}
     */
    getPlaceholder(name, params = null) {
        if (params) {
            return `[${name}:${params}]`;
        }
        return `[${name}]`;
    }

    /** @returns {string[]} */
    getSupportedVariables() {
        return Object.keys(this.generators);
    }

    /** @returns {string} */
    _generateUUID() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }

    /**
     * @param {string} params
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
     * @param {string} params
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

    /** @returns {string} */
    _generateRandomEmail() {
        const username = this._generateRandomString('8').toLowerCase();
        const domain = this.emailDomains[Math.floor(Math.random() * this.emailDomains.length)];
        return `${username}@${domain}`;
    }

    /** @returns {string} */
    _generateRandomName() {
        const firstName = this.firstNames[Math.floor(Math.random() * this.firstNames.length)];
        const lastName = this.lastNames[Math.floor(Math.random() * this.lastNames.length)];
        return `${firstName} ${lastName}`;
    }

    /** @returns {string} */
    _generateRandomIPv4() {
        const first = Math.floor(Math.random() * 254) + 1;
        const rest = Array.from({ length: 3 }, () => Math.floor(Math.random() * 256));
        return [first, ...rest].join('.');
    }

    /**
     * @param {string} params
     * @param {number} defaultDays
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
     * @param {Date} date
     * @returns {string}
     */
    _formatDateISO(date) {
        return date.toISOString().slice(0, 10);
    }

    /**
     * @param {number} days
     * @returns {Date}
     */
    _dateWithDayOffset(days) {
        const date = new Date();
        date.setDate(date.getDate() + days);
        return date;
    }

    /**
     * @param {string} params
     * @returns {string}
     */
    _generateRandomDate(params) {
        const span = this._parseDaySpan(params);
        const offset = Math.floor(Math.random() * (span * 2 + 1)) - span;
        return this._formatDateISO(this._dateWithDayOffset(offset));
    }

    /**
     * @param {string} params
     * @returns {string}
     */
    _generateRandomDatePast(params) {
        const span = this._parseDaySpan(params);
        const offset = -(Math.floor(Math.random() * span) + 1);
        return this._formatDateISO(this._dateWithDayOffset(offset));
    }

    /**
     * @param {string} params
     * @returns {string}
     */
    _generateRandomDateFuture(params) {
        const span = this._parseDaySpan(params);
        const offset = Math.floor(Math.random() * span) + 1;
        return this._formatDateISO(this._dateWithDayOffset(offset));
    }

    /** @returns {string} */
    _generateRandomUrl() {
        const host = this._generateRandomString('8').toLowerCase();
        const path = this._generateRandomString('6').toLowerCase();
        const tld = this.urlTlds[Math.floor(Math.random() * this.urlTlds.length)];
        return `https://${host}.${tld}/${path}`;
    }

    /**
     * @param {string} params
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
     * @param {string} params
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

    /** @returns {string} */
    _generateRandomPhoneNumber() {
        const area = Math.floor(Math.random() * 800) + 200;
        const exchange = Math.floor(Math.random() * 800) + 200;
        const line = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
        return `+1-${area}-${exchange}-${line}`;
    }
}
