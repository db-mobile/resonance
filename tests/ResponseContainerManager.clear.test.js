/* global document, DOMParser */
import { readFileSync } from 'node:fs';

jest.mock('../src/modules/editorLoader.js', () => ({ createLazyEditorProxy: () => ({
    setContent: jest.fn(), getContent: () => '', onLanguageChange: jest.fn(), destroy: jest.fn()
}) }));
jest.mock('../src/modules/websocketHandler.js', () => ({ clearWebSocketTranscript: jest.fn() }));
jest.mock('../src/modules/sseHandler.js', () => ({ clearSseTranscript: jest.fn() }));
jest.mock('../src/modules/ui/Toast.js', () => ({ toast: { error: jest.fn() } }));

import { ResponseContainerManager } from '../src/modules/ResponseContainerManager.js';
import { templateLoader } from '../src/modules/templateLoader.js';
import { clearWebSocketTranscript } from '../src/modules/websocketHandler.js';
import { clearSseTranscript } from '../src/modules/sseHandler.js';
import { toast } from '../src/modules/ui/Toast.js';

describe('response Clear control', () => {
    let manager;
    beforeEach(() => {
        jest.clearAllMocks();
        document.body.innerHTML = '<div id="workspace-response-container"></div>';
        templateLoader.cache.set('./src/templates/response/responseContainer.html',
            new DOMParser().parseFromString(readFileSync('src/templates/response/responseContainer.html', 'utf8'), 'text/html'));
        manager = new ResponseContainerManager({ getPreviewMode: () => false, setPreviewMode: jest.fn(), removePreviewMode: jest.fn() });
        clearWebSocketTranscript.mockResolvedValue(undefined);
        clearSseTranscript.mockResolvedValue(undefined);
    });
    afterEach(() => {
        for (const tabId of manager.containers.keys()) { manager.removeContainer(tabId); }
        document.body.innerHTML = '';
    });

    test('Clear is accessible and targets its own response tab after another tab becomes active', async () => {
        const first = manager.getOrCreateContainer('tab-1');
        manager.showContainer('tab-2');
        const button = first.wrapper.querySelector('.clear-response-btn');
        expect(button).not.toBeNull();
        expect(button.getAttribute('aria-label')).toBe('Clear response');
        expect(button.dataset.tabId).toBe('tab-1');
        expect(button.textContent.trim()).toBe('');
        expect(button.querySelector('.icon')).not.toBeNull();
        button.dataset.protocol = 'websocket';
        button.click();
        await Promise.resolve();
        expect(clearWebSocketTranscript).toHaveBeenCalledWith('tab-1');
    });

    test('an SSE Clear targets its own stream when another response tab is active', async () => {
        const { clearBtn } = manager.getOrCreateContainer('sse-tab');
        clearBtn.dataset.protocol = 'sse';
        manager.showContainer('other-tab');
        clearBtn.click();
        await Promise.resolve();
        expect(clearSseTranscript).toHaveBeenCalledWith('sse-tab');
        expect(clearWebSocketTranscript).not.toHaveBeenCalled();
    });

    test('a failed clear reports an error without an unhandled rejection', async () => {
        clearWebSocketTranscript.mockRejectedValueOnce(new Error('Storage unavailable'));
        const { wrapper } = manager.getOrCreateContainer('tab-1');
        const button = wrapper.querySelector('.clear-response-btn');
        expect(button).not.toBeNull();
        button.dataset.protocol = 'websocket';
        button.click();
        await Promise.resolve();
        expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('Storage unavailable'));
    });
});
