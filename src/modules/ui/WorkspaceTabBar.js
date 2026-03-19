/**
 * @fileoverview Tab bar UI component for workspace tab management
 * @module ui/WorkspaceTabBar
 */

import { templateLoader } from '../templateLoader.js';

/**
 * WorkspaceTabBar
 *
 * @class
 * @classdesc UI component for the workspace tab bar. Handles rendering and interaction
 * with workspace tabs including switching, closing, creating, renaming, and duplicating.
 * Displays tab names with modified indicators and provides context menus.
 */
export class WorkspaceTabBar {
    constructor(containerId) {
        this.containerId = containerId;
        this.container = null;
        this.onTabSwitch = null;
        this.onTabClose = null;
        this.onTabCreate = null;
        this.onTabRename = null;
        this.onTabDuplicate = null;
        this.onTabReorder = null;
        this.dragPreview = null;
    }

    /**
     * Initialize and render the tab bar
     * @param {Array} tabs
     * @param {string} activeTabId
     */
    render(tabs, activeTabId) {
        this.container = document.getElementById(this.containerId);
        if (!this.container) {
            return;
        }

        // Store current tabs and activeTabId for dropdown
        this.tabs = tabs;
        this.activeTabId = activeTabId;

        this.container.innerHTML = '';

        // Create left scroll button
        const leftScrollBtn = this._createScrollButton('left');

        // Create wrapper with tab bar
        const tabBar = document.createElement('div');
        tabBar.className = 'workspace-tab-bar u-flex u-flex-1';
        this.tabBar = tabBar;

        // Create tabs container
        const tabsContainer = document.createElement('div');
        tabsContainer.className = 'workspace-tabs-container u-flex';

        // Render individual tabs
        tabs.forEach(tab => {
            const tabElement = this._createTabElement(tab, tab.id === activeTabId);
            tabsContainer.appendChild(tabElement);
        });

        // Create new tab button
        const newTabBtn = this._createNewTabButton();
        tabsContainer.appendChild(newTabBtn);

        tabBar.appendChild(tabsContainer);

        // Create right scroll button
        const rightScrollBtn = this._createScrollButton('right');

        // Create tab list dropdown button
        const tabListButton = this._createTabListButton();

        this.container.appendChild(leftScrollBtn);
        this.container.appendChild(tabBar);
        this.container.appendChild(rightScrollBtn);
        this.container.appendChild(tabListButton);

        // Store references for scroll management
        this.leftScrollBtn = leftScrollBtn;
        this.rightScrollBtn = rightScrollBtn;

        // Update scroll button visibility
        this._updateScrollButtons();

        // Listen for scroll events
        tabBar.addEventListener('scroll', () => this._updateScrollButtons());

        // Listen for window resize
        if (!this.resizeObserver) {
            this.resizeObserver = new ResizeObserver(() => this._updateScrollButtons());
            this.resizeObserver.observe(tabBar);
        }
    }

