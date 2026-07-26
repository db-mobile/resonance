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
            expect(code).toContain('HttpRequest.newBuilder()');
            expect(code).toContain('.POST(');
            expect(code).toContain('URI.create(');
        });

        test('builds an HttpRequest and sends the built request, not the builder', () => {
            const code = generateCode('java', testConfig);
            expect(code).toContain('HttpRequest request = HttpRequest.newBuilder()');
            expect(code).toContain('.build();');
            expect(code).toContain('client.send(request,');
            expect(code).not.toContain('client.send(requestBuilder');
        });

        test('uses .GET() with no argument for a body-less GET', () => {
            const code = generateCode('java', { method: 'GET', url: 'https://api.example.com/x', headers: {} });
            expect(code).toContain('.GET()');
            expect(code).not.toContain('.GET(HttpRequest');
        });

        test('uses .method() for a verb without a dedicated builder setter', () => {
            const code = generateCode('java', {
                method: 'PATCH',
                url: 'https://api.example.com/x',
                headers: {},
                body: { a: 1 }
            });
            expect(code).toContain('.method("PATCH", HttpRequest.BodyPublishers.ofString(');
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

        test('should emit body for lowercase methods across all languages', () => {
            const lowerConfig = { ...testConfig, method: 'post' };
            for (const { id } of SUPPORTED_LANGUAGES) {
                const code = generateCode(id, lowerConfig);
                expect(code).toContain('John Doe');
            }
        });
    });

    describe('Form-data bodies (row arrays)', () => {
        const formConfig = {
            method: 'POST',
            url: 'https://api.example.com/upload',
            headers: { 'Content-Type': 'multipart/form-data' },
            bodyType: 'formdata',
            body: [
                { key: 'title', value: 'hello', type: 'text' },
                { key: 'avatar', type: 'file', filePath: '/tmp/pic.png', contentType: 'image/png' }
            ]
        };

        test('curl emits -F for text and file parts and drops Content-Type', () => {
            const code = generateCode('curl', formConfig);
            expect(code).toContain("-F 'title=hello'");
            expect(code).toContain("-F 'avatar=@/tmp/pic.png;type=image/png'");
            expect(code).not.toContain('Content-Type: multipart/form-data');
            expect(code).not.toContain('-d ');
        });

        test('curl omits ;type= when part has no content type', () => {
            const config = {
                ...formConfig,
                body: [{ key: 'file', type: 'file', filePath: '/tmp/a.bin' }]
            };
            const code = generateCode('curl', config);
            expect(code).toContain("-F 'file=@/tmp/a.bin'");
        });

        test('curl supports legacy flat-object formdata bodies', () => {
            const config = { ...formConfig, body: { title: 'hello' } };
            const code = generateCode('curl', config);
            expect(code).toContain("-F 'title=hello'");
        });

        test('python emits files= and data= dicts', () => {
            const code = generateCode('python', formConfig);
            expect(code).toContain('files = {');
            expect(code).toContain('"avatar": ("pic.png", open("/tmp/pic.png", "rb"), "image/png")');
            expect(code).toContain('data = {');
            expect(code).toContain('"title": "hello"');
            expect(code).toContain('files=files');
            expect(code).toContain('data=data');
        });

        test('other generators emit a comment instead of a bogus body', () => {
            const code = generateCode('javascript-fetch', formConfig);
            expect(code).toContain('File upload bodies are only generated for cURL and Python snippets.');
            expect(code).not.toContain('body: `');
        });
    });

    describe('URL-encoded bodies (row arrays)', () => {
        const urlencodedConfig = {
            method: 'POST',
            url: 'https://api.example.com/form',
            headers: {},
            bodyType: 'urlencoded',
            body: [
                { key: 'a', value: '1' },
                { key: 'a', value: '2 &more' }
            ]
        };

        test('curl emits --data-urlencode per row preserving duplicates', () => {
            const code = generateCode('curl', urlencodedConfig);
            expect(code).toContain("--data-urlencode 'a=1'");
            expect(code).toContain("--data-urlencode 'a=2 &more'");
        });

        test('python emits a list of tuples', () => {
            const code = generateCode('python', urlencodedConfig);
            expect(code).toContain('data = [');
            expect(code).toContain('("a", "1")');
            expect(code).toContain('("a", "2 &more")');
        });

        test('string-body generators receive an encoded query string', () => {
            const code = generateCode('javascript-fetch', urlencodedConfig);
            expect(code).toContain('a=1&a=2%20%26more');
        });
    });

    describe('Binary bodies', () => {
        const binaryConfig = {
            method: 'PUT',
            url: 'https://api.example.com/blob',
            headers: {},
            bodyType: 'binary',
            body: { filePath: '/tmp/payload.bin', contentType: 'application/pdf' }
        };

        test('curl emits --data-binary with @path and a Content-Type header', () => {
            const code = generateCode('curl', binaryConfig);
            expect(code).toContain("--data-binary '@/tmp/payload.bin'");
            expect(code).toContain("-H 'Content-Type: application/pdf'");
        });

        test('curl keeps a user-supplied Content-Type header', () => {
            const config = { ...binaryConfig, headers: { 'Content-Type': 'image/png' } };
            const code = generateCode('curl', config);
            expect(code).toContain("-H 'Content-Type: image/png'");
            expect(code).not.toContain('application/pdf');
        });

        test('python opens the file for the request body', () => {
            const code = generateCode('python', binaryConfig);
            expect(code).toContain('data = open("/tmp/payload.bin", "rb")');
            expect(code).toContain('data=data');
        });

        test('other generators emit a comment instead of a bogus body', () => {
            const code = generateCode('go', binaryConfig);
            expect(code).toContain('File upload bodies are only generated for cURL and Python snippets.');
        });
    });

    describe('Injection safety / escaping', () => {
        const withHeader = (value) => ({
            method: 'POST',
            url: 'https://api.example.com/x',
            headers: { 'X-Evil': value },
            body: { k: 'v' }
        });

        test('JS single-quoted contexts escape single quotes (fetch, axios, nodejs)', () => {
            const config = withHeader("a'INJECT");
            for (const id of ['javascript-fetch', 'javascript-axios', 'nodejs']) {
                const code = generateCode(id, config);
                expect(code).not.toMatch(/(?<!\\)'INJECT/);
                expect(code).toContain("a\\'INJECT");
            }
        });

        test('PHP double-quoted strings escape the $ interpolation sigil', () => {
            const code = generateCode('php', withHeader('a$INJECT'));
            expect(code).not.toMatch(/(?<!\\)\$INJECT/);
            expect(code).toContain('a\\$INJECT');
        });

        test('Ruby double-quoted strings neutralize #{} interpolation', () => {
            const code = generateCode('ruby', withHeader('a#{INJECT}'));
            expect(code).not.toMatch(/(?<!\\)#\{INJECT/);
            expect(code).toContain('a\\#{INJECT}');
        });

        test('double-quoted-string languages escape embedded double quotes', () => {
            const config = withHeader('a"INJECT');
            for (const id of ['python', 'go', 'java', 'php', 'ruby']) {
                const code = generateCode(id, config);
                expect(code).not.toMatch(/(?<!\\)"INJECT/);
            }
        });

        test('backslashes in a value are escaped, not passed through raw', () => {
            const config = withHeader('a\\INJECT');
            for (const id of ['python', 'go', 'java', 'php', 'ruby', 'javascript-fetch', 'nodejs']) {
                const code = generateCode(id, config);
                expect(code).toContain('a\\\\INJECT');
            }
        });

        test('a hostile string body cannot break out in any language', () => {
            const config = {
                method: 'POST',
                url: 'https://api.example.com/x',
                headers: {},
                // eslint-disable-next-line no-template-curly-in-string
                body: 'q"S\'B`T${TL}H#{RB}P$PHP\\E'
            };
            expect(generateCode('go', config)).not.toMatch(/(?<!\\)"S/);
            expect(generateCode('java', config)).not.toMatch(/(?<!\\)"S/);
            expect(generateCode('python', config)).not.toMatch(/(?<!\\)"S/);
            expect(generateCode('php', config)).not.toMatch(/(?<!\\)\$PHP/);
            expect(generateCode('ruby', config)).not.toMatch(/(?<!\\)#\{RB/);
            expect(generateCode('javascript-fetch', config)).not.toMatch(/(?<!\\)\$\{TL/);
        });
    });
});
