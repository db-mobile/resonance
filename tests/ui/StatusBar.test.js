/* global document */
jest.mock('../../src/modules/ui/ContextMenu.js', () => ({
    ContextMenu: jest.fn().mockImplementation(() => ({ show: jest.fn(), hide: jest.fn() }))
}));

import { StatusBar } from '../../src/modules/ui/StatusBar.js';
import { notifyStreamStateChanged, registerStreamSource } from '../../src/modules/streaming/streamState.js';

function renderMarkup() {
    document.body.innerHTML = `
        <span id="status-bar-version"></span>
        <button id="status-bar-http"><span data-role="label"></span></button>
        <button id="status-bar-mock" hidden><span data-role="label"></span></button>
        <button id="status-bar-proxy" hidden><span data-role="label"></span></button>
        <button id="status-bar-live" hidden><span data-role="label"></span></button>
        <span id="status-bar-keychain" hidden><span data-role="label"></span></span>
    `;
}

function emitterService(extra) {
    const listeners = [];
    return {
        addChangeListener: (cb) => listeners.push(cb),
        emit: (value) => listeners.forEach(cb => cb(value)),
        ...extra
    };
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const label = (id) => document.querySelector(`#${id} [data-role="label"]`).textContent;
const isHidden = (id) => document.getElementById(id).hidden;

describe('StatusBar indicators', () => {
    let mockService;
    let proxyService;
    let secretStore;
    let settingsModal;
    let dialog;
    let httpVersionManager;

    beforeEach(() => {
        renderMarkup();
        mockService = emitterService({ getStatus: jest.fn().mockResolvedValue({ running: false, port: null }) });
        proxyService = emitterService({ getSettings: jest.fn().mockResolvedValue({ enabled: false }) });
        secretStore = { isUsingKeychain: jest.fn().mockResolvedValue(true) };
        settingsModal = { show: jest.fn() };
        dialog = { show: jest.fn() };
        httpVersionManager = emitterService({ ready: Promise.resolve(), getCurrentVersion: () => 'http2' });
    });

    function createBar() {
        const bar = new StatusBar({
            mockServer: { service: mockService, dialog },
            proxyService,
            secretStore,
            settingsModal,
            httpVersionManager
        });
        bar.initialize();
        return bar;
    }

    test('everything stays hidden when nothing is active', async () => {
        createBar();
        await flush();

        expect(isHidden('status-bar-mock')).toBe(true);
        expect(isHidden('status-bar-proxy')).toBe(true);
        expect(isHidden('status-bar-live')).toBe(true);
        expect(isHidden('status-bar-keychain')).toBe(true);
    });

    test('http version is always shown, follows changes, and opens the general settings tab', async () => {
        createBar();
        await flush();

        expect(isHidden('status-bar-http')).toBe(false);
        expect(label('status-bar-http')).toBe('HTTP/2');

        httpVersionManager.emit('http1');
        expect(label('status-bar-http')).toBe('HTTP/1.x');

        httpVersionManager.emit('auto');
        expect(label('status-bar-http')).toBe('HTTP auto');

        document.getElementById('status-bar-http').click();
        expect(settingsModal.show).toHaveBeenCalledWith({ tab: 'general' });
    });

    test('mock server indicator follows start/stop and opens the dialog', async () => {
        createBar();
        await flush();

        mockService.emit({ running: true, port: 3001 });
        expect(isHidden('status-bar-mock')).toBe(false);
        expect(label('status-bar-mock')).toBe('Mock :3001');

        document.getElementById('status-bar-mock').click();
        expect(dialog.show).toHaveBeenCalled();

        mockService.emit({ running: false, port: null });
        expect(isHidden('status-bar-mock')).toBe(true);
    });

    test('proxy indicator shows host or system proxy and opens the proxy settings tab', async () => {
        proxyService.getSettings.mockResolvedValue({ enabled: true, host: 'corp', port: 8080 });
        createBar();
        await flush();

        expect(label('status-bar-proxy')).toBe('Proxy corp:8080');

        proxyService.emit({ enabled: true, useSystemProxy: true });
        expect(label('status-bar-proxy')).toBe('System proxy');

        document.getElementById('status-bar-proxy').click();
        expect(settingsModal.show).toHaveBeenCalledWith({ tab: 'proxy' });

        proxyService.emit({ enabled: false });
        expect(isHidden('status-bar-proxy')).toBe(true);
    });

    test('keychain warning appears only when secrets fall back to local storage', async () => {
        secretStore.isUsingKeychain.mockResolvedValue(false);
        createBar();
        await flush();

        expect(isHidden('status-bar-keychain')).toBe(false);
        expect(label('status-bar-keychain')).toBe('Secrets unencrypted');
    });

    test('live connection count updates on stream state changes', async () => {
        const entries = new Map();
        const off = registerStreamSource('WebSocket', () => entries.entries());
        createBar();
        await flush();
        expect(isHidden('status-bar-live')).toBe(true);

        entries.set('tab-1', { state: 'open' });
        entries.set('tab-2', { state: 'connecting' });
        notifyStreamStateChanged();
        expect(label('status-bar-live')).toBe('2 live connections');

        entries.set('tab-2', { state: 'closed' });
        notifyStreamStateChanged();
        expect(label('status-bar-live')).toBe('1 live connection');

        entries.clear();
        notifyStreamStateChanged();
        expect(isHidden('status-bar-live')).toBe(true);
        off();
    });
});
