/**
 * DynamicVariableGenerator - Generates dynamic values for variables with $ prefix
 * Supports per-request caching to ensure same variable resolves to same value within a request
 */
export class DynamicVariableGenerator {
    constructor() {
        this.requestCache = new Map();

        // Random name data for randomName generator
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

        // Email domains for randomEmail generator
        this.emailDomains = [
            'example.com', 'test.com', 'mail.test', 'demo.org', 'sample.net'
        ];

        // Generator functions for each dynamic variable type
        this.generators = {
            'timestamp': () => Math.floor(Date.now() / 1000),
            'timestampMs': () => Date.now(),
            'isoTimestamp': () => new Date().toISOString(),
            'uuid': () => this._generateUUID(),
            'randomInt': (params) => this._generateRandomInt(params),
            'randomString': (params) => this._generateRandomString(params),
            'randomEmail': () => this._generateRandomEmail(),
            'randomName': () => this._generateRandomName()
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

        // Return cached value if exists
        if (this.requestCache.has(cacheKey)) {
            return this.requestCache.get(cacheKey);
        }

        // Check if generator exists
        const generator = this.generators[name];
        if (!generator) {
            return null;
        }

        // Generate new value
        const value = generator(params);

        // Cache the value
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

    // Private generator methods

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

        // Ensure min <= max
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
                length = Math.min(parsedLength, 1000); // Cap at 1000 chars
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
}
