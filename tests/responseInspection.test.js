import { readFileSync } from 'node:fs';
const { document, window } = globalThis;
import { responseInspectionSource } from '../src/modules/responseInspectionSource.js';
import { ResponseInspectionController } from '../src/modules/ResponseInspectionController.js';

jest.mock('../src/modules/editorLoader.js', () => ({ createLazyEditorProxy: () => {
    let content = '';
    return { setContent: (text) => { content = text; }, getContent: () => content, clear: () => { content = ''; }, destroy: jest.fn() };
} }));
const tick = async () => { for (let i = 0; i < 10; i++) { await Promise.resolve(); } };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const result = text => ({ text, language: 'json', kind: 'nodes', totalCount: 1, displayedCount: 1, truncated: false, namespaces: {} });

function fixture(backend = jest.fn().mockResolvedValue(result('[1]'))) {
    document.body.innerHTML = readFileSync('src/templates/response/responseContainer.html', 'utf8');
    const wrapper = document.querySelector('template').content.firstElementChild.cloneNode(true);
    document.body.appendChild(wrapper);
    const container = { wrapper, tabId: 'a', bodyContainer: wrapper.querySelector('.response-body-container'),
        previewContainer: wrapper.querySelector('.response-preview-container'),
        codeBtn: wrapper.querySelector('[data-mode="code"]'), previewBtn: wrapper.querySelector('[data-mode="preview"]'),
        previewManager: { isPreviewMode: () => false, showCode: jest.fn(), showPreview: jest.fn() } };
    const persist = jest.fn();
    const controller = new ResponseInspectionController(container, { inspect: backend, persist });
    const input = wrapper.querySelector('.inspection-expression');
    const type = text => { input.value = text; input.dispatchEvent(new Event('input')); };
    return { controller, wrapper, type, input, backend, persist, container };
}

describe('complete inspection snapshots', () => {
    test.each([false, 0, null, '', '42', '{"id":1}'])('preserves decoded JSON scalar %p', data => {
        expect(responseInspectionSource({ data, isJson: true })).toEqual({ format: 'json', body: JSON.stringify(data) });
    });
    test('refuses binary, truncated and ambiguous legacy strings', () => {
        for (const response of [{ data: {}, isBinary: true }, { data: {}, truncated: true }, { data: 'false' }]) {
            expect(responseInspectionSource(response).format).toBeUndefined();
        }
        expect(responseInspectionSource({ data: { id: 1 } }).format).toBe('json');
        expect(responseInspectionSource({ data: '', isJson: false, headers: { 'content-type': 'application/json' } }))
            .toEqual({ unavailable: 'unavailable' });
        expect(responseInspectionSource({ data: '<r/>', isJson: false, headers: { 'content-type': 'application/xml' } }).format).toBe('xml');
    });
});

describe('response inspection lifecycle', () => {
    test('applies only on submit; original stays intact; clear restores Code', async () => {
        const f = fixture();
        f.controller.setSource({ format: 'json', body: '{"id":1}' });
        f.type('$.id');
        expect(f.backend).not.toHaveBeenCalled();
        f.wrapper.querySelector('.inspection-form').dispatchEvent(new Event('submit', { cancelable: true }));
        await tick();
        expect(f.backend).toHaveBeenCalledWith({ format: 'json', body: '{"id":1}', expression: '$.id', namespaces: {} });
        expect(f.controller.resultsEditor.getContent()).toBe('[1]');
        expect(f.wrapper.querySelector('.inspection-panel').classList.contains('is-hidden')).toBe(false);
        f.controller.clear();
        expect(f.input.value).toBe('');
        expect(f.wrapper.querySelector('.inspection-panel').classList.contains('is-hidden')).toBe(true);
    });
    test('reapplies applied query while preserving an unsubmitted draft, with only latest request queued', async () => {
        const first = deferred(); const backend = jest.fn().mockReturnValueOnce(first.promise).mockResolvedValue(result('[3]'));
        const f = fixture(backend);
        f.controller.setSource({ format: 'json', body: '1' }); f.type('$'); f.controller.apply();
        f.type('$.draft');
        f.controller.setSource({ format: 'json', body: '2' });
        f.controller.setSource({ format: 'json', body: '3' });
        expect(backend).toHaveBeenCalledTimes(1);
        first.resolve(result('[1]')); await tick();
        expect(backend).toHaveBeenCalledTimes(2);
        expect(backend.mock.calls[1][0]).toEqual({ format: 'json', body: '3', expression: '$', namespaces: {} });
        expect(f.input.value).toBe('$.draft');
        expect(f.controller.resultsEditor.getContent()).toBe('[3]');
    });
    test.each(['clear', 'destroy'])('ignores pending completion after %s', async operation => {
        const pending = deferred(); const f = fixture(() => pending.promise);
        f.controller.setSource({ format: 'json', body: '1' }); f.type('$'); f.controller.apply();
        f.controller[operation](); pending.resolve(result('[late]')); await tick();
        expect(f.controller.resultsEditor.getContent()).not.toBe('[late]');
    });
    test('typing invalidates an in-flight completion without running the draft', async () => {
        const pending = deferred(); const f = fixture(jest.fn(() => pending.promise));
        f.controller.setSource({ format: 'json', body: '1' }); f.type('$'); f.controller.apply();
        f.type('$.new'); pending.resolve(result('[late]')); await tick();
        expect(f.controller.resultsEditor.getContent()).toBe(''); expect(f.backend).toHaveBeenCalledTimes(1);
    });
    test('keeps JSONPath and XPath states separate, restores Results and recomputes', async () => {
        const f = fixture(); f.controller.restore({ view: 'results', json: { draft: '$.draft', applied: '$' }, xml: { draft: '//r', applied: '//r', namespaces: {} } });
        f.controller.setSource({ format: 'json', body: 'false' }); await tick();
        expect(f.input.value).toBe('$.draft'); expect(f.backend.mock.calls[0][0].expression).toBe('$');
        f.controller.setSource({ format: 'xml', body: '<r/>' }); await tick();
        expect(f.input.value).toBe('//r'); expect(f.backend.mock.calls[1][0].format).toBe('xml');
        expect(JSON.stringify(f.controller.state)).not.toContain('[1]');
    });
    test('exports exactly displayed text with format-specific extension', async () => {
        const f = fixture();
        window.backendAPI = { saveResponseBody: jest.fn().mockResolvedValue(true) };
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: jest.fn().mockResolvedValue() } });
        f.controller.setSource({ format: 'json', body: '1' }); f.type('$'); f.controller.apply(); await tick();
        f.wrapper.querySelector('.inspection-copy').click(); f.wrapper.querySelector('.inspection-save').click(); await tick();
        expect(navigator.clipboard.writeText).toHaveBeenCalledWith('[1]');
        expect(window.backendAPI.saveResponseBody).toHaveBeenCalledWith('results.json', 'WzFd');
    });
});

