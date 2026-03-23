/**
 * @fileoverview Toast notification system
 * @module ui/Toast
 */

/**
 * Lightweight toast notification manager
 *
 * @class
 * @classdesc Displays non-blocking notifications that auto-dismiss.
 * Supports error, success, and info variants. Toasts stack from the
 * bottom-right corner and can be manually dismissed.
 */
class Toast {
    constructor() {
        this.container = null;
    }

    /**
     * Lazily creates and inserts the toast container into the DOM
     *
     * @private
     * @returns {HTMLElement}
     */
    getContainer() {
        if (!this.container) {
            this.container = document.createElement('div');
            this.container.className = 'toast-container';
            this.container.setAttribute('aria-live', 'polite');
            this.container.setAttribute('aria-atomic', 'false');
            document.body.appendChild(this.container);
        }
        return this.container;
    }

    /**
     * Shows a toast notification
     *
     * @param {string} message - The message to display
     * @param {'error'|'success'|'info'} [type='info'] - Notification type
     * @param {number} [duration=4000] - Auto-dismiss delay in ms
     * @returns {void}
     */
    show(message, type = 'info', duration = 4000) {
        const container = this.getContainer();

        const toast = document.createElement('div');
        toast.className = `toast toast--${type}`;
        toast.setAttribute('role', type === 'error' ? 'alert' : 'status');

        const messageEl = document.createElement('span');
        messageEl.className = 'toast__message';
        messageEl.textContent = message;

        const closeBtn = document.createElement('button');
        closeBtn.className = 'toast__close';
        closeBtn.setAttribute('aria-label', 'Dismiss');
        closeBtn.innerHTML = '<span class="icon icon-x icon-14"></span>';

        toast.appendChild(messageEl);
        toast.appendChild(closeBtn);
        container.appendChild(toast);

        // Trigger enter animation on next frame
        requestAnimationFrame(() => toast.classList.add('toast--visible'));

        const dismiss = () => {
            toast.classList.remove('toast--visible');
            toast.addEventListener('transitionend', () => toast.remove(), { once: true });
        };

        closeBtn.addEventListener('click', dismiss);

        if (duration > 0) {
            setTimeout(dismiss, duration);
        }
    }

    /**
     * Shows an error toast
     *
     * @param {string} message
     * @returns {void}
     */
    error(message) {
        this.show(message, 'error', 5000);
    }

    /**
     * Shows a success toast
     *
     * @param {string} message
     * @returns {void}
     */
    success(message) {
        this.show(message, 'success', 3000);
    }

    /**
     * Shows an info toast
     *
     * @param {string} message
     * @returns {void}
     */
    info(message) {
        this.show(message, 'info', 4000);
    }
}

export const toast = new Toast();
