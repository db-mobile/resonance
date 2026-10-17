/* global document */
jest.mock('../../src/modules/state/pendingSaves.js', () => ({
    registerPendingSave: jest.fn(),
    cancelPendingSaves: jest.fn()
}));

import { CollectionController } from '../../src/modules/controllers/CollectionController.js';
import { RequestFormReader } from '../../src/modules/requestFormReader.js';
import { cancelPendingSaves } from '../../src/modules/state/pendingSaves.js';
import { getCurrentEndpoint, setCurrentEndpoint } from '../../src/modules/state/currentEndpoint.js';
import { requestBarMarkup, requestFormMarkup } from '../helpers/requestBarMarkup.js';

function makeController() {
    const controller = Object.create(CollectionController.prototype);
    controller.formReader = new RequestFormReader();
    controller.repository = { clearLastSelectedRequest: jest.fn().mockResolvedValue(undefined) };
    controller.renderer = { clearActiveEndpoint: jest.fn() };
    return controller;
}

function fillForm() {
    document.getElementById('url-input').value = 'https://api.test/x';
    document.getElementById('method-select').value = 'POST';
    document.getElementById('body-input').value = '{"a":1}';
    for (const id of ['path-params-list', 'query-params-list', 'headers-list']) {
        document.getElementById(id).innerHTML = '<div class="key-value-row"></div>';
    }
}

describe('CollectionController._resetIfCurrentEndpoint', () => {
    beforeEach(() => {
        document.body.innerHTML = `${requestBarMarkup()}${requestFormMarkup()}<textarea id="body-input"></textarea>`;
        cancelPendingSaves.mockClear();
        fillForm();
    });

    afterEach(() => {
        setCurrentEndpoint(null);
        document.body.innerHTML = '';
    });

    test('blanks the form and forgets the selection when the current endpoint is removed', async () => {
        setCurrentEndpoint({ collectionId: 'c1', endpointId: 'e2' });
        const controller = makeController();

        await controller._resetIfCurrentEndpoint('c1', ['e1', 'e2']);

        expect(cancelPendingSaves).toHaveBeenCalledTimes(1);
        expect(document.getElementById('url-input').value).toBe('');
        expect(document.getElementById('method-select').value).toBe('GET');
        expect(document.getElementById('body-input').value).toBe('');
        for (const id of ['path-params-list', 'query-params-list', 'headers-list']) {
            expect(document.getElementById(id).children).toHaveLength(0);
        }
        expect(getCurrentEndpoint()).toBeNull();
        expect(controller.repository.clearLastSelectedRequest).toHaveBeenCalledTimes(1);
        expect(controller.renderer.clearActiveEndpoint).toHaveBeenCalledTimes(1);
    });

    test('leaves everything alone when another endpoint or collection is current', async () => {
        setCurrentEndpoint({ collectionId: 'c1', endpointId: 'e9' });
        const controller = makeController();

        await controller._resetIfCurrentEndpoint('c1', ['e1']);
        await controller._resetIfCurrentEndpoint('c2', ['e9']);

        expect(cancelPendingSaves).not.toHaveBeenCalled();
        expect(document.getElementById('url-input').value).toBe('https://api.test/x');
        expect(getCurrentEndpoint()).toEqual({ collectionId: 'c1', endpointId: 'e9' });
        expect(controller.renderer.clearActiveEndpoint).not.toHaveBeenCalled();
    });

    test('does nothing without a current endpoint', async () => {
        const controller = makeController();

        await controller._resetIfCurrentEndpoint('c1', ['e1']);

        expect(cancelPendingSaves).not.toHaveBeenCalled();
    });
});
