/**
 * @fileoverview Base class for overlay-style modal dialogs.
 * @module ui/BaseModal
 */

import { templateLoader } from '../templateLoader.js';

/**
 * Shared scaffolding for overlay modal dialogs.
 *
 * Owns overlay/dialog element creation, template cloning, mounting to the
 * document, dismiss-on-overlay-click, dismiss-on-Escape, and teardown (including
 * removal of the global keydown listener, so closing via a button never leaks it).
 * Subclasses provide their template + element wiring and override
 * {@link BaseModal#onDismiss} to define what dismissing means (e.g. resolving a
 * promise with a cancel value).
 *
 * @class
 */
export class BaseModal {
    constructor() {
        /** @type {HTMLElement|null} The overlay backdrop element. */
        this.overlay = null;
        /** @type {HTMLElement|null} The dialog element hosting the template. */
        this.dialog = null;
        /** @type {((e: KeyboardEvent) => void)|null} Global Escape handler, if any. */
        this._keydownHandler = null;
    }

    /**
     * Builds the overlay + dialog, clones the template into it, mounts to the body,
     * and wires the shared dismiss interactions.
     *
     * @protected
     * @param {Object} config - Mount configuration.
     * @param {string} config.overlayClass - Class for the overlay; `modal-overlay` is appended.
     * @param {string} config.dialogClass - Class for the dialog element.
     * @param {string} config.templatePath - Template file path passed to templateLoader.
     * @param {string} config.templateId - Template element id within the file.
     * @param {boolean} [config.closeOnEscape=true] - Dismiss when Escape is pressed.
     * @param {boolean} [config.closeOnOverlayClick=true] - Dismiss when the backdrop is clicked.
     * @returns {HTMLElement} The dialog element, for subclass wiring.
     */
    mount({
        overlayClass,
        dialogClass,
        templatePath,
        templateId,
        closeOnEscape = true,
        closeOnOverlayClick = true
    }) {
        this.overlay = document.createElement('div');
        this.overlay.className = `${overlayClass} modal-overlay`;

        this.dialog = document.createElement('div');
        this.dialog.className = dialogClass;
        this.dialog.appendChild(templateLoader.cloneSync(templatePath, templateId));

        this.overlay.appendChild(this.dialog);
        document.body.appendChild(this.overlay);

        if (closeOnOverlayClick) {
            this.overlay.addEventListener('click', (e) => {
                if (e.target === this.overlay) {
                    this.onDismiss();
                }
            });
        }

        if (closeOnEscape) {
            this._keydownHandler = (e) => {
                if (e.key === 'Escape') {
                    this.onDismiss();
                }
            };
            document.addEventListener('keydown', this._keydownHandler);
        }

        return this.dialog;
    }

    /**
     * Invoked when the user dismisses the modal via Escape or backdrop click.
     * Subclasses override to add cancel semantics; the default just tears down.
     *
     * @protected
     * @returns {void}
     */
    onDismiss() {
        this.destroy();
    }

    /**
     * Removes the overlay from the DOM and detaches the global keydown listener.
     *
     * @protected
     * @returns {void}
     */
    destroy() {
        if (this._keydownHandler) {
            document.removeEventListener('keydown', this._keydownHandler);
            this._keydownHandler = null;
        }
        if (this.overlay) {
            this.overlay.remove();
            this.overlay = null;
        }
        this.dialog = null;
    }
}
