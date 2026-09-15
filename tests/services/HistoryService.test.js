import {
    HistoryService,
    REDACTED_PLACEHOLDER,
    SENSITIVE_REQUEST_HEADERS,
    SENSITIVE_RESPONSE_HEADERS
} from '../../src/modules/services/HistoryService.js';
import {
    MAX_HISTORY_REQUEST_SIZE,
    MAX_HISTORY_RESPONSE_SIZE
} from '../../src/modules/storage/HistoryRepository.js';

describe('HistoryService credential redaction', () => {
    let service;
    let added;

    beforeEach(() => {
        service = new HistoryService({});
        added = null;
        service.repository = {
            add: (entry) => {
                added = entry;
                return Promise.resolve(entry);
            }
        };
    });

    const baseResult = () => ({
        success: true,
        status: 200,
        statusText: 'OK',
        data: { ok: true },
        headers: {}
    });

    it('redacts Authorization and Cookie request headers by default', async () => {
        await service.createHistoryEntry(
            {
                method: 'GET',
                url: 'https://api.example.com/users',
                headers: {
                    Authorization: 'Basic ZmVmZTpzZWNyZXQ=',
                    Cookie: 'session=abc123',
                    Accept: 'application/json'
                }
            },
            baseResult()
        );

        expect(added.request.headers.Authorization).toBe(REDACTED_PLACEHOLDER);
        expect(added.request.headers.Cookie).toBe(REDACTED_PLACEHOLDER);
        expect(added.request.headers.Accept).toBe('application/json');
    });

    it('matches sensitive header names case-insensitively and preserves original casing', async () => {
        await service.createHistoryEntry(
            {
                method: 'GET',
                url: 'https://api.example.com/users',
                headers: { authorization: 'Bearer t', 'PROXY-AUTHORIZATION': 'Basic p' }
            },
            baseResult()
        );

        expect(added.request.headers.authorization).toBe(REDACTED_PLACEHOLDER);
        expect(added.request.headers['PROXY-AUTHORIZATION']).toBe(REDACTED_PLACEHOLDER);
    });

    it('redacts a configured API-key header supplied via sensitive.headerNames', async () => {
        await service.createHistoryEntry(
            {
                method: 'GET',
                url: 'https://api.example.com/users',
                headers: { 'X-Company-Token': 'super-secret', Accept: 'application/json' }
            },
            baseResult(),
            null,
            null,
            { headerNames: ['X-Company-Token'] }
        );

        expect(added.request.headers['X-Company-Token']).toBe(REDACTED_PLACEHOLDER);
        expect(added.request.headers.Accept).toBe('application/json');
    });

    it('redacts a configured API-key query parameter in url and rawUrl', async () => {
        await service.createHistoryEntry(
            {
                method: 'GET',
                url: 'https://api.example.com/users?api_key=SECRET&page=2',
                rawUrl: 'https://api.example.com/users?api_key=SECRET&page=2',
                headers: {}
            },
            baseResult(),
            null,
            null,
            { queryNames: ['api_key'] }
        );

        expect(added.request.url).toContain(`api_key=${encodeURIComponent(REDACTED_PLACEHOLDER)}`);
        expect(added.request.url).toContain('page=2');
        expect(added.request.url).not.toContain('SECRET');
        expect(added.request.rawUrl).not.toContain('SECRET');
    });

    it('redacts Set-Cookie response headers', async () => {
        await service.createHistoryEntry(
            { method: 'POST', url: 'https://api.example.com/login', headers: {} },
            { ...baseResult(), headers: { 'set-cookie': 'session=xyz; Secure', 'content-type': 'application/json' } }
        );

        expect(added.response.headers['set-cookie']).toBe(REDACTED_PLACEHOLDER);
        expect(added.response.headers['content-type']).toBe('application/json');
    });

    it('redacts response headers on the error branch too', async () => {
        await service.createHistoryEntry(
            { method: 'POST', url: 'https://api.example.com/login', headers: {} },
            { success: false, message: 'Network error', headers: { 'set-cookie': 'session=xyz' } }
        );

        expect(added.response.error).toBe(true);
        expect(added.response.headers['set-cookie']).toBe(REDACTED_PLACEHOLDER);
    });

    it('leaves the url unchanged when no query names are given', async () => {
        const url = 'https://api.example.com/users?page=2';
        await service.createHistoryEntry({ method: 'GET', url, headers: {} }, baseResult());

        expect(added.request.url).toBe(url);
    });

    it('leaves an unparseable url unchanged', async () => {
        await service.createHistoryEntry(
            { method: 'GET', url: 'not a url', headers: {} },
            baseResult(),
            null,
            null,
            { queryNames: ['api_key'] }
        );

        expect(added.request.url).toBe('not a url');
    });

    it('does not mutate the caller request headers object', async () => {
        const headers = { Authorization: 'Bearer keep-me' };
        await service.createHistoryEntry(
            { method: 'GET', url: 'https://api.example.com/users', headers },
            baseResult()
        );

        expect(headers.Authorization).toBe('Bearer keep-me');
        expect(added.request.headers.Authorization).toBe(REDACTED_PLACEHOLDER);
    });

    it('handles a missing request headers object', async () => {
        await service.createHistoryEntry(
            { method: 'GET', url: 'https://api.example.com/users' },
            baseResult()
        );

        expect(added.request.headers).toEqual({});
    });
});

