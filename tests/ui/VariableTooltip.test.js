/* global document, window */
import { VariableTooltip, renderVariableTooltip } from '../../src/modules/ui/VariableTooltip.js';
import { decorateInput, getDecoration, setVariableLookup } from '../../src/modules/ui/inputDecorator.js';

function text(el) {
    return el.textContent.replace(/\s+/g, ' ').trim();
}

describe('renderVariableTooltip', () => {
    test('resolved value with scope badge', () => {
        const el = renderVariableTooltip({ status: 'resolved', name: 'baseUrl', scope: 'environment', value: 'https://dev', secret: false, envName: 'Dev' });
        expect(el.className).toBe('var-tooltip var-tooltip--resolved');
        expect(text(el.querySelector('.var-tooltip-name'))).toBe('baseUrl');
        expect(text(el.querySelector('.var-tooltip-scope'))).toBe('Environment "Dev"');
        expect(el.querySelector('.var-tooltip-scope').classList.contains('accent')).toBe(true);
        expect(text(el.querySelector('.var-tooltip-value'))).toBe('https://dev');
    });

    test('secret shows the mask and a secret badge, never the value', () => {
        const el = renderVariableTooltip({ status: 'resolved', name: 'token', scope: 'collection', value: 'hunter2', secret: true, envName: null });
        expect(text(el.querySelector('.var-tooltip-value'))).toBe('••••••');
        expect(text(el.querySelector('.var-tooltip-secret'))).toBe('secret');
        expect(el.textContent).not.toContain('hunter2');
    });

    test('unresolved, unknown, dynamic, path-param and empty bodies', () => {
        expect(text(renderVariableTooltip({ status: 'unresolved', name: 'x', scope: null }).querySelector('.var-tooltip-missing')))
            .toBe('Not defined in current environment or collection');
        expect(text(renderVariableTooltip({ status: 'unknown', name: 'x', scope: null }).querySelector('.var-tooltip-missing')))
            .toBe('Variables not loaded yet');
        const dynamic = renderVariableTooltip({ status: 'dynamic', name: '$uuid', scope: 'dynamic', description: 'UUID v4', example: '{{$uuid}}' });
        expect(text(dynamic.querySelector('.var-tooltip-description'))).toBe('UUID v4');
        expect(text(dynamic.querySelector('.var-tooltip-example'))).toBe('{{$uuid}}');
        expect(text(renderVariableTooltip({ status: 'path-param', name: 'id', scope: 'path-param', value: '42', secret: false }).querySelector('.var-tooltip-scope')))
            .toBe('Path parameter');
        const empty = renderVariableTooltip({ status: 'resolved', name: 'e', scope: 'collection', value: '', secret: false });
        expect(empty.querySelector('.var-tooltip-value').classList.contains('is-empty')).toBe(true);
        expect(renderVariableTooltip(null).className).toContain('var-tooltip--unresolved');
    });

    test('long values are truncated and markup is rendered as text', () => {
        const el = renderVariableTooltip({ status: 'resolved', name: 'v', scope: 'collection', value: `<b>${'x'.repeat(400)}`, secret: false });
        expect(el.querySelector('b')).toBeNull();
        expect(el.querySelector('.var-tooltip-value').textContent).toHaveLength(240);
    });
});

describe('VariableTooltip', () => {
    let tooltip;

    beforeEach(() => {
        document.body.innerHTML = '';
        setVariableLookup((name) => name === 'base'
            ? { status: 'resolved', name, scope: 'environment', value: 'https://dev', secret: false, envName: 'Dev' }
            : { status: 'unresolved', name, scope: null, value: null, secret: false, envName: null });
    });

    afterEach(() => {
        tooltip?.destroy();
        tooltip = null;
    });

    function decoratedInput(value) {
        const input = document.createElement('input');
        input.value = value;
        document.body.appendChild(input);
        decorateInput(input);
        return input;
    }

    function rectFor(el, rect) {
        el.getBoundingClientRect = () => ({ left: rect.left, right: rect.left + rect.width, top: rect.top, bottom: rect.top + rect.height, width: rect.width, height: rect.height });
    }

    test('showAt positions above the token and renders the entry', () => {
        tooltip = new VariableTooltip(() => null);
        tooltip.install();

        tooltip.showAt({ left: 100, top: 300, bottom: 320, width: 40 }, { status: 'resolved', name: 'base', scope: 'collection', value: 'v', secret: false });

        const el = document.querySelector('.var-tooltip-floating');
        expect(tooltip.isVisible()).toBe(true);
        expect(el.style.left).toBe('100px');
        expect(el.style.top).toBe('294px');
        expect(text(el.querySelector('.var-tooltip-name'))).toBe('base');

        tooltip.showAt({ left: 10, top: 2, bottom: 22, width: 40 }, { status: 'unresolved', name: 'y', scope: null });
        expect(el.style.top).toBe('28px');
        tooltip.hide();
        expect(tooltip.isVisible()).toBe(false);
    });

    test('mousemove over a token in a decorated input shows its lookup, elsewhere hides', () => {
        const input = decoratedInput('a={{base}} b={{nope}}');
        const [first, second] = getDecoration(input).text.querySelectorAll('.var-token');
        rectFor(first, { left: 20, top: 10, width: 60, height: 20 });
        rectFor(second, { left: 100, top: 10, width: 60, height: 20 });
        const lookup = jest.fn((name) => ({ status: name === 'base' ? 'resolved' : 'unresolved', name, scope: name === 'base' ? 'environment' : null, value: 'v', secret: false, envName: 'Dev' }));
        tooltip = new VariableTooltip(lookup, { isTarget: () => true });
        tooltip.install();

        input.dispatchEvent(new window.MouseEvent('mousemove', { bubbles: true, clientX: 30, clientY: 15 }));
        tooltip._handleMove(tooltip._pending);
        expect(tooltip.isVisible()).toBe(true);
        expect(lookup).toHaveBeenCalledWith('base', input);
        expect(text(document.querySelector('.var-tooltip-floating .var-tooltip-name'))).toBe('base');

        input.dispatchEvent(new window.MouseEvent('mousemove', { bubbles: true, clientX: 31, clientY: 15 }));
        tooltip._handleMove(tooltip._pending);
        expect(lookup).toHaveBeenCalledTimes(1);

        input.dispatchEvent(new window.MouseEvent('mousemove', { bubbles: true, clientX: 120, clientY: 15 }));
        tooltip._handleMove(tooltip._pending);
        expect(text(document.querySelector('.var-tooltip-floating .var-tooltip-name'))).toBe('nope');

        input.dispatchEvent(new window.MouseEvent('mousemove', { bubbles: true, clientX: 90, clientY: 15 }));
        tooltip._handleMove(tooltip._pending);
        expect(tooltip.isVisible()).toBe(false);
    });

    test('ignores inputs that are not targets and hides on keydown, mouseout and focusout', () => {
        const input = decoratedInput('{{base}}');
        rectFor(getDecoration(input).text.querySelector('.var-token'), { left: 0, top: 0, width: 50, height: 20 });
        tooltip = new VariableTooltip(() => ({ status: 'resolved', name: 'base', scope: 'collection', value: 'v', secret: false }), { isTarget: () => false });
        tooltip.install();
        tooltip._handleMove({ target: input, clientX: 5, clientY: 5 });
        expect(tooltip.isVisible()).toBe(false);

        tooltip.isTarget = () => true;
        tooltip._handleMove({ target: input, clientX: 5, clientY: 5 });
        expect(tooltip.isVisible()).toBe(true);
        input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'a', bubbles: true }));
        expect(tooltip.isVisible()).toBe(false);

        tooltip._handleMove({ target: input, clientX: 5, clientY: 5 });
        input.dispatchEvent(new window.MouseEvent('mouseout', { bubbles: true }));
        expect(tooltip.isVisible()).toBe(false);

        tooltip._handleMove({ target: input, clientX: 5, clientY: 5 });
        input.dispatchEvent(new window.FocusEvent('focusout', { bubbles: true }));
        expect(tooltip.isVisible()).toBe(false);
    });

    test('destroy removes the floating element', () => {
        tooltip = new VariableTooltip(() => null);
        tooltip.install();
        tooltip.showAt({ left: 0, top: 50, bottom: 60, width: 10 }, { status: 'unresolved', name: 'x', scope: null });
        tooltip.destroy();
        tooltip = null;
        expect(document.querySelector('.var-tooltip-floating')).toBeNull();
    });
});
