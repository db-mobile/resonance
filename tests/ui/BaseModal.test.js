/* global document, KeyboardEvent, DOMParser */
import { BaseModal } from '../../src/modules/ui/BaseModal.js';
import { templateLoader } from '../../src/modules/templateLoader.js';
import { escapeHandlerCount } from '../../src/modules/ui/modalEscape.js';

const TEMPLATE_PATH = './test/baseModal.html';
const TEMPLATE_HTML = `
<template id="tpl-form">
    <div class="dialog-header"><h2 class="dialog-title">Title</h2></div>
    <div class="dialog-body">
        <input id="first" type="text">
        <input id="check" type="checkbox">
        <button id="hidden-btn" class="is-hidden">Hidden</button>
        <textarea id="notes"></textarea>
    </div>
    <div class="dialog-footer"><button id="last">OK</button></div>
</template>
<template id="tpl-autofocus">
    <h2 class="dialog-title" id="custom-title">Pick</h2>
    <button id="a">A</button>
    <button id="b" autofocus>B</button>
</template>`;

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const keydown = (target, key, init = {}) => {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
    target.dispatchEvent(event);
    return event;
};

/**
 * @param {Object} [options]
 * @returns {BaseModal}
 */
function open(options = {}) {
    const modal = new BaseModal();
    modal.mount({
        overlayClass: 'test-overlay',
        dialogClass: 'modal-dialog',
        templatePath: TEMPLATE_PATH,
        templateId: 'tpl-form',
        ...options
    });
    return modal;
}

describe('BaseModal', () => {
    beforeEach(() => {
        templateLoader.cache.set(TEMPLATE_PATH, new DOMParser().parseFromString(TEMPLATE_HTML, 'text/html'));
        document.body.innerHTML = '';
    });

    afterEach(() => {
        document.body.innerHTML = '';
        expect(escapeHandlerCount()).toBe(0);
    });

    test('marks the dialog as a modal labelled by its title', () => {
        const modal = open();

        expect(modal.dialog.getAttribute('role')).toBe('dialog');
        expect(modal.dialog.getAttribute('aria-modal')).toBe('true');
        const title = modal.dialog.querySelector('.dialog-title');
        expect(title.id).toMatch(/^modal-title-\d+$/);
        expect(modal.dialog.getAttribute('aria-labelledby')).toBe(title.id);

        modal.destroy();
    });

    test('keeps an existing title id', () => {
        const modal = open({ templateId: 'tpl-autofocus' });

        expect(modal.dialog.getAttribute('aria-labelledby')).toBe('custom-title');

        modal.destroy();
    });

    test('focuses the dialog after mount, or the [autofocus] element when present', async () => {
        const plain = open();
        await flush();
        expect(document.activeElement).toBe(plain.dialog);
        plain.destroy();

        const withAutofocus = open({ templateId: 'tpl-autofocus' });
        await flush();
        expect(document.activeElement.id).toBe('b');
        withAutofocus.destroy();
    });

    test('does not steal focus a subclass already placed inside the dialog', async () => {
        const modal = open();
        modal.dialog.querySelector('#notes').focus();
        await flush();

        expect(document.activeElement.id).toBe('notes');

        modal.destroy();
    });

    test('restores focus to the opener on destroy', () => {
        const opener = document.createElement('button');
        document.body.appendChild(opener);
        opener.focus();

        const modal = open();
        modal.dialog.querySelector('#first').focus();
        modal.destroy();

        expect(document.activeElement).toBe(opener);
    });

    test('Tab wraps from the last to the first focusable element and Shift+Tab wraps back', () => {
        const modal = open();
        const first = modal.dialog.querySelector('#first');
        const last = modal.dialog.querySelector('#last');

        last.focus();
        expect(keydown(last, 'Tab').defaultPrevented).toBe(true);
        expect(document.activeElement).toBe(first);

        expect(keydown(first, 'Tab', { shiftKey: true }).defaultPrevented).toBe(true);
        expect(document.activeElement).toBe(last);

        modal.destroy();
    });

    test('Tab in the middle of the dialog is left to the browser', () => {
        const modal = open();
        const first = modal.dialog.querySelector('#first');
        first.focus();

        expect(keydown(first, 'Tab').defaultPrevented).toBe(false);

        modal.destroy();
    });

    test('onSubmit fires for Enter in a text input but not in a checkbox or textarea', () => {
        const onSubmit = jest.fn();
        const modal = open({ onSubmit });

        keydown(modal.dialog.querySelector('#check'), 'Enter');
        keydown(modal.dialog.querySelector('#notes'), 'Enter');
        expect(onSubmit).not.toHaveBeenCalled();

        keydown(modal.dialog.querySelector('#first'), 'Enter');
        expect(onSubmit).toHaveBeenCalledTimes(1);

        modal.destroy();
    });

    test('Escape and overlay clicks dismiss, unless disabled', () => {
        const escaped = open();
        keydown(document, 'Escape');
        expect(escaped.overlay).toBeNull();

        const clicked = open();
        clicked.overlay.click();
        expect(clicked.overlay).toBeNull();

        const form = open({ closeOnOverlayClick: false });
        form.overlay.click();
        expect(form.overlay).not.toBeNull();
        form.destroy();
    });

    test('stacked modals close top-first on Escape', () => {
        const bottom = open();
        const top = open();

        keydown(document, 'Escape');
        expect(top.overlay).toBeNull();
        expect(bottom.overlay).not.toBeNull();

        keydown(document, 'Escape');
        expect(bottom.overlay).toBeNull();
    });
});