describe('HistoryService redaction constants', () => {
    it('freezes the sensitive-name lists', () => {
        expect(Object.isFrozen(SENSITIVE_REQUEST_HEADERS)).toBe(true);
        expect(Object.isFrozen(SENSITIVE_RESPONSE_HEADERS)).toBe(true);
    });
});

describe('HistoryService body size caps', () => {
    let service;
    let added;

    beforeEach(() => {
        service = new HistoryService({});
        added = null;
        service.repository = {
            add: (entry) => {
                added = entry;
                return Promise.resolve(entry);
            }
        };
    });

    const request = () => ({ method: 'POST', url: 'https://api.example.com/users' });

    it('caps an oversized response body and flags it', async () => {
        const data = 'z'.repeat(MAX_HISTORY_RESPONSE_SIZE + 500);

        await service.createHistoryEntry(request(), {
            success: true,
            status: 200,
            statusText: 'OK',
            data,
            headers: {}
        });

        expect(added.response.data).toHaveLength(MAX_HISTORY_RESPONSE_SIZE);
        expect(added.response.truncated).toBe(true);
        expect(added.response.originalSize).toBe(data.length);
    });

    it('caps an oversized response body on the error branch too', async () => {
        const data = 'z'.repeat(MAX_HISTORY_RESPONSE_SIZE + 1);

        await service.createHistoryEntry(request(), {
            success: false,
            status: null,
            statusText: '',
            message: 'boom',
            data,
            headers: {}
        });

        expect(added.response.error).toBe(true);
        expect(added.response.data).toHaveLength(MAX_HISTORY_RESPONSE_SIZE);
        expect(added.response.truncated).toBe(true);
    });

    it('caps an oversized request body at the larger request limit', async () => {
        const body = 'q'.repeat(MAX_HISTORY_REQUEST_SIZE + 10);

        await service.createHistoryEntry(
            { ...request(), body },
            { success: true, status: 200, statusText: 'OK', data: null, headers: {} }
        );

        expect(added.request.body).toHaveLength(MAX_HISTORY_REQUEST_SIZE);
        expect(added.request.truncated).toBe(true);
        expect(added.request.originalSize).toBe(body.length);
    });

    it('leaves small bodies untouched and unflagged', async () => {
        const body = { name: 'Ada' };

        await service.createHistoryEntry(
            { ...request(), body },
            { success: true, status: 200, statusText: 'OK', data: { ok: true }, headers: {} }
        );

        expect(added.request.body).toEqual(body);
        expect(added.response.data).toEqual({ ok: true });
        expect(added.request.truncated).toBeUndefined();
        expect(added.response.truncated).toBeUndefined();
    });

    it('keeps the request body well above the response limit', async () => {
        const body = 'q'.repeat(MAX_HISTORY_RESPONSE_SIZE + 1000);

        await service.createHistoryEntry(
            { ...request(), body },
            { success: true, status: 200, statusText: 'OK', data: null, headers: {} }
        );

        expect(added.request.body).toBe(body);
        expect(added.request.truncated).toBeUndefined();
    });
});
