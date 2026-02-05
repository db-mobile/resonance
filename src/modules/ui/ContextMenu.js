/**
 * @fileoverview Right-click context menu component with dynamic positioning
 * @module ui/ContextMenu
 */

/**
 * Context menu component for right-click interactions
 *
 * @class
 * @classdesc Provides customizable context menus with icons, i18n support,
 * and automatic positioning to stay within viewport bounds. Handles click
 * outside to dismiss and provides static helper methods for common icons.
 */
import { templateLoader } from '../templateLoader.js';

export class ContextMenu {
    /**
     * Creates a ContextMenu instance
     */
    constructor() {
        this.currentMenu = null;
        this.clickHandler = null;
        this.contextMenuHandler = null;
    }

    /**
     * Shows context menu at event position
     *
     * Displays a context menu with provided items at the cursor position.
     * Automatically adjusts position to stay within viewport bounds.
     *
     * @param {MouseEvent} event - The context menu event
     * @param {Array<Object>} menuItems - Array of menu item configurations
     * @param {string} menuItems[].label - Item display text
     * @param {string} [menuItems[].translationKey] - i18n translation key
     * @param {string} [menuItems[].icon] - SVG icon markup
     * @param {string} [menuItems[].className] - Additional CSS class
     * @param {Function} [menuItems[].onClick] - Click handler function
     * @returns {void}
     */
    show(event, menuItems) {
        this.hide();

        const menu = document.createElement('div');
        menu.className = 'context-menu';
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

        if (window.i18n && window.i18n.updateUI) {
            window.i18n.updateUI();
        }

        this.adjustPosition(menu, event);
        this.attachCloseHandlers();
    }

    /**
     * Creates a menu item element
     *
     * Builds menu item with optional icon and i18n support. Attaches
     * click handler that dismisses menu after execution.
     *
     * @private
     * @param {Object} item - Menu item configuration
     * @returns {HTMLDivElement} Menu item element
     */
    createMenuItem(item) {
        const fragment = templateLoader.cloneSync(
            './src/templates/contextMenu/contextMenu.html',
            'tpl-context-menu-item'
        );
        const menuItem = fragment.firstElementChild;
        menuItem.className = `context-menu-item ${item.className || ''}`;

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
     * Adjusts menu position to stay within viewport
     *
     * Repositions menu if it would overflow viewport bounds, ensuring
     * the menu is always fully visible.
     *
     * @private
     * @param {HTMLElement} menu - Menu element
     * @param {MouseEvent} event - Original mouse event
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

    /**
     * Attaches document-level handlers to close menu
     *
     * Sets up click and context menu listeners to dismiss the menu.
     * Uses setTimeout to prevent immediate closure from same event.
     *
     * @private
     * @returns {void}
     */
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

    /**
     * Removes document-level close handlers
     *
     * @private
     * @returns {void}
     */
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

    /**
     * Hides and removes current menu
     *
     * Cleans up menu element and event listeners.
     *
     * @returns {void}
     */
    hide() {
        if (this.currentMenu) {
            this.currentMenu.remove();
            this.currentMenu = null;
        }
        this.removeCloseHandlers();
    }

    /**
     * Creates SVG icon for rename action
     *
     * @static
     * @returns {string} SVG markup for rename icon
     */
    static createRenameIcon() {
        return 'icon-pencil';
    }

    /**
     * Creates SVG icon for delete action
     *
     * @static
     * @returns {string} SVG markup for delete icon
     */
    static createDeleteIcon() {
        return 'icon-trash';
    }

    /**
     * Creates SVG icon for variable/settings action
     *
     * @static
     * @returns {string} SVG markup for variable icon
     */
    static createVariableIcon() {
        return 'icon-variable';
    }

    /**
     * Creates SVG icon for new request/add action
     *
     * @static
     * @returns {string} SVG markup for new request icon
     */
    static createNewRequestIcon() {
        return 'icon-plus';
    }

    /**
     * Creates SVG icon for export action
     *
     * @static
     * @returns {string} SVG markup for export icon
     */
    static createExportIcon() {
        return 'icon-export';
    }

    /**
     * Creates script/code icon SVG markup
     * @static
     * @returns {string} SVG path markup
     */
    static createScriptIcon() {
        return 'icon-script';
    }
}
