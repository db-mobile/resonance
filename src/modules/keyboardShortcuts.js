/**
 * KeyboardShortcutsManager
 *
 * Manages keyboard shortcuts for the application.
 * Provides platform-aware shortcuts (Cmd on macOS, Ctrl on Windows/Linux)
 * and a help dialog to display available shortcuts.
 */

import { templateLoader } from './templateLoader.js';

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
     * Register a keyboard shortcut
     * @param {string} key - The key combination (e.g., 'Enter', 'KeyS')
     * @param {Object} options - Options object
     * @param {Function} options.handler - The function to execute
     * @param {string} options.description - Description for help dialog
     * @param {boolean} options.ctrl - Require Ctrl/Cmd key
     * @param {boolean} options.shift - Require Shift key
     * @param {boolean} options.alt - Require Alt key
     * @param {string} options.category - Category for grouping in help dialog
     * @param {boolean} options.preventDefault - Whether to prevent default behavior (default: true)
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

        // Track categories
        if (!this.categories.has(category)) {
            this.categories.set(category, []);
        }
        this.categories.get(category).push(shortcutKey);
    }

    /**
     * Create a unique key for the shortcut
     */
    _createShortcutKey(key, ctrl, shift, alt) {
        const parts = [];
        if (ctrl) {parts.push('ctrl');}
        if (shift) {parts.push('shift');}
        if (alt) {parts.push('alt');}
        parts.push(key.toLowerCase());
        return parts.join('+');
    }

    /**
     * Get display string for the shortcut
     */
    _getDisplayKey(key, ctrl, shift, alt) {
        const parts = [];
        if (ctrl) {parts.push(this.modifierDisplayKey);}
        if (shift) {parts.push(this.isMac ? '⇧' : 'Shift');}
        if (alt) {parts.push(this.isMac ? '⌥' : 'Alt');}

        // Format key for display
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
        }

        parts.push(displayKey);
        return parts.join(this.isMac ? '' : '+');
    }

    /**
     * Handle keyboard events
     */
    handleKeydown(event) {
        const ctrl = this.isMac ? event.metaKey : event.ctrlKey;
        const shift = event.shiftKey;
        const alt = event.altKey;

        // Don't trigger shortcuts if user is typing in an input/textarea/contenteditable
        // or CodeMirror editor, unless it's a specific input-safe shortcut
        const targetTag = event.target.tagName.toLowerCase();
        const { isContentEditable } = event.target;
        const isCodeMirror = event.target.closest('.CodeMirror');
        const isInputField = targetTag === 'input' ||
                           targetTag === 'textarea' ||
                           isContentEditable ||
                           isCodeMirror;

        const shortcutKey = this._createShortcutKey(event.code, ctrl, shift, alt);
        const shortcut = this.shortcuts.get(shortcutKey);

        if (shortcut) {
            // Some shortcuts work in input fields (like Ctrl+Enter to send, Ctrl+S to save, Escape to cancel)
            // Only allow shortcuts that use Ctrl/Cmd modifier or Enter/Escape keys when in input fields
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

    /**
     * Initialize the keyboard shortcuts manager
     */
    init() {
        document.addEventListener('keydown', (event) => {
            this.handleKeydown(event);
        });
    }

    /**
     * Create and show the help dialog
     */
    showHelp() {
        if (this.helpDialogVisible) {return;}

        const fragment = templateLoader.cloneSync(
            './src/templates/shortcuts/keyboardShortcuts.html',
            'tpl-keyboard-shortcuts-overlay'
        );
        const overlay = fragment.firstElementChild;

        const contentEl = overlay.querySelector('[data-role="content"]');
        if (contentEl) {
            this._renderHelpContent(contentEl);
        }

        document.body.appendChild(overlay);
        this.helpDialogVisible = true;

        // Apply i18n if available
        if (window.i18n) {
            window.i18n.updateUI(overlay);
        }

        const closeBtn = overlay.querySelector('#close-shortcuts-btn');
        const _dialog = overlay.querySelector('#keyboard-shortcuts-dialog');

        const close = () => {
            overlay.remove();
            this.helpDialogVisible = false;
        };

        closeBtn.addEventListener('click', close);
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {close();}
        });

        // Close on Escape
        const escHandler = (e) => {
            if (e.key === 'Escape') {
                close();
                document.removeEventListener('keydown', escHandler);
            }
        };
        document.addEventListener('keydown', escHandler);
    }

    /**
     * Generate HTML content for help dialog
     */
    _renderHelpContent(containerEl) {
        containerEl.innerHTML = '';

        for (const [category, shortcutKeys] of this.categories) {
            const categoryFragment = templateLoader.cloneSync(
                './src/templates/shortcuts/keyboardShortcuts.html',
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
                const itemFragment = templateLoader.cloneSync(
                    './src/templates/shortcuts/keyboardShortcuts.html',
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
     * Get registered shortcuts (for debugging)
     */
    getShortcuts() {
        return Array.from(this.shortcuts.entries()).map(([key, value]) => ({
            key,
            ...value
        }));
    }
}

export const keyboardShortcuts = new KeyboardShortcutsManager();
