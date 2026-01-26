import { VariableProcessor } from '../../src/modules/variables/VariableProcessor.js';

describe('VariableProcessor', () => {
    let processor;

    beforeEach(() => {
        processor = new VariableProcessor();
        processor.clearDynamicCache(); // Ensure fresh cache for each test
    });

    describe('processTemplate', () => {
        test('should replace simple variables', () => {
            const template = 'Hello {{ name }}!';
            const variables = { name: 'World' };
            const result = processor.processTemplate(template, variables);
            expect(result).toBe('Hello World!');
        });

        test('should handle multiple variables', () => {
            const template = '{{ protocol }}://{{ host }}:{{ port }}/{{ path }}';
            const variables = { protocol: 'https', host: 'api.example.com', port: '443', path: 'v1/users' };
            const result = processor.processTemplate(template, variables);
            expect(result).toBe('https://api.example.com:443/v1/users');
        });

        test('should handle missing variables by leaving them unchanged', () => {
            const template = 'Hello {{ name }}! Welcome to {{ place }}.';
            const variables = { name: 'Alice' };
            const result = processor.processTemplate(template, variables);
            expect(result).toBe('Hello Alice! Welcome to {{ place }}.');
        });

        test('should handle empty variables object', () => {
            const template = 'Hello {{ name }}!';
            const result = processor.processTemplate(template, {});
            expect(result).toBe('Hello {{ name }}!');
        });

        test('should handle null/undefined template', () => {
            expect(processor.processTemplate(null, { name: 'test' })).toBe(null);
            expect(processor.processTemplate(undefined, { name: 'test' })).toBe(undefined);
        });

        test('should handle variables with spaces', () => {
            const template = '{{ name }} and {{  other  }}';
            const variables = { name: 'Alice', other: 'Bob' };
            const result = processor.processTemplate(template, variables);
            expect(result).toBe('Alice and Bob');
        });
    });

    describe('processObject', () => {
        test('should process strings in objects', () => {
            const obj = { url: 'https://{{ host }}/api', method: 'GET' };
            const variables = { host: 'example.com' };
            const result = processor.processObject(obj, variables);
            expect(result).toEqual({ url: 'https://example.com/api', method: 'GET' });
        });

        test('should process nested objects', () => {
            const obj = {
                config: {
                    baseUrl: 'https://{{ host }}',
                    timeout: 5000
                },
                headers: {
                    'Authorization': 'Bearer {{ token }}'
                }
            };
            const variables = { host: 'api.example.com', token: 'abc123' };
            const result = processor.processObject(obj, variables);
            expect(result).toEqual({
                config: {
                    baseUrl: 'https://api.example.com',
                    timeout: 5000
                },
                headers: {
                    'Authorization': 'Bearer abc123'
                }
            });
        });

        test('should process arrays', () => {
            const obj = ['{{ url1 }}', '{{ url2 }}', 'static-url'];
            const variables = { url1: 'https://api1.com', url2: 'https://api2.com' };
            const result = processor.processObject(obj, variables);
            expect(result).toEqual(['https://api1.com', 'https://api2.com', 'static-url']);
        });

        test('should process object keys', () => {
            const obj = { '{{ dynamicKey }}': 'value' };
            const variables = { dynamicKey: 'actualKey' };
            const result = processor.processObject(obj, variables);
            expect(result).toEqual({ actualKey: 'value' });
        });
    });

    describe('extractVariableNames', () => {
        test('should extract variable names from template', () => {
            const template = 'Hello {{ name }}! Welcome to {{ place }}.';
            const result = processor.extractVariableNames(template);
            expect(result).toEqual(['name', 'place']);
        });

        test('should handle duplicate variable names', () => {
            const template = '{{ name }} and {{ name }} are friends with {{ other }}.';
            const result = processor.extractVariableNames(template);
            expect(result).toEqual(['name', 'other']);
        });

        test('should handle empty template', () => {
            expect(processor.extractVariableNames('')).toEqual([]);
            expect(processor.extractVariableNames(null)).toEqual([]);
            expect(processor.extractVariableNames(undefined)).toEqual([]);
        });

        test('should handle template with no variables', () => {
            const template = 'Hello World!';
            const result = processor.extractVariableNames(template);
            expect(result).toEqual([]);
        });

        test('should handle variables with underscores and numbers', () => {
            const template = '{{ api_key }} and {{ version_2 }} and {{ _private }}';
            const result = processor.extractVariableNames(template);
            expect(result).toEqual(['api_key', 'version_2', '_private']);
        });
    });

    describe('extractVariableNamesFromObject', () => {
        test('should extract from nested objects', () => {
            const obj = {
                url: 'https://{{ host }}/{{ path }}',
                headers: {
                    'Authorization': 'Bearer {{ token }}'
                },
                params: ['{{ param1 }}', '{{ param2 }}']
            };
            const result = processor.extractVariableNamesFromObject(obj);
            expect(result.sort()).toEqual(['host', 'path', 'token', 'param1', 'param2'].sort());
        });

        test('should handle empty object', () => {
            expect(processor.extractVariableNamesFromObject({})).toEqual([]);
        });

        test('should handle null/undefined', () => {
            expect(processor.extractVariableNamesFromObject(null)).toEqual([]);
            expect(processor.extractVariableNamesFromObject(undefined)).toEqual([]);
        });
    });

    describe('isValidVariableName', () => {
        test('should validate correct variable names', () => {
            expect(processor.isValidVariableName('name')).toBe(true);
            expect(processor.isValidVariableName('api_key')).toBe(true);
            expect(processor.isValidVariableName('_private')).toBe(true);
            expect(processor.isValidVariableName('version2')).toBe(true);
            expect(processor.isValidVariableName('camelCase')).toBe(true);
        });

        test('should reject invalid variable names', () => {
            expect(processor.isValidVariableName('2name')).toBe(false);
            expect(processor.isValidVariableName('api-key')).toBe(false);
            expect(processor.isValidVariableName('api key')).toBe(false);
            expect(processor.isValidVariableName('')).toBe(false);
            expect(processor.isValidVariableName(null)).toBe(false);
            expect(processor.isValidVariableName(undefined)).toBe(false);
        });
    });

    describe('getPreview', () => {
        test('should provide preview with missing variables', () => {
            const template = 'Hello {{ name }}! Welcome to {{ place }}.';
            const variables = { name: 'Alice' };
            const result = processor.getPreview(template, variables);
            
            expect(result.preview).toBe('Hello Alice! Welcome to {{ place }}.');
            expect(result.missingVariables).toEqual(['place']);
            expect(result.foundVariables).toEqual(['name']);
        });

        test('should handle all variables present', () => {
            const template = 'Hello {{ name }}!';
            const variables = { name: 'Alice' };
            const result = processor.getPreview(template, variables);
            
            expect(result.preview).toBe('Hello Alice!');
            expect(result.missingVariables).toEqual([]);
            expect(result.foundVariables).toEqual(['name']);
        });

        test('should handle no variables present', () => {
            const template = 'Hello {{ name }}!';
            const variables = {};
            const result = processor.getPreview(template, variables);

            expect(result.preview).toBe('Hello {{ name }}!');
            expect(result.missingVariables).toEqual(['name']);
            expect(result.foundVariables).toEqual([]);
        });

        test('should show placeholders for dynamic variables', () => {
            const template = 'ID: {{$uuid}} at {{$timestamp}}';
            const result = processor.getPreview(template, {});

            expect(result.preview).toBe('ID: [uuid] at [timestamp]');
            expect(result.dynamicVariables).toEqual(['uuid', 'timestamp']);
        });

        test('should show placeholders with params for parameterized dynamic variables', () => {
            const template = 'Random: {{$randomInt:1:100}} and {{$randomString:16}}';
            const result = processor.getPreview(template, {});

            expect(result.preview).toBe('Random: [randomInt:1:100] and [randomString:16]');
            expect(result.dynamicVariables).toEqual(['randomInt', 'randomString']);
        });

        test('should handle mixed regular and dynamic variables in preview', () => {
            const template = 'User {{ name }} has ID {{$uuid}}';
            const variables = { name: 'Alice' };
            const result = processor.getPreview(template, variables);

            expect(result.preview).toBe('User Alice has ID [uuid]');
            expect(result.foundVariables).toEqual(['name']);
            expect(result.dynamicVariables).toEqual(['uuid']);
        });
    });

    describe('dynamic variables', () => {
        test('should process {{$timestamp}} variable', () => {
            const template = 'Time: {{$timestamp}}';
            const before = Math.floor(Date.now() / 1000);
            const result = processor.processTemplate(template, {});
            const after = Math.floor(Date.now() / 1000);

            const match = result.match(/Time: (\d+)/);
            expect(match).not.toBeNull();
            const timestamp = parseInt(match[1], 10);
            expect(timestamp).toBeGreaterThanOrEqual(before);
            expect(timestamp).toBeLessThanOrEqual(after);
        });

        test('should process {{$timestampMs}} variable', () => {
            const template = 'Time: {{$timestampMs}}';
            const before = Date.now();
            const result = processor.processTemplate(template, {});
            const after = Date.now();

            const match = result.match(/Time: (\d+)/);
            expect(match).not.toBeNull();
            const timestamp = parseInt(match[1], 10);
            expect(timestamp).toBeGreaterThanOrEqual(before);
            expect(timestamp).toBeLessThanOrEqual(after);
        });

        test('should process {{$isoTimestamp}} variable', () => {
            const template = 'Date: {{$isoTimestamp}}';
            const result = processor.processTemplate(template, {});

            expect(result).toMatch(/Date: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/);
        });

        test('should process {{$uuid}} variable', () => {
            const template = 'ID: {{$uuid}}';
            const result = processor.processTemplate(template, {});

            expect(result).toMatch(/ID: [0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/);
        });

        test('should process {{$randomInt}} variable with default range', () => {
            const template = 'Number: {{$randomInt}}';
            const result = processor.processTemplate(template, {});

            const match = result.match(/Number: (\d+)/);
            expect(match).not.toBeNull();
            const num = parseInt(match[1], 10);
            expect(num).toBeGreaterThanOrEqual(0);
            expect(num).toBeLessThanOrEqual(1000);
        });

        test('should process {{$randomInt:min:max}} variable with params', () => {
            processor.clearDynamicCache();
            const template = 'Number: {{$randomInt:50:100}}';
            const result = processor.processTemplate(template, {});

            const match = result.match(/Number: (\d+)/);
            expect(match).not.toBeNull();
            const num = parseInt(match[1], 10);
            expect(num).toBeGreaterThanOrEqual(50);
            expect(num).toBeLessThanOrEqual(100);
        });

        test('should process {{$randomString}} variable with default length', () => {
            const template = 'String: {{$randomString}}';
            const result = processor.processTemplate(template, {});

            const match = result.match(/String: ([A-Za-z0-9]+)/);
            expect(match).not.toBeNull();
            expect(match[1].length).toBe(8);
        });

        test('should process {{$randomString:length}} variable with params', () => {
            processor.clearDynamicCache();
            const template = 'String: {{$randomString:16}}';
            const result = processor.processTemplate(template, {});

            const match = result.match(/String: ([A-Za-z0-9]+)/);
            expect(match).not.toBeNull();
            expect(match[1].length).toBe(16);
        });

        test('should process {{$randomEmail}} variable', () => {
            const template = 'Email: {{$randomEmail}}';
            const result = processor.processTemplate(template, {});

            expect(result).toMatch(/Email: [a-z0-9]+@[a-z]+\.[a-z]+/);
        });

        test('should process {{$randomName}} variable', () => {
            const template = 'Name: {{$randomName}}';
            const result = processor.processTemplate(template, {});

            expect(result).toMatch(/Name: [A-Za-z]+ [A-Za-z]+/);
        });

        test('should leave unknown dynamic variables unchanged', () => {
            const template = 'Unknown: {{$unknownVar}}';
            const result = processor.processTemplate(template, {});

            expect(result).toBe('Unknown: {{$unknownVar}}');
        });

        test('should handle mixed regular and dynamic variables', () => {
            const template = 'User {{ name }} (ID: {{$uuid}}) created at {{$timestamp}}';
            const variables = { name: 'Alice' };
            const result = processor.processTemplate(template, variables);

            expect(result).toMatch(/User Alice \(ID: [0-9a-f-]+\) created at \d+/);
        });

        test('should return same value for same dynamic variable within request', () => {
            const template = 'First: {{$uuid}}, Second: {{$uuid}}';
            const result = processor.processTemplate(template, {});

            const uuidPattern = /[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/g;
            const matches = result.match(uuidPattern);
            expect(matches).not.toBeNull();
            expect(matches.length).toBe(2);
            expect(matches[0]).toBe(matches[1]);
        });

        test('should return different values after cache clear', () => {
            const template = '{{$uuid}}';
            const result1 = processor.processTemplate(template, {});
            processor.clearDynamicCache();
            const result2 = processor.processTemplate(template, {});

            expect(result1).not.toBe(result2);
        });

        test('should handle dynamic variables with spaces', () => {
            const template = '{{ $uuid }} and {{  $timestamp  }}';
            const result = processor.processTemplate(template, {});

            expect(result).toMatch(/[0-9a-f-]+ and \d+/);
        });
    });

    describe('extractDynamicVariableNames', () => {
        test('should extract dynamic variable names from template', () => {
            const template = 'ID: {{$uuid}} at {{$timestamp}}';
            const result = processor.extractDynamicVariableNames(template);

            expect(result).toEqual([
                { name: 'uuid', params: null },
                { name: 'timestamp', params: null }
            ]);
        });

        test('should extract dynamic variable names with params', () => {
            const template = 'Random: {{$randomInt:1:100}} and {{$randomString:16}}';
            const result = processor.extractDynamicVariableNames(template);

            expect(result).toEqual([
                { name: 'randomInt', params: '1:100' },
                { name: 'randomString', params: '16' }
            ]);
        });

        test('should return empty array for template without dynamic variables', () => {
            const template = 'Hello {{ name }}!';
            const result = processor.extractDynamicVariableNames(template);

            expect(result).toEqual([]);
        });

        test('should return empty array for null/undefined template', () => {
            expect(processor.extractDynamicVariableNames(null)).toEqual([]);
            expect(processor.extractDynamicVariableNames(undefined)).toEqual([]);
            expect(processor.extractDynamicVariableNames('')).toEqual([]);
        });

        test('should handle mixed regular and dynamic variables', () => {
            const template = 'User {{ name }} has ID {{$uuid}}';
            const result = processor.extractDynamicVariableNames(template);

            expect(result).toEqual([
                { name: 'uuid', params: null }
            ]);
        });
    });

    describe('clearDynamicCache', () => {
        test('should clear the dynamic variable cache', () => {
            const template = '{{$uuid}}';

            // Generate first value
            const result1 = processor.processTemplate(template, {});

            // Clear cache
            processor.clearDynamicCache();

            // Generate second value - should be different
            const result2 = processor.processTemplate(template, {});

            expect(result1).not.toBe(result2);
        });
    });
});
