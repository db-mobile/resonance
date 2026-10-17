/* global document */
import { CollectionRenderer } from '../../src/modules/ui/CollectionRenderer.js';

describe('CollectionRenderer expansion store', () => {
    beforeEach(() => {
        document.body.innerHTML = '<div id="collections-list"></div>';
    });

    afterEach(() => {
        document.body.innerHTML = '';
    });

    test('saves the current expansion state through the store', async () => {
        const store = { load: jest.fn(), save: jest.fn().mockResolvedValue(undefined) };
        const renderer = new CollectionRenderer('collections-list', store);
        jest.spyOn(renderer, 'getExpansionState').mockReturnValue({ c1: true });

        await renderer.saveExpansionState();

        expect(store.save).toHaveBeenCalledWith({ c1: true });
    });

    test('loads and restores the saved state through the store', async () => {
        const store = { load: jest.fn().mockResolvedValue({ c1: false }), save: jest.fn() };
        const renderer = new CollectionRenderer('collections-list', store);
        const restore = jest.spyOn(renderer, 'restoreExpansionState').mockImplementation(() => {});

        await renderer.loadAndRestoreExpansionState();

        expect(restore).toHaveBeenCalledWith({ c1: false });
    });

    test('does nothing without a store', async () => {
        const renderer = new CollectionRenderer('collections-list');
        const restore = jest.spyOn(renderer, 'restoreExpansionState');

        await renderer.saveExpansionState();
        await renderer.loadAndRestoreExpansionState();

        expect(restore).not.toHaveBeenCalled();
    });
});
