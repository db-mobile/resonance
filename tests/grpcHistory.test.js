/* global document, window */

import { HistoryService, REDACTED_PLACEHOLDER } from '../src/modules/services/HistoryService.js';
import { grpcStatusName, isGrpcStatusOk } from '../src/modules/utils/grpcStatus.js';

function makeService() {
    const service = new HistoryService({});
    const added = [];
    service.repository = {
        add: (entry) => {
            added.push(entry);
            return Promise.resolve(entry);
        }
    };
    return { service, added };
}

const grpcRequestConfig = (overrides = {}) => ({
    protocol: 'grpc',
    method: 'GRPC',
    url: 'localhost:50051/helloworld.Greeter/SayHello',
    rawUrl: '{{host}}/helloworld.Greeter/SayHello',
    headers: { authorization: 'Bearer secret', 'x-api-key': 'k-123', 'x-trace': 'keep' },
    body: { name: 'world' },
    grpc: {
        target: 'localhost:50051',
        rawTarget: '{{host}}',
        fullMethod: '/helloworld.Greeter/SayHello',
        useTls: true,
        protoPath: null,
        clientStreaming: false,
        serverStreaming: false
    },
    ...overrides
});

describe('grpcStatusName', () => {
    it('names the canonical codes', () => {
        expect(grpcStatusName(0)).toBe('OK');
        expect(grpcStatusName(5)).toBe('NOT_FOUND');
        expect(grpcStatusName(16)).toBe('UNAUTHENTICATED');
    });

    it('falls back to a labelled code so it cannot be read as an HTTP status', () => {
        expect(grpcStatusName(99)).toBe('CODE_99');
    });

    it('returns an empty string when no code was reported', () => {
        expect(grpcStatusName(null)).toBe('');
        expect(grpcStatusName(undefined)).toBe('');
    });

    it('treats only 0 as success', () => {
        expect(isGrpcStatusOk(0)).toBe(true);
        expect(isGrpcStatusOk(1)).toBe(false);
        expect(isGrpcStatusOk(null)).toBe(false);
    });
});

describe('gRPC history entries', () => {
    it('records the protocol and replay context', async () => {
        const { service, added } = makeService();

        await service.createHistoryEntry(grpcRequestConfig(), {
            success: true,
            status: 0,
            statusText: 'OK',
            data: { message: 'hi' },
            headers: {},
            trailers: { 'x-trailer': '1' }
        });

        const [entry] = added;
        expect(entry.request.protocol).toBe('grpc');
        expect(entry.request.grpc.fullMethod).toBe('/helloworld.Greeter/SayHello');
        expect(entry.request.grpc.useTls).toBe(true);
        expect(entry.response.status).toBe(0);
        expect(entry.response.trailers).toEqual({ 'x-trailer': '1' });
    });

    it('keeps a zero status instead of nulling it', async () => {
        const { service, added } = makeService();

        await service.createHistoryEntry(grpcRequestConfig(), {
            success: true,
            status: 0,
            statusText: 'OK',
            headers: {}
        });

        expect(added[0].response.status).toBe(0);
        expect(added[0].response.status).not.toBeNull();
    });

    it('redacts credentials in metadata, including a configured api-key', async () => {
        const { service, added } = makeService();

        await service.createHistoryEntry(
            grpcRequestConfig(),
            { success: true, status: 0, headers: {} },
            null,
            null,
            { headerNames: ['x-api-key'] }
        );

        const { headers } = added[0].request;
        expect(headers.authorization).toBe(REDACTED_PLACEHOLDER);
        expect(headers['x-api-key']).toBe(REDACTED_PLACEHOLDER);
        expect(headers['x-trace']).toBe('keep');
    });

    it('does not carry a second unredacted copy of the metadata', async () => {
        const { service, added } = makeService();

        await service.createHistoryEntry(grpcRequestConfig(), { success: true, status: 0, headers: {} });

        expect(JSON.stringify(added[0])).not.toContain('Bearer secret');
    });

    it('leaves a bare host:port url unchanged', async () => {
        const { service, added } = makeService();

        await service.createHistoryEntry(
            grpcRequestConfig(),
            { success: true, status: 0, headers: {} },
            null,
            null,
            { queryNames: ['token'] }
        );

        expect(added[0].request.url).toBe('localhost:50051/helloworld.Greeter/SayHello');
    });

    it('defaults non-gRPC entries to the http protocol', async () => {
        const { service, added } = makeService();

        await service.createHistoryEntry(
            { method: 'GET', url: 'https://api.example.com/x', headers: {} },
            { success: true, status: 200, headers: {} }
        );

        expect(added[0].request.protocol).toBe('http');
        expect(added[0].request.grpc).toBeNull();
    });
});

describe('HistoryService.getStatusDisplay', () => {
    let service;

    beforeEach(() => {
        service = new HistoryService({});
    });

    it('renders a successful gRPC call as OK, not as an error', () => {
        const display = service.getStatusDisplay({
            request: { protocol: 'grpc' },
            response: { status: 0 }
        });

        expect(display).not.toBeNull();
        expect(display.text).toBe('OK');
        expect(display.color).toContain('success');
    });

    it('renders a failed gRPC call with its status name in the error colour', () => {
        const display = service.getStatusDisplay({
            request: { protocol: 'grpc' },
            response: { status: 5 }
        });

        expect(display.text).toBe('NOT_FOUND');
        expect(display.color).toContain('error');
    });

    it('returns null for a gRPC entry that never got a status', () => {
        expect(service.getStatusDisplay({
            request: { protocol: 'grpc' },
            response: { status: null }
        })).toBeNull();
    });

    it('still renders HTTP statuses as numbers', () => {
        const display = service.getStatusDisplay({
            request: { protocol: 'http' },
            response: { status: 404 }
        });

        expect(display.text).toBe('404');
    });

    it('returns null for an HTTP entry with no status', () => {
        expect(service.getStatusDisplay({
            request: { protocol: 'http' },
            response: {}
        })).toBeNull();
    });
});

