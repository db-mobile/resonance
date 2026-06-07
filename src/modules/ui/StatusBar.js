export class StatusBar {
    constructor(environmentService) {
        this._environmentService = environmentService;
        this._envNameEl = null;
        this._envDotEl = null;
        this._versionEl = null;
        this._requestEl = null;
        this._requestTimeEl = null;
        this._requestTimer = null;
    }

    initialize() {
        this._envNameEl = document.getElementById('status-bar-env-name');
        this._envDotEl = document.getElementById('status-bar-env-dot');
        this._versionEl = document.getElementById('status-bar-version');
        this._requestEl = document.getElementById('status-bar-request');
        this._requestTimeEl = document.getElementById('status-bar-request-time');

        if (this._environmentService) {
            this._environmentService.addChangeListener((event) => {
                if (event.type === 'environment-switched') {
                    this._setEnvName(event.environmentName);
                    this._setColor(event.environmentColor);
                }
            });
        }

        this._loadVersion();
        this._loadInitialEnv();
    }

    async _loadVersion() {
        try {
            const version = await window.backendAPI?.app?.getVersion();
            if (version && this._versionEl) {
                this._versionEl.textContent = `v${version}`;
            }
        } catch (_e) { /* version stays as "Resonance" */ }
    }

    async _loadInitialEnv() {
        try {
            const env = await this._environmentService.getActiveEnvironment();
            this._setEnvName(env?.name ?? null);
            this._setColor(env?.color ?? null);
        } catch (_e) { /* stays "No Environment" */ }
    }

    _setEnvName(name) {
        if (!this._envNameEl) { return; }
        this._envNameEl.textContent = name ?? 'No Environment';
    }

    _setColor(color) {
        if (!this._envDotEl) { return; }
        this._envDotEl.style.background = color ?? '';
    }

    /**
     * Show or hide the in-flight request indicator with a live elapsed timer.
     * @param {boolean} running - Whether a request is currently in progress
     */
    setRequestRunning(running) {
        if (this._requestTimer) {
            clearInterval(this._requestTimer);
            this._requestTimer = null;
        }

        if (!this._requestEl) { return; }

        if (running) {
            const startedAt = performance.now();
            const render = () => {
                if (!this._requestTimeEl) { return; }
                const seconds = (performance.now() - startedAt) / 1000;
                this._requestTimeEl.textContent = `${seconds.toFixed(1)}s`;
            };
            render();
            this._requestTimer = setInterval(render, 100);
            this._requestEl.hidden = false;
        } else {
            this._requestEl.hidden = true;
        }
    }
}
