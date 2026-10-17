/* global document */

function markup() {
    return `
        <div class="status-info-container"></div>
        <div id="response-body-container"></div>
        <select id="language-selector"><option value="text">text</option><option value="json">json</option></select>
        <div id="response-headers-display"></div>
        <div id="response-cookies-display"></div>
        <div id="response-performance-display"></div>
    `;
}

async function loadResponseView() {
    document.body.innerHTML = markup();
    jest.resetModules();

    const lazyEditor = { setContent: jest.fn(), clear: jest.fn(), onLanguageChange: jest.fn(), setLanguage: jest.fn() };
    const createLazyEditorProxy = jest.fn(() => lazyEditor);
    jest.doMock('../../src/modules/editorLoader.js', () => ({
        loadEditor: jest.fn(),
        warmEditors: jest.fn(),
        createLazyEditorProxy
    }));

    const view = await import('../../src/modules/responseView.js');
    const { app } = await import('../../src/modules/appContext.js');
    app.responseContainerManager = undefined;
    return { ...view, app, lazyEditor, createLazyEditorProxy };
}

function tabContainer(overrides = {}) {
    return {
        tabId: 'tab-1',
        renderedResponse: '<p>old</p>',
        statusContainer: document.createElement('div'),
        editor: { setContent: jest.fn(), clear: jest.fn(), currentLanguage: 'json' },
        previewManager: {
            updateButtonState: jest.fn(),
            isPreviewable: jest.fn(() => true),
            refreshPreviewContent: jest.fn(),
            clearPreview: jest.fn()
        },
        ...overrides
    };
}

function managerFor(container) {
    return {
        getOrCreateContainer: jest.fn(() => container),
        getActiveElements: jest.fn(() => container)
    };
}

