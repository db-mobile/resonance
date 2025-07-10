import { VariableProcessor } from '../../src/modules/variables/VariableProcessor.js';

describe('VariableProcessor', () => {
    let processor;

    beforeEach(() => {
        processor = new VariableProcessor();
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
    });
});