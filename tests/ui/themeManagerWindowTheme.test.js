/* global document, window */
import { ThemeManager } from '../../src/modules/themeManager.js';

function createManager(systemDark) {
    const manager = Object.create(ThemeManager.prototype);
    manager.currentTheme = 'system';
    manager.currentThemeLink = null;
    manager.availableThemes = ['light', 'dark', 'system'];
    manager.loadThemeCSS = jest.fn().mockResolvedValue();
    window.matchMedia = jest.fn().mockReturnValue({ matches: systemDark, addEventListener: jest.fn() });
    return manager;
}

describe('ThemeManager window theme sync', () => {
    let setWindowTheme;

    beforeEach(() => {
        setWindowTheme = jest.fn().mockResolvedValue();
        window.backendAPI = { app: { setWindowTheme } };
    });

    afterEach(() => {
        delete window.backendAPI;
        delete window.matchMedia;
    });

    test('system theme passes the effective scheme to the window', async () => {
        await createManager(true).applyTheme('system');
        expect(setWindowTheme).toHaveBeenCalledWith('dark');
        await createManager(false).applyTheme('system');
        expect(setWindowTheme).toHaveBeenLastCalledWith('light');
    });

    test('explicit themes are passed through unchanged', async () => {
        await createManager(true).applyTheme('light');
        expect(setWindowTheme).toHaveBeenLastCalledWith('light');
        await createManager(false).applyTheme('dark');
        expect(setWindowTheme).toHaveBeenLastCalledWith('dark');
    });

    test('a failing window theme call does not break applying the theme', async () => {
        setWindowTheme.mockRejectedValue(new Error('no window'));
        const manager = createManager(true);
        await manager.applyTheme('dark');
        expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
        expect(manager.currentTheme).toBe('dark');
    });

    test('missing backend API is tolerated', async () => {
        delete window.backendAPI;
        const manager = createManager(true);
        await manager.applyTheme('dark');
        expect(manager.currentTheme).toBe('dark');
    });
});
