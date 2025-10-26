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
            const settings = await window.electronAPI.settings.get();
            this.currentVersion = settings.httpVersion || 'auto';
        } catch (error) {
            console.error('Error loading saved HTTP version:', error);
            this.currentVersion = 'auto';
        }
    }

    async saveVersion(version) {
        try {
            const settings = await window.electronAPI.settings.get();
            settings.httpVersion = version;
            await window.electronAPI.settings.set(settings);
        } catch (error) {
            console.error('Error saving HTTP version:', error);
        }
    }

    async setVersion(version) {
        if (!this.availableVersions.includes(version)) {
            console.error(`HTTP version '${version}' is not available`);
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