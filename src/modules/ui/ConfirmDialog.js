export class ConfirmDialog {
    constructor() {
        this.overlay = null;
        this.onConfirm = null;
        this.onCancel = null;
    }

    show(message, options = {}) {
        return new Promise((resolve) => {
            this.onConfirm = () => resolve(true);
            this.onCancel = () => resolve(false);

            this.createDialog(message, options);
        });
    }

    createDialog(message, options) {
        this.overlay = document.createElement('div');
        this.overlay.className = 'confirm-dialog-overlay';
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
        dialog.className = 'confirm-dialog';
        dialog.style.cssText = `
            background: var(--bg-primary);
            border-radius: 8px;
            padding: 24px;
            min-width: 400px;
            max-width: 500px;
            box-shadow: var(--shadow-xl);
            border: 1px solid var(--border-light);
        `;

        const title = options.title || 'Confirm Action';
        const confirmText = options.confirmText || 'Confirm';
        const cancelText = options.cancelText || 'Cancel';
        const isDangerous = options.dangerous !== false; // Default to true for delete confirmations

        dialog.innerHTML = `
            <h3 style="margin: 0 0 16px 0; color: var(--text-primary);">${this.escapeHtml(title)}</h3>
            <div style="margin-bottom: 24px;">
                <p style="margin: 0; color: var(--text-primary); white-space: pre-wrap; line-height: 1.5;">${this.escapeHtml(message)}</p>
            </div>
            <div style="display: flex; gap: 8px; justify-content: flex-end;">
                <button id="confirm-cancel-btn" style="padding: 8px 16px; border: 1px solid var(--border-light); background: transparent; color: var(--text-primary); border-radius: 4px; cursor: pointer;">${this.escapeHtml(cancelText)}</button>
                <button id="confirm-confirm-btn" style="padding: 8px 16px; border: none; background: ${isDangerous ? '#dc2626' : 'var(--color-primary)'}; color: white; border-radius: 4px; cursor: pointer;">${this.escapeHtml(confirmText)}</button>
            </div>
        `;

        this.overlay.appendChild(dialog);
        document.body.appendChild(this.overlay);

        this.setupEventListeners(dialog);
        this.focusCancelButton(dialog);
    }

    setupEventListeners(dialog) {
        const cancelBtn = dialog.querySelector('#confirm-cancel-btn');
        const confirmBtn = dialog.querySelector('#confirm-confirm-btn');

        cancelBtn.addEventListener('click', () => this.cancel());
        confirmBtn.addEventListener('click', () => this.confirm());

        // Keyboard navigation
        const handleKeyDown = (e) => {
            if (e.key === 'Enter') {
                this.confirm();
            } else if (e.key === 'Escape') {
                this.cancel();
            } else if (e.key === 'Tab') {
                // Allow tab navigation between buttons
                e.preventDefault();
                if (document.activeElement === cancelBtn) {
                    confirmBtn.focus();
                } else {
                    cancelBtn.focus();
                }
            }
        };

        cancelBtn.addEventListener('keydown', handleKeyDown);
        confirmBtn.addEventListener('keydown', handleKeyDown);

        // Click overlay to cancel
        this.overlay.addEventListener('click', (e) => {
            if (e.target === this.overlay) {
                this.cancel();
            }
        });
    }

    focusCancelButton(dialog) {
        // Focus cancel button by default for safety (prevents accidental deletions)
        const cancelBtn = dialog.querySelector('#confirm-cancel-btn');
        cancelBtn.focus();
    }

    confirm() {
        if (this.onConfirm) {
            this.onConfirm();
        }
        this.cleanup();
    }

    cancel() {
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

        // Restore focus to the main window
        // Focus the collections list to ensure focus returns to the app
        const collectionsList = document.getElementById('collections-list');
        if (collectionsList) {
            collectionsList.focus();
        }
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}
