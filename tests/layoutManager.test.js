/* global window */
import { LayoutManager } from '../src/modules/layoutManager.js';

describe('LayoutManager', () => {
    let store;

    beforeEach(() => {
        store = {};
        window.backendAPI = {
            store: {
                get: jest.fn(async (key) => store[key] ?? null),
                set: jest.fn(async (key, value) => { store[key] = value; })
            }
        };
    });

    test('defaults to stacked and ignores unknown stored values', async () => {
        store.layout = 'diagonal';
        const manager = new LayoutManager();
        await manager.ready;
        expect(manager.getLayout()).toBe('stacked');
    });

    test('loads the saved layout and notifies listeners on toggle', async () => {
        store.layout = 'side-by-side';
        const manager = new LayoutManager();
        await manager.ready;
        expect(manager.getLayout()).toBe('side-by-side');

        const listener = jest.fn();
        manager.addChangeListener(listener);
        await manager.toggle();

        expect(listener).toHaveBeenCalledWith('stacked');
        expect(store.layout).toBe('stacked');
    });

    test('setting the current layout again is a no-op', async () => {
        const manager = new LayoutManager();
        await manager.ready;
        const listener = jest.fn();
        manager.addChangeListener(listener);

        await manager.setLayout('stacked');

        expect(listener).not.toHaveBeenCalled();
        expect(window.backendAPI.store.set).not.toHaveBeenCalled();
    });
});
