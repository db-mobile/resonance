import { resolveRequestSettings, updateSetting } from './state/settingsCache.js';
import { ChangeEmitter } from './services/ChangeEmitter.js';

export class HttpVersionManager {
    constructor() {
        this.currentVersion = 'auto';
        this.availableVersions = ['auto', 'http1', 'http2'];
        this._events = new ChangeEmitter();
        this.ready = this.init();
    }

    async init() {
        await this.loadSavedVersion();
    }

    async loadSavedVersion() {
        const { httpVersion } = await resolveRequestSettings();
        if (this.availableVersions.includes(httpVersion)) {
            this.currentVersion = httpVersion;
            this._events.emit(httpVersion);
        }
    }

    /**
     * @param {(version: string) => void} callback
     * @returns {void}
     */
    addChangeListener(callback) {
        this._events.add(callback);
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
        this._events.emit(version);
    }

    getCurrentVersion() {
        return this.currentVersion;
    }
}
