const { app, BrowserWindow, ipcMain } = require('electron/main');
const windowStateKeeper = require('electron-window-state');
const path = require('path');
const axios = require('axios');

const createWindow = () => {
    let mainWindowState = windowStateKeeper({
        defaultWidth: 1000,
        defaultHeight: 800
    });

    const win = new BrowserWindow({
        x: mainWindowState.x,
        y: mainWindowState.y,
        width: mainWindowState.width,
        height: mainWindowState.height,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js')
        }
    });

    mainWindowState.manage(win);

    win.loadFile('index.html');
}

app.whenReady().then(() => {
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
})

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

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
            headers: response.headers // You might want to return headers as well
        };
    } catch (error) {
        // Handle Axios errors
        if (error.response) {
            // The request was made and the server responded with a status code
            // that falls out of the range of 2xx
            throw {
                message: error.message,
                status: error.response.status,
                data: error.response.data,
                headers: error.response.headers
            };
        } else if (error.request) {
            // The request was made but no response was received
            throw {
                message: "No response received from server.",
                request: error.request
            };
        } else {
            // Something happened in setting up the request that triggered an Error
            throw {
                message: `Error setting up request: ${error.message}`
            };
        }
    }
});