import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import Store from 'electron-store';
import windowStateKeeper from 'electron-window-state'; // Import windowStateKeeper
import axios from 'axios'; // Import axios

const store = new Store({
    name: 'api-requests', // Name of the config file (e.g., api-requests.json)
    defaults: {
        requests: [] // Default empty array for storing requests
    }
});

let mainWindow;

function createWindow () {
    let mainWindowState = windowStateKeeper({
        defaultWidth: 1200,
        defaultHeight: 800
    });

    const win = new BrowserWindow({
        x: mainWindowState.x,
        y: mainWindowState.y,
        width: mainWindowState.width,
        height: mainWindowState.height,
        webPreferences: {
            preload: path.join(process.cwd(), 'src', 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true
        }
    });

    mainWindowState.manage(win);

    win.loadFile('index.html');

    mainWindow = win;
}

app.whenReady().then(() => {
    createWindow();

    app.on('activate', function () {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', function () {
    if (process.platform !== 'darwin') app.quit();
});

// --- IPC Handler for API Requests (no change) ---
ipcMain.handle('send-api-request', async (event, requestOptions) => {
    try {
        const response = await axios({
            method: requestOptions.method,
            url: requestOptions.url,
            headers: requestOptions.headers,
            data: requestOptions.body
        });
        return {
            data: response.data,
            status: response.status,
            statusText: response.statusText,
            headers: response.headers
        };
    } catch (error) {
        if (error.response) {
            throw {
                message: error.message,
                status: error.response.status,
                data: error.response.data,
                headers: error.response.headers
            };
        } else if (error.request) {
            throw {
                message: "No response received from server.",
                request: error.request
            };
        } else {
            throw {
                message: `Error setting up request: ${error.message}`
            };
        }
    }
});

ipcMain.handle('store:get', (event, key) => {
    return store.get(key);
});

ipcMain.handle('store:set', (event, key, value) => {
    store.set(key, value);
});