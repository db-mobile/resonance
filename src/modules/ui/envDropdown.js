/**
 * @fileoverview Environment dropdown pieces shared by the selector and the cookie manager
 * @module ui/envDropdown
 */

import { templateLoader } from '../templateLoader.js';

const TEMPLATE_PATH = './src/templates/environment/environmentSelector.html';

/**
 * @param {HTMLElement} target
 * @param {string} property
 * @param {string|null|undefined} color
 * @returns {void}
 */
export function applyEnvColor(target, property, color) {
    if (color) {
        target.style.setProperty(property, color);
    } else {
        target.style.removeProperty(property);
    }
}

/**
 * @param {HTMLElement|null} button
 * @param {HTMLElement|null} indicator
 * @param {string|null|undefined} color
 * @returns {void}
 */
export function applyEnvButtonColor(button, indicator, color) {
    const hasColor = Boolean(color);
    if (button) {
        button.classList.toggle('has-color', hasColor);
        applyEnvColor(button, '--env-selected-color', color);
    }
    if (indicator) {
        indicator.classList.toggle('is-hidden', !hasColor);
        applyEnvColor(indicator, '--env-indicator-color', color);
    }
}

/**
 * @param {{name: string, color?: string|null}} env
 * @param {boolean} isActive
 * @returns {HTMLElement}
 */
export function createEnvDropdownItem(env, isActive) {
    const fragment = templateLoader.cloneSync(TEMPLATE_PATH, 'tpl-env-dropdown-item');
    const item = fragment.firstElementChild;
    item.className = `env-dropdown-item dropdown-item${isActive ? ' active is-active' : ''}`;

    const nameEl = item.querySelector('[data-role="name"]');
    const checkEl = item.querySelector('[data-role="check"]');
    const colorEl = item.querySelector('[data-role="color"]');
    if (nameEl) {nameEl.textContent = env.name;}
    if (checkEl) {checkEl.classList.toggle('is-hidden', !isActive);}
    if (colorEl) {
        colorEl.classList.toggle('is-hidden', !env.color);
        applyEnvColor(colorEl, '--env-indicator-color', env.color);
    }
    return item;
}

/**
 * @param {HTMLElement} dropdown
 * @param {HTMLElement} button
 * @returns {void}
 */
export function positionEnvDropdown(dropdown, button) {
    const rect = button.getBoundingClientRect();
    dropdown.style.setProperty('--env-dropdown-top', `${rect.bottom + 4}px`);
    dropdown.style.setProperty('--env-dropdown-left', `${rect.left}px`);
    dropdown.style.setProperty('--env-dropdown-min-width', `${rect.width}px`);
}
