/* global document, DOMParser */
import fs from 'fs';
import path from 'path';
import { templateLoader } from '../../src/modules/templateLoader.js';
import { MockServerDialog } from '../../src/modules/ui/MockServerDialog.js';
import { escapeHandlerCount } from '../../src/modules/ui/modalEscape.js';

const TEMPLATE_PATH = './src/templates/mockServer/mockServerDialog.html';
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function seedTemplates() {
    const html = fs.readFileSync(path.join(process.cwd(), 'src/templates/mockServer/mockServerDialog.html'), 'utf8');
    templateLoader.cache.set(TEMPLATE_PATH, new DOMParser().parseFromString(html, 'text/html'));
}

function endpoint(id, method, p) {
    return { id, method, path: p };
}

function makeController(overrides = {}) {
    const settings = { port: 3000, enabledCollections: ['c1'], endpointDelays: {} };
    return {
        getSettings: jest.fn(async () => settings),
        getCollections: jest.fn(async () => []),
        getStatus: jest.fn(async () => ({ running: false, port: 3000 })),
        getRequestLogs: jest.fn(async () => []),
        handleStart: jest.fn(async () => ({ success: true })),
        handleStop: jest.fn(async () => ({ success: true })),
        handleUpdatePort: jest.fn(async () => ({ success: true })),
        handleToggleCollection: jest.fn(async () => ({ success: true })),
        clearRequestLogs: jest.fn(async () => {}),
        getCustomResponse: jest.fn(async () => null),
        getCustomStatusCode: jest.fn(async () => null),
        getDefaultResponse: jest.fn(async () => ({ hello: 'world' })),
        handleSetDelay: jest.fn(async () => ({ success: true })),
        handleSetCustomStatusCode: jest.fn(async () => ({ success: true })),
        handleSetCustomResponse: jest.fn(async () => ({ success: true })),
        ...overrides
    };
}

async function openDialog(controller) {
    const dialog = new MockServerDialog(controller);
    dialog.show();
    for (let i = 0; i < 4; i++) {
        await flush();
    }
    return dialog;
}

