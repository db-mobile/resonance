/**
 * Context menu component for collections
 * Follows Single Responsibility Principle - only handles context menu UI
 */
export class ContextMenu {
    constructor() {
        this.currentMenu = null;
        this.clickHandler = null;
        this.contextMenuHandler = null;
    }

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

        // Trigger translation for the newly created elements
        if (window.i18n && window.i18n.updateUI) {
            window.i18n.updateUI();
        }

        this.adjustPosition(menu, event);
        this.attachCloseHandlers();
    }

    createMenuItem(item) {
        const menuItem = document.createElement('div');
        menuItem.className = `context-menu-item ${item.className || ''}`;
        
        if (item.icon) {
            menuItem.innerHTML = `
                <svg class="context-menu-icon" width="16" height="16" viewBox="0 0 24 24" fill="none">
                    ${item.icon}
                </svg>
                <span ${item.translationKey ? `data-i18n="${item.translationKey}"` : ''}>${item.label}</span>
            `;
        } else {
            if (item.translationKey) {
                menuItem.setAttribute('data-i18n', item.translationKey);
            }
            menuItem.textContent = item.label;
        }

        if (item.onClick) {
            menuItem.addEventListener('click', (e) => {
                e.stopPropagation();
                this.hide();
                item.onClick();
            });
        }

        return menuItem;
    }

    adjustPosition(menu, event) {
        const rect = menu.getBoundingClientRect();
        if (rect.right > window.innerWidth) {
            menu.style.left = `${event.clientX - rect.width}px`;
        }
        if (rect.bottom > window.innerHeight) {
            menu.style.top = `${event.clientY - rect.height}px`;
        }
    }

    attachCloseHandlers() {
        // Remove any existing handlers first
        this.removeCloseHandlers();

        // Create new handler references
        this.clickHandler = () => this.hide();
        this.contextMenuHandler = (e) => {
            e.preventDefault();
            this.hide();
        };

        // Add handlers with a small delay to avoid immediate triggering
        setTimeout(() => {
            document.addEventListener('click', this.clickHandler);
            document.addEventListener('contextmenu', this.contextMenuHandler);
        }, 0);
    }

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

    hide() {
        if (this.currentMenu) {
            this.currentMenu.remove();
            this.currentMenu = null;
        }
        // Clean up event listeners when hiding
        this.removeCloseHandlers();
    }

    static createRenameIcon() {
        return `
            <path d="M11 4H4C3.46957 4 2.96086 4.21071 2.58579 4.58579C2.21071 4.96086 2 5.46957 2 6V20C2 20.5304 2.21071 21.0391 2.58579 21.4142C2.96086 21.7893 3.46957 22 4 22H18C18.5304 22 19.0391 21.7893 19.4142 21.4142C19.7893 21.0391 20 20.5304 20 20V13" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M18.5 2.50023C18.8978 2.10243 19.4374 1.87891 20 1.87891C20.5626 1.87891 21.1022 2.10243 21.5 2.50023C21.8978 2.89804 22.1213 3.43762 22.1213 4.00023C22.1213 4.56284 21.8978 5.10243 21.5 5.50023L12 15.0002L8 16.0002L9 12.0002L18.5 2.50023Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        `;
    }

    static createDeleteIcon() {
        return `
            <path d="M3 6H5H21" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            <path d="M8 6V4C8 3.46957 8.21071 2.96086 8.58579 2.58579C8.96086 2.21071 9.46957 2 10 2H14C14.5304 2 15.0391 2.21071 15.4142 2.58579C15.7893 2.96086 16 3.46957 16 4V6M19 6V20C19 20.5304 18.7893 21.0391 18.4142 21.4142C18.0391 21.7893 17.5304 22 17 22H7C6.46957 22 5.96086 21.7893 5.58579 21.4142C5.21071 21.0391 5 20.5304 5 20V6H19Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        `;
    }

    static createVariableIcon() {
        return `
            <path d="M12 2L3.09 8.26L4 21L12 17L20 21L20.91 8.26L12 2Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M8 11L10 13L16 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        `;
    }

    static createNewRequestIcon() {
        return `
            <path d="M12 5V19" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            <path d="M5 12H19" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        `;
    }
}