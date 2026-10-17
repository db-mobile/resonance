/* global document */
jest.mock('../../src/modules/state/pendingSaves.js', () => ({
    registerPendingSave: jest.fn(),
    cancelPendingSaves: jest.fn()
}));

import { CollectionController } from '../../src/modules/controllers/CollectionController.js';
import { registerPendingSave } from '../../src/modules/state/pendingSaves.js';
import { setCurrentEndpoint } from '../../src/modules/state/currentEndpoint.js';

function makeController() {
    const controller = Object.create(CollectionController.prototype);
    controller._debouncedSaveBody = null;
    controller._inFlightBodySave = null;
    controller.saveRequestBodyModification = jest.fn().mockResolvedValue(undefined);
    return controller;
}

const input = () => document.getElementById('body-input');

describe('CollectionController body tracking', () => {
    beforeEach(() => {
        jest.useFakeTimers();
        registerPendingSave.mockClear();
        document.body.innerHTML = '<textarea id="body-input"></textarea>';
        setCurrentEndpoint({ collectionId: 'c1', endpointId: 'e1' });
    });

    afterEach(() => {
        jest.useRealTimers();
        setCurrentEndpoint(null);
        document.body.innerHTML = '';
    });

    test('typing schedules one save two seconds after the last keystroke', () => {
        const controller = makeController();
        controller.initializeBodyTracking(input());

        input().dispatchEvent(new Event('input'));
        jest.advanceTimersByTime(1500);
        input().dispatchEvent(new Event('input'));
        jest.advanceTimersByTime(1999);
        expect(controller.saveRequestBodyModification).not.toHaveBeenCalled();

        jest.advanceTimersByTime(1);
        expect(controller.saveRequestBodyModification).toHaveBeenCalledTimes(1);
        expect(controller.saveRequestBodyModification).toHaveBeenCalledWith('c1', 'e1');
    });

    test('leaving the field saves immediately and drops the pending debounce', async () => {
        const controller = makeController();
        controller.initializeBodyTracking(input());

        input().dispatchEvent(new Event('input'));
        input().dispatchEvent(new Event('blur'));
        await Promise.resolve();
        jest.advanceTimersByTime(5000);

        expect(controller.saveRequestBodyModification).toHaveBeenCalledTimes(1);
    });

    test('does nothing without a current endpoint', () => {
        const controller = makeController();
        controller.initializeBodyTracking(input());
        setCurrentEndpoint(null);

        input().dispatchEvent(new Event('input'));
        input().dispatchEvent(new Event('blur'));
        jest.advanceTimersByTime(5000);

        expect(controller.saveRequestBodyModification).not.toHaveBeenCalled();
    });

    test('registers a flushable, cancellable pending save', async () => {
        const controller = makeController();
        let resolveSave;
        controller.saveRequestBodyModification.mockImplementation(() => new Promise((resolve) => { resolveSave = resolve; }));
        controller.initializeBodyTracking(input());

        expect(registerPendingSave).toHaveBeenCalledTimes(1);
        const handle = registerPendingSave.mock.calls[0][0];
        expect(typeof handle.flush).toBe('function');
        expect(typeof handle.cancel).toBe('function');

        input().dispatchEvent(new Event('input'));
        jest.advanceTimersByTime(2000);
        let flushed = false;
        const flushing = controller.flushPendingBodySave().then(() => { flushed = true; });
        await Promise.resolve();
        expect(flushed).toBe(false);
        resolveSave();
        await flushing;
        expect(flushed).toBe(true);

        input().dispatchEvent(new Event('input'));
        handle.cancel();
        jest.advanceTimersByTime(5000);
        expect(controller.saveRequestBodyModification).toHaveBeenCalledTimes(1);
    });

    test('installs nothing when the body field is absent', () => {
        document.body.innerHTML = '';
        const controller = makeController();

        controller.initializeBodyTracking(null);

        expect(registerPendingSave).not.toHaveBeenCalled();
        expect(controller._debouncedSaveBody).toBeNull();
    });
});
