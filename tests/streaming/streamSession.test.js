jest.mock('../../src/modules/apiHandler.js', () => ({
    displayResponseWithLineNumbersForTab: jest.fn()
}));

jest.mock('../../src/modules/statusDisplay.js', () => ({
    updateStatusDisplay: jest.fn(),
    updateResponseTime: jest.fn(),
    updateResponseSize: jest.fn()
}));

import { app } from '../../src/modules/appContext.js';
import { displayResponseWithLineNumbersForTab } from '../../src/modules/apiHandler.js';
import { StreamSession } from '../../src/modules/streaming/streamSession.js';

const TAB = 'tab-1';

describe('StreamSession transcript', () => {
    let session;
    let updateTab;

    beforeEach(() => {
        jest.useFakeTimers();
        jest.clearAllMocks();

        updateTab = jest.fn().mockResolvedValue({});
        app.workspaceTabController = {
            isRestoringState: false,
            service: {
                updateTab,
                getActiveTabId: jest.fn().mockResolvedValue(TAB)
            }
        };

        session = new StreamSession({
            buildResponseMeta: (entry, transcript, state) => ({ data: transcript, state })
        });
        session.set(TAB, { url: 'https://x/events', state: 'open', transcript: '' });
    });

    afterEach(() => {
        jest.useRealTimers();
        delete app.workspaceTabController;
    });

    const lastRendered = () => {
        const { calls } = displayResponseWithLineNumbersForTab.mock;
        return calls[calls.length - 1][0];
    };

    test('appends timestamped entries separated by a blank line', async () => {
        await session.append(TAB, 'CONNECTED https://x/events');
        await session.append(TAB, 'EVENT', 'data: hello');

        const { transcript } = session.get(TAB);
        expect(transcript).toMatch(/CONNECTED https:\/\/x\/events/);
        expect(transcript).toMatch(/EVENT\ndata: hello$/);
        expect(transcript.split('\n\n')).toHaveLength(2);
        expect(lastRendered()).toBe(transcript);
    });

    test('caps the entry count and reports how many were dropped', async () => {
        for (let i = 0; i < 520; i += 1) {
            await session.append(TAB, 'EVENT', `data: ${i}`);
        }

        const { transcript } = session.get(TAB);
        const entries = transcript.split('\n\n');

        expect(entries).toHaveLength(501);
        expect(entries[0]).toBe('[20 earlier entries dropped]');
        expect(transcript).toContain('data: 519');
        expect(transcript).not.toContain('data: 19\n');
    });

    test('caps total size when a few entries are very large', async () => {
        const big = 'x'.repeat(100 * 1024);
        for (let i = 0; i < 5; i += 1) {
            await session.append(TAB, 'EVENT', big);
        }

        const { transcript } = session.get(TAB);
        expect(transcript.length).toBeLessThan(300 * 1024);
        expect(transcript).toContain('earlier entries dropped');
    });

    test('keeps a single oversized entry rather than truncating it', async () => {
        const huge = 'y'.repeat(400 * 1024);
        await session.append(TAB, 'EVENT', huge);

        expect(session.get(TAB).transcript).toContain(huge);
    });

    test('starts a fresh transcript when a handler clears it', async () => {
        await session.append(TAB, 'EVENT', 'first');
        session.set(TAB, { ...session.get(TAB), transcript: '' });
        await session.append(TAB, 'EVENT', 'second');

        const { transcript } = session.get(TAB);
        expect(transcript).toContain('second');
        expect(transcript).not.toContain('first');
        expect(transcript).not.toContain('dropped');
    });

    test('reports dropped counts per tab independently', async () => {
        session.set('tab-2', { state: 'open', transcript: '' });
        for (let i = 0; i < 505; i += 1) {
            await session.append(TAB, 'EVENT', `a${i}`);
        }
        await session.append('tab-2', 'EVENT', 'b');

        expect(session.get(TAB).transcript).toContain('[5 earlier entries dropped]');
        expect(session.get('tab-2').transcript).not.toContain('dropped');
    });
});

describe('StreamSession persistence', () => {
    let session;
    let updateTab;

    beforeEach(() => {
        jest.useFakeTimers();
        jest.clearAllMocks();

        updateTab = jest.fn().mockResolvedValue({});
        app.workspaceTabController = {
            isRestoringState: false,
            service: { updateTab, getActiveTabId: jest.fn().mockResolvedValue(TAB) }
        };
        session = new StreamSession({
            buildResponseMeta: (entry, transcript, state) => ({ data: transcript, state })
        });
        session.set(TAB, { state: 'open', transcript: '' });
    });

    afterEach(() => {
        jest.useRealTimers();
        delete app.workspaceTabController;
    });

    test('coalesces a burst of events into a single write', async () => {
        for (let i = 0; i < 25; i += 1) {
            await session.append(TAB, 'EVENT', `data: ${i}`);
        }
        expect(updateTab).not.toHaveBeenCalled();

        jest.runOnlyPendingTimers();
        await Promise.resolve();

        expect(updateTab).toHaveBeenCalledTimes(1);
        expect(updateTab.mock.calls[0][1].response.data).toContain('data: 24');
    });

    test('persists the state as of the flush, not the queued append', async () => {
        await session.append(TAB, 'EVENT', 'data: 1');
        session.set(TAB, { ...session.get(TAB), state: 'closed' });

        jest.runOnlyPendingTimers();
        await Promise.resolve();

        expect(updateTab.mock.calls[0][1].response.state).toBe('closed');
    });

    test('drops a queued write when the tab is removed', async () => {
        await session.append(TAB, 'EVENT', 'data: 1');
        session.remove(TAB);

        jest.runOnlyPendingTimers();
        await Promise.resolve();

        expect(updateTab).not.toHaveBeenCalled();
    });

    test('does not persist when no response builder was provided', async () => {
        const transient = new StreamSession();
        transient.set(TAB, { state: 'open', transcript: '' });

        await transient.append(TAB, 'EVENT', 'data: 1');
        jest.runOnlyPendingTimers();
        await Promise.resolve();

        expect(updateTab).not.toHaveBeenCalled();
        expect(transient.get(TAB).transcript).toContain('data: 1');
    });
});
