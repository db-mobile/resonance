import { WorkspaceTabEndpointLoaderService } from '../../src/modules/services/WorkspaceTabEndpointLoaderService.js';

describe('WorkspaceTabEndpointLoaderService history entries', () => {
    let loader;

    beforeEach(() => {
        loader = new WorkspaceTabEndpointLoaderService({
            service: {
                generateTabName: (method, url) => `${method} ${url}`
            }
        });
    });

    const httpEntry = () => ({
        id: 'history_1',
        request: {
            protocol: 'http',
            method: 'POST',
            url: 'https://api.example.com/users?page=2&sort=name',
            rawUrl: '{{baseUrl}}/users?page=2&sort=name',
            headers: { 'Content-Type': 'application/json', Authorization: '[redacted]' },
            body: { name: 'Ada' }
        }
    });

    const grpcEntry = () => ({
        id: 'history_2',
        request: {
            protocol: 'grpc',
            method: 'GRPC',
            url: 'localhost:50051/pkg.Greeter/SayHello',
            headers: { 'x-token': '[redacted]' },
            body: { name: 'Ada' },
            grpc: {
                target: 'localhost:50051',
                rawTarget: '{{grpcHost}}',
                fullMethod: '/pkg.Greeter/SayHello',
                useTls: true,
                protoPath: '/tmp/greeter.proto',
                clientStreaming: false,
                serverStreaming: true
            }
        }
    });

    test('an HTTP entry becomes an unbound HTTP tab tagged with the entry id', () => {
        const update = loader.createHistoryTabUpdate(httpEntry());

        expect(update.endpoint).toBeNull();
        expect(update.historyEntryId).toBe('history_1');
        expect(update.isModified).toBe(false);
        expect(update.type).toBe('request');
        expect(update.request.protocol).toBe('http');
        expect(update.request.url).toBe('{{baseUrl}}/users');
        expect(update.request.method).toBe('POST');
        expect(update.request.queryParams).toEqual({ page: '2', sort: 'name' });
        expect(update.request.headers).toEqual({
            'Content-Type': 'application/json',
            Authorization: '[redacted]'
        });
        expect(update.request.body).toEqual({
            mode: 'json',
            content: JSON.stringify({ name: 'Ada' }, null, 2)
        });
        expect(update.request.authType).toBe('none');
    });

    test('a gRPC entry becomes a gRPC tab with its method and streaming flags', () => {
        const update = loader.createHistoryTabUpdate(grpcEntry());

        expect(update.endpoint).toBeNull();
        expect(update.historyEntryId).toBe('history_2');
        expect(update.name).toBe('SayHello');
        expect(update.request.protocol).toBe('grpc');
        expect(update.request.grpc).toEqual({
            target: '{{grpcHost}}',
            service: 'pkg.Greeter',
            fullMethod: '/pkg.Greeter/SayHello',
            requestJson: JSON.stringify({ name: 'Ada' }, null, 2),
            metadata: { 'x-token': '[redacted]' },
            useTls: true,
            protoPath: '/tmp/greeter.proto',
            clientStreaming: false,
            serverStreaming: true
        });
    });

    test('a string body is restored as text and a missing body as empty JSON', () => {
        const entry = httpEntry();
        entry.request.body = 'plain text payload';
        expect(loader.createHistoryTabUpdate(entry).request.body).toEqual({
            mode: 'text',
            content: 'plain text payload'
        });

        entry.request.body = null;
        expect(loader.createHistoryTabUpdate(entry).request.body).toEqual({
            mode: 'json',
            content: ''
        });
    });

    test('an unparseable URL yields no query params instead of throwing', () => {
        const entry = httpEntry();
        entry.request.url = '{{baseUrl}}/users';

        expect(loader.createHistoryTabUpdate(entry).request.queryParams).toEqual({});
    });

    test('loading a collection endpoint clears the history tag on the tab', async () => {
        const updates = [];
        loader.service = {
            ...loader.service,
            updateTab: (tabId, update) => {
                updates.push(update);
                return Promise.resolve(null);
            }
        };

        await loader.loadEndpoint({ protocol: 'http', method: 'GET', path: '/users' }, 'tab-1');

        expect(updates[0].historyEntryId).toBeNull();
    });
});
