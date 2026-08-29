import { registerPendingSave, flushPendingSaves, cancelPendingSaves } from '../../src/modules/state/pendingSaves.js';

describe('pendingSaves registry', () => {
    let unregisters;

    beforeEach(() => {
        unregisters = [];
    });

    afterEach(() => {
        unregisters.forEach((unregister) => unregister());
    });

    const register = (handle) => {
        unregisters.push(registerPendingSave(handle));
        return handle;
    };

    test('flushPendingSaves awaits every registered flush', async () => {
        let firstSettled = false;
        let secondSettled = false;
        register({
            flush: async () => {
                await Promise.resolve();
                firstSettled = true;
            },
            cancel: jest.fn()
        });
        register({
            flush: async () => {
                secondSettled = true;
            },
            cancel: jest.fn()
        });

        await flushPendingSaves();

        expect(firstSettled).toBe(true);
        expect(secondSettled).toBe(true);
    });

    test('cancelPendingSaves cancels every registered handle without flushing', () => {
        const first = register({ flush: jest.fn(), cancel: jest.fn() });
        const second = register({ flush: jest.fn(), cancel: jest.fn() });

        cancelPendingSaves();

        expect(first.cancel).toHaveBeenCalledTimes(1);
        expect(second.cancel).toHaveBeenCalledTimes(1);
        expect(first.flush).not.toHaveBeenCalled();
        expect(second.flush).not.toHaveBeenCalled();
    });

    test('an unregistered handle is no longer flushed', async () => {
        const handle = { flush: jest.fn().mockResolvedValue(undefined), cancel: jest.fn() };
        const unregister = registerPendingSave(handle);
        unregister();

        await flushPendingSaves();

        expect(handle.flush).not.toHaveBeenCalled();
    });
});
