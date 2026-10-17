import { app } from './appContext.js';
import { createLazyEditorProxy } from './editorLoader.js';
import { textToBase64 } from './utils/encoding.js';
import { translate } from './utils/translate.js';

const messages = {
    results: 'Results', expression: 'Query expression', apply: 'Apply', clear: 'Clear',
    copy: 'Copy Results', save: 'Save Results', namespaces: 'Namespace overrides',
    namespaceHelp: 'One prefix=URI per line. Overrides take precedence over detected bindings.',
    bindings: 'Effective namespaces', idle: 'Enter a query and select Apply.',
    draft: 'Draft changed. Select Apply to run it.', loading: 'Inspecting response…',
    unavailable: 'Inspection needs a completed JSON or XML response.',
    binary: 'Binary responses cannot be inspected.', truncated: 'Stored response is truncated. Resend to inspect the complete body.',
    legacy: 'This saved response has no reliable format information. Resend to inspect it.',
    parse: 'Malformed response body.', query: 'Invalid query expression.', namespace: 'Invalid or unbound namespace prefix.',
    limit: 'Inspection limit reached. Refine the query or reduce the response.',
    backend: 'Response inspection is unavailable.', empty: 'No matches.',
    count: '{{count}} matches.', scalar: '{{kind}} result.',
    partial: 'Partial results: showing {{shown}} of {{count}} matches.',
    boolean: 'Boolean', number: 'Number', string: 'String',
    copied: 'Results copied.', saved: 'Results saved.', exportError: 'Could not export results.'
};
function t(key, params) { return translate(`responseInspection.${key}`, messages[key], params); }
const emptyFormat = () => ({ draft: '', applied: '', namespaces: '', appliedNamespaces: {} });

/** One controller and one active native query per response container. */
export class ResponseInspectionController {
    constructor(container, { inspect, persist } = {}) {
        this.container = container;
        this.inspect = inspect || (request => window.backendAPI.responses.inspect(request));
        this.persist = persist || (state => app.workspaceTabController?.service.updateTab(container.tabId, { responseInspection: state }));
        this.state = { view: 'code', json: emptyFormat(), xml: emptyFormat() };
        this.source = null;
        this.unavailable = 'unavailable';
        this.format = 'json';
        this.generation = 0;
        this.running = false;
        this.pending = null;
        this.destroyed = false;
        this.restored = false;
        this.result = null;
        this.listeners = [];
        const { wrapper } = container;
        this.panel = wrapper.querySelector('.inspection-panel');
        this.resultsBtn = wrapper.querySelector('[data-mode="results"]');
        this.input = wrapper.querySelector('.inspection-expression');
        this.namespaceInput = wrapper.querySelector('.inspection-namespaces');
        this.status = wrapper.querySelector('.inspection-status');
        this.resultsEditor = createLazyEditorProxy('response', wrapper.querySelector('.inspection-editor'));
        this.lastOriginalView = container.previewManager.isPreviewMode(container.tabId) ? 'preview' : 'code';
        this.state.view = this.lastOriginalView;
        this.state.originalView = this.lastOriginalView;
        wrapper.querySelectorAll('[data-inspection-text]').forEach(element => {
            element.textContent = t(element.dataset.inspectionText);
        });
        this.input.setAttribute('aria-label', t('expression'));
        this.namespaceInput.setAttribute('aria-label', t('namespaces'));
        this.resultsBtn.setAttribute('aria-label', t('results'));
        wrapper.querySelector('.inspection-editor').setAttribute('aria-label', t('results'));
        this.listen(this.resultsBtn, 'click', () => this.showResults());
        this.listen(container.codeBtn, 'click', () => this.leaveResults('code'));
        this.listen(container.previewBtn, 'click', () => this.leaveResults('preview'));
        this.listen(wrapper.querySelector('.inspection-form'), 'submit', event => { event.preventDefault(); this.apply(); });
        this.listen(wrapper.querySelector('.inspection-clear'), 'click', () => this.clear());
        this.listen(this.input, 'input', () => this.edit());
        this.listen(this.namespaceInput, 'input', () => this.edit());
        this.listen(wrapper.querySelector('.inspection-copy'), 'click', () => this.export(false));
        this.listen(wrapper.querySelector('.inspection-save'), 'click', () => this.export(true));
        this.render();
        this.setStatus('unavailable');
    }

