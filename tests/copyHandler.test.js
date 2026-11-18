/* global document */
import { attachCopyHandler, attachHeadersCopyHandler } from '../src/modules/copyHandler.js';
import { app } from '../src/modules/appContext.js';

const TAB = 'tab-1';

function copyButton(title) {
    const button = document.createElement('button');
    button.className = 'copy-btn';
    button.title = title;
    button.innerHTML = '<span class="icon icon-16 icon-copy"></span>';
    document.body.appendChild(button);
    return button;
}

async function click(button) {
    button.click();
    await Promise.resolve();
    await Promise.resolve();
}

describe('copyHandler feedback', () => {
    let body;
    let headers;

    beforeEach(() => {
        jest.useFakeTimers();
        document.body.innerHTML = '';
        body = '{"a":1}';
        headers = 'content-type: application/json';
        app.responseContainerManager = {
            getOrCreateContainer: () => ({
                editor: { getContent: () => body },
                headersEditor: { getContent: () => headers }
            })
        };
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: { writeText: jest.fn().mockResolvedValue() }
        });
    });

    afterEach(() => {
        jest.useRealTimers();
        app.responseContainerManager = null;
    });

    it('shows the check mark and restores the copy icon after the delay', async () => {
        const button = copyButton('Copy Response Body');
        attachCopyHandler(button, TAB);

        await click(button);

        expect(navigator.clipboard.writeText).toHaveBeenCalledWith('{"a":1}');
        expect(button.title).toBe('Copied!');
        expect(button.classList.contains('copied')).toBe(true);
        expect(button.querySelector('.icon').classList.contains('icon-check')).toBe(true);

        jest.advanceTimersByTime(2000);

        expect(button.title).toBe('Copy Response Body');
        expect(button.classList.contains('copied')).toBe(false);
        expect(button.querySelector('.icon').className).toBe('icon icon-16 icon-copy');
    });

    it('a second click during the feedback does not leave the check mark stuck', async () => {
        const button = copyButton('Copy Response Body');
        attachCopyHandler(button, TAB);

        await click(button);
        jest.advanceTimersByTime(500);
        await click(button);

        jest.advanceTimersByTime(1500);
        expect(button.title).toBe('Copied!');
        expect(button.querySelector('.icon').classList.contains('icon-check')).toBe(true);

        jest.advanceTimersByTime(500);
        expect(button.title).toBe('Copy Response Body');
        expect(button.classList.contains('copied')).toBe(false);
        expect(button.querySelector('.icon').className).toBe('icon icon-16 icon-copy');

        jest.advanceTimersByTime(5000);
        expect(button.title).toBe('Copy Response Body');
        expect(button.querySelector('.icon').className).toBe('icon icon-16 icon-copy');
    });

    it('a failure followed by a success ends on the original state', async () => {
        const button = copyButton('Copy Response Headers');
        attachHeadersCopyHandler(button, TAB);

        headers = 'No response headers.';
        await click(button);
        expect(button.title).toBe('Copy failed');
        expect(button.classList.contains('copy-error')).toBe(true);
        expect(button.querySelector('.icon').classList.contains('icon-copy')).toBe(true);

        headers = 'x-a: 1';
        await click(button);
        expect(button.title).toBe('Copied!');
        expect(button.classList.contains('copy-error')).toBe(false);

        jest.advanceTimersByTime(2000);
        expect(button.title).toBe('Copy Response Headers');
        expect(button.classList.contains('copied')).toBe(false);
        expect(button.querySelector('.icon').className).toBe('icon icon-16 icon-copy');
    });
});
