/**
 * @fileoverview Tab bar UI component for workspace tab management
 * @module ui/WorkspaceTabBar
 */

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
    }

    /**
     * Initialize and render the tab bar
     * @param {Array} tabs
     * @param {string} activeTabId
     */
    render(tabs, activeTabId) {
        this.container = document.getElementById(this.containerId);
        if (!this.container) {
            console.error(`Container ${this.containerId} not found`);
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
        tabBar.className = 'workspace-tab-bar';
        this.tabBar = tabBar;

        // Create tabs container
        const tabsContainer = document.createElement('div');
        tabsContainer.className = 'workspace-tabs-container';

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
        tabEl.className = `workspace-tab${isActive ? ' active' : ''}${tab.isModified ? ' modified' : ''}`;
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
        closeBtn.innerHTML = `
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5">
                <line x1="3" y1="3" x2="9" y2="9"></line>
                <line x1="9" y1="3" x2="3" y2="9"></line>
            </svg>
        `;

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

        return tabEl;
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
            btn.innerHTML = `
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="7 2 3 6 7 10"></polyline>
                </svg>
            `;
            btn.addEventListener('click', () => this._scrollTabs(-200));
        } else {
            btn.innerHTML = `
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="5 2 9 6 5 10"></polyline>
                </svg>
            `;
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
        btn.className = 'workspace-tab-new';
        btn.setAttribute('aria-label', 'New tab');
        btn.title = 'New tab';
        btn.innerHTML = `
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5">
                <line x1="7" y1="3" x2="7" y2="11"></line>
                <line x1="3" y1="7" x2="11" y2="7"></line>
            </svg>
        `;

        btn.addEventListener('click', () => {
            if (this.onTabCreate) {
                this.onTabCreate();
            }
        });

        return btn;
    }

    /**
     * Create tab list dropdown button
     * @private
     */
    _createTabListButton() {
        const btn = document.createElement('button');
        btn.className = 'workspace-tab-list-button';
        btn.setAttribute('aria-label', 'All tabs');
        btn.title = 'All tabs';
        btn.innerHTML = `
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5">
                <line x1="2" y1="4" x2="12" y2="4"></line>
                <line x1="2" y1="7" x2="12" y2="7"></line>
                <line x1="2" y1="10" x2="12" y2="10"></line>
            </svg>
        `;

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
        dropdown.className = 'workspace-tab-list-dropdown visible';

        // Position dropdown below button
        const rect = button.getBoundingClientRect();
        dropdown.style.top = `${rect.bottom + 4}px`;
        dropdown.style.right = '8px';

        // Add tab items using current tabs
        this.tabs.forEach(tab => {
            const item = document.createElement('div');
            item.className = `workspace-tab-list-item${tab.id === this.activeTabId ? ' active' : ''}`;

            // Add modified indicator if needed
            if (tab.isModified) {
                const indicator = document.createElement('span');
                indicator.className = 'workspace-tab-list-item-indicator';
                item.appendChild(indicator);
            }

            // Add tab name
            const name = document.createElement('span');
            name.className = 'workspace-tab-list-item-name';
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
        menu.className = 'workspace-tab-context-menu';
        menu.style.left = `${event.pageX}px`;
        menu.style.top = `${event.pageY}px`;

        const menuItems = [
            {
                label: 'Rename',
                icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                </svg>`,
                action: () => {
                    const tabEl = document.querySelector(`[data-tab-id="${tab.id}"]`);
                    if (tabEl) {
                        this._startRenaming(tabEl, tab);
                    }
                }
            },
            {
                label: 'Duplicate',
                icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                </svg>`,
                action: () => {
                    if (this.onTabDuplicate) {
                        this.onTabDuplicate(tab.id);
                    }
                }
            },
            {
                label: 'Save',
                icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path>
                    <polyline points="17 21 17 13 7 13 7 21"></polyline>
                    <polyline points="7 3 7 8 15 8"></polyline>
                </svg>`,
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
                icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>`,
                action: () => {
                    if (this.onTabClose) {
                        this.onTabClose(tab.id);
                    }
                }
            },
            {
                label: 'Close Others',
                icon: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>`,
                action: () => {
                    if (this.onCloseOthers) {
                        this.onCloseOthers(tab.id);
                    }
                }
            }
        ];

        menuItems.forEach(item => {
            if (item.divider) {
                const divider = document.createElement('div');
                divider.className = 'workspace-tab-context-menu-divider';
                menu.appendChild(divider);
            } else {
                const menuItem = document.createElement('div');
                menuItem.className = 'workspace-tab-context-menu-item';
                if (item.disabled) {
                    menuItem.classList.add('disabled');
                }
                menuItem.innerHTML = `<span class="menu-icon">${item.icon}</span><span>${item.label}</span>`;
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
