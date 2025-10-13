import { BrowserWindow, globalShortcut } from 'electron';
import path from 'path';
import windowStateKeeper from 'electron-window-state';

/**
 * Manages Electron window creation and lifecycle
 */
class WindowManager {
    constructor() {
        this.mainWindow = null;
    }

    /**
     * Create the main application window
     */
    createWindow() {
        let mainWindowState = windowStateKeeper({
            defaultWidth: 1200,
            defaultHeight: 800
        });

        this.mainWindow = new BrowserWindow({
            x: mainWindowState.x,
            y: mainWindowState.y,
            width: mainWindowState.width,
            height: mainWindowState.height,
            icon: path.join(process.cwd(), 'assets', 'icons', 'icon.png'),
            webPreferences: {
                preload: path.join(process.cwd(), 'src', 'preload.js'),
                nodeIntegration: false,
                contextIsolation: true
            }
        });

        mainWindowState.manage(this.mainWindow);

        // Register global shortcuts
        globalShortcut.register('CommandOrControl+R', () => {
            if (this.mainWindow) {
                this.mainWindow.reload();
            }
        });

        this.mainWindow.setMenu(null);
        this.mainWindow.loadFile('index.html');

        return this.mainWindow;
    }

    /**
     * Get the main window instance
     */
    getMainWindow() {
        return this.mainWindow;
    }
}

export default WindowManager;
