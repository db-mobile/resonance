/* global window */

test.each(['json', 'junit'])('runner %s export forwards the summary to Rust', async (format) => {
    const previousInternals = window.__TAURI_INTERNALS__;
    const previousAPI = window.backendAPI;
    const invoke = jest.fn().mockResolvedValue({ cancelled: true });
    window.__TAURI_INTERNALS__ = { invoke };
    try {
        let api;
        jest.isolateModules(() => { ({ api } = require('../../src/modules/ipcBridge.js')); });
        const summary = { runnerName: 'Smoke', requests: [] };

        await expect(api.runner.saveReport('smoke.xml', format, summary)).resolves.toEqual({ cancelled: true });

        expect(invoke).toHaveBeenCalledWith('save_runner_report', { defaultFileName: 'smoke.xml', format, summary });
    } finally {
        window.__TAURI_INTERNALS__ = previousInternals;
        window.backendAPI = previousAPI;
    }
});
