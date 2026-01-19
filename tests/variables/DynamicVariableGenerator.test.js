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
            expect(supported.length).toBe(8);
        });
    });

    describe('generate with unknown variable', () => {
        test('should return null for unknown variable', () => {
            const result = generator.generate('unknownVariable');
            expect(result).toBeNull();
        });
    });
});
