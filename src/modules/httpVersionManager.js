import { updateSetting } from './state/settingsCache.js';

export class HttpVersionManager {
    constructor() {
        this.currentVersion = 'auto';
        this.availableVersions = ['auto', 'http1', 'http2'];
        this.init();
    }

    async init() {
        await this.loadSavedVersion();
    }

    async loadSavedVersion() {
        try {
            this.httpVersionSelector = document.getElementById('http-version-selector');
            this.setupEventListeners();
            this.initializeDefaultVersion();
        } catch (error) {
            void error;
        }
    }

    async saveVersion(version) {
        await updateSetting('httpVersion', version);
    }

    async setVersion(version) {
        if (!this.availableVersions.includes(version)) {
            return;
        }

        this.currentVersion = version;
        await this.saveVersion(version);
    }

    getCurrentVersion() {
        return this.currentVersion;
    }
}