describe('MockServerDialog', () => {
    beforeEach(seedTemplates);

    afterEach(() => {
        document.body.innerHTML = '';
        expect(escapeHandlerCount()).toBe(0);
    });

    test('renders the static texts and the stopped status', async () => {
        const controller = makeController();
        const dialog = await openDialog(controller);

        expect(document.querySelector('[data-role="title"]').textContent).toBe('Mock Server');
        expect(document.querySelector('[data-role="port-label"]').textContent).toBe('Port:');
        expect(document.querySelector('[data-role="collections-heading"]').textContent).toBe('COLLECTIONS TO MOCK');
        expect(document.querySelector('[data-role="request-log-heading"]').textContent).toBe('REQUEST LOG');
        expect(document.querySelector('[data-role="clear"]').textContent).toBe('Clear');
        expect(document.querySelector('#mock-server-close-btn').getAttribute('aria-label')).toBe('Close');
        expect(document.querySelector('#mock-server-port-input').value).toBe('3000');
        expect(document.querySelector('#mock-server-status-text').textContent).toBe('Stopped');
        expect(document.querySelector('#mock-server-toggle-btn').textContent).toBe('Start Server');
        const emptyStates = document.querySelectorAll('.mock-server-empty-state');
        expect(emptyStates).toHaveLength(2);
        expect(emptyStates[0].textContent).toBe('');
        expect(document.querySelectorAll('.mock-server-empty-state br')).toHaveLength(0);

        dialog.close();
    });

    test('renders enabled collections with their HTTP endpoints and a show-all toggle', async () => {
        const many = Array.from({ length: 12 }, (_, i) => endpoint(`e${i}`, 'GET', `/items/${i}`));
        const collections = [
            { id: 'c1', name: 'Shop', endpoints: [...many, endpoint('ws', 'WS', '/socket')] },
            { id: 'c2', name: 'Other', endpoints: [endpoint('x', 'POST', '/x')] },
            { id: 'c3', name: 'Sockets only', endpoints: [endpoint('g', 'GRPC', '/g')] }
        ];
        const controller = makeController({ getCollections: jest.fn(async () => collections) });
        const dialog = await openDialog(controller);

        const blocks = Array.from(document.querySelectorAll('.mock-server-collection'));
        expect(blocks).toHaveLength(2);
        expect(blocks[0].querySelector('.mock-server-collection-label').textContent).toBe('Shop (12 endpoints)');
        expect(blocks[0].querySelector('.mock-server-collection-header').classList.contains('has-endpoints')).toBe(true);
        expect(blocks[0].querySelector('input[type="checkbox"]').checked).toBe(true);
        expect(blocks[0].querySelectorAll('.mock-server-endpoint')).toHaveLength(10);
        expect(blocks[0].querySelector('.mock-server-endpoints-toggle').textContent).toBe('Show all 12 endpoints');
        expect(blocks[0].querySelector('.mock-server-endpoints-toggle .icon').classList.contains('icon-chevron-down')).toBe(true);
        expect(blocks[1].querySelector('.mock-server-endpoints')).toBeNull();
        expect(blocks[1].querySelector('.mock-server-collection-header').classList.contains('has-endpoints')).toBe(false);

        blocks[0].querySelector('.mock-server-endpoints-toggle').click();
        await flush();
        await flush();

        const expanded = document.querySelector('.mock-server-collection');
        expect(expanded.querySelectorAll('.mock-server-endpoint')).toHaveLength(12);
        expect(expanded.querySelector('.mock-server-endpoints-toggle').textContent).toBe('Show less');
        expect(expanded.querySelector('.mock-server-endpoints-toggle .icon').classList.contains('icon-chevron-up')).toBe(true);
        const first = expanded.querySelector('.mock-server-endpoint');
        expect(first.querySelector('.method-pill').textContent).toBe('GET');
        expect(first.querySelector('.method-pill').dataset.method).toBe('GET');
        expect(first.querySelector('.mock-server-endpoint-path').textContent).toBe('/items/0');
        expect(first.querySelector('.mock-server-edit-response-btn').textContent).toBe('Edit');
        expect(first.querySelector('.mock-server-edit-response-btn').title).toBe('Edit custom response');

        dialog.close();
    });

    test('toggling a collection notifies the controller and re-renders', async () => {
        const collections = [{ id: 'c1', name: 'Shop', endpoints: [endpoint('a', 'GET', '/a')] }];
        const controller = makeController({ getCollections: jest.fn(async () => collections) });
        const dialog = await openDialog(controller);

        document.querySelector('.mock-server-collection input[type="checkbox"]').dispatchEvent(new Event('change'));
        await flush();
        await flush();

        expect(controller.handleToggleCollection).toHaveBeenCalledWith('c1');
        expect(controller.getCollections).toHaveBeenCalledTimes(2);

        dialog.close();
    });

    test('renders the request log table with status classes', async () => {
        const logs = [
            { timestamp: 1700000000000, method: 'GET', path: '/ok', responseStatus: 200, responseTime: 5 },
            { timestamp: 1700000001000, method: 'GET', path: '/missing', responseStatus: 404, responseTime: 7 },
            { timestamp: 1700000002000, method: 'POST', path: '/boom', responseStatus: 500, responseTime: 9 }
        ];
        const controller = makeController({ getRequestLogs: jest.fn(async () => logs) });
        const dialog = await openDialog(controller);

        const headers = Array.from(document.querySelectorAll('.mock-server-logs-th')).map(th => th.textContent);
        expect(headers).toEqual(['Time', 'Method', 'Path', 'Status', 'Time (ms)']);

        const rows = Array.from(document.querySelectorAll('tbody .mock-server-logs-row'));
        expect(rows).toHaveLength(3);
        expect(rows[0].querySelector('[data-role="method"]').textContent).toBe('GET');
        expect(rows[0].querySelector('[data-role="path"]').textContent).toBe('/ok');
        expect(rows[0].querySelector('[data-role="path"]').title).toBe('/ok');
        expect(rows[0].querySelector('[data-role="time-ms"]').textContent).toBe('5');
        expect(rows[0].querySelector('[data-role="time"]').textContent).toBe(new Date(1700000000000).toLocaleTimeString());
        const statuses = rows.map(r => r.querySelector('[data-role="status"]'));
        expect(statuses.map(s => s.textContent)).toEqual(['200', '404', '500']);
        expect(statuses[0].classList.contains('is-success')).toBe(true);
        expect(statuses[1].classList.contains('is-warning')).toBe(true);
        expect(statuses[2].classList.contains('is-danger')).toBe(true);

        dialog.close();
    });

    test('the empty log state is rendered when there are no logs', async () => {
        const dialog = await openDialog(makeController());
        expect(document.querySelector('#mock-server-logs .mock-server-empty-state')).not.toBeNull();
        expect(document.querySelector('#mock-server-logs .mock-server-empty-state').textContent).toBe('');
        dialog.close();
    });

    test('running status switches the toggle button and disables the port input', async () => {
        const controller = makeController({ getStatus: jest.fn(async () => ({ running: true, port: 4000 })) });
        const dialog = await openDialog(controller);

        expect(document.querySelector('#mock-server-status-text').textContent).toBe('Running');
        expect(document.querySelector('#mock-server-url').textContent).toBe('http://localhost:4000');
        const toggle = document.querySelector('#mock-server-toggle-btn');
        expect(toggle.textContent).toBe('Stop Server');
        expect(toggle.classList.contains('btn-danger')).toBe(true);
        expect(document.querySelector('#mock-server-port-input').disabled).toBe(true);

        toggle.click();
        await flush();
        await flush();
        expect(controller.handleStop).toHaveBeenCalledTimes(1);

        dialog.close();
    });

    test('a failed start shows an error toast and re-enables the toggle', async () => {
        const controller = makeController({ handleStart: jest.fn(async () => ({ success: false, message: 'Port in use' })) });
        const dialog = await openDialog(controller);

        document.querySelector('#mock-server-toggle-btn').click();
        for (let i = 0; i < 4; i++) {
            await flush();
        }

        const toastEl = document.querySelector('.toast--error .toast__message');
        expect(toastEl.textContent).toBe('Port in use');
        expect(document.querySelector('#mock-server-toggle-btn').disabled).toBe(false);

        dialog.close();
    });

    test('a thrown toggle error still re-enables the toggle', async () => {
        const controller = makeController({ getStatus: jest.fn(async () => { throw new Error('boom'); }) });
        const dialog = await openDialog(controller);
        controller.getStatus.mockClear();

        document.querySelector('#mock-server-toggle-btn').click();
        for (let i = 0; i < 4; i++) {
            await flush();
        }

        expect(document.querySelector('#mock-server-toggle-btn').disabled).toBe(false);

        dialog.close();
    });

    test('the response editor shows the defaults and saves delay, status and body', async () => {
        const collections = [{ id: 'c1', name: 'Shop', endpoints: [endpoint('a', 'POST', '/a')] }];
        const controller = makeController({ getCollections: jest.fn(async () => collections) });
        const dialog = await openDialog(controller);

        document.querySelector('.mock-server-edit-response-btn').click();
        for (let i = 0; i < 6; i++) {
            await flush();
        }

        const editor = document.querySelector('.mock-server-response-editor');
        expect(editor.querySelector('[data-role="title"]').textContent).toBe('Edit Response');
        expect(editor.querySelector('[data-role="subtitle"]').textContent).toBe('POST /a');
        expect(editor.querySelector('[data-role="delay-label"]').textContent).toBe('Delay (ms)');
        expect(editor.querySelector('[data-role="status-code-label"]').textContent).toBe('Status Code');
        expect(editor.querySelector('[data-role="body-label"]').textContent).toBe('Response Body (JSON)');
        expect(editor.querySelector('[data-role="template-hint"]').textContent).toMatch(/^Strings may use /);
        expect(editor.querySelector('[data-role="reset"]').textContent).toBe('Reset to Default');
        expect(editor.querySelector('[data-role="cancel"]').textContent).toBe('Cancel');
        expect(editor.querySelector('[data-role="save"]').textContent).toBe('Save');
        expect(editor.querySelector('[data-role="custom-notice"]').classList.contains('is-hidden')).toBe(true);
        expect(editor.querySelector('#response-editor-delay').value).toBe('0');
        expect(editor.querySelector('#response-editor-status-code').value).toBe('201');
        expect(editor.querySelector('#response-editor-textarea').value).toBe(JSON.stringify({ hello: 'world' }, null, 2));
        expect(escapeHandlerCount()).toBe(2);

        editor.querySelector('#response-editor-delay').value = '250';
        editor.querySelector('#response-editor-status-code').value = '202';
        editor.querySelector('#response-editor-textarea').value = '{"a":1}';
        editor.querySelector('#response-editor-save').click();
        for (let i = 0; i < 6; i++) {
            await flush();
        }

        expect(controller.handleSetDelay).toHaveBeenCalledWith('c1', 'a', 250);
        expect(controller.handleSetCustomStatusCode).toHaveBeenCalledWith('c1', 'a', 202);
        expect(controller.handleSetCustomResponse).toHaveBeenCalledWith('c1', 'a', { a: 1 });
        expect(document.querySelector('.mock-server-response-editor')).toBeNull();

        dialog.close();
    });

    test('the response editor rejects an out-of-range delay without saving', async () => {
        const collections = [{ id: 'c1', name: 'Shop', endpoints: [endpoint('a', 'GET', '/a')] }];
        const controller = makeController({ getCollections: jest.fn(async () => collections) });
        const dialog = await openDialog(controller);

        document.querySelector('.mock-server-edit-response-btn').click();
        for (let i = 0; i < 6; i++) {
            await flush();
        }
        const editor = document.querySelector('.mock-server-response-editor');
        editor.querySelector('#response-editor-delay').value = '99999';
        editor.querySelector('#response-editor-save').click();
        await flush();

        expect(editor.querySelector('#response-editor-error').textContent).toBe('Delay must be between 0 and 30000ms');
        expect(controller.handleSetDelay).not.toHaveBeenCalled();

        editor.querySelector('#response-editor-delay').value = '0';
        editor.querySelector('#response-editor-status-code').value = '42';
        editor.querySelector('#response-editor-save').click();
        await flush();
        expect(editor.querySelector('#response-editor-error').textContent).toBe('Status code must be between 100 and 599');

        editor.querySelector('#response-editor-cancel').click();
        expect(document.querySelector('.mock-server-response-editor')).toBeNull();

        dialog.close();
    });

    test('reset clears the overrides through the controller', async () => {
        const collections = [{ id: 'c1', name: 'Shop', endpoints: [endpoint('a', 'DELETE', '/a')] }];
        const controller = makeController({
            getCollections: jest.fn(async () => collections),
            getCustomResponse: jest.fn(async () => ({ custom: true }))
        });
        const dialog = await openDialog(controller);

        document.querySelector('.mock-server-edit-response-btn').click();
        for (let i = 0; i < 6; i++) {
            await flush();
        }
        const editor = document.querySelector('.mock-server-response-editor');
        expect(editor.querySelector('[data-role="custom-notice"]').textContent).toBe('Using custom response');
        expect(editor.querySelector('#response-editor-status-code').value).toBe('204');

        editor.querySelector('#response-editor-reset').click();
        for (let i = 0; i < 6; i++) {
            await flush();
        }

        expect(controller.handleSetDelay).toHaveBeenCalledWith('c1', 'a', 0);
        expect(controller.handleSetCustomStatusCode).toHaveBeenCalledWith('c1', 'a', null);
        expect(controller.handleSetCustomResponse).toHaveBeenCalledWith('c1', 'a', null);
        expect(document.querySelector('.mock-server-response-editor')).toBeNull();

        dialog.close();
    });

    test('getDefaultStatusCode follows the HTTP method', () => {
        const dialog = new MockServerDialog(makeController());
        expect(dialog.getDefaultStatusCode({ method: 'post' })).toBe(201);
        expect(dialog.getDefaultStatusCode({ method: 'DELETE' })).toBe(204);
        expect(dialog.getDefaultStatusCode({ method: 'GET' })).toBe(200);
        expect(dialog.getDefaultStatusCode({ method: 'PATCH' })).toBe(200);
        expect(dialog.getDefaultStatusCode({ method: 'CUSTOM' })).toBe(200);
    });
});