describe('recordGrpcHistory', () => {
    afterEach(() => {
        jest.resetModules();
    });

    async function loadRecorder() {
        jest.resetModules();
        const { app } = await import('../src/modules/appContext.js');
        const addHistoryEntry = jest.fn(async () => {});
        app.historyController = { addHistoryEntry };
        const { recordGrpcHistory } = await import('../src/modules/grpcHistory.js');
        return { recordGrpcHistory, addHistoryEntry, app };
    }

    const baseCall = {
        rawTarget: '{{host}}',
        target: 'localhost:50051',
        fullMethod: '/helloworld.Greeter/SayHello',
        metadata: { authorization: 'Bearer secret' },
        requestJson: { name: 'world' },
        useTls: false,
        sensitiveNames: ['authorization']
    };

    it('builds a gRPC request config and names the status', async () => {
        const { recordGrpcHistory, addHistoryEntry } = await loadRecorder();

        await recordGrpcHistory({
            ...baseCall,
            result: { success: true, status: 0, data: { message: 'hi' }, headers: {} }
        });

        expect(addHistoryEntry).toHaveBeenCalledTimes(1);
        const [requestConfig, result, , , sensitive] = addHistoryEntry.mock.calls[0];
        expect(requestConfig.protocol).toBe('grpc');
        expect(requestConfig.method).toBe('GRPC');
        expect(requestConfig.url).toBe('localhost:50051/helloworld.Greeter/SayHello');
        expect(requestConfig.rawUrl).toBe('{{host}}/helloworld.Greeter/SayHello');
        expect(result.statusText).toBe('OK');
        expect(result.size).toBeGreaterThan(0);
        expect(sensitive.headerNames).toEqual(['authorization']);
    });

    it('records a failed call with no status code', async () => {
        const { recordGrpcHistory, addHistoryEntry } = await loadRecorder();

        await recordGrpcHistory({
            ...baseCall,
            result: { success: false, status: null, statusMessage: 'transport error', data: null }
        });

        const [, result] = addHistoryEntry.mock.calls[0];
        expect(result.success).toBe(false);
        expect(result.status).toBeNull();
        expect(result.statusText).toBe('');
        expect(result.message).toBe('transport error');
    });

    it('does nothing when there is no history controller', async () => {
        jest.resetModules();
        const { app } = await import('../src/modules/appContext.js');
        delete app.historyController;
        const { recordGrpcHistory } = await import('../src/modules/grpcHistory.js');

        await expect(recordGrpcHistory({ ...baseCall, result: { success: true, status: 0 } }))
            .resolves.toBeUndefined();
    });

    it('records a streaming call when the stream closes, with the transcript', async () => {
        document.body.innerHTML = `
            <span id="status-display"></span>
            <span id="response-time-display"></span>
            <span id="response-size-display"></span>
        `;
        jest.resetModules();

        jest.doMock('../src/modules/apiHandler.js', () => ({
            displayResponseWithLineNumbersForTab: jest.fn()
        }));

        const { app } = await import('../src/modules/appContext.js');
        const addHistoryEntry = jest.fn(async () => {});
        app.historyController = { addHistoryEntry };
        app.workspaceTabController = {
            service: { getActiveTabId: async () => 'tab-1' }
        };

        let backendHandler = null;
        window.__TAURI_INTERNALS__ = {
            invoke: async (_cmd, args) => {
                backendHandler = args.handler;
            },
            transformCallback: (fn) => fn
        };
        window.backendAPI = {
            grpc: {
                streamStart: jest.fn(async () => ({ success: true })),
                streamSend: jest.fn(),
                streamCancel: jest.fn()
            }
        };

        const { startOrSend } = await import('../src/modules/grpcStreamHandler.js');

        await startOrSend({
            target: 'localhost:50051',
            fullMethod: '/chat.Chat/Converse',
            requestJson: { text: 'hi' },
            metadata: {},
            tls: { useTls: false, skipVerify: false },
            canSend: true,
            historyContext: {
                ...baseCall,
                fullMethod: '/chat.Chat/Converse',
                clientStreaming: true,
                serverStreaming: true
            }
        });

        expect(backendHandler).not.toBeNull();
        expect(addHistoryEntry).not.toHaveBeenCalled();

        await backendHandler({
            payload: {
                tabId: 'tab-1',
                eventType: 'message',
                fullMethod: '/chat.Chat/Converse',
                message: { text: 'pong' }
            }
        });
        await backendHandler({
            payload: {
                tabId: 'tab-1',
                eventType: 'close',
                fullMethod: '/chat.Chat/Converse',
                status: 0,
                trailers: { 'x-done': '1' }
            }
        });

        expect(addHistoryEntry).toHaveBeenCalledTimes(1);
        const [requestConfig, result] = addHistoryEntry.mock.calls[0];
        expect(requestConfig.grpc.clientStreaming).toBe(true);
        expect(result.statusText).toBe('OK');
        expect(result.data).toContain('pong');
        expect(result.trailers).toEqual({ 'x-done': '1' });

        delete window.backendAPI;
        delete app.workspaceTabController;
        document.body.innerHTML = '';
    });

    it('never throws when recording fails', async () => {
        const { recordGrpcHistory, app } = await loadRecorder();
        app.historyController.addHistoryEntry = jest.fn(async () => {
            throw new Error('store unavailable');
        });

        await expect(recordGrpcHistory({ ...baseCall, result: { success: true, status: 0 } }))
            .resolves.toBeUndefined();
    });
});
