/* global document, KeyboardEvent, DOMParser */
import fs from 'fs';
import path from 'path';
import { pushEscapeHandler, escapeHandlerCount } from '../../src/modules/ui/modalEscape.js';
import { EnvironmentSelector } from '../../src/modules/ui/EnvironmentSelector.js';
import { templateLoader } from '../../src/modules/templateLoader.js';

const SELECTOR_TEMPLATE = './src/templates/environment/environmentSelector.html';

const pressEscape = () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

/**
 * Every dialog that used to own a document-level Escape listener now registers on
 * the shared stack. Two properties matter for each: closing by any route releases
 * the registration, and a dialog opened over another absorbs Escape alone.
 */
describe('migrated dialogs share one Escape stack', () => {
    afterEach(() => {
        document.body.innerHTML = '';
        expect(escapeHandlerCount()).toBe(0);
    });

    describe('EnvironmentSelector dropdown', () => {
        let selector;

        beforeEach(() => {
            document.body.innerHTML = '<div id="env-container"></div>';
            selector = new EnvironmentSelector(
                {
                    getAllEnvironments: jest.fn().mockResolvedValue([]),
                    getActiveEnvironmentId: jest.fn().mockResolvedValue(null)
                },
                jest.fn(),
                jest.fn()
            );
            selector.dropdown = document.createElement('div');
            document.body.appendChild(selector.dropdown);
        });

        test('closing the dropdown releases its registration', () => {
            selector.releaseEscape = pushEscapeHandler(() => selector.closeDropdown());
            selector.isOpen = true;
            expect(escapeHandlerCount()).toBe(1);

            selector.closeDropdown();

            expect(selector.isOpen).toBe(false);
            expect(escapeHandlerCount()).toBe(0);
        });

        test('Escape closes the dropdown and leaves nothing registered', () => {
            selector.releaseEscape = pushEscapeHandler(() => selector.closeDropdown());
            selector.isOpen = true;

            pressEscape();

            expect(selector.isOpen).toBe(false);
            expect(escapeHandlerCount()).toBe(0);
        });

        test('closing twice is harmless', () => {
            selector.releaseEscape = pushEscapeHandler(() => selector.closeDropdown());
            selector.isOpen = true;

            selector.closeDropdown();
            selector.closeDropdown();

            expect(escapeHandlerCount()).toBe(0);
        });

        test('the real open/close cycle registers and releases exactly once', async () => {
            templateLoader.cache.set(
                SELECTOR_TEMPLATE,
                new DOMParser().parseFromString(
                    fs.readFileSync(
                        path.join(process.cwd(), 'src/templates/environment/environmentSelector.html'),
                        'utf8'
                    ),
                    'text/html'
                )
            );
            document.body.innerHTML += '<button id="env-selector-btn"></button>';

            await selector.openDropdown();
            expect(selector.isOpen).toBe(true);
            expect(escapeHandlerCount()).toBe(1);

            pressEscape();

            expect(selector.isOpen).toBe(false);
            expect(escapeHandlerCount()).toBe(0);
        });
    });

    describe('a dropdown opened over a dialog', () => {
        test('Escape closes the dropdown first, then the dialog', () => {
            const closeDialog = jest.fn();
            const closeDropdown = jest.fn();

            const releaseDialog = pushEscapeHandler(closeDialog);
            const releaseDropdown = pushEscapeHandler(closeDropdown);

            pressEscape();
            expect(closeDropdown).toHaveBeenCalledTimes(1);
            expect(closeDialog).not.toHaveBeenCalled();

            releaseDropdown();

            pressEscape();
            expect(closeDialog).toHaveBeenCalledTimes(1);
            expect(closeDropdown).toHaveBeenCalledTimes(1);

            releaseDialog();
        });
    });

    describe('an AbortController-driven dialog', () => {
        test('aborting the controller releases the stack registration', () => {
            const controller = new AbortController();
            const finish = jest.fn();

            const release = pushEscapeHandler(finish);
            controller.signal.addEventListener('abort', release, { once: true });
            expect(escapeHandlerCount()).toBe(1);

            controller.abort();

            expect(escapeHandlerCount()).toBe(0);
            pressEscape();
            expect(finish).not.toHaveBeenCalled();
        });

        test('Escape reaches the dialog before it is aborted', () => {
            const controller = new AbortController();
            const finish = jest.fn();

            const release = pushEscapeHandler(finish);
            controller.signal.addEventListener('abort', release, { once: true });

            pressEscape();

            expect(finish).toHaveBeenCalledTimes(1);
            controller.abort();
        });
    });
});
