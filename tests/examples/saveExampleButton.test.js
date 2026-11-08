/* global document, DOMParser */
import { readFileSync } from 'node:fs';

jest.mock('../../src/modules/editorLoader.js', () => ({ createLazyEditorProxy: () => ({
    setContent: jest.fn(), getContent: () => '', onLanguageChange: jest.fn(), destroy: jest.fn()
}) }));
jest.mock('../../src/modules/websocketHandler.js', () => ({ clearWebSocketTranscript: jest.fn() }));
jest.mock('../../src/modules/sseHandler.js', () => ({ clearSseTranscript: jest.fn() }));
jest.mock('../../src/modules/ui/Toast.js', () => ({ toast: { error: jest.fn(), success: jest.fn() } }));
jest.mock('../../src/modules/examples/exampleCapture.js', () => ({ attachSaveExampleHandler: jest.fn() }));

import { ResponseContainerManager } from '../../src/modules/ResponseContainerManager.js';
import { templateLoader } from '../../src/modules/templateLoader.js';
import { attachSaveExampleHandler } from '../../src/modules/examples/exampleCapture.js';

describe('Save as example toolbar button', () => {
    let manager;

    beforeEach(() => {
        jest.clearAllMocks();
        document.body.innerHTML = '<div id="workspace-response-container"></div>';
        templateLoader.cache.set('./src/templates/response/responseContainer.html',
            new DOMParser().parseFromString(readFileSync('src/templates/response/responseContainer.html', 'utf8'), 'text/html'));
        manager = new ResponseContainerManager({ getPreviewMode: () => false, setPreviewMode: jest.fn(), removePreviewMode: jest.fn() });
    });

    afterEach(() => {
        for (const tabId of manager.containers.keys()) { manager.removeContainer(tabId); }
        document.body.innerHTML = '';
    });

    test('exists per response tab, is labelled, tab-scoped and wired to the capture handler', () => {
        const container = manager.getOrCreateContainer('tab-1');
        const button = container.wrapper.querySelector('.save-example-btn');

        expect(button).not.toBeNull();
        expect(container.saveExampleBtn).toBe(button);
        expect(button.getAttribute('aria-label')).toBe('Save as example');
        expect(button.title).toBe('Save as example');
        expect(button.dataset.tabId).toBe('tab-1');
        expect(button.querySelector('.icon-bookmark')).not.toBeNull();
        expect(button.previousElementSibling.classList.contains('save-response-btn')).toBe(true);
        expect(attachSaveExampleHandler).toHaveBeenCalledWith(button, 'tab-1');
    });
});
