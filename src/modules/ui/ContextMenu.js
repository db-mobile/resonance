/**
 * @fileoverview Right-click context menu component with dynamic positioning
 * @module ui/ContextMenu
 */

import { app } from '../appContext.js';
import { templateLoader } from '../templateLoader.js';
import { pushEscapeHandler } from './modalEscape.js';
import { restoreFocus } from './BaseModal.js';

export class ContextMenu {
    constructor() {
        this.currentMenu = null;
        this.clickHandler = null;
        this.contextMenuHandler = null;
        /** @type {(() => void)|null} */
        this.releaseEscape = null;
        /** @type {HTMLElement|null} */
        this.previousFocus = null;
    }

    /**
     * @param {MouseEvent} event
     * @param {Array<Object>} menuItems
     * @param {string} [menuItems[].translationKey]
     * @param {string} [menuItems[].icon]
     * @param {string} [menuItems[].className]
     * @param {Function} [menuItems[].onClick]
     * @returns {void}
     */
    show(event, menuItems) {
        this.hide();

        const menu = document.createElement('div');
        menu.className = 'context-menu';
        menu.setAttribute('role', 'menu');
        menu.style.position = 'fixed';
        menu.style.left = `${event.clientX}px`;
        menu.style.top = `${event.clientY}px`;
        menu.style.zIndex = '1000';

        menuItems.forEach(item => {
            const menuItem = this.createMenuItem(item);
            menu.appendChild(menuItem);
        });

        document.body.appendChild(menu);
        this.currentMenu = menu;

        if (app.i18n && app.i18n.updateUI) {
            app.i18n.updateUI(menu);
        }

        this.adjustPosition(menu, event);
        this.attachCloseHandlers();

        this.previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        menu.addEventListener('keydown', (e) => this.handleMenuKeydown(e));
        this.releaseEscape = pushEscapeHandler(() => this.hide());
        this.menuItems()[0]?.focus();
    }

    /** @returns {HTMLElement[]} */
    menuItems() {
        return this.currentMenu ? Array.from(this.currentMenu.querySelectorAll('[role="menuitem"]')) : [];
    }

    /**
     * @param {KeyboardEvent} e
     * @returns {void}
     */
    handleMenuKeydown(e) {
        const items = this.menuItems();
        if (items.length === 0) {
            return;
        }
        const index = items.indexOf(/** @type {HTMLElement} */ (document.activeElement));
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            const step = e.key === 'ArrowDown' ? 1 : -1;
            const start = index === -1 && step === -1 ? 0 : index;
            items[(start + step + items.length) % items.length].focus();
        } else if (e.key === 'Enter' && index !== -1) {
            e.preventDefault();
            e.stopPropagation();
            items[index].click();
        }
    }

    /**
     * @param {Object} item
     * @returns {HTMLDivElement}
     */
    createMenuItem(item) {
        const fragment = templateLoader.cloneSync(
            './src/templates/contextMenu/contextMenu.html',
            'tpl-context-menu-item'
        );
        const menuItem = fragment.firstElementChild;
        menuItem.className = `context-menu-item ${item.className || ''}`;
        menuItem.setAttribute('role', 'menuitem');
        menuItem.tabIndex = -1;

        const iconEl = menuItem.querySelector('[data-role="icon"]');
        const labelEl = menuItem.querySelector('[data-role="label"]');

        if (item.iconClass) {
            iconEl.classList.add(item.iconClass);
        } else {
            iconEl.remove();
        }

        if (item.translationKey) {
            labelEl.setAttribute('data-i18n', item.translationKey);
        }
        labelEl.textContent = item.label;

        if (item.onClick) {
            menuItem.addEventListener('click', (e) => {
                e.stopPropagation();
                this.hide();
                item.onClick();
            });
        }

        return menuItem;
    }

    /**
     * @param {HTMLElement} menu
     * @param {MouseEvent} event
     * @returns {void}
     */
    adjustPosition(menu, event) {
        const rect = menu.getBoundingClientRect();
        if (rect.right > window.innerWidth) {
            menu.style.left = `${event.clientX - rect.width}px`;
        }
        if (rect.bottom > window.innerHeight) {
            menu.style.top = `${event.clientY - rect.height}px`;
        }
    }

    /** @returns {void} */
    attachCloseHandlers() {
        this.removeCloseHandlers();

        this.clickHandler = () => this.hide();
        this.contextMenuHandler = (e) => {
            e.preventDefault();
            this.hide();
        };

        setTimeout(() => {
            document.addEventListener('click', this.clickHandler);
            document.addEventListener('contextmenu', this.contextMenuHandler);
        }, 0);
    }

    /** @returns {void} */
    removeCloseHandlers() {
        if (this.clickHandler) {
            document.removeEventListener('click', this.clickHandler);
            this.clickHandler = null;
        }
        if (this.contextMenuHandler) {
            document.removeEventListener('contextmenu', this.contextMenuHandler);
            this.contextMenuHandler = null;
        }
    }

    /** @returns {void} */
    hide() {
        if (this.releaseEscape) {
            this.releaseEscape();
            this.releaseEscape = null;
        }
        if (this.currentMenu) {
            const hadFocus = this.currentMenu.contains(document.activeElement);
            this.currentMenu.remove();
            this.currentMenu = null;
            if (hadFocus) {
                restoreFocus(this.previousFocus);
            }
        }
        this.previousFocus = null;
        this.removeCloseHandlers();
    }

    /** @returns {string} */
    static createRenameIcon() {
        return 'icon-pencil';
    }

    /** @returns {string} */
    static createDeleteIcon() {
        return 'icon-trash';
    }

    /** @returns {string} */
    static createVariableIcon() {
        return 'icon-variable';
    }

    /** @returns {string} */
    static createNewRequestIcon() {
        return 'icon-plus';
    }

    /** @returns {string} */
    static createExportIcon() {
        return 'icon-export';
    }

    /** @returns {string} */
    static createDocumentIcon() {
        return 'icon-document';
    }
}