    listen(element, type, listener) {
        element.addEventListener(type, listener);
        this.listeners.push(() => element.removeEventListener(type, listener));
    }

    save() {
        // Snapshot before asynchronous persistence; derived output is deliberately excluded.
        Promise.resolve(this.persist(JSON.parse(JSON.stringify(this.state)))).catch(error => console.error('Failed to save inspection state', error));
    }

    restore(state) {
        if (this.restored || !state) { return; }
        this.restored = true;
        for (const format of ['json', 'xml']) {
            const saved = state[format];
            if (saved) {
                this.state[format] = { ...emptyFormat(),
                    draft: typeof saved.draft === 'string' ? saved.draft : '',
                    applied: typeof saved.applied === 'string' ? saved.applied : '',
                    namespaces: typeof saved.namespaces === 'string' ? saved.namespaces : '',
                    appliedNamespaces: saved.appliedNamespaces && typeof saved.appliedNamespaces === 'object' ? { ...saved.appliedNamespaces } : {} };
            }
        }
        this.state.view = ['code', 'preview', 'results'].includes(state.view) ? state.view : 'code';
        if (['code', 'preview'].includes(state.originalView)) { this.lastOriginalView = state.originalView; }
        if (this.state.view !== 'results') { this.lastOriginalView = this.state.view; }
        this.invalidate();
        this.render();
        this.reapply();
    }

    setSource(source) {
        if (this.destroyed) { return; }
        this.invalidate();
        this.source = source?.format && typeof source.body === 'string' ? Object.freeze({ ...source }) : null;
        this.unavailable = source?.unavailable || 'unavailable';
        if (this.source) { this.format = this.source.format; }
        this.result = null;
        this.resultsEditor.clear();
        this.render();
        this.reapply();
    }

    invalidate() { this.generation++; this.pending = null; }

    edit() {
        const state = this.state[this.format];
        state.draft = this.input.value;
        state.namespaces = this.namespaceInput.value;
        this.invalidate();
        this.setStatus('draft');
        this.save();
    }

    showResults() {
        this.state.view = 'results';
        this.renderVisibility();
        this.save();
        this.input.focus();
    }

    leaveResults(view = this.lastOriginalView) {
        this.lastOriginalView = view;
        this.state.originalView = view;
        this.state.view = view;
        this.renderVisibility();
        this.save();
    }

    clear() {
        this.invalidate();
        this.state[this.format] = emptyFormat();
        this.result = null;
        this.resultsEditor.clear();
        this.state.view = this.lastOriginalView;
        if (this.lastOriginalView === 'preview') { this.container.previewManager.showPreview(this.container.tabId); }
        else { this.container.previewManager.showCode(this.container.tabId); }
        this.render();
        this.setStatus(this.source ? 'idle' : this.unavailable);
        this.save();
    }

    apply() {
        if (!this.source) { this.setStatus(this.unavailable); return; }
        const state = this.state[this.format];
        try {
            const namespaces = {};
            if (this.format === 'xml') {
                for (const line of state.namespaces.split('\n').filter(line => line.trim())) {
                    const index = line.indexOf('=');
                    if (index < 1) { throw new Error(t('namespaceHelp')); }
                    const prefix = line.slice(0, index).trim();
                    Object.defineProperty(namespaces, prefix, { enumerable: true, value: line.slice(index + 1).trim() });
                }
            }
            state.appliedNamespaces = namespaces;
        } catch (error) { this.setStatus('namespace', {}, error.message); return; }
        state.applied = state.draft;
        this.invalidate();
        this.showResults();
        this.reapply();
    }

    reapply() {
        if (!this.source) { this.setStatus(this.unavailable); return; }
        const state = this.state[this.format];
        this.result = null;
        this.resultsEditor.clear();
        this.updateExports();
        if (!state.applied.trim()) { this.setStatus('idle'); return; }
        this.pending = { token: this.generation, request: { ...this.source, expression: state.applied,
            namespaces: { ...state.appliedNamespaces } } };
        this.setStatus('loading');
        this.drain();
    }

