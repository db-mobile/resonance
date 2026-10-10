/* global document, DOMParser, KeyboardEvent */
import fs from 'fs';
import path from 'path';
import { keyboardShortcuts } from '../../src/modules/keyboardShortcuts.js';
import { templateLoader } from '../../src/modules/templateLoader.js';
import { ContextMenu } from '../../src/modules/ui/ContextMenu.js';
import { WorkspaceTabBar } from '../../src/modules/ui/WorkspaceTabBar.js';
import { UrlAutocomplete } from '../../src/modules/ui/UrlAutocomplete.js';
import { escapeHandlerCount } from '../../src/modules/ui/modalEscape.js';

const SHORTCUTS_TEMPLATE = './src/templates/shortcuts/keyboardShortcuts.html';
const CONTEXT_MENU_TEMPLATE = './src/templates/contextMenu/contextMenu.html';

const loadTemplate = (key) => {
    const html = fs.readFileSync(path.join(process.cwd(), key), 'utf8');
    templateLoader.cache.set(key, new DOMParser().parseFromString(html, 'text/html'));
};

const press = (key, init = {}, target = document.body) =>
    target.dispatchEvent(new KeyboardEvent('keydown', { key, code: init.code ?? key, bubbles: true, cancelable: true, ...init }));

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

const onSend = jest.fn();
const onCancel = jest.fn();

beforeAll(() => {
    loadTemplate(SHORTCUTS_TEMPLATE);
    loadTemplate(CONTEXT_MENU_TEMPLATE);
    keyboardShortcuts.register('Enter', { ctrl: true, handler: onSend, description: 'Send', category: 'Request' });
    keyboardShortcuts.register('Escape', { handler: onCancel, description: 'Cancel', category: 'Request' });
    keyboardShortcuts.init();
});

beforeEach(() => {
    document.body.innerHTML = '';
    keyboardShortcuts.helpDialogVisible = false;
    onSend.mockClear();
    onCancel.mockClear();
});

afterEach(() => {
    expect(escapeHandlerCount()).toBe(0);
});

describe('global shortcut guard', () => {
    test('ignores shortcuts while a modal overlay is open', () => {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        document.body.appendChild(overlay);

        press('Enter', { code: 'Enter', ctrlKey: true });
        expect(onSend).not.toHaveBeenCalled();

        overlay.remove();
        press('Enter', { code: 'Enter', ctrlKey: true });
        expect(onSend).toHaveBeenCalledTimes(1);
    });

    test('a hidden modal overlay does not block shortcuts', () => {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay is-hidden';
        document.body.appendChild(overlay);

        press('Enter', { code: 'Enter', ctrlKey: true });
        expect(onSend).toHaveBeenCalledTimes(1);
    });
});

describe('keyboard shortcuts help dialog', () => {
    test('mounts as an ARIA dialog and restores focus on close', async () => {
        const opener = document.createElement('button');
        document.body.appendChild(opener);
        opener.focus();

        keyboardShortcuts.showHelp();
        await flush();

        const dialog = document.getElementById('keyboard-shortcuts-dialog');
        expect(dialog.getAttribute('role')).toBe('dialog');
        expect(dialog.getAttribute('aria-modal')).toBe('true');
        expect(document.getElementById(dialog.getAttribute('aria-labelledby')).textContent).toBe('Keyboard Shortcuts');
        expect(dialog.closest('.modal-overlay').classList).toContain('keyboard-shortcuts-overlay');
        expect(dialog.contains(document.activeElement)).toBe(true);
        expect(dialog.querySelector('[data-role="keys"]').textContent).toBe('Ctrl+Enter');

        press('Escape');

        expect(document.getElementById('keyboard-shortcuts-dialog')).toBeNull();
        expect(keyboardShortcuts.helpDialogVisible).toBe(false);
        expect(document.activeElement).toBe(opener);
        expect(onCancel).not.toHaveBeenCalled();
    });
});

