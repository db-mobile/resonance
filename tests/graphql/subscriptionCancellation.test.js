/* global window */
jest.mock('../../src/modules/responseView.js', () => ({
    displayResponseWithLineNumbersForTab: jest.fn(),
    clearResponseDisplayForTab: jest.fn()
}));
jest.mock('../../src/modules/statusDisplay.js', () => ({
    updateStatusDisplay: jest.fn(),
    updateResponseTime: jest.fn(),
    updateResponseSize: jest.fn()
}));
jest.mock('../../src/modules/tlsOptions.js', () => ({
    resolveTlsOptions: jest.fn().mockResolvedValue({})
}));
jest.mock('../../src/modules/ui/Toast.js', () => ({
    toast: { error: jest.fn() }
}));

import { app } from '../../src/modules/appContext.js';
import { displayResponseWithLineNumbersForTab } from '../../src/modules/responseView.js';
import { updateStatusDisplay } from '../../src/modules/statusDisplay.js';
import {
    handleGraphQLSubscriptionStart, handleGraphQLSubscriptionCancel,
    clearGraphQLSubscriptionState, isSubscriptionActive
} from '../../src/modules/graphqlSubscriptionHandler.js';

const options = { url: 'wss://example.test/graphql', query: 'subscription { updated }' };
let pending;

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
    pending.push(resolve);
    return { promise, resolve, reject };
}

async function transcript() {
    await jest.advanceTimersByTimeAsync(100);
    return displayResponseWithLineNumbersForTab.mock.calls.at(-1)?.[0] || '';
}

describe('GraphQL subscription command continuations', () => {
    beforeEach(() => {
        pending = [];
        jest.useFakeTimers();
        jest.clearAllMocks();
        app.workspaceTabController = {
            service: {
                getActiveTabId: jest.fn().mockResolvedValue('tab-1'),
                updateTab: jest.fn().mockResolvedValue(undefined)
            }
        };
        window.__TAURI_INTERNALS__ = {
            invoke: jest.fn().mockResolvedValue(undefined),
            transformCallback: handler => handler
        };
        window.backendAPI = {
            graphqlSubscription: {
                send: jest.fn().mockResolvedValue({ success: true }),
                close: jest.fn().mockResolvedValue({ success: true })
            }
        };
    });

    afterEach(async () => {
        pending.forEach(resolve => resolve({ success: true }));
        await clearGraphQLSubscriptionState('tab-1');
        jest.useRealTimers();
        delete window.backendAPI;
        delete window.__TAURI_INTERNALS__;
        app.workspaceTabController = null;
    });

    test('a rejected pending send after Stop keeps the stopped state and transcript', async () => {
        const gate = deferred();
        const entered = deferred();
        window.backendAPI.graphqlSubscription.send.mockImplementationOnce(() => {
            entered.resolve();
            return gate.promise;
        });
        const starting = handleGraphQLSubscriptionStart(options);
        await entered.promise;
        await handleGraphQLSubscriptionCancel();
        gate.reject('Connection cancelled');
        await starting;

        expect(isSubscriptionActive('tab-1')).toBe(false);
        expect(updateStatusDisplay).toHaveBeenLastCalledWith('Subscription stopped', null);
        const content = await transcript();
        expect(content).toContain('STOPPED');
        expect(content).not.toContain('ERROR');
    });

    test('an older rejected start cannot modify a replacement attempt at the same URL', async () => {
        const old = deferred();
        const entered = deferred();
        window.backendAPI.graphqlSubscription.send.mockImplementationOnce(() => {
            entered.resolve();
            return old.promise;
        });
        const starting = handleGraphQLSubscriptionStart(options);
        await entered.promise;
        await handleGraphQLSubscriptionStart({ ...options, query: 'subscription { replacement }' });
        old.reject('Connection cancelled');
        await starting;

        expect(isSubscriptionActive('tab-1')).toBe(true);
        expect(updateStatusDisplay).toHaveBeenLastCalledWith('Subscription connecting...', null);
        expect(await transcript()).not.toContain('ERROR');
    });

    test('a genuine start failure closes the current attempt and retains the error details', async () => {
        window.backendAPI.graphqlSubscription.send.mockRejectedValueOnce(new Error('dial failed'));
        await handleGraphQLSubscriptionStart(options);

        expect(isSubscriptionActive('tab-1')).toBe(false);
        expect(updateStatusDisplay).toHaveBeenLastCalledWith('Subscription connection failed', null);
        const content = await transcript();
        expect(content).toContain('Connection failed: dial failed');
        expect(content.match(/ERROR/g)).toHaveLength(1);
    });
});