    /**
     * Create a tab element
     * @private
     */
    _createTabElement(tab, isActive) {
        const tabEl = document.createElement('div');
        tabEl.className = `workspace-tab u-flex u-items-center${isActive ? ' active' : ''}${tab.isModified ? ' modified' : ''}`;
        tabEl.dataset.tabId = tab.id;

        // Tab name
        const nameEl = document.createElement('span');
        nameEl.className = 'workspace-tab-name';
        nameEl.textContent = tab.name;
        nameEl.title = tab.name;

        // Modified indicator (dot)
        if (tab.isModified) {
            const modifiedIndicator = document.createElement('span');
            modifiedIndicator.className = 'workspace-tab-modified-indicator';
            modifiedIndicator.setAttribute('aria-label', 'Modified');
            tabEl.appendChild(modifiedIndicator);
        }

        tabEl.appendChild(nameEl);

        // Close button
        const closeBtn = document.createElement('button');
        closeBtn.className = 'workspace-tab-close';
        closeBtn.setAttribute('aria-label', 'Close tab');
        closeBtn.title = 'Close tab';
        {
            const iconEl = document.createElement('span');
            iconEl.className = 'icon icon-12 icon-x';
            closeBtn.appendChild(iconEl);
        }

        closeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (this.onTabClose) {
                this.onTabClose(tab.id);
            }
        });

        tabEl.appendChild(closeBtn);

        // Tab click to switch
        tabEl.addEventListener('click', () => {
            if (this.onTabSwitch) {
                this.onTabSwitch(tab.id);
            }
        });

        // Middle mouse button to close tab
        tabEl.addEventListener('mousedown', (e) => {
            if (e.button === 1) { // Middle mouse button
                e.preventDefault();
                if (this.onTabClose) {
                    this.onTabClose(tab.id);
                }
            }
        });

        // Double-click to rename
        nameEl.addEventListener('dblclick', (e) => {
            e.stopPropagation();
            this._startRenaming(tabEl, tab);
        });

        // Context menu
        tabEl.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            this._showContextMenu(e, tab);
        });


        // Drag and drop for reordering
        tabEl.draggable = true;

        tabEl.addEventListener('dragstart', (e) => {
            tabEl.classList.add('is-dragging');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', tab.id);
            this._setDragPreview(e, tab);
        });

        tabEl.addEventListener('dragend', () => {
            tabEl.classList.remove('is-dragging');
            this._removeDragPreview();
        });

        tabEl.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            const dragging = tabEl.closest('.workspace-tabs-container')?.querySelector('.is-dragging');
            if (dragging && dragging !== tabEl) {
                const rect = tabEl.getBoundingClientRect();
                const midX = rect.left + rect.width / 2;
                if (e.clientX < midX) {
                    tabEl.parentNode.insertBefore(dragging, tabEl);
                } else {
                    tabEl.parentNode.insertBefore(dragging, tabEl.nextSibling);
                }
            }
        });

        tabEl.addEventListener('drop', (e) => {
            e.preventDefault();
            const container = tabEl.closest('.workspace-tabs-container');
            if (container) {
                const tabEls = container.querySelectorAll('.workspace-tab');
                const newOrder = Array.from(tabEls).map(el => el.dataset.tabId);

                if (this.tabs) {
                    const tabMap = new Map(this.tabs.map(t => [t.id, t]));
                    this.tabs = newOrder.map(id => tabMap.get(id)).filter(Boolean);
                }

                if (this.onTabReorder) {
                    this.onTabReorder(newOrder);
                }
            }
        });

        return tabEl;
    }

    /**
     * Create and register a compact drag preview for the browser drag image.
     * @private
     */
    _setDragPreview(event, tab) {
        this._removeDragPreview();

        const preview = document.createElement('div');
        preview.className = `workspace-tab-drag-preview${tab.isModified ? ' modified' : ''}`;

        if (tab.isModified) {
            const indicator = document.createElement('span');
            indicator.className = 'workspace-tab-modified-indicator';
            preview.appendChild(indicator);
        }

        const name = document.createElement('span');
        name.className = 'workspace-tab-drag-preview-name';
        name.textContent = tab.name;
        preview.appendChild(name);

        document.body.appendChild(preview);

        event.dataTransfer.setDragImage(preview, 18, 14);
        this.dragPreview = preview;
    }

    /**
     * Remove any previous drag preview element.
     * @private
     */
    _removeDragPreview() {
        if (this.dragPreview) {
            this.dragPreview.remove();
            this.dragPreview = null;
        }
    }

    /**
     * Create scroll button
     * @private
     */
    _createScrollButton(direction) {
        const btn = document.createElement('button');
        btn.className = `workspace-tab-scroll-button ${direction}`;
        btn.setAttribute('aria-label', `Scroll ${direction}`);

        if (direction === 'left') {
            const iconEl = document.createElement('span');
            iconEl.className = 'icon icon-12 icon-chevron-left';
            btn.appendChild(iconEl);
            btn.addEventListener('click', () => this._scrollTabs(-200));
        } else {
            const iconEl = document.createElement('span');
            iconEl.className = 'icon icon-12 icon-chevron-right';
            btn.appendChild(iconEl);
            btn.addEventListener('click', () => this._scrollTabs(200));
        }

        return btn;
    }

    /**
     * Scroll the tab bar
     * @private
     */
    _scrollTabs(delta) {
        if (this.tabBar) {
            this.tabBar.scrollLeft += delta;
        }
    }

    /**
     * Update scroll button visibility and state
     * @private
     */
    _updateScrollButtons() {
        if (!this.tabBar || !this.leftScrollBtn || !this.rightScrollBtn) {return;}

        const { scrollLeft, scrollWidth, clientWidth } = this.tabBar;
        const hasOverflow = scrollWidth > clientWidth;

        // Show/hide buttons based on overflow
        if (hasOverflow) {
            this.leftScrollBtn.classList.add('visible');
            this.rightScrollBtn.classList.add('visible');
        } else {
            this.leftScrollBtn.classList.remove('visible');
            this.rightScrollBtn.classList.remove('visible');
        }

        // Disable left button at start
        if (scrollLeft <= 0) {
            this.leftScrollBtn.disabled = true;
        } else {
            this.leftScrollBtn.disabled = false;
        }

        // Disable right button at end
        if (scrollLeft + clientWidth >= scrollWidth - 1) {
            this.rightScrollBtn.disabled = true;
        } else {
            this.rightScrollBtn.disabled = false;
        }
    }

    /**
     * Create new tab button
     * @private
     */
    _createNewTabButton() {
        const btn = document.createElement('button');
        btn.className = 'workspace-tab-new u-flex u-items-center u-justify-center';
        btn.setAttribute('aria-label', 'New tab');
        btn.title = 'New tab';
        {
            const iconEl = document.createElement('span');
            iconEl.className = 'icon icon-14 icon-plus';
            btn.appendChild(iconEl);
        }

        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            this._showNewTabMenu(btn);
        });

        return btn;
    }

    /**
     * Show protocol selection menu for new tab
     * @private
     */
    _showNewTabMenu(button) {
        // Remove any existing dropdown
        const existingDropdown = document.querySelector('.workspace-tab-new-menu');
        if (existingDropdown) {
            existingDropdown.remove();
            return;
        }

        const menu = document.createElement('div');
        menu.className = 'workspace-tab-new-menu dropdown-panel visible';

        const rect = button.getBoundingClientRect();
        menu.style.position = 'fixed';
        menu.style.top = `${rect.bottom + 4}px`;
        menu.style.left = `${rect.left}px`;
        menu.style.minWidth = '160px';
        menu.style.zIndex = '1000';

        const protocols = [
            { label: 'HTTP', protocol: 'http' },
            { label: 'WebSocket', protocol: 'websocket' },
            { label: 'gRPC', protocol: 'grpc' }
        ];

        protocols.forEach(({ label, protocol }) => {
            const item = document.createElement('div');
            item.className = 'dropdown-item';

            const labelEl = document.createElement('span');
            labelEl.className = 'dropdown-item-label';
            labelEl.textContent = label;
            item.appendChild(labelEl);

            item.addEventListener('click', () => {
                menu.remove();
                if (this.onTabCreate) {
                    this.onTabCreate(protocol);
                }
            });

            menu.appendChild(item);
        });

        document.body.appendChild(menu);

        const closeMenu = (e) => {
            if (!menu.contains(e.target) && !button.contains(e.target)) {
                menu.remove();
                document.removeEventListener('click', closeMenu);
            }
        };
        setTimeout(() => document.addEventListener('click', closeMenu), 0);
    }

    /**
     * Create tab list dropdown button
     * @private
     */
    _createTabListButton() {
        const btn = document.createElement('button');
        btn.className = 'workspace-tab-list-button u-flex u-items-center u-justify-center';
        btn.setAttribute('aria-label', 'All tabs');
        btn.title = 'All tabs';
        {
            const iconEl = document.createElement('span');
            iconEl.className = 'icon icon-14 icon-menu';
            btn.appendChild(iconEl);
        }

        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            this._toggleTabListDropdown(btn);
        });

        return btn;
    }

    /**
     * Toggle tab list dropdown
     * @private
     */
    _toggleTabListDropdown(button) {
        // Remove any existing dropdown
        const existingDropdown = document.querySelector('.workspace-tab-list-dropdown');
        if (existingDropdown) {
            existingDropdown.remove();
            return;
        }

        // Create dropdown
        const dropdown = document.createElement('div');
        dropdown.className = 'workspace-tab-list-dropdown dropdown-panel visible';

        // Position dropdown below button
        const rect = button.getBoundingClientRect();
        dropdown.style.top = `${rect.bottom + 4}px`;
        dropdown.style.right = '8px';

        // Add tab items using current tabs
        this.tabs.forEach(tab => {
            const item = document.createElement('div');
            item.className = `workspace-tab-list-item dropdown-item${tab.id === this.activeTabId ? ' active is-active' : ''}`;

            // Add modified indicator if needed
            if (tab.isModified) {
                const indicator = document.createElement('span');
                indicator.className = 'workspace-tab-list-item-indicator';
                item.appendChild(indicator);
            }

            // Add tab name
            const name = document.createElement('span');
            name.className = 'workspace-tab-list-item-name dropdown-item-label';
            name.textContent = tab.name;
            item.appendChild(name);

            // Click handler
            item.addEventListener('click', () => {
                if (this.onTabSwitch) {
                    this.onTabSwitch(tab.id);
                }
                dropdown.remove();
            });

            dropdown.appendChild(item);
        });

        document.body.appendChild(dropdown);

        // Close dropdown on outside click
        const closeDropdown = (e) => {
            if (!dropdown.contains(e.target) && !button.contains(e.target)) {
                dropdown.remove();
                document.removeEventListener('click', closeDropdown);
            }
        };
        setTimeout(() => document.addEventListener('click', closeDropdown), 0);
    }

    /**
     * Start renaming a tab
     * @private
     */
    _startRenaming(tabElement, tab) {
        // Close any open dropdown
        const existingDropdown = document.querySelector('.workspace-tab-list-dropdown');
        if (existingDropdown) {
            existingDropdown.remove();
        }

        const nameEl = tabElement.querySelector('.workspace-tab-name');
        const currentName = nameEl.textContent;

        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'workspace-tab-rename-input';
        input.value = currentName;

        const finishRenaming = () => {
            const newName = input.value.trim() || currentName;
            nameEl.textContent = newName;
            nameEl.title = newName;
            input.replaceWith(nameEl);

            if (newName !== currentName && this.onTabRename) {
                this.onTabRename(tab.id, newName);
            }
        };

        input.addEventListener('blur', finishRenaming);
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                finishRenaming();
            } else if (e.key === 'Escape') {
                nameEl.textContent = currentName;
                input.replaceWith(nameEl);
            }
        });

        nameEl.replaceWith(input);
        input.focus();
        input.select();
    }

    /**
     * Show context menu for tab
     * @private
     */
    _showContextMenu(event, tab) {
        // Remove any existing context menus
        const existingMenu = document.querySelector('.workspace-tab-context-menu');
        if (existingMenu) {
            existingMenu.remove();
        }

        const menu = document.createElement('div');
        menu.className = 'workspace-tab-context-menu dropdown-panel';
        menu.style.left = `${event.pageX}px`;
        menu.style.top = `${event.pageY}px`;

        const createMenuItemEl = (label, iconClass, disabled) => {
            const fragment = templateLoader.cloneSync(
                './src/templates/workspaceTabs/workspaceTabBar.html',
                'tpl-workspace-tab-context-menu-item'
            );
            const el = fragment.firstElementChild;

            const iconEl = el.querySelector('[data-role="icon"]');
            const labelEl = el.querySelector('[data-role="label"]');

            if (iconEl) {iconEl.classList.add(iconClass);}
            if (labelEl) {labelEl.textContent = label;}
            if (disabled) {el.classList.add('disabled');}

            return el;
        };

        const createDividerEl = () => {
            const fragment = templateLoader.cloneSync(
                './src/templates/workspaceTabs/workspaceTabBar.html',
                'tpl-workspace-tab-context-menu-divider'
            );
            return fragment.firstElementChild;
        };

        const menuItems = [
            {
                label: 'Rename',
                iconClass: 'icon-pencil',
                action: () => {
                    const tabEl = document.querySelector(`[data-tab-id="${tab.id}"]`);
                    if (tabEl) {
                        this._startRenaming(tabEl, tab);
                    }
                }
            },
            {
                label: 'Duplicate',
                iconClass: 'icon-duplicate',
                action: () => {
                    if (this.onTabDuplicate) {
                        this.onTabDuplicate(tab.id);
                    }
                }
            },
            {
                label: 'Save',
                iconClass: 'icon-save',
                action: async () => {
                    if (tab.endpoint && tab.endpoint.collectionId && tab.endpoint.endpointId) {
                        const { saveAllRequestModifications } = await import('../collectionManager.js');
                        await saveAllRequestModifications(tab.endpoint.collectionId, tab.endpoint.endpointId);
                        if (window.workspaceTabController) {
                            await window.workspaceTabController.markCurrentTabUnmodified();
                        }
                    }
                },
                disabled: !tab.endpoint
            },
            { divider: true },
            {
                label: 'Close',
                iconClass: 'icon-x',
                action: () => {
                    if (this.onTabClose) {
                        this.onTabClose(tab.id);
                    }
                }
            },
            {
                label: 'Close Others',
                iconClass: 'icon-x',
                action: () => {
                    if (this.onCloseOthers) {
                        this.onCloseOthers(tab.id);
                    }
                }
            }
        ];

        menuItems.forEach(item => {
            if (item.divider) {
                menu.appendChild(createDividerEl());
            } else {
                const menuItem = createMenuItemEl(item.label, item.iconClass, item.disabled);
                menuItem.addEventListener('click', () => {
                    if (!item.disabled) {
                        item.action();
                        menu.remove();
                    }
                });
                menu.appendChild(menuItem);
            }
        });

        document.body.appendChild(menu);

        // Close menu on outside click
        const closeMenu = (e) => {
            if (!menu.contains(e.target)) {
                menu.remove();
                document.removeEventListener('click', closeMenu);
            }
        };
        setTimeout(() => document.addEventListener('click', closeMenu), 0);
    }

    /**
     * Update a specific tab
     * @param {string} tabId
     * @param {Object} updates
     */
    updateTab(tabId, updates) {
        const tabEl = this.container?.querySelector(`[data-tab-id="${tabId}"]`);
        if (!tabEl) {return;}

        // Update the stored tabs array
        if (this.tabs) {
            const tab = this.tabs.find(t => t.id === tabId);
            if (tab) {
                if (updates.name !== undefined) {
                    tab.name = updates.name;
                }
                if (updates.isModified !== undefined) {
                    tab.isModified = updates.isModified;
                }
            }
        }

        if (updates.name !== undefined) {
            const nameEl = tabEl.querySelector('.workspace-tab-name');
            if (nameEl) {
                nameEl.textContent = updates.name;
                nameEl.title = updates.name;
            }
        }

        if (updates.isModified !== undefined) {
            if (updates.isModified) {
                tabEl.classList.add('modified');
                if (!tabEl.querySelector('.workspace-tab-modified-indicator')) {
                    const indicator = document.createElement('span');
                    indicator.className = 'workspace-tab-modified-indicator';
                    indicator.setAttribute('aria-label', 'Modified');
                    tabEl.insertBefore(indicator, tabEl.firstChild);
                }
            } else {
                tabEl.classList.remove('modified');
                const indicator = tabEl.querySelector('.workspace-tab-modified-indicator');
                if (indicator) {
                    indicator.remove();
                }
            }
        }
    }

    /**
     * Set active tab
     * @param {string} tabId
     */
    setActiveTab(tabId) {
        if (!this.container) {return;}

        // Update stored active tab ID
        this.activeTabId = tabId;

        const tabs = this.container.querySelectorAll('.workspace-tab');
        tabs.forEach(tab => {
            if (tab.dataset.tabId === tabId) {
                tab.classList.add('active');
                // Scroll active tab into view
                tab.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
            } else {
                tab.classList.remove('active');
            }
        });

        // Update scroll buttons after scrolling
        setTimeout(() => this._updateScrollButtons(), 300);
    }
}
