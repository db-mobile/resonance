import { updateSetting } from './state/settingsCache.js';

export class TimeoutManager {
    constructor() {
        this.currentTimeout = 0;
        this.init();
    }

    async init() {
        await this.loadSavedTimeout();
    }

    async loadSavedTimeout() {
        try {
            const settings = await window.backendAPI.settings.get();
            this.currentTimeout = settings.requestTimeout !== undefined ? settings.requestTimeout : 0;
        } catch (error) {
            this.currentTimeout = 0;
        }
    }

    async saveTimeout(timeout) {
        await updateSetting('requestTimeout', timeout);
    }

    async setTimeout(timeout) {
        const timeoutValue = parseInt(timeout, 10);
        if (isNaN(timeoutValue) || timeoutValue < 0) {
            return;
        }

        this.currentTimeout = timeoutValue;
        await this.saveTimeout(timeoutValue);
    }

    getCurrentTimeout() {
        return this.currentTimeout;
    }

    getCurrentTimeoutDisplay() {
        return this.currentTimeout === 0 ? 'No timeout' : `${this.currentTimeout}ms`;
    }
}
