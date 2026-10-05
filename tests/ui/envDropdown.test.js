/* global document, DOMParser */
import fs from 'fs';
import path from 'path';
import { templateLoader } from '../../src/modules/templateLoader.js';
import {
    applyEnvButtonColor,
    applyEnvColor,
    createEnvDropdownItem,
    positionEnvDropdown
} from '../../src/modules/ui/envDropdown.js';

const TEMPLATE_PATH = './src/templates/environment/environmentSelector.html';

beforeEach(() => {
    const html = fs.readFileSync(path.join(process.cwd(), 'src/templates/environment/environmentSelector.html'), 'utf8');
    templateLoader.cache.set(TEMPLATE_PATH, new DOMParser().parseFromString(html, 'text/html'));
});

describe('createEnvDropdownItem', () => {
    test('renders an active, coloured item', () => {
        const item = createEnvDropdownItem({ id: 'a', name: 'Dev', color: '#ff0000' }, true);

        expect(item.className).toBe('env-dropdown-item dropdown-item active is-active');
        expect(item.querySelector('[data-role="name"]').textContent).toBe('Dev');
        expect(item.querySelector('[data-role="check"]').classList.contains('is-hidden')).toBe(false);
        const color = item.querySelector('[data-role="color"]');
        expect(color.classList.contains('is-hidden')).toBe(false);
        expect(color.style.getPropertyValue('--env-indicator-color')).toBe('#ff0000');
    });

    test('renders an inactive item without colour', () => {
        const item = createEnvDropdownItem({ id: 'b', name: 'Prod', color: null }, false);

        expect(item.className).toBe('env-dropdown-item dropdown-item');
        expect(item.querySelector('[data-role="check"]').classList.contains('is-hidden')).toBe(true);
        const color = item.querySelector('[data-role="color"]');
        expect(color.classList.contains('is-hidden')).toBe(true);
        expect(color.style.getPropertyValue('--env-indicator-color')).toBe('');
    });
});

describe('applyEnvColor / applyEnvButtonColor', () => {
    test('sets and removes the custom property', () => {
        const target = document.createElement('span');
        applyEnvColor(target, '--x', '#123456');
        expect(target.style.getPropertyValue('--x')).toBe('#123456');
        applyEnvColor(target, '--x', null);
        expect(target.style.getPropertyValue('--x')).toBe('');
    });

    test('styles the button and indicator together', () => {
        const button = document.createElement('button');
        const indicator = document.createElement('span');

        applyEnvButtonColor(button, indicator, '#abcdef');
        expect(button.classList.contains('has-color')).toBe(true);
        expect(button.style.getPropertyValue('--env-selected-color')).toBe('#abcdef');
        expect(indicator.classList.contains('is-hidden')).toBe(false);
        expect(indicator.style.getPropertyValue('--env-indicator-color')).toBe('#abcdef');

        applyEnvButtonColor(button, indicator, null);
        expect(button.classList.contains('has-color')).toBe(false);
        expect(button.style.getPropertyValue('--env-selected-color')).toBe('');
        expect(indicator.classList.contains('is-hidden')).toBe(true);

        expect(() => applyEnvButtonColor(null, null, '#000')).not.toThrow();
    });
});

describe('positionEnvDropdown', () => {
    test('derives the custom properties from the button rect', () => {
        const dropdown = document.createElement('div');
        const button = document.createElement('button');
        button.getBoundingClientRect = () => ({ bottom: 30, left: 12, width: 150 });

        positionEnvDropdown(dropdown, button);

        expect(dropdown.style.getPropertyValue('--env-dropdown-top')).toBe('34px');
        expect(dropdown.style.getPropertyValue('--env-dropdown-left')).toBe('12px');
        expect(dropdown.style.getPropertyValue('--env-dropdown-min-width')).toBe('150px');
    });
});
