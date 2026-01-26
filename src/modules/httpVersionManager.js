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
        try {
            const settings = await window.backendAPI.settings.get();
            settings.httpVersion = version;
            await window.backendAPI.settings.set(settings);
        } catch (error) {
            void error;
        }
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

    getCurrentVersionDisplay() {
        const versionMap = {
            'auto': 'Auto',
            'http1': 'HTTP/1.x',
            'http2': 'HTTP/2'
        };
        return versionMap[this.currentVersion] || 'Auto';
    }

    getAvailableVersions() {
        return [...this.availableVersions];
    }

    getAxiosConfig() {
        const config = {};
        
        switch (this.currentVersion) {
            case 'http1':
                config.httpVersion = '1.1';
                config.http2 = false;
                break;
            case 'http2':
                config.http2 = true;
                break;
            case 'auto':
            default:
                break;
        }
        
        return config;
    }
}