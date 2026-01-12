/**
 * @fileoverview Window management for Electron application
 * @module main/windowManager
 */

import { BrowserWindow, globalShortcut, app } from 'electron';
import path from 'path';
import windowStateKeeper from 'electron-window-state';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Manages the main application window lifecycle
 *
 * @class
 * @classdesc Handles creation, configuration, and state management of the main
 * BrowserWindow. Uses electron-window-state for persistent window dimensions
 * and position. Configures security settings with context isolation enabled.
 */
class WindowManager {
    /**
     * Creates a WindowManager instance
     */
    constructor() {
        /** @type {BrowserWindow|null} The main application window */
        this.mainWindow = null;
    }

    /**
     * Creates and configures the main application window
     *
     * Sets up the BrowserWindow with security settings (contextIsolation: true,
     * nodeIntegration: false), persistent window state, and global keyboard
     * shortcuts. The window uses a preload script for secure IPC communication.
     *
     * @returns {BrowserWindow} The created BrowserWindow instance
     */
    createWindow() {
        const mainWindowState = windowStateKeeper({
            defaultWidth: 1200,
            defaultHeight: 800
        });

        const isDev = !app.isPackaged;
        const _appPath = isDev ? process.cwd() : path.dirname(app.getPath('exe'));
        const resourcesPath = isDev ? process.cwd() : process.resourcesPath;

        this.mainWindow = new BrowserWindow({
            x: mainWindowState.x,
            y: mainWindowState.y,
            width: mainWindowState.width,
            height: mainWindowState.height,
            icon: path.join(resourcesPath, 'assets', 'icons', 'icon.png'),
            webPreferences: {
                preload: path.join(__dirname, '..', 'preload.js'),
                nodeIntegration: false,
                contextIsolation: true
            }
        });

        mainWindowState.manage(this.mainWindow);

        globalShortcut.register('CommandOrControl+R', () => {
            if (this.mainWindow) {
                this.mainWindow.reload();
            }
        });

        //this.mainWindow.setMenu(null);
        this.mainWindow.loadFile('index.html');

        return this.mainWindow;
    }

    /**
     * Retrieves the main application window
     *
     * @returns {BrowserWindow|null} The main window instance, or null if not created
     */
    getMainWindow() {
        return this.mainWindow;
    }
}

export default WindowManager;
