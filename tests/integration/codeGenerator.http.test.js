/** @jest-environment node */
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { generateCode } from '../../src/modules/codeGenerator.js';

const execute = promisify(execFile);
let server;
let url;

beforeAll(async () => {
    server = createServer(async (request, response) => {
        const chunks = [];
        for await (const chunk of request) {
            chunks.push(chunk);
        }
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify({
            method: request.method,
            body: Buffer.concat(chunks).toString('utf8'),
            contentType: request.headers['content-type']
        }));
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${server.address().port}/echo`;
});

afterAll(async () => {
    await new Promise(resolve => server.close(resolve));
});

test.each(['GET', 'DELETE'].flatMap(method => ['curl', 'nodejs'].map(language => [method, language])))('%s %s snippet sends the actual body', async (method, language) => {
    for (const body of [{ message: 'Grüße' }, 'Grüße `$value`\n', false, 0]) {
        const code = generateCode(language, { method, url, headers: { 'Content-Type': 'application/json' }, body });
        const command = language === 'curl' ? 'sh' : process.execPath;
        const args = language === 'curl' ? ['-c', code] : ['--input-type=commonjs', '--eval', code];
        const { stdout } = await execute(command, args, { timeout: 5000, env: { ...process.env, NO_PROXY: '*' } });
        expect(JSON.parse(stdout)).toEqual({
            method,
            body: typeof body === 'string' ? body : JSON.stringify(body),
            contentType: 'application/json'
        });
    }
});
