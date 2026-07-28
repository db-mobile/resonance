/* global document, KeyboardEvent */
import { pushEscapeHandler, escapeHandlerCount } from '../../src/modules/ui/modalEscape.js';

const pressEscape = () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
const pressKey = (key) => document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));

/**
 * A dialog that removed its Escape listener only inside the `if (e.key === 'Escape')`
 * branch leaked it on every other close path, and a dialog opened on top of another
 * let one keypress dismiss both. Both failures are properties of this stack.
 */
describe('modalEscape', () => {
    afterEach(() => {
        expect(escapeHandlerCount()).toBe(0);
    });

    test('dispatches Escape to the only registered handler', () => {
        const onEscape = jest.fn();
        const release = pushEscapeHandler(onEscape);

        pressEscape();

        expect(onEscape).toHaveBeenCalledTimes(1);
        release();
    });

    test('ignores keys other than Escape', () => {
        const onEscape = jest.fn();
        const release = pushEscapeHandler(onEscape);

        pressKey('Enter');
        pressKey('a');

        expect(onEscape).not.toHaveBeenCalled();
        release();
    });

    test('only the topmost handler runs, so one press closes one dialog', () => {
        const parent = jest.fn();
        const child = jest.fn();
        const releaseParent = pushEscapeHandler(parent);
        const releaseChild = pushEscapeHandler(child);

        pressEscape();

        expect(child).toHaveBeenCalledTimes(1);
        expect(parent).not.toHaveBeenCalled();

        releaseChild();
        releaseParent();
    });

    test('releasing the top hands Escape back to the one beneath', () => {
        const parent = jest.fn();
        const child = jest.fn();
        const releaseParent = pushEscapeHandler(parent);
        const releaseChild = pushEscapeHandler(child);

        releaseChild();
        pressEscape();

        expect(parent).toHaveBeenCalledTimes(1);
        expect(child).not.toHaveBeenCalled();

        releaseParent();
    });

    test('a released handler never runs again, however the dialog was closed', () => {
        const onEscape = jest.fn();
        const release = pushEscapeHandler(onEscape);

        release();
        pressEscape();

        expect(onEscape).not.toHaveBeenCalled();
    });

    test('release is idempotent and does not disturb other dialogs', () => {
        const parent = jest.fn();
        const child = jest.fn();
        const releaseParent = pushEscapeHandler(parent);
        const releaseChild = pushEscapeHandler(child);

        releaseChild();
        releaseChild();
        releaseChild();

        expect(escapeHandlerCount()).toBe(1);

        pressEscape();
        expect(parent).toHaveBeenCalledTimes(1);

        releaseParent();
        expect(escapeHandlerCount()).toBe(0);
    });

    test('the document listener is detached once the last dialog releases', () => {
        const addSpy = jest.spyOn(document, 'addEventListener');
        const removeSpy = jest.spyOn(document, 'removeEventListener');

        const releaseA = pushEscapeHandler(() => {});
        const releaseB = pushEscapeHandler(() => {});

        expect(addSpy).toHaveBeenCalledTimes(1);

        releaseA();
        expect(removeSpy).not.toHaveBeenCalled();

        releaseB();
        expect(removeSpy).toHaveBeenCalledTimes(1);

        addSpy.mockRestore();
        removeSpy.mockRestore();
    });

    test('stops the event so dialogs beneath and app shortcuts stay quiet', () => {
        const appShortcut = jest.fn();
        document.addEventListener('keydown', appShortcut);
        const release = pushEscapeHandler(() => {});

        pressEscape();

        expect(appShortcut).not.toHaveBeenCalled();

        release();
        document.removeEventListener('keydown', appShortcut);
    });

    test('app shortcuts still see Escape when no dialog is open', () => {
        const appShortcut = jest.fn();
        document.addEventListener('keydown', appShortcut);

        pressEscape();

        expect(appShortcut).toHaveBeenCalledTimes(1);
        document.removeEventListener('keydown', appShortcut);
    });
});
