import { BrowserWindow, globalShortcut, app } from 'electron';
import path from 'path';
import windowStateKeeper from 'electron-window-state';
import { fileURLToPath } from 'url';

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

        // Determine correct paths for packaged vs development
        const isDev = !app.isPackaged;
        const appPath = isDev ? process.cwd() : path.dirname(app.getPath('exe'));
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
