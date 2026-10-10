/* global document */
import { SettingsModal } from '../../src/modules/ui/SettingsModal.js';
import { MockServerDialog } from '../../src/modules/ui/MockServerDialog.js';

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
        modal.overlay = overlay;
        modal._releaseEscape = release;

        modal.hide();

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
        modal.overlay = overlay;
        modal._releaseEscape = release;

        modal.hide();
        modal.hide();

        expect(release).toHaveBeenCalledTimes(1);
    });

    test('MockServerDialog.close releases the Escape registration', () => {
        const dialog = new MockServerDialog({});
        const overlay = document.createElement('div');
        document.body.appendChild(overlay);

        const release = jest.fn();
        dialog.overlay = overlay;
        dialog._releaseEscape = release;
        dialog.resolve = jest.fn();

        dialog.close();

        expect(release).toHaveBeenCalledTimes(1);
        expect(dialog._releaseEscape).toBeNull();
        expect(overlay.parentNode).toBeNull();
    });
});
