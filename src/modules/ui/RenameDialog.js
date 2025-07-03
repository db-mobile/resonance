/**
 * Rename dialog component
 * Follows Single Responsibility Principle - only handles rename dialog UI
 */
export class RenameDialog {
    constructor() {
        this.overlay = null;
        this.onConfirm = null;
        this.onCancel = null;
    }

    show(currentName, options = {}) {
        return new Promise((resolve, reject) => {
            this.onConfirm = resolve;
            this.onCancel = () => resolve(null);
            
            this.createDialog(currentName, options);
        });
    }

    createDialog(currentName, options) {
        this.overlay = document.createElement('div');
        this.overlay.className = 'rename-dialog-overlay';
        this.overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.5);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10000;
        `;

        const dialog = document.createElement('div');
        dialog.className = 'rename-dialog';
        dialog.style.cssText = `
            background: var(--bg-primary);
            border-radius: 8px;
            padding: 24px;
            min-width: 400px;
            box-shadow: var(--shadow-xl);
            border: 1px solid var(--border-light);
        `;

        const title = options.title || 'Rename Collection';
        const label = options.label || 'Collection Name:';
        const confirmText = options.confirmText || 'Rename';

        dialog.innerHTML = `
            <h3 style="margin: 0 0 16px 0; color: var(--text-primary);">${title}</h3>
            <div style="margin-bottom: 16px;">
                <label for="rename-input" style="display: block; margin-bottom: 8px; color: var(--text-primary); font-weight: 500;">${label}</label>
                <input type="text" id="rename-input" value="${this.escapeHtml(currentName)}" 
                       style="width: 100%; padding: 8px 12px; border: 1px solid var(--border-light); border-radius: 4px; font-size: 14px; box-sizing: border-box; background: var(--bg-secondary); color: var(--text-primary);">
            </div>
            <div style="display: flex; gap: 8px; justify-content: flex-end;">
                <button id="rename-cancel-btn" style="padding: 8px 16px; border: 1px solid var(--border-light); background: transparent; color: var(--text-primary); border-radius: 4px; cursor: pointer;">Cancel</button>
                <button id="rename-confirm-btn" style="padding: 8px 16px; border: none; background: var(--color-primary); color: white; border-radius: 4px; cursor: pointer;">${confirmText}</button>
            </div>
        `;

        this.overlay.appendChild(dialog);
        document.body.appendChild(this.overlay);

        this.setupEventListeners(dialog);
        this.focusInput(dialog);
    }

    setupEventListeners(dialog) {
        const nameInput = dialog.querySelector('#rename-input');
        const cancelBtn = dialog.querySelector('#rename-cancel-btn');
        const confirmBtn = dialog.querySelector('#rename-confirm-btn');

        cancelBtn.addEventListener('click', () => this.close());
        
        confirmBtn.addEventListener('click', () => this.confirm(nameInput.value));

        nameInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                this.confirm(nameInput.value);
            } else if (e.key === 'Escape') {
                this.close();
            }
        });

        this.overlay.addEventListener('click', (e) => {
            if (e.target === this.overlay) {
                this.close();
            }
        });
    }

    focusInput(dialog) {
        const nameInput = dialog.querySelector('#rename-input');
        nameInput.focus();
        nameInput.select();
    }

    confirm(newName) {
        const trimmedName = newName.trim();
        if (trimmedName) {
            if (this.onConfirm) {
                this.onConfirm(trimmedName);
            }
        } else {
            // Could show validation error here
            return;
        }
        this.cleanup();
    }

    close() {
        if (this.onCancel) {
            this.onCancel();
        }
        this.cleanup();
    }

    cleanup() {
        if (this.overlay) {
            this.overlay.remove();
            this.overlay = null;
        }
        this.onConfirm = null;
        this.onCancel = null;
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}