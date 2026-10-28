import { BaseModal } from './BaseModal.js';

/** Shared lifecycle for the rename and tag-entry dialogs. */
export class TextInputDialog extends BaseModal {
    /** @param {{prefix: string, templatePath: string, templateId: string, defaults: Object, parseValue: Function}} config */
    constructor(config) {
        super();
        this.config = config;
        this.resolve = null;
    }

    /** @returns {Promise<*>} */
    show(text, options = {}) {
        return new Promise((resolve) => {
            this.resolve = resolve;
            const { prefix, templatePath, templateId, defaults } = this.config;
            const dialog = this.mount({
                overlayClass: `${prefix}-dialog-overlay`,
                dialogClass: `${prefix}-dialog modal-dialog modal-dialog--sm`,
                templatePath,
                templateId
            });

            for (const [role, option] of [['title', 'title'], ['label', 'label'], ['confirm', 'confirmText']]) {
                const element = dialog.querySelector(`[data-role="${role}"]`);
                if (element) {element.textContent = options[option] || defaults[option];}
            }

            const input = dialog.querySelector(`#${prefix}-input`);
            input.value = text;
            dialog.querySelector(`#${prefix}-cancel-btn`).addEventListener('click', () => this.onDismiss());
            dialog.querySelector(`#${prefix}-close-btn`)?.addEventListener('click', () => this.onDismiss());
            dialog.querySelector(`#${prefix}-confirm-btn`).addEventListener('click', () => this.confirm(input.value));
            input.addEventListener('keydown', (event) => {
                if (event.key === 'Enter') {this.confirm(input.value);}
            });
            input.focus();
            input.select();
        });
    }

    confirm(text) {
        const value = this.config.parseValue(text);
        if (value !== undefined) {this._settle(value);}
    }

    onDismiss() {
        this._settle(null);
    }

    _settle(value) {
        this.resolve?.(value);
        this.resolve = null;
        this.destroy();
    }
}
