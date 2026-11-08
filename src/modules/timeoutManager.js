import { updateSetting } from './state/settingsCache.js';

export class TimeoutManager {
    constructor() {
        this.currentTimeout = 0;
        this.loadSavedTimeout();
    }

    async loadSavedTimeout() {
        try {
            const settings = await window.backendAPI.settings.get();
            this.currentTimeout = settings.requestTimeout ?? 0;
        } catch {
            this.currentTimeout = 0;
        }
    }

    async setTimeout(timeout) {
        const timeoutValue = parseInt(timeout, 10);
        if (isNaN(timeoutValue) || timeoutValue < 0) {
            return;
        }

        this.currentTimeout = timeoutValue;
        await updateSetting('requestTimeout', timeoutValue);
    }

    getCurrentTimeout() {
        return this.currentTimeout;
    }
}