describe('context menu', () => {
    const open = (items) => {
        const menu = new ContextMenu();
        menu.show({ clientX: 10, clientY: 10 }, items);
        return menu;
    };

    test('Escape closes the menu without closing the dialog beneath it', () => {
        keyboardShortcuts.showHelp();
        open([{ label: 'Rename' }]);

        press('Escape');
        expect(document.querySelector('.context-menu')).toBeNull();
        expect(document.getElementById('keyboard-shortcuts-dialog')).not.toBeNull();

        press('Escape');
        expect(document.getElementById('keyboard-shortcuts-dialog')).toBeNull();
    });

    test('Escape that closes the menu does not reach the cancel-request shortcut', () => {
        open([{ label: 'Rename' }]);

        press('Escape');

        expect(document.querySelector('.context-menu')).toBeNull();
        expect(onCancel).not.toHaveBeenCalled();

        press('Escape');
        expect(onCancel).toHaveBeenCalledTimes(1);
    });

    test('exposes menu roles, moves focus with arrows and activates with Enter', () => {
        const opener = document.createElement('button');
        document.body.appendChild(opener);
        opener.focus();
        const first = jest.fn();
        const second = jest.fn();

        open([{ label: 'One', onClick: first }, { label: 'Two', onClick: second }]);

        const menuEl = document.querySelector('.context-menu');
        const items = menuEl.querySelectorAll('[role="menuitem"]');
        expect(menuEl.getAttribute('role')).toBe('menu');
        expect(items).toHaveLength(2);
        expect(document.activeElement).toBe(items[0]);

        press('ArrowDown', {}, document.activeElement);
        expect(document.activeElement).toBe(items[1]);
        press('ArrowDown', {}, document.activeElement);
        expect(document.activeElement).toBe(items[0]);
        press('ArrowUp', {}, document.activeElement);
        expect(document.activeElement).toBe(items[1]);

        press('Enter', {}, document.activeElement);

        expect(second).toHaveBeenCalledTimes(1);
        expect(first).not.toHaveBeenCalled();
        expect(document.querySelector('.context-menu')).toBeNull();
        expect(document.activeElement).toBe(opener);
    });
});

describe('workspace tab bar menus', () => {
    test('Escape closes the new-tab menu and only the menu', () => {
        const bar = new WorkspaceTabBar('tabs');
        const button = document.createElement('button');
        document.body.appendChild(button);

        bar._showNewTabMenu(button);
        expect(document.querySelector('.workspace-tab-new-menu')).not.toBeNull();

        press('Escape');

        expect(document.querySelector('.workspace-tab-new-menu')).toBeNull();
        expect(onCancel).not.toHaveBeenCalled();

        bar._showNewTabMenu(button);
        expect(document.querySelector('.workspace-tab-new-menu')).not.toBeNull();
        bar._showNewTabMenu(button);
        expect(document.querySelector('.workspace-tab-new-menu')).toBeNull();
    });

    test('Escape closes the tab context menu, and reopening replaces it', () => {
        loadTemplate('./src/templates/workspaceTabs/workspaceTabBar.html');
        const bar = new WorkspaceTabBar('tabs');
        const tab = { id: 'a', name: 'A', type: 'request' };

        bar._showContextMenu({ pageX: 10, pageY: 10 }, tab);
        bar._showContextMenu({ pageX: 20, pageY: 20 }, tab);
        expect(document.querySelectorAll('.workspace-tab-context-menu')).toHaveLength(1);
        expect(escapeHandlerCount()).toBe(1);

        press('Escape');

        expect(document.querySelector('.workspace-tab-context-menu')).toBeNull();
        expect(escapeHandlerCount()).toBe(0);
        expect(onCancel).not.toHaveBeenCalled();
    });

    test('Escape closes the all-tabs menu', () => {
        const bar = new WorkspaceTabBar('tabs');
        bar.tabs = [{ id: 'a', name: 'A' }];
        bar.activeTabId = 'a';
        const button = document.createElement('button');
        document.body.appendChild(button);

        bar._toggleTabListDropdown(button);
        press('Escape');

        expect(document.querySelector('.workspace-tab-list-dropdown')).toBeNull();
        expect(onCancel).not.toHaveBeenCalled();
    });

    test('Escape in the inline rename restores the name without cancelling the request', () => {
        const bar = new WorkspaceTabBar('tabs');
        bar.onTabRename = jest.fn();
        const tabEl = document.createElement('div');
        const nameEl = document.createElement('span');
        nameEl.className = 'workspace-tab-name';
        nameEl.textContent = 'Original';
        tabEl.appendChild(nameEl);
        document.body.appendChild(tabEl);

        bar._startRenaming(tabEl, { id: 'a' });
        const input = tabEl.querySelector('.workspace-tab-rename-input');
        input.value = 'Edited';
        press('Escape', {}, input);
        input.dispatchEvent(new Event('blur'));

        expect(tabEl.querySelector('.workspace-tab-name').textContent).toBe('Original');
        expect(bar.onTabRename).not.toHaveBeenCalled();
        expect(onCancel).not.toHaveBeenCalled();
    });
});

describe('url autocomplete', () => {
    test('Escape hides the dropdown without cancelling the request', () => {
        const input = document.createElement('input');
        document.body.appendChild(document.createElement('div')).appendChild(input);
        const ac = new UrlAutocomplete(input, {
            handleHistorySelect: jest.fn(),
            service: { formatTimestamp: () => '', getMethodColor: () => '', searchHistory: async () => [] }
        });
        ac.init();
        ac.suggestions = [{ request: { method: 'GET', url: 'https://a' }, timestamp: 1 }];
        ac._render();
        expect(escapeHandlerCount()).toBe(1);

        press('Escape', {}, input);

        expect(ac._isVisible()).toBe(false);
        expect(onCancel).not.toHaveBeenCalled();
    });
});
