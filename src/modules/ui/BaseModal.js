/**
 * @fileoverview Base class for overlay-style modal dialogs.
 * @module ui/BaseModal
 */

import { templateLoader } from '../templateLoader.js';
import { app } from '../appContext.js';
import { pushEscapeHandler } from './modalEscape.js';

const FOCUSABLE_SELECTOR = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled]):not([type="hidden"])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
    '[contenteditable="true"]'
].join(',');

let titleIdCounter = 0;

/**
 * @param {HTMLElement} root
 * @returns {HTMLElement[]}
 */
export function focusableElements(root) {
    return Array.from(root.querySelectorAll(FOCUSABLE_SELECTOR))
        .filter(el => !el.closest('[hidden], .is-hidden, .u-hidden'));
}

/**
 * @param {HTMLElement} dialog
 * @returns {void}
 */
export function applyDialogAria(dialog) {
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    const title = dialog.querySelector('.dialog-title');
    if (title) {
        if (!title.id) {
            titleIdCounter += 1;
            title.id = `modal-title-${titleIdCounter}`;
        }
        dialog.setAttribute('aria-labelledby', title.id);
    }
}

/**
 * @param {KeyboardEvent} e
 * @param {HTMLElement} dialog
 * @returns {void}
 */
export function trapTab(e, dialog) {
    if (e.key !== 'Tab' || e.defaultPrevented) {
        return;
    }
    const items = focusableElements(dialog);
    if (items.length === 0) {
        e.preventDefault();
        dialog.focus();
        return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || !dialog.contains(active))) {
        e.preventDefault();
        last.focus();
    } else if (!e.shiftKey && (active === last || !dialog.contains(active))) {
        e.preventDefault();
        first.focus();
    }
}

/**
 * @param {HTMLElement|null} element
 * @returns {void}
 */
export function restoreFocus(element) {
    if (element?.isConnected && element !== document.body && typeof element.focus === 'function') {
        element.focus();
    }
}

export class BaseModal {
    constructor() {
        /** @type {HTMLElement|null} */
        this.overlay = null;
        /** @type {HTMLElement|null} */
        this.dialog = null;
        /** @type {(() => void)|null} */
        this._releaseEscape = null;
        /** @type {HTMLElement|null} */
        this._previousFocus = null;
    }

    /**
     * @param {Object} config
     * @param {string} config.overlayClass
     * @param {string} config.dialogClass
     * @param {string} config.templatePath
     * @param {string} config.templateId
     * @param {boolean} [config.closeOnEscape=true]
     * @param {boolean} [config.closeOnOverlayClick=true]
     * @param {(() => void)|null} [config.onSubmit=null]
     * @returns {HTMLElement}
     */
    mount({
        overlayClass,
        dialogClass,
        templatePath,
        templateId,
        closeOnEscape = true,
        closeOnOverlayClick = true,
        onSubmit = null
    }) {
        this._previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;

        this.overlay = document.createElement('div');
        this.overlay.className = `${overlayClass} modal-overlay`;

        this.dialog = document.createElement('div');
        this.dialog.className = dialogClass;
        this.dialog.tabIndex = -1;
        this.dialog.appendChild(templateLoader.cloneSync(templatePath, templateId));
        app.i18n?.updateUI?.(this.dialog);
        applyDialogAria(this.dialog);

        this.overlay.appendChild(this.dialog);
        document.body.appendChild(this.overlay);

        this.overlay.addEventListener('keydown', (e) => {
            if (this.dialog) {
                trapTab(e, this.dialog);
            }
        });

        if (onSubmit) {
            this.dialog.addEventListener('keydown', (e) => {
                const { target } = e;
                if (e.key === 'Enter' && !e.defaultPrevented && !e.isComposing
                    && target.tagName === 'INPUT' && target.type !== 'checkbox' && target.type !== 'radio') {
                    e.preventDefault();
                    onSubmit();
                }
            });
        }

        if (closeOnOverlayClick) {
            this.overlay.addEventListener('click', (e) => {
                if (e.target === this.overlay) {
                    this.onDismiss();
                }
            });
        }

        if (closeOnEscape) {
            this._releaseEscape = pushEscapeHandler(() => this.onDismiss());
        }

        queueMicrotask(() => {
            if (this.dialog && !this.dialog.contains(document.activeElement)) {
                const preferred = this.dialog.querySelector('[autofocus]');
                (preferred instanceof HTMLElement ? preferred : this.dialog).focus();
            }
        });

        return this.dialog;
    }

    /** @returns {void} */
    onDismiss() {
        this.destroy();
    }

    /** @returns {void} */
    destroy() {
        if (this._releaseEscape) {
            this._releaseEscape();
            this._releaseEscape = null;
        }
        const hadFocus = this.overlay?.contains(document.activeElement) ?? false;
        if (this.overlay) {
            this.overlay.remove();
            this.overlay = null;
        }
        this.dialog = null;
        if (hadFocus || document.activeElement === document.body) {
            restoreFocus(this._previousFocus);
        }
        this._previousFocus = null;
    }
}