describe('responseView', () => {
    describe('displayResponseWithLineNumbersForTab', () => {
        test('writes into the per-tab editor and refreshes a previewable response', async () => {
            const { displayResponseWithLineNumbersForTab, app } = await loadResponseView();
            const container = tabContainer();
            app.responseContainerManager = managerFor(container);

            displayResponseWithLineNumbersForTab('{"a":1}', 'application/json', 'tab-1', 'json');

            expect(container.renderedResponse).toBeNull();
            expect(container.editor.setContent).toHaveBeenCalledWith('{"a":1}', 'application/json', 'json');
            expect(container.previewManager.updateButtonState).toHaveBeenCalledWith('tab-1', 'json');
            expect(container.previewManager.refreshPreviewContent).toHaveBeenCalledWith('tab-1', '{"a":1}', 'json');
            expect(container.previewManager.clearPreview).not.toHaveBeenCalled();
        });

        test('clears the preview when the language is not previewable', async () => {
            const { displayResponseWithLineNumbersForTab, app } = await loadResponseView();
            const container = tabContainer();
            container.previewManager.isPreviewable.mockReturnValue(false);
            app.responseContainerManager = managerFor(container);

            displayResponseWithLineNumbersForTab('plain', 'text/plain', 'tab-1');

            expect(container.previewManager.clearPreview).toHaveBeenCalledWith('tab-1');
            expect(container.previewManager.refreshPreviewContent).not.toHaveBeenCalled();
        });

        test('falls back to a single lazy global editor that syncs the language selector', async () => {
            const { displayResponseWithLineNumbersForTab, lazyEditor, createLazyEditorProxy } = await loadResponseView();

            displayResponseWithLineNumbersForTab('first', null, null);
            displayResponseWithLineNumbersForTab('second', null, null);

            expect(createLazyEditorProxy).toHaveBeenCalledTimes(1);
            expect(createLazyEditorProxy).toHaveBeenCalledWith('response', document.getElementById('response-body-container'));
            expect(lazyEditor.setContent).toHaveBeenNthCalledWith(1, 'first', null, undefined);
            expect(lazyEditor.setContent).toHaveBeenNthCalledWith(2, 'second', null, undefined);

            const onLanguageChange = lazyEditor.onLanguageChange.mock.calls[0][0];
            onLanguageChange('json');
            expect(document.getElementById('language-selector').value).toBe('json');
            onLanguageChange(null);
            expect(document.getElementById('language-selector').value).toBe('text');

            const selector = document.getElementById('language-selector');
            selector.value = 'json';
            selector.dispatchEvent(new Event('change'));
            expect(lazyEditor.setLanguage).toHaveBeenCalledWith('json');
        });
    });

    describe('clearResponseDisplayForTab', () => {
        test('clears the per-tab editor and drops the rendered preview', async () => {
            const { clearResponseDisplayForTab, app } = await loadResponseView();
            const container = tabContainer();
            app.responseContainerManager = managerFor(container);

            clearResponseDisplayForTab('tab-1');

            expect(container.renderedResponse).toBeNull();
            expect(container.editor.clear).toHaveBeenCalled();
        });

        test('clears the global editor when no tab container exists', async () => {
            const { clearResponseDisplayForTab, lazyEditor } = await loadResponseView();

            clearResponseDisplayForTab(null);

            expect(lazyEditor.clear).toHaveBeenCalled();
        });
    });

    describe('schema validation badge', () => {
        test('renders a success badge in the tab status container', async () => {
            const { displaySchemaValidationResult, app } = await loadResponseView();
            const container = tabContainer();
            app.responseContainerManager = managerFor(container);

            displaySchemaValidationResult({ hasSchema: true, valid: true, errors: [] }, 'tab-1');

            const badge = container.statusContainer.querySelector('.response-validation-badge');
            expect(badge.classList.contains('is-success')).toBe(true);
            expect(badge.textContent).toBe('Schema Valid');
            expect(badge.title).toBe('');
        });

        test('renders an error badge with joined messages and replaces an older badge', async () => {
            const { displaySchemaValidationResult, app } = await loadResponseView();
            const container = tabContainer();
            app.responseContainerManager = managerFor(container);

            displaySchemaValidationResult({ hasSchema: true, valid: true, errors: [] }, 'tab-1');
            displaySchemaValidationResult({
                hasSchema: true,
                valid: false,
                errors: [{ path: '/a', message: 'required' }, { path: '/b', message: 'type' }]
            }, 'tab-1');

            const badges = container.statusContainer.querySelectorAll('.response-validation-badge');
            expect(badges).toHaveLength(1);
            expect(badges[0].classList.contains('is-error')).toBe(true);
            expect(badges[0].textContent).toBe('Schema Invalid (2)');
            expect(badges[0].title).toBe('/a: required\n/b: type');
        });

        test('renders nothing without a schema and clears a previous badge', async () => {
            const { displaySchemaValidationResult, clearSchemaValidationBadge, app } = await loadResponseView();
            const container = tabContainer();
            app.responseContainerManager = managerFor(container);

            displaySchemaValidationResult({ hasSchema: true, valid: true, errors: [] }, 'tab-1');
            displaySchemaValidationResult({ hasSchema: false }, 'tab-1');
            expect(container.statusContainer.querySelector('.response-validation-badge')).toBeNull();

            displaySchemaValidationResult({ hasSchema: true, valid: true, errors: [] }, 'tab-1');
            clearSchemaValidationBadge('tab-1');
            expect(container.statusContainer.querySelector('.response-validation-badge')).toBeNull();
        });

        test('falls back to the global status container without a tab', async () => {
            const { displaySchemaValidationResult } = await loadResponseView();

            displaySchemaValidationResult({ hasSchema: true, valid: true, errors: [] }, null);

            expect(document.querySelector('.status-info-container .response-validation-badge')).not.toBeNull();
        });
    });

    describe('GraphQL errors badge', () => {
        test('renders the count and joined messages, falling back to JSON for message-less errors', async () => {
            const { renderGraphQLErrorsBadge, clearGraphQLErrorsBadge, app } = await loadResponseView();
            const container = tabContainer();
            app.responseContainerManager = managerFor(container);

            renderGraphQLErrorsBadge([{ message: 'boom' }, { code: 7 }], 'tab-1');

            const badge = container.statusContainer.querySelector('.graphql-errors-badge');
            expect(badge.textContent).toBe('GraphQL Errors (2)');
            expect(badge.title).toBe('boom\n{"code":7}');

            clearGraphQLErrorsBadge('tab-1');
            expect(container.statusContainer.querySelector('.graphql-errors-badge')).toBeNull();
        });
    });
});