describe('inspection view and error states', () => {
    test('applying an empty draft clears previous derived results and exports', async () => {
        const f = fixture(); f.controller.setSource({ format: 'json', body: '1' }); f.type('$'); f.controller.apply(); await tick();
        f.type(''); f.controller.apply(); await tick();
        expect(f.controller.resultsEditor.getContent()).toBe('');
        expect(f.wrapper.querySelector('.inspection-copy').disabled).toBe(true);
    });
    test('Clear returns to the persisted original Preview view', async () => {
        const f = fixture();
        f.controller.restore({ view: 'results', originalView: 'preview', json: { draft: '$', applied: '$' } });
        f.controller.setSource({ format: 'json', body: '1' }); await tick();
        f.controller.clear();
        expect(f.container.previewManager.showPreview).toHaveBeenCalledWith('a');
        expect(f.container.previewContainer.classList.contains('is-hidden')).toBe(false);
    });
    test('Results remains the only visible view after external Preview restoration', () => {
        const f = fixture(); f.controller.showResults();
        f.container.bodyContainer.classList.remove('is-hidden');
        f.container.previewContainer.classList.remove('is-hidden');
        f.controller.renderVisibility();
        expect(f.container.bodyContainer.classList.contains('is-hidden')).toBe(true);
        expect(f.container.previewContainer.classList.contains('is-hidden')).toBe(true);
    });
    test('separate tabs do not share expressions or results', async () => {
        const first = fixture(); const second = fixture();
        first.controller.setSource({ format: 'json', body: '1' }); first.type('$'); first.controller.apply(); await tick();
        expect(second.input.value).toBe('');
        expect(second.controller.resultsEditor.getContent()).toBe('');
        expect(second.backend).not.toHaveBeenCalled();
    });
    test('namespace overrides, errors, partial and no-match statuses are visible', async () => {
        const backend = jest.fn().mockRejectedValueOnce({ code: 'namespace', message: 'Unknown prefix' })
            .mockResolvedValueOnce({ ...result('<r/>'), language: 'text', totalCount: 2000, displayedCount: 1000, truncated: true, namespaces: { ns: 'urn:r' } })
            .mockResolvedValueOnce({ ...result(''), totalCount: 0, displayedCount: 0 });
        const f = fixture(backend);
        f.controller.setSource({ format: 'xml', body: '<r/>' }); f.type('//ns:r');
        const input = f.wrapper.querySelector('.inspection-namespaces');
        input.value = 'ns=urn:r'; input.dispatchEvent(new Event('input'));
        f.controller.apply(); await tick();
        expect(f.wrapper.querySelector('.inspection-status').textContent).toContain('namespace');
        expect(f.wrapper.querySelector('.inspection-save').disabled).toBe(true);
        f.controller.apply(); await tick();
        expect(backend.mock.calls[1][0].namespaces).toEqual({ ns: 'urn:r' });
        expect(f.wrapper.querySelector('.inspection-status').textContent).toContain('1000 of 2000');
        expect(f.wrapper.querySelector('.inspection-bindings').textContent).toBe('ns=urn:r');
        f.controller.apply(); await tick();
        expect(f.wrapper.querySelector('.inspection-status').textContent).toBe('No matches.');
        window.backendAPI = { saveResponseBody: jest.fn().mockResolvedValue({ success: true }) };
        f.wrapper.querySelector('.inspection-save').click(); await tick();
        expect(window.backendAPI.saveResponseBody).toHaveBeenCalledWith('results.txt', '');
    });
    test('new request placeholders clear results and retain the applied query', async () => {
        const f = fixture(); f.controller.setSource({ format: 'json', body: '1' }); f.type('$'); f.controller.apply(); await tick();
        f.controller.setSource(null);
        expect(f.controller.resultsEditor.getContent()).toBe('');
        expect(f.controller.state.json.applied).toBe('$');
        expect(f.wrapper.querySelector('.inspection-save').disabled).toBe(true);
        expect(f.wrapper.querySelector('.inspection-apply').disabled).toBe(true);
        f.controller.setSource({ format: 'json', body: '2' }); await tick();
        expect(f.backend).toHaveBeenCalledTimes(2);
    });
});
