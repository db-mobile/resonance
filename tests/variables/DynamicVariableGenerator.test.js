import { DynamicVariableGenerator } from '../../src/modules/variables/DynamicVariableGenerator.js';

describe('DynamicVariableGenerator', () => {
    let generator;

    beforeEach(() => {
        generator = new DynamicVariableGenerator();
    });

    describe('timestamp', () => {
        test('should generate Unix timestamp in seconds', () => {
            const before = Math.floor(Date.now() / 1000);
            const result = generator.generate('timestamp');
            const after = Math.floor(Date.now() / 1000);

            expect(typeof result).toBe('number');
            expect(result).toBeGreaterThanOrEqual(before);
            expect(result).toBeLessThanOrEqual(after);
        });
    });

    describe('timestampMs', () => {
        test('should generate timestamp in milliseconds', () => {
            const before = Date.now();
            const result = generator.generate('timestampMs');
            const after = Date.now();

            expect(typeof result).toBe('number');
            expect(result).toBeGreaterThanOrEqual(before);
            expect(result).toBeLessThanOrEqual(after);
        });
    });

    describe('isoTimestamp', () => {
        test('should generate ISO 8601 formatted date', () => {
            const result = generator.generate('isoTimestamp');

            expect(typeof result).toBe('string');
            expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

            // Should be parseable as a valid date
            const date = new Date(result);
            expect(date.toISOString()).toBe(result);
        });
    });

    describe('uuid', () => {
        test('should generate valid UUID v4', () => {
            const result = generator.generate('uuid');

            expect(typeof result).toBe('string');
            // UUID v4 format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
            expect(result).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
        });

        test('should generate unique UUIDs after cache clear', () => {
            const uuid1 = generator.generate('uuid');
            generator.clearCache();
            const uuid2 = generator.generate('uuid');

            expect(uuid1).not.toBe(uuid2);
        });
    });

    describe('randomInt', () => {
        test('should generate random integer with default range (0-1000)', () => {
            const result = generator.generate('randomInt');

            expect(typeof result).toBe('number');
            expect(Number.isInteger(result)).toBe(true);
            expect(result).toBeGreaterThanOrEqual(0);
            expect(result).toBeLessThanOrEqual(1000);
        });

        test('should generate random integer with custom min:max range', () => {
            generator.clearCache();
            const results = [];
            for (let i = 0; i < 20; i++) {
                generator.clearCache();
                results.push(generator.generate('randomInt', '50:100'));
            }

            results.forEach(result => {
                expect(result).toBeGreaterThanOrEqual(50);
                expect(result).toBeLessThanOrEqual(100);
            });
        });

        test('should handle reversed min:max range', () => {
            generator.clearCache();
            const result = generator.generate('randomInt', '100:50');

            expect(result).toBeGreaterThanOrEqual(50);
            expect(result).toBeLessThanOrEqual(100);
        });

        test('should handle single max parameter', () => {
            generator.clearCache();
            const result = generator.generate('randomInt', '10');

            expect(result).toBeGreaterThanOrEqual(0);
            expect(result).toBeLessThanOrEqual(10);
        });

        test('should handle invalid params gracefully', () => {
            generator.clearCache();
            const result = generator.generate('randomInt', 'invalid');

            expect(typeof result).toBe('number');
            expect(result).toBeGreaterThanOrEqual(0);
            expect(result).toBeLessThanOrEqual(1000);
        });
    });

    describe('randomString', () => {
        test('should generate random alphanumeric string with default length (8)', () => {
            const result = generator.generate('randomString');

            expect(typeof result).toBe('string');
            expect(result.length).toBe(8);
            expect(result).toMatch(/^[A-Za-z0-9]+$/);
        });

        test('should generate random string with custom length', () => {
            generator.clearCache();
            const result = generator.generate('randomString', '16');

            expect(result.length).toBe(16);
            expect(result).toMatch(/^[A-Za-z0-9]+$/);
        });

        test('should cap length at 1000 characters', () => {
            generator.clearCache();
            const result = generator.generate('randomString', '2000');

            expect(result.length).toBe(1000);
        });

        test('should handle invalid length gracefully', () => {
            generator.clearCache();
            const result = generator.generate('randomString', 'invalid');

            expect(result.length).toBe(8); // Falls back to default
        });

        test('should handle zero or negative length', () => {
            generator.clearCache();
            const result = generator.generate('randomString', '0');

            expect(result.length).toBe(8); // Falls back to default
        });
    });

    describe('randomEmail', () => {
        test('should generate valid email format', () => {
            const result = generator.generate('randomEmail');

            expect(typeof result).toBe('string');
            expect(result).toMatch(/^[a-z0-9]+@[a-z]+\.[a-z]+$/);
        });

        test('should use test domains', () => {
            const validDomains = ['example.com', 'test.com', 'mail.test', 'demo.org', 'sample.net'];
            const result = generator.generate('randomEmail');
            const domain = result.split('@')[1];

            expect(validDomains).toContain(domain);
        });
    });

    describe('randomName', () => {
        test('should generate name with first and last name', () => {
            const result = generator.generate('randomName');

            expect(typeof result).toBe('string');
            const parts = result.split(' ');
            expect(parts.length).toBe(2);
            expect(parts[0].length).toBeGreaterThan(0);
            expect(parts[1].length).toBeGreaterThan(0);
        });
    });

    describe('randomBoolean', () => {
        test('should generate a boolean', () => {
            const result = generator.generate('randomBoolean');

            expect(typeof result).toBe('boolean');
        });
    });

    describe('randomIPv4', () => {
        test('should generate a valid IPv4 address', () => {
            const result = generator.generate('randomIPv4');

            expect(result).toMatch(/^\d{1,3}(\.\d{1,3}){3}$/);
        });

        test('should keep octets in valid ranges', () => {
            for (let i = 0; i < 20; i++) {
                generator.clearCache();
                const octets = generator.generate('randomIPv4').split('.').map(Number);
                expect(octets[0]).toBeGreaterThanOrEqual(1);
                expect(octets[0]).toBeLessThanOrEqual(254);
                octets.slice(1).forEach(octet => {
                    expect(octet).toBeGreaterThanOrEqual(0);
                    expect(octet).toBeLessThanOrEqual(255);
                });
            }
        });
    });

    describe('randomDate', () => {
        test('should generate an ISO date string', () => {
            const result = generator.generate('randomDate');

            expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
            expect(isNaN(new Date(result).getTime())).toBe(false);
        });

        test('should stay within the given day span', () => {
            const dayMs = 86400000;
            for (let i = 0; i < 20; i++) {
                generator.clearCache();
                const result = generator.generate('randomDate', '7');
                const diff = Math.abs(new Date(result).getTime() - Date.now());
                expect(diff).toBeLessThanOrEqual(8 * dayMs);
            }
        });

        test('should fall back to default span for invalid params', () => {
            const result = generator.generate('randomDate', 'abc');

            expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        });
    });

    describe('randomDatePast', () => {
        test('should generate a date strictly in the past', () => {
            for (let i = 0; i < 20; i++) {
                generator.clearCache();
                const result = generator.generate('randomDatePast', '30');
                expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
                expect(new Date(result).getTime()).toBeLessThan(Date.now());
            }
        });
    });

    describe('randomDateFuture', () => {
        test('should generate a date strictly in the future', () => {
            for (let i = 0; i < 20; i++) {
                generator.clearCache();
                const result = generator.generate('randomDateFuture', '30');
                expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
                expect(new Date(result).getTime()).toBeGreaterThan(Date.now());
            }
        });
    });

    describe('randomUrl', () => {
        test('should generate a valid https URL', () => {
            const result = generator.generate('randomUrl');

            expect(result).toMatch(/^https:\/\/[a-z0-9]{8}\.(com|org|net|io|dev)\/[a-z0-9]{6}$/);
        });
    });

    describe('randomLoremWords', () => {
        test('should generate 5 words by default', () => {
            const result = generator.generate('randomLoremWords');

            expect(result.split(' ').length).toBe(5);
            expect(result).toMatch(/^[a-z]+( [a-z]+)*$/);
        });

        test('should generate the requested word count', () => {
            const result = generator.generate('randomLoremWords', '12');

            expect(result.split(' ').length).toBe(12);
        });

        test('should cap word count at 100', () => {
            const result = generator.generate('randomLoremWords', '5000');

            expect(result.split(' ').length).toBe(100);
        });

        test('should fall back to default for invalid params', () => {
            const result = generator.generate('randomLoremWords', 'abc');

            expect(result.split(' ').length).toBe(5);
        });
    });

    describe('randomPrice', () => {
        test('should generate a price with two decimals in the default range', () => {
            const result = generator.generate('randomPrice');

            expect(result).toMatch(/^\d+\.\d{2}$/);
            const price = parseFloat(result);
            expect(price).toBeGreaterThanOrEqual(1);
            expect(price).toBeLessThanOrEqual(1000);
        });

        test('should respect a custom min:max range', () => {
            for (let i = 0; i < 20; i++) {
                generator.clearCache();
                const price = parseFloat(generator.generate('randomPrice', '10:50'));
                expect(price).toBeGreaterThanOrEqual(10);
                expect(price).toBeLessThanOrEqual(50);
            }
        });

        test('should treat a single param as max', () => {
            for (let i = 0; i < 20; i++) {
                generator.clearCache();
                const price = parseFloat(generator.generate('randomPrice', '5'));
                expect(price).toBeGreaterThanOrEqual(1);
                expect(price).toBeLessThanOrEqual(5);
            }
        });

        test('should swap reversed min and max', () => {
            for (let i = 0; i < 20; i++) {
                generator.clearCache();
                const price = parseFloat(generator.generate('randomPrice', '100:1'));
                expect(price).toBeGreaterThanOrEqual(1);
                expect(price).toBeLessThanOrEqual(100);
            }
        });

        test('should fall back to defaults for invalid params', () => {
            const price = parseFloat(generator.generate('randomPrice', 'xyz'));

            expect(price).toBeGreaterThanOrEqual(1);
            expect(price).toBeLessThanOrEqual(1000);
        });
    });

    describe('randomPhoneNumber', () => {
        test('should generate a US-style phone number', () => {
            const result = generator.generate('randomPhoneNumber');

            expect(result).toMatch(/^\+1-\d{3}-\d{3}-\d{4}$/);
        });

        test('should keep area code and exchange in 200-999', () => {
            for (let i = 0; i < 20; i++) {
                generator.clearCache();
                const parts = generator.generate('randomPhoneNumber').split('-');
                expect(parseInt(parts[1], 10)).toBeGreaterThanOrEqual(200);
                expect(parseInt(parts[1], 10)).toBeLessThanOrEqual(999);
                expect(parseInt(parts[2], 10)).toBeGreaterThanOrEqual(200);
                expect(parseInt(parts[2], 10)).toBeLessThanOrEqual(999);
            }
        });
    });

    describe('caching', () => {
        test('should return same value within request (before cache clear)', () => {
            const uuid1 = generator.generate('uuid');
            const uuid2 = generator.generate('uuid');

            expect(uuid1).toBe(uuid2);
        });

        test('should return different values after cache clear', () => {
            const uuid1 = generator.generate('uuid');
            generator.clearCache();
            const uuid2 = generator.generate('uuid');

            expect(uuid1).not.toBe(uuid2);
        });

        test('should cache values with different params separately', () => {
            const int1 = generator.generate('randomInt', '1:10');
            const int2 = generator.generate('randomInt', '100:200');

            // Different params should be cached separately
            const int1Again = generator.generate('randomInt', '1:10');
            const int2Again = generator.generate('randomInt', '100:200');

            expect(int1).toBe(int1Again);
            expect(int2).toBe(int2Again);
        });
    });

    describe('isDynamicVariable', () => {
        test('should return true for supported variables', () => {
            expect(generator.isDynamicVariable('timestamp')).toBe(true);
            expect(generator.isDynamicVariable('timestampMs')).toBe(true);
            expect(generator.isDynamicVariable('isoTimestamp')).toBe(true);
            expect(generator.isDynamicVariable('uuid')).toBe(true);
            expect(generator.isDynamicVariable('randomInt')).toBe(true);
            expect(generator.isDynamicVariable('randomString')).toBe(true);
            expect(generator.isDynamicVariable('randomEmail')).toBe(true);
            expect(generator.isDynamicVariable('randomName')).toBe(true);
        });

        test('should return false for unsupported variables', () => {
            expect(generator.isDynamicVariable('unknown')).toBe(false);
            expect(generator.isDynamicVariable('custom')).toBe(false);
            expect(generator.isDynamicVariable('')).toBe(false);
        });
    });

    describe('getPlaceholder', () => {
        test('should return placeholder without params', () => {
            expect(generator.getPlaceholder('uuid')).toBe('[uuid]');
            expect(generator.getPlaceholder('timestamp')).toBe('[timestamp]');
        });

        test('should return placeholder with params', () => {
            expect(generator.getPlaceholder('randomInt', '1:100')).toBe('[randomInt:1:100]');
            expect(generator.getPlaceholder('randomString', '16')).toBe('[randomString:16]');
        });
    });

    describe('getSupportedVariables', () => {
        test('should return list of all supported variable names', () => {
            const supported = generator.getSupportedVariables();

            expect(Array.isArray(supported)).toBe(true);
            expect(supported).toContain('timestamp');
            expect(supported).toContain('timestampMs');
            expect(supported).toContain('isoTimestamp');
            expect(supported).toContain('uuid');
            expect(supported).toContain('randomInt');
            expect(supported).toContain('randomString');
            expect(supported).toContain('randomEmail');
            expect(supported).toContain('randomName');
            expect(supported).toContain('randomBoolean');
            expect(supported).toContain('randomIPv4');
            expect(supported).toContain('randomDate');
            expect(supported).toContain('randomDatePast');
            expect(supported).toContain('randomDateFuture');
            expect(supported).toContain('randomUrl');
            expect(supported).toContain('randomLoremWords');
            expect(supported).toContain('randomPrice');
            expect(supported).toContain('randomPhoneNumber');
            expect(supported.length).toBe(17);
        });
    });

    describe('generate with unknown variable', () => {
        test('should return null for unknown variable', () => {
            const result = generator.generate('unknownVariable');
            expect(result).toBeNull();
        });
    });
});
