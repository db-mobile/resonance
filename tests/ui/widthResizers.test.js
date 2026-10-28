/* global document, window, MouseEvent */
import { initResizer } from '../../src/modules/resizer.js';
import { app } from '../../src/modules/appContext.js';

const configs = [
    { key: 'sidebarWidth', handleId: 'horizontal-resizer-handle', selector: '.collections-sidebar', min: 200, direction: 1 },
    { key: 'graphqlExplorerWidth', handleId: 'graphql-explorer-resizer-handle', selector: '#graphql-docs-rail', min: 240, direction: -1 }
];

describe.each(configs)('$key resizing', ({ key, handleId, selector, min, direction }) => {
    let pane;
    let handle;
    let measure;
    let previousBackend;
    let previousManager;

    beforeEach(() => {
        jest.useFakeTimers();
        previousBackend = window.backendAPI;
        previousManager = app.graphqlBodyManager;
        measure = jest.fn();
        app.graphqlBodyManager = { graphqlEditor: { view: { requestMeasure: measure } } };
        window.backendAPI = { store: { get: jest.fn().mockResolvedValue(null), set: jest.fn().mockResolvedValue() } };
        document.body.innerHTML = '<div class="collections-sidebar"></div><div id="graphql-docs-rail"></div>'
            + '<div id="horizontal-resizer-handle"></div><div id="graphql-explorer-resizer-handle"></div>';
        pane = document.querySelector(selector);
        handle = document.getElementById(handleId);
        Object.defineProperty(pane, 'offsetWidth', { get: () => parseFloat(pane.style.flexBasis) || 300 });
    });

    afterEach(() => {
        document.dispatchEvent(new MouseEvent('mouseup'));
        jest.runOnlyPendingTimers();
        jest.useRealTimers();
        document.body.innerHTML = '';
        window.backendAPI = previousBackend;
        app.graphqlBodyManager = previousManager;
    });

    function start() {
        handle.dispatchEvent(new MouseEvent('mousedown', { clientX: 500, bubbles: true, cancelable: true }));
    }

    function moveTo(width) {
        document.dispatchEvent(new MouseEvent('mousemove', { clientX: 500 + (width - 300) / direction }));
    }

    test('restores the existing saved width and storage key', async () => {
        window.backendAPI.store.get.mockImplementation(async (name) => name === key ? 420 : null);
        initResizer();
        await Promise.resolve();

        expect(pane.style.flexBasis).toBe('420px');
        expect(pane.style.width).toBe(key === 'sidebarWidth' ? '420px' : '');
    });

    test.each([min - 1, 601])('ignores saved width %s outside the bounds', async (width) => {
        window.backendAPI.store.get.mockResolvedValue(width);
        initResizer();
        await Promise.resolve();
        expect(pane.style.flexBasis).toBe('');
    });

    test('resizes in the correct direction and persists only after the debounce', () => {
        initResizer();
        start();
        expect(handle.classList.contains('dragging')).toBe(true);
        expect(document.body.style.cursor).toBe('col-resize');
        expect(document.body.style.userSelect).toBe('none');

        moveTo(350);
        expect(pane.style.flexBasis).toBe('350px');
        expect(pane.style.width).toBe(key === 'sidebarWidth' ? '350px' : '');
        expect(window.backendAPI.store.set).not.toHaveBeenCalled();

        document.dispatchEvent(new MouseEvent('mouseup'));
        expect(handle.classList.contains('dragging')).toBe(false);
        expect(document.body.style.cursor).toBe('');
        expect(document.body.style.userSelect).toBe('');
        expect(measure).toHaveBeenCalledTimes(key === 'graphqlExplorerWidth' ? 1 : 0);
        jest.advanceTimersByTime(299);
        expect(window.backendAPI.store.set).not.toHaveBeenCalled();
        jest.advanceTimersByTime(1);
        expect(window.backendAPI.store.set).toHaveBeenCalledWith(key, 350);

        moveTo(400);
        expect(pane.style.flexBasis).toBe('350px');
    });

    test('accepts exact bounds and rejects movements beyond either bound', () => {
        initResizer();
        start();
        moveTo(min);
        expect(pane.style.flexBasis).toBe(`${min}px`);
        moveTo(601);
        expect(pane.style.flexBasis).toBe(`${min}px`);
        moveTo(600);
        expect(pane.style.flexBasis).toBe('600px');
        moveTo(min - 1);
        expect(pane.style.flexBasis).toBe('600px');
    });
});
