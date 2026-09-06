/**
 * @fileoverview Base class for overlay-style modal dialogs.
 * @module ui/BaseModal
 */

import { templateLoader } from '../templateLoader.js';
import { pushEscapeHandler } from './modalEscape.js';

export class BaseModal {
    constructor() {
        /** @type {HTMLElement|null} */
        this.overlay = null;
        /** @type {HTMLElement|null} */
        this.dialog = null;
        /** @type {(() => void)|null} */
        this._releaseEscape = null;
    }

    /**
     * @param {Object} config
     * @param {string} config.overlayClass
     * @param {string} config.dialogClass
     * @param {string} config.templatePath
     * @param {string} config.templateId
     * @param {boolean} [config.closeOnEscape=true]
     * @param {boolean} [config.closeOnOverlayClick=true]
     * @returns {HTMLElement}
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
            this._releaseEscape = pushEscapeHandler(() => this.onDismiss());
        }

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
        if (this.overlay) {
            this.overlay.remove();
            this.overlay = null;
        }
        this.dialog = null;
    }
}
