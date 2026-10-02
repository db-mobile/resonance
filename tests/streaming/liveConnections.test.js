import { listLiveConnections, registerStreamSource } from '../../src/modules/streaming/streamState.js';

describe('listLiveConnections', () => {
    const unregister = [];

    afterEach(() => {
        unregister.splice(0).forEach(fn => fn());
    });

    test('collects non-closed entries across protocols with their tab ids', () => {
        const ws = new Map([
            ['tab-1', { state: 'open' }],
            ['tab-2', { state: 'closed' }]
        ]);
        const mqtt = new Map([
            ['tab-3', { state: 'connecting' }],
            ['tab-4', {}]
        ]);
        unregister.push(registerStreamSource('WebSocket', () => ws.entries()));
        unregister.push(registerStreamSource('MQTT', () => mqtt.entries()));

        expect(listLiveConnections()).toEqual([
            { tabId: 'tab-1', protocol: 'WebSocket' },
            { tabId: 'tab-3', protocol: 'MQTT' }
        ]);
    });

    test('reflects later state changes and unregistration', () => {
        const sse = new Map([['tab-1', { state: 'open' }]]);
        const off = registerStreamSource('SSE', () => sse.entries());

        sse.set('tab-1', { state: 'closed' });
        expect(listLiveConnections()).toEqual([]);

        sse.set('tab-1', { state: 'open' });
        off();
        expect(listLiveConnections()).toEqual([]);
    });
});
