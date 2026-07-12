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

        test('should resolve names with hyphens, dots, and leading digits', () => {
            const template = '{{api-key}} {{base.url}} {{2fa_code}}';
            const variables = { 'api-key': 'k1', 'base.url': 'https://api.test', '2fa_code': '123456' };
            const result = processor.processTemplate(template, variables);
            expect(result).toBe('k1 https://api.test 123456');
        });

        test('should resolve hyphen/dot names with surrounding spaces', () => {
            const template = '{{ api-key }} and {{  base.url  }}';
            const variables = { 'api-key': 'k1', 'base.url': 'u1' };
            const result = processor.processTemplate(template, variables);
            expect(result).toBe('k1 and u1');
        });

        test('should leave unresolved hyphen/dot names unchanged', () => {
            const template = 'x {{api-key}} y {{base.url}} z';
            const result = processor.processTemplate(template, {});
            expect(result).toBe('x {{api-key}} y {{base.url}} z');
        });
    });

    describe('nested resolution', () => {
        test('should resolve a variable whose value contains another variable', () => {
            const template = '{{url}}';
            const variables = { url: '{{host}}/api', host: 'https://example.com' };
            const result = processor.processTemplate(template, variables);
            expect(result).toBe('https://example.com/api');
        });

        test('should resolve two levels of nesting', () => {
            const template = '{{a}}';
            const variables = { a: 'a-{{b}}', b: 'b-{{c}}', c: 'c' };
            const result = processor.processTemplate(template, variables);
            expect(result).toBe('a-b-c');
        });

        test('should resolve a dynamic variable inside a static variable value', () => {
            const template = '{{token}}';
            const variables = { token: '{{$uuid}}' };
            const result = processor.processTemplate(template, variables);
            expect(result).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
        });

        test('should leave self-referencing variables verbatim', () => {
            const template = '{{a}}';
            const variables = { a: '{{a}}' };
            const result = processor.processTemplate(template, variables);
            expect(result).toBe('{{a}}');
        });

        test('should terminate on mutually recursive variables', () => {
            const template = '{{a}}';
            const variables = { a: '{{b}}', b: '{{a}}' };
            const result = processor.processTemplate(template, variables);
            expect(result).toMatch(/^\{\{[ab]\}\}$/);
        });

        test('should leave unresolved inner variables verbatim', () => {
            const template = '{{a}}';
            const variables = { a: 'x-{{missing}}' };
            const result = processor.processTemplate(template, variables);
            expect(result).toBe('x-{{missing}}');
        });

        test('should stop at the resolution pass cap for deep chains', () => {
            const variables = { a12: 'end' };
            for (let i = 1; i < 12; i++) {
                variables[`a${i}`] = `{{a${i + 1}}}`;
            }
            const result = processor.processTemplate('{{a1}}', variables);
            expect(result).toBe('{{a11}}');
        });

        test('should use the same cached dynamic value for nested and top-level use', () => {
            const template = '{{a}} {{$uuid}}';
            const variables = { a: '{{$uuid}}' };
            const result = processor.processTemplate(template, variables);
            const [left, right] = result.split(' ');
            expect(left).toBe(right);
            expect(left).toMatch(/^[0-9a-f]{8}-/);
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

        test('should handle variables with hyphens, dots, and leading digits', () => {
            const template = '{{ api-key }} and {{ base.url }} and {{ 2fa_code }}';
            const result = processor.extractVariableNames(template);
            expect(result).toEqual(['api-key', 'base.url', '2fa_code']);
        });

        test('should not extract dynamic variables as static names', () => {
            const template = '{{$uuid}} and {{ $unknownVar }}';
            const result = processor.extractVariableNames(template);
            expect(result).toEqual([]);
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

    describe('extractUnresolvedVariableNames', () => {
        test('should report static names missing from the variables map', () => {
            const result = processor.extractUnresolvedVariableNames('{{host}}/{{path}}', { host: 'h' });
            expect(result).toEqual(['path']);
        });

        test('should report all static names when no variables are given', () => {
            const result = processor.extractUnresolvedVariableNames('{{api-key}} {{base.url}}');
            expect(result.sort()).toEqual(['api-key', 'base.url']);
        });

        test('should report unknown dynamic variables with $ prefix', () => {
            const result = processor.extractUnresolvedVariableNames('{{$unknownVar}} and {{$uuid}}');
            expect(result).toEqual(['$unknownVar']);
        });

        test('should walk objects, arrays, and keys', () => {
            const config = {
                url: 'https://{{host}}/api',
                headers: { 'X-{{headerName}}': 'Bearer {{token}}' },
                body: { items: ['{{item1}}', { nested: '{{item2}}' }] }
            };
            const result = processor.extractUnresolvedVariableNames(config, { token: 't' });
            expect(result.sort()).toEqual(['headerName', 'host', 'item1', 'item2']);
        });

        test('should deduplicate repeated names', () => {
            const result = processor.extractUnresolvedVariableNames('{{a}} {{a}} {{a}}');
            expect(result).toEqual(['a']);
        });

        test('should return empty array for fully resolved or non-string input', () => {
            expect(processor.extractUnresolvedVariableNames('plain text')).toEqual([]);
            expect(processor.extractUnresolvedVariableNames(null)).toEqual([]);
            expect(processor.extractUnresolvedVariableNames(undefined)).toEqual([]);
            expect(processor.extractUnresolvedVariableNames(42)).toEqual([]);
            expect(processor.extractUnresolvedVariableNames({ a: 1, b: true })).toEqual([]);
        });
    });

    describe('isValidVariableName', () => {
        test('should validate correct variable names', () => {
            expect(processor.isValidVariableName('name')).toBe(true);
            expect(processor.isValidVariableName('api_key')).toBe(true);
            expect(processor.isValidVariableName('_private')).toBe(true);
            expect(processor.isValidVariableName('version2')).toBe(true);
            expect(processor.isValidVariableName('camelCase')).toBe(true);
            expect(processor.isValidVariableName('2name')).toBe(true);
            expect(processor.isValidVariableName('api-key')).toBe(true);
            expect(processor.isValidVariableName('base.url')).toBe(true);
        });

        test('should reject invalid variable names', () => {
            expect(processor.isValidVariableName('api key')).toBe(false);
            expect(processor.isValidVariableName('$uuid')).toBe(false);
            expect(processor.isValidVariableName('-leading')).toBe(false);
            expect(processor.isValidVariableName('.leading')).toBe(false);
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

        test('should report variables introduced by nested expansion', () => {
            const template = '{{a}}';
            const variables = { a: '{{missing}}' };
            const result = processor.getPreview(template, variables);

            expect(result.preview).toBe('{{missing}}');
            expect(result.foundVariables).toEqual(['a']);
            expect(result.missingVariables).toEqual(['missing']);
        });

        test('should report dynamic variables introduced by nested expansion', () => {
            const template = '{{token}}';
            const variables = { token: 'Bearer {{$uuid}}' };
            const result = processor.getPreview(template, variables);

            expect(result.preview).toBe('Bearer [uuid]');
            expect(result.dynamicVariables).toEqual(['uuid']);
        });

        test('should report missing hyphen/dot names', () => {
            const template = '{{api-key}} {{base.url}}';
            const result = processor.getPreview(template, {});

            expect(result.missingVariables.sort()).toEqual(['api-key', 'base.url']);
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

        test('should leave unknown dynamic variables with spaces unchanged', () => {
            const template = 'Unknown: {{ $unknownVar }}';
            const result = processor.processTemplate(template, {});

            expect(result).toBe('Unknown: {{ $unknownVar }}');
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
