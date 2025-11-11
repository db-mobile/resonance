import { generateCode, SUPPORTED_LANGUAGES } from '../src/modules/codeGenerator.js';

describe('Code Generator', () => {
    const testConfig = {
        method: 'POST',
        url: 'https://api.example.com/users',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer test-token'
        },
        body: {
            name: 'John Doe',
            email: 'john@example.com'
        }
    };

    describe('Language Support', () => {
        test('should have supported languages defined', () => {
            expect(SUPPORTED_LANGUAGES).toBeDefined();
            expect(Array.isArray(SUPPORTED_LANGUAGES)).toBe(true);
            expect(SUPPORTED_LANGUAGES.length).toBeGreaterThan(0);
        });

        test('each language should have required properties', () => {
            SUPPORTED_LANGUAGES.forEach(lang => {
                expect(lang).toHaveProperty('id');
                expect(lang).toHaveProperty('name');
                expect(lang).toHaveProperty('description');
            });
        });
    });

    describe('cURL Generation', () => {
        test('should generate valid cURL command', () => {
            const code = generateCode('curl', testConfig);
            expect(code).toContain('curl');
            expect(code).toContain('-X POST');
            expect(code).toContain(testConfig.url);
            expect(code).toContain('Content-Type: application/json');
            expect(code).toContain('Authorization: Bearer test-token');
        });

        test('should handle GET requests without -X flag', () => {
            const getConfig = { ...testConfig, method: 'GET' };
            const code = generateCode('curl', getConfig);
            expect(code).toContain('curl');
            expect(code).not.toContain('-X GET');
        });
    });

    describe('Python Generation', () => {
        test('should generate valid Python requests code', () => {
            const code = generateCode('python', testConfig);
            expect(code).toContain('import requests');
            expect(code).toContain('url =');
            expect(code).toContain(testConfig.url);
            expect(code).toContain('headers = {');
            expect(code).toContain('Content-Type');
            expect(code).toContain('Authorization');
            expect(code).toContain('requests.post(url');
        });
    });

    describe('JavaScript Fetch Generation', () => {
        test('should generate valid JavaScript fetch code', () => {
            const code = generateCode('javascript-fetch', testConfig);
            expect(code).toContain('fetch(');
            expect(code).toContain(testConfig.url);
            expect(code).toContain("method: 'POST'");
            expect(code).toContain('headers: {');
            expect(code).toContain('body:');
            expect(code).toContain('.then');
            expect(code).toContain('.catch');
        });
    });

    describe('JavaScript Axios Generation', () => {
        test('should generate valid JavaScript axios code', () => {
            const code = generateCode('javascript-axios', testConfig);
            expect(code).toContain('const axios = require');
            expect(code).toContain('const config = {');
            expect(code).toContain("method: 'post'");
            expect(code).toContain(testConfig.url);
            expect(code).toContain('axios(config)');
        });
    });

    describe('Node.js Generation', () => {
        test('should generate valid Node.js https code', () => {
            const code = generateCode('nodejs', testConfig);
            expect(code).toContain("const https = require('https')");
            expect(code).toContain('const options = {');
            expect(code).toContain('hostname:');
            expect(code).toContain("method: 'POST'");
            expect(code).toContain('https.request(options');
        });
    });

    describe('Go Generation', () => {
        test('should generate valid Go net/http code', () => {
            const code = generateCode('go', testConfig);
            expect(code).toContain('package main');
            expect(code).toContain('import (');
            expect(code).toContain('"net/http"');
            expect(code).toContain('http.NewRequest');
            expect(code).toContain('"POST"');
            expect(code).toContain(testConfig.url);
            expect(code).toContain('req.Header.Add');
        });
    });

    describe('PHP Generation', () => {
        test('should generate valid PHP cURL code', () => {
            const code = generateCode('php', testConfig);
            expect(code).toContain('<?php');
            expect(code).toContain('$curl = curl_init()');
            expect(code).toContain('curl_setopt_array');
            expect(code).toContain('CURLOPT_URL');
            expect(code).toContain('CURLOPT_CUSTOMREQUEST');
            expect(code).toContain('"POST"');
        });
    });

    describe('Ruby Generation', () => {
        test('should generate valid Ruby net/http code', () => {
            const code = generateCode('ruby', testConfig);
            expect(code).toContain('require "uri"');
            expect(code).toContain('require "net/http"');
            expect(code).toContain('url = URI(');
            expect(code).toContain('Net::HTTP::Post.new');
            expect(code).toContain('http.use_ssl = true');
        });
    });

    describe('Java Generation', () => {
        test('should generate valid Java HttpClient code', () => {
            const code = generateCode('java', testConfig);
            expect(code).toContain('import java.net.http.HttpClient');
            expect(code).toContain('import java.net.http.HttpRequest');
            expect(code).toContain('HttpClient.newHttpClient()');
            expect(code).toContain('HttpRequest.Builder');
            expect(code).toContain('.POST(');
            expect(code).toContain('URI.create(');
        });
    });

    describe('Error Handling', () => {
        test('should throw error for unsupported language', () => {
            expect(() => {
                generateCode('unsupported-language', testConfig);
            }).toThrow('Unsupported language');
        });
    });

    describe('Edge Cases', () => {
        test('should handle empty headers', () => {
            const config = { ...testConfig, headers: {} };
            const code = generateCode('curl', config);
            expect(code).toBeDefined();
            expect(code).toContain('curl');
        });

        test('should handle missing body for GET request', () => {
            const config = { method: 'GET', url: testConfig.url, headers: {} };
            const code = generateCode('curl', config);
            expect(code).toBeDefined();
            expect(code).not.toContain('-d');
        });

        test('should handle body as string', () => {
            const config = {
                ...testConfig,
                body: '{"test": "data"}'
            };
            const code = generateCode('curl', config);
            expect(code).toContain('-d');
        });
    });
});
