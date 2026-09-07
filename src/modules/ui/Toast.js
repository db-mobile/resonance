/**
 * @fileoverview Toast notification system
 * @module ui/Toast
 */

class Toast {
    constructor() {
        this.container = null;
    }

    /** @returns {HTMLElement} */
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
     * @param {string} message
     * @param {'error'|'success'|'info'} [type='info']
     * @param {number} [duration=4000]
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
     * @param {string} message
     * @returns {void}
     */
    error(message) {
        this.show(message, 'error', 5000);
    }

    /**
     * @param {string} message
     * @returns {void}
     */
    success(message) {
        this.show(message, 'success', 3000);
    }

    /**
     * @param {string} message
     * @returns {void}
     */
    info(message) {
        this.show(message, 'info', 4000);
    }

    /**
     * @param {string} message
     * @returns {void}
     */
    warning(message) {
        this.show(message, 'warning', 6000);
    }
}

export const toast = new Toast();
