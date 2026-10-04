import { ChangeEmitter } from './services/ChangeEmitter.js';

const LAYOUTS = Object.freeze(['stacked', 'side-by-side']);

export class LayoutManager {
    constructor() {
        this.currentLayout = 'stacked';
        this._events = new ChangeEmitter();
        this.ready = this.loadSavedLayout();
    }

    async loadSavedLayout() {
        try {
            const saved = await window.backendAPI.store.get('layout');
            if (LAYOUTS.includes(saved)) {
                this.currentLayout = saved;
            }
        } catch {}
        this._events.emit(this.currentLayout);
    }

    /**
     * @param {(layout: string) => void} callback
     * @returns {void}
     */
    addChangeListener(callback) {
        this._events.add(callback);
    }

    /** @returns {string} */
    getLayout() {
        return this.currentLayout;
    }

    /** @param {string} layout */
    async setLayout(layout) {
        if (!LAYOUTS.includes(layout) || layout === this.currentLayout) {
            return;
        }
        this.currentLayout = layout;
        this._events.emit(layout);
        try {
            await window.backendAPI.store.set('layout', layout);
        } catch {}
    }

    async toggle() {
        await this.setLayout(this.currentLayout === 'stacked' ? 'side-by-side' : 'stacked');
    }
}