    async drain() {
        if (this.running || this.destroyed) { return; }
        this.running = true;
        try {
            while (this.pending && !this.destroyed) {
                const { token, request } = this.pending;
                this.pending = null;
                try {
                    const result = await this.inspect(request);
                    if (this.destroyed || token !== this.generation) { continue; }
                    this.result = { ...result, format: request.format };
                    this.resultsEditor.setContent(result.text, null, result.language);
                    const bindings = this.container.wrapper.querySelector('.inspection-bindings');
                    bindings.textContent = Object.entries(result.namespaces || {}).map(([prefix, uri]) => `${prefix}=${uri}`).join('\n');
                    this.setStatus(result.truncated ? 'partial' : result.totalCount === 0 ? 'empty' : result.kind === 'nodes' ? 'count' : 'scalar',
                        { count: result.totalCount, shown: result.displayedCount, kind: result.kind === 'nodes' ? '' : t(result.kind) });
                    this.updateExports();
                } catch (error) {
                    if (this.destroyed || token !== this.generation) { continue; }
                    this.setStatus(Object.hasOwn(messages, error?.code) ? error.code : 'backend', {}, error?.message || String(error));
                }
            }
        } finally { this.running = false; }
    }

    setStatus(key, params = {}, detail = '') {
        this.status.textContent = t(key, params);
        this.status.title = detail;
        this.status.setAttribute('aria-busy', String(key === 'loading'));
    }

    render() {
        this.input.value = this.state[this.format].draft;
        this.input.placeholder = this.format === 'xml' ? '//ns:item' : '$.items[*]';
        this.container.wrapper.querySelector('.inspection-format').textContent = this.format === 'xml' ? 'XPath 1.0' : 'JSONPath';
        this.namespaceInput.value = this.state[this.format].namespaces;
        this.container.wrapper.querySelector('.inspection-namespace-options').classList.toggle('is-hidden', this.format !== 'xml');
        this.container.wrapper.querySelector('.inspection-apply').disabled = !this.source;
        this.input.disabled = !this.source;
        this.namespaceInput.disabled = !this.source;
        this.container.wrapper.querySelector('.inspection-bindings').textContent = '';
        this.updateExports();
        this.renderVisibility();
    }

    renderVisibility() {
        const results = this.state.view === 'results';
        this.panel.classList.toggle('is-hidden', !results);
        this.resultsBtn.classList.toggle('active', results);
        this.resultsBtn.setAttribute('aria-pressed', String(results));
        if (results) {
            this.container.bodyContainer.classList.add('is-hidden');
            this.container.previewContainer.classList.add('is-hidden');
            this.container.codeBtn.classList.remove('active');
            this.container.previewBtn.classList.remove('active');
        } else {
            const preview = this.state.view === 'preview' && !this.container.previewBtn.disabled;
            this.container.bodyContainer.classList.toggle('is-hidden', preview);
            this.container.previewContainer.classList.toggle('is-hidden', !preview);
            this.container.codeBtn.classList.toggle('active', !preview);
            this.container.previewBtn.classList.toggle('active', preview);
        }
        this.container.codeBtn.setAttribute('aria-pressed', String(this.container.codeBtn.classList.contains('active')));
        this.container.previewBtn.setAttribute('aria-pressed', String(this.container.previewBtn.classList.contains('active')));
    }

    updateExports() {
        this.container.wrapper.querySelectorAll('.inspection-copy, .inspection-save').forEach(button => { button.disabled = !this.result; });
    }

    async export(save) {
        if (!this.result) { return; }
        const token = this.generation;
        const { text, format } = this.result;
        try {
            if (save) {
                const saved = await window.backendAPI.saveResponseBody(`results.${format === 'json' ? 'json' : 'txt'}`, textToBase64(text));
                if (saved === false || saved?.cancelled) { return; }
                if (saved?.success === false) { throw new Error(t('exportError')); }
            } else { await navigator.clipboard.writeText(text); }
            if (!this.destroyed && token === this.generation) { this.setStatus(save ? 'saved' : 'copied'); }
        } catch (error) { if (!this.destroyed && token === this.generation) { this.setStatus('exportError', {}, error.message); } }
    }

    destroy() {
        this.destroyed = true;
        this.invalidate();
        this.listeners.forEach(remove => remove());
        this.resultsEditor.destroy();
    }
}
