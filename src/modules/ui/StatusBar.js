import { app } from '../appContext.js';
import { STREAM_STATE_EVENT, listLiveConnections } from '../streaming/streamState.js';
import { translate, translateCount } from '../utils/translate.js';
import { ContextMenu } from './ContextMenu.js';

export class StatusBar {
    /**
     * @param {Object} [deps]
     * @param {{service: Object, dialog: Object}} [deps.mockServer]
     * @param {Object} [deps.proxyService]
     * @param {Object} [deps.secretStore]
     * @param {Object} [deps.settingsModal]
     * @param {Object} [deps.httpVersionManager]
     */
    constructor({ mockServer = null, proxyService = null, secretStore = null, settingsModal = null, httpVersionManager = null } = {}) {
        this._httpVersionManager = httpVersionManager;
        this._mockServer = mockServer;
        this._proxyService = proxyService;
        this._secretStore = secretStore;
        this._settingsModal = settingsModal;
        this._versionEl = null;
        this._requestEl = null;
        this._requestTimeEl = null;
        this._requestTimer = null;
        this._httpEl = null;
        this._mockEl = null;
        this._proxyEl = null;
        this._liveEl = null;
        this._keychainEl = null;
        this._liveMenu = new ContextMenu();
    }

    initialize() {
        this._versionEl = document.getElementById('status-bar-version');
        this._requestEl = document.getElementById('status-bar-request');
        this._requestTimeEl = document.getElementById('status-bar-request-time');
        this._httpEl = document.getElementById('status-bar-http');
        this._mockEl = document.getElementById('status-bar-mock');
        this._proxyEl = document.getElementById('status-bar-proxy');
        this._liveEl = document.getElementById('status-bar-live');
        this._keychainEl = document.getElementById('status-bar-keychain');

        this._httpEl?.addEventListener('click', () => this._settingsModal?.show({ tab: 'general' }));
        this._mockEl?.addEventListener('click', () => this._mockServer?.dialog?.show());
        this._proxyEl?.addEventListener('click', () => this._settingsModal?.show({ tab: 'proxy' }));
        this._liveEl?.addEventListener('click', () => this._showLiveConnections());

        this._httpVersionManager?.addChangeListener((version) => this._renderHttpVersion(version));
        this._mockServer?.service?.addChangeListener((status) => this._renderMock(status));
        this._proxyService?.addChangeListener((settings) => this._renderProxy(settings));
        document.addEventListener(STREAM_STATE_EVENT, () => this._renderLive());

        this._loadVersion();
        this._loadHttpVersion();
        this._loadMock();
        this._loadProxy();
        this._loadKeychain();
        this._renderLive();
    }

    async _loadVersion() {
        try {
            const version = await window.backendAPI?.app?.getVersion();
            if (version && this._versionEl) {
                this._versionEl.textContent = `v${version}`;
            }
        } catch (_e) { }
    }

    async _loadHttpVersion() {
        if (!this._httpVersionManager) { return; }
        await this._httpVersionManager.ready;
        this._renderHttpVersion(this._httpVersionManager.getCurrentVersion());
    }

    /** @param {string} version */
    _renderHttpVersion(version) {
        const labels = {
            auto: translate('status_bar.http_auto', 'HTTP auto'),
            http1: translate('http_version.http1', 'HTTP/1.x'),
            http2: translate('http_version.http2', 'HTTP/2')
        };
        this._setItem(this._httpEl, labels[version] ?? labels.auto, translate('status_bar.http_hint', 'HTTP version used for requests. Click to change.'));
    }

    async _loadMock() {
        if (!this._mockServer?.service) { return; }
        this._renderMock(await this._mockServer.service.getStatus());
    }

    async _loadProxy() {
        if (!this._proxyService) { return; }
        try {
            this._renderProxy(await this._proxyService.getSettings());
        } catch (_e) { }
    }

    async _loadKeychain() {
        if (!this._secretStore) { return; }
        try {
            const usingKeychain = await this._secretStore.isUsingKeychain();
            this._setItem(
                this._keychainEl,
                usingKeychain ? null : translate('status_bar.keychain_unavailable', 'Secrets unencrypted'),
                translate('status_bar.keychain_hint', 'No OS keychain available. Secrets are stored locally without encryption at rest.')
            );
        } catch (_e) { }
    }

    /** @param {{running?: boolean, port?: number|null}|null} status */
    _renderMock(status) {
        const label = status?.running
            ? translate('status_bar.mock_running', 'Mock :{{port}}', { port: status.port ?? '' })
            : null;
        this._setItem(this._mockEl, label, translate('status_bar.mock_hint', 'Mock server running. Click to manage.'));
    }

    /** @param {Object|null} settings */
    _renderProxy(settings) {
        let label = null;
        if (settings?.enabled) {
            label = settings.useSystemProxy
                ? translate('status_bar.proxy_system', 'System proxy')
                : translate('status_bar.proxy_host', 'Proxy {{host}}:{{port}}', { host: settings.host, port: settings.port });
        }
        this._setItem(this._proxyEl, label, translate('status_bar.proxy_hint', 'All requests go through this proxy. Click to configure.'));
    }

    _renderLive() {
        const count = listLiveConnections().length;
        const label = count > 0
            ? translateCount('status_bar.live_connections', count, { one: '{{count}} live connection', other: '{{count}} live connections' })
            : null;
        this._setItem(this._liveEl, label, translate('status_bar.live_hint', 'Open streaming connections. Click to jump to a tab.'));
        if (count === 0) {
            this._liveMenu.hide();
        }
    }

    async _showLiveConnections() {
        const connections = listLiveConnections();
        if (connections.length === 0 || !this._liveEl) { return; }

        const tabs = await app.workspaceTabController?.service.getAllTabs() ?? [];
        const tabNames = new Map(tabs.map(tab => [tab.id, tab.name]));
        const items = connections.map(({ tabId, protocol }) => ({
            label: `${protocol} · ${tabNames.get(tabId) ?? tabId}`,
            onClick: () => app.workspaceTabController?.switchTab(tabId)
        }));

        const rect = this._liveEl.getBoundingClientRect();
        this._liveMenu.show({ clientX: rect.left, clientY: rect.top }, items);
    }

    /**
     * @param {HTMLElement|null} el
     * @param {string|null} label
     * @param {string} [hint]
     */
    _setItem(el, label, hint) {
        if (!el) { return; }
        el.hidden = !label;
        if (!label) { return; }
        const labelEl = el.querySelector('[data-role="label"]');
        if (labelEl) { labelEl.textContent = label; }
        if (hint) {
            el.title = hint;
            el.setAttribute('aria-label', `${label}. ${hint}`);
        }
    }

    /** @param {boolean} running */
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
