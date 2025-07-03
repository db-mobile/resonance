/**
 * HTTP Version Manager - Handles HTTP version setting and persistence
 */
export class HttpVersionManager {
    constructor() {
        this.currentVersion = 'auto';
        this.availableVersions = ['auto', 'http1', 'http2'];
        this.init();
    }

    async init() {
        // Load saved HTTP version or default to auto
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
        console.log(`HTTP version set to: ${version}`);
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

    /**
     * Get axios configuration options based on the selected HTTP version
     */
    getAxiosConfig() {
        const config = {};
        
        switch (this.currentVersion) {
            case 'http1':
                // Force HTTP/1.x
                config.httpVersion = '1.1';
                config.http2 = false;
                break;
            case 'http2':
                // Force HTTP/2
                config.http2 = true;
                break;
            case 'auto':
            default:
                // Let axios/Node.js decide (default behavior)
                // This will typically use HTTP/1.1 but can negotiate HTTP/2
                break;
        }
        
        return config;
    }
}