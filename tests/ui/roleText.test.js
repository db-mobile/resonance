/* global document */
import { setRoleTexts } from '../../src/modules/ui/roleText.js';

describe('setRoleTexts', () => {
    test('fills matching slots and skips missing ones', () => {
        const root = document.createElement('div');
        root.innerHTML = '<span data-role="title"></span><span data-role="count">old</span>';

        setRoleTexts(root, { title: 'Hello', count: 3, missing: 'ignored' });

        expect(root.querySelector('[data-role="title"]').textContent).toBe('Hello');
        expect(root.querySelector('[data-role="count"]').textContent).toBe('3');
    });

    test('only touches the first matching slot per role', () => {
        const root = document.createElement('div');
        root.innerHTML = '<span data-role="a">1</span><span data-role="a">2</span>';

        setRoleTexts(root, { a: 'x' });

        const slots = root.querySelectorAll('[data-role="a"]');
        expect(slots[0].textContent).toBe('x');
        expect(slots[1].textContent).toBe('2');
    });
});
