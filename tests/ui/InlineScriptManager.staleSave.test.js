import { InlineScriptManager } from '../../src/modules/ui/InlineScriptManager.js';

jest.mock('../../src/modules/editorLoader.js', () => ({
    createLazyEditorProxy: jest.fn()
}));

describe('InlineScriptManager stale-context saves', () => {
    let manager;
    let scriptsApi;

    const makeEditor = (content) => ({
        content,
        getContent() {
            return this.content;
        },
        setContent: jest.fn(),
        clear: jest.fn(),
        onChange: jest.fn()
    });

    beforeEach(() => {
        jest.useFakeTimers();
        scriptsApi = {
            get: jest.fn().mockResolvedValue({ preRequestScript: 'pre-B', testScript: 'test-B' }),
            save: jest.fn().mockResolvedValue(undefined)
        };
        global.window.backendAPI = { scripts: scriptsApi };
        manager = new InlineScriptManager();
        manager.preRequestEditor = makeEditor('pre-A');
        manager.testScriptEditor = makeEditor('test-A');
        manager.initialized = true;
    });

    afterEach(() => {
        jest.useRealTimers();
        delete global.window.backendAPI;
    });

    test('loadScripts flushes a pending save under the old endpoint before switching', async () => {
        manager.currentCollectionId = 'col-A';
        manager.currentEndpointId = 'ep-A';
        manager.scheduleAutoSave();

        await manager.loadScripts('col-B', 'ep-B');

        expect(scriptsApi.save).toHaveBeenCalledTimes(1);
        expect(scriptsApi.save).toHaveBeenCalledWith('col-A', 'ep-A', {
            preRequestScript: 'pre-A',
            testScript: 'test-A'
        });
        expect(manager.preRequestEditor.setContent).toHaveBeenCalledWith('pre-B', { emitChange: false });
        expect(manager.testScriptEditor.setContent).toHaveBeenCalledWith('test-B', { emitChange: false });
    });

    test('a save firing after the context changed still writes under the scheduled endpoint', async () => {
        manager.currentCollectionId = 'col-A';
        manager.currentEndpointId = 'ep-A';
        manager.scheduleAutoSave();

        manager.currentCollectionId = 'col-B';
        manager.currentEndpointId = 'ep-B';
        await jest.advanceTimersByTimeAsync(1000);

        expect(scriptsApi.save).toHaveBeenCalledTimes(1);
        expect(scriptsApi.save).toHaveBeenCalledWith('col-A', 'ep-A', expect.anything());
    });

    test('clear flushes the pending save before dropping the context', async () => {
        manager.currentCollectionId = 'col-A';
        manager.currentEndpointId = 'ep-A';
        manager.scheduleAutoSave();

        await manager.clear();

        expect(scriptsApi.save).toHaveBeenCalledWith('col-A', 'ep-A', {
            preRequestScript: 'pre-A',
            testScript: 'test-A'
        });
        expect(manager.currentCollectionId).toBeNull();
        expect(manager.preRequestEditor.clear).toHaveBeenCalledWith({ emitChange: false });
        expect(manager.testScriptEditor.clear).toHaveBeenCalledWith({ emitChange: false });
    });

    test('scheduleAutoSave without an endpoint context schedules nothing', async () => {
        manager.scheduleAutoSave();

        await jest.advanceTimersByTimeAsync(1000);

        expect(scriptsApi.save).not.toHaveBeenCalled();
    });
});
