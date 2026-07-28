/* global document */
import { SettingsModal } from '../../src/modules/ui/SettingsModal.js';
import { MockServerDialog } from '../../src/modules/ui/MockServerDialog.js';

/**
 * Both dialogs used to unregister Escape only inside the `if (e.key === 'Escape')`
 * branch, so closing by button, backdrop or Cancel left a listener holding a
 * detached overlay. Their single teardown must release the registration whichever
 * route closed the dialog.
 */
describe('dialog Escape teardown runs on every close path', () => {
    afterEach(() => {
        document.body.innerHTML = '';
    });

    test('SettingsModal.hide releases the Escape registration', () => {
        const modal = new SettingsModal({});
        const overlay = document.createElement('div');
        document.body.appendChild(overlay);

        const release = jest.fn();
        modal.isOpen = true;
        modal._releaseEscape = release;

        modal.hide(overlay);

        expect(release).toHaveBeenCalledTimes(1);
        expect(modal._releaseEscape).toBeNull();
        expect(overlay.parentNode).toBeNull();
    });

    test('SettingsModal.hide is safe to call twice', () => {
        const modal = new SettingsModal({});
        const overlay = document.createElement('div');
        document.body.appendChild(overlay);

        const release = jest.fn();
        modal.isOpen = true;
        modal._releaseEscape = release;

        modal.hide(overlay);
        modal.hide(overlay);

        expect(release).toHaveBeenCalledTimes(1);
    });

    test('MockServerDialog.close releases the Escape registration', () => {
        const dialog = new MockServerDialog({});
        const overlay = document.createElement('div');
        document.body.appendChild(overlay);

        const release = jest.fn();
        dialog.dialog = overlay;
        dialog.releaseEscape = release;
        dialog.resolve = jest.fn();

        dialog.close();

        expect(release).toHaveBeenCalledTimes(1);
        expect(dialog.releaseEscape).toBeNull();
        expect(overlay.parentNode).toBeNull();
    });
});
