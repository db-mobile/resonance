
import { app } from './appContext.js';
import { templateLoader } from './templateLoader.js';
import { BaseModal } from './ui/BaseModal.js';

const SHORTCUTS_TEMPLATE = './src/templates/shortcuts/keyboardShortcuts.html';

/** @returns {boolean} */
function isModalOpen() {
    return document.querySelector('.modal-overlay:not(.is-hidden):not([hidden])') !== null;
}

class ShortcutsHelpModal extends BaseModal {
    /**
     * @param {() => void} onClose
     */
    constructor(onClose) {
        super();
        this.onClose = onClose;
    }

    /** @returns {void} */
    destroy() {
        super.destroy();
        this.onClose();
    }
}

class KeyboardShortcutsManager {
    constructor() {
        this.shortcuts = new Map();
        this.isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
        this.modifierKey = this.isMac ? 'meta' : 'ctrl';
        this.modifierDisplayKey = this.isMac ? '⌘' : 'Ctrl';
        this.helpDialogVisible = false;
        this.categories = new Map();
    }

    /**
     * @param {string} key
     * @param {Object} options
     * @param {Function} options.handler
     * @param {string} options.description
     * @param {boolean} options.ctrl
     * @param {boolean} options.shift
     * @param {boolean} options.alt
     * @param {string} options.category
     * @param {boolean} options.preventDefault
     */
    register(key, options) {
        const {
            handler,
            description,
            ctrl = false,
            shift = false,
            alt = false,
            category = 'General',
            preventDefault = true
        } = options;

        const shortcutKey = this._createShortcutKey(key, ctrl, shift, alt);

        this.shortcuts.set(shortcutKey, {
            handler,
            description,
            displayKey: this._getDisplayKey(key, ctrl, shift, alt),
            category,
            preventDefault
        });

        if (!this.categories.has(category)) {
            this.categories.set(category, []);
        }
        this.categories.get(category).push(shortcutKey);
    }

    _createShortcutKey(key, ctrl, shift, alt) {
        const parts = [];
        if (ctrl) {parts.push('ctrl');}
        if (shift) {parts.push('shift');}
        if (alt) {parts.push('alt');}
        parts.push(key.toLowerCase());
        return parts.join('+');
    }

    _getDisplayKey(key, ctrl, shift, alt) {
        const parts = [];
        if (ctrl) {parts.push(this.modifierDisplayKey);}
        if (shift) {parts.push(this.isMac ? '⇧' : 'Shift');}
        if (alt) {parts.push(this.isMac ? '⌥' : 'Alt');}

        let displayKey = key;
        if (key.startsWith('Key')) {
            displayKey = key.substring(3);
        } else if (key.startsWith('Digit')) {
            displayKey = key.substring(5);
        } else if (key === 'Enter') {
            displayKey = this.isMac ? '↵' : 'Enter';
        } else if (key === 'Escape') {
            displayKey = this.isMac ? '⎋' : 'Esc';
        } else if (key === 'Slash') {
            displayKey = '/';
        } else if (key === 'Comma') {
            displayKey = ',';
        } else if (key === 'Backslash') {
            displayKey = '\\';
        }

        parts.push(displayKey);
        return parts.join(this.isMac ? '' : '+');
    }

    handleKeydown(event) {
        if (isModalOpen()) {
            return false;
        }

        const ctrl = this.isMac ? event.metaKey : event.ctrlKey;
        const shift = event.shiftKey;
        const alt = event.altKey;

        const targetTag = event.target.tagName.toLowerCase();
        const { isContentEditable } = event.target;
        const isCodeMirror = event.target.closest('.cm-editor') || event.target.closest('.CodeMirror');
        const isInputField = targetTag === 'input' ||
                           targetTag === 'textarea' ||
                           isContentEditable ||
                           isCodeMirror;

        const shortcutKey = this._createShortcutKey(event.code, ctrl, shift, alt);
        const shortcut = this.shortcuts.get(shortcutKey);

        if (shortcut) {
            const isInputSafeShortcut = ctrl ||
                                       shortcutKey.includes('enter') ||
                                       shortcutKey.includes('escape');

            if (!isInputField || isInputSafeShortcut) {
                if (shortcut.preventDefault) {
                    event.preventDefault();
                }
                shortcut.handler(event);
                return true;
            }
        }

        return false;
    }

    init() {
        document.addEventListener('keydown', (event) => {
            this.handleKeydown(event);
        });
    }

    showHelp() {
        if (this.helpDialogVisible) {return;}

        const modal = new ShortcutsHelpModal(() => {
            this.helpDialogVisible = false;
        });
        const dialog = modal.mount({
            overlayClass: 'keyboard-shortcuts-overlay modal-overlay--blur',
            dialogClass: 'modal-dialog modal-dialog--shortcuts',
            templatePath: SHORTCUTS_TEMPLATE,
            templateId: 'tpl-keyboard-shortcuts-dialog'
        });
        dialog.id = 'keyboard-shortcuts-dialog';
        this.helpDialogVisible = true;

        const contentEl = dialog.querySelector('[data-role="content"]');
        if (contentEl) {
            this._renderHelpContent(contentEl);
        }

        if (app.i18n) {
            app.i18n.updateUI(modal.overlay);
        }

        dialog.querySelector('#close-shortcuts-btn').addEventListener('click', () => modal.onDismiss());
    }

    _renderHelpContent(containerEl) {
        containerEl.innerHTML = '';

        for (const [category, shortcutKeys] of this.categories) {
            const categoryFragment = templateLoader.cloneSync(
                SHORTCUTS_TEMPLATE,
                'tpl-shortcuts-category'
            );
            const categoryEl = categoryFragment.firstElementChild;

            const titleEl = categoryEl.querySelector('[data-role="title"]');
            const listEl = categoryEl.querySelector('[data-role="list"]');

            if (titleEl) {
                titleEl.textContent = category;
                titleEl.setAttribute(
                    'data-i18n',
                    `shortcuts.category.${category.toLowerCase().replace(/\s+/g, '_')}`
                );
            }

            for (const key of shortcutKeys) {
                const shortcut = this.shortcuts.get(key);
                if (!shortcut) { continue; }
                const itemFragment = templateLoader.cloneSync(
                    SHORTCUTS_TEMPLATE,
                    'tpl-shortcut-item'
                );
                const itemEl = itemFragment.firstElementChild;

                const descEl = itemEl.querySelector('[data-role="description"]');
                const keysEl = itemEl.querySelector('[data-role="keys"]');
                if (descEl) {
                    descEl.textContent = shortcut.description;
                    descEl.setAttribute('data-i18n', `shortcuts.${key.replace(/\+/g, '_')}`);
                }
                if (keysEl) {
                    keysEl.textContent = shortcut.displayKey;
                }

                listEl.appendChild(itemEl);
            }

            containerEl.appendChild(categoryEl);
        }
    }

    /**
     * @param {string} key
     * @param {boolean} ctrl
     * @param {boolean} shift
     * @param {boolean} alt
     * @returns {string|null}
     */
    lookupDisplayKey(key, ctrl = false, shift = false, alt = false) {
        const shortcutKey = this._createShortcutKey(key, ctrl, shift, alt);
        const shortcut = this.shortcuts.get(shortcutKey);
        return shortcut ? shortcut.displayKey : null;
    }

}

export const keyboardShortcuts = new KeyboardShortcutsManager();
