import { MockServerDialog } from '../../src/modules/ui/MockServerDialog.js';

function makeDialog(controller) {
    const dialog = Object.create(MockServerDialog.prototype);
    dialog.controller = controller;
    return dialog;
}

const collection = { id: 'c1' };
const endpoint = { id: 'e1' };

describe('MockServerDialog._saveResponseOverrides', () => {
    test('reports the failing step instead of an earlier success message', async () => {
        const dialog = makeDialog({
            handleSetDelay: jest.fn(async () => ({ success: true, message: 'Delay updated successfully' })),
            handleSetCustomStatusCode: jest.fn(async () => ({ success: false, message: 'Status code must be 100-599' })),
            handleSetCustomResponse: jest.fn(async () => ({ success: true, message: 'Custom response updated successfully' }))
        });

        const result = await dialog._saveResponseOverrides(collection, endpoint, { delay: 0, statusCode: 999, response: null });

        expect(result).toEqual({ success: false, message: 'Status code must be 100-599' });
    });

    test('succeeds with no message when every step succeeds', async () => {
        const dialog = makeDialog({
            handleSetDelay: jest.fn(async () => ({ success: true, message: 'Delay updated successfully' })),
            handleSetCustomStatusCode: jest.fn(async () => ({ success: true })),
            handleSetCustomResponse: jest.fn(async () => ({ success: true }))
        });

        const result = await dialog._saveResponseOverrides(collection, endpoint, { delay: 10, statusCode: null, response: null });

        expect(result).toEqual({ success: true, message: undefined });
    });
});
