/**
 * @fileoverview Per-tab list of saved WebSocket messages rendered into the WebSocket request tab
 * @module websocket/websocketPresets
 */

import { translate } from '../utils/translate.js';
import { normalizeWebSocketData } from './websocketFields.js';

export const MESSAGES_LIST_ID = 'websocket-messages-list';
export const MESSAGES_EMPTY_ID = 'websocket-messages-empty';
export const SAVE_MESSAGE_BUTTON_ID = 'websocket-save-message-btn';

/**
 * @typedef {import('./websocketFields.js').WebSocketMessagePreset} WebSocketMessagePreset
 */

/**
 * @typedef {Object} WebSocketPresetListDeps
 * @property {(defaultName: string) => Promise<string|null|undefined>} promptName
 * @property {(preset: WebSocketMessagePreset) => void} loadMessage
 * @property {(content: string) => Promise<*>} sendMessage
 * @property {() => {mode: 'json'|'text', content: string}} readComposer
 * @property {() => void} notifyChanged
 * @property {(message: string) => void} [warn]
 */

/**
 * @param {string} content
 * @returns {string}
 */
function firstLine(content) {
    return content.split(/\r?\n/).find((line) => line.trim()) ?? '';
}

export class WebSocketPresetList {
    /**
     * @param {WebSocketPresetListDeps} deps
     */
    constructor({ promptName, loadMessage, sendMessage, readComposer, notifyChanged, warn = () => {} }) {
        this.promptName = promptName;
        this.loadMessage = loadMessage;
        this.sendMessage = sendMessage;
        this.readComposer = readComposer;
        this.notifyChanged = notifyChanged;
        this.warn = warn;
        /** @type {WebSocketMessagePreset[]} */
        this.messages = [];
    }

    /** @returns {void} */
    initialize() {
        document.getElementById(MESSAGES_LIST_ID)?.addEventListener('click', (event) => this._onListClick(event));
        document.getElementById(SAVE_MESSAGE_BUTTON_ID)?.addEventListener('click', () => this.saveCurrent());
        this.render();
    }

    /** @returns {WebSocketMessagePreset[]} */
    getMessages() {
        return this.messages.map((message) => ({ ...message }));
    }

    /**
     * @param {Array<Object>|null|undefined} messages
     * @returns {void}
     */
    setMessages(messages) {
        this.messages = normalizeWebSocketData({ messages }).messages;
        this.render();
    }

    /** @returns {Promise<void>} */
    async saveCurrent() {
        const { mode, content } = this.readComposer();
        if (!content.trim()) {
            this.warn(translate('websocket.nothing_to_save', 'Type a message in the Body tab first'));
            return;
        }
        const defaultName = translate('websocket.default_message_name', 'Message {{n}}', { n: this.messages.length + 1 });
        const name = await this.promptName(defaultName);
        if (!name) {
            return;
        }
        this.messages.push({ id: crypto.randomUUID(), name: name.trim() || defaultName, mode, content });
        this.render();
        this.notifyChanged();
    }

    /**
     * @param {string} id
     * @returns {void}
     */
    remove(id) {
        const index = this.messages.findIndex((message) => message.id === id);
        if (index === -1) {
            return;
        }
        this.messages.splice(index, 1);
        this.render();
        this.notifyChanged();
    }

    /** @returns {void} */
    render() {
        const list = document.getElementById(MESSAGES_LIST_ID);
        const empty = document.getElementById(MESSAGES_EMPTY_ID);
        if (empty) {
            empty.hidden = this.messages.length > 0;
        }
        if (!list) {
            return;
        }
        list.replaceChildren(...this.messages.map((message) => this._row(message)));
        list.hidden = this.messages.length === 0;
    }

    /**
     * @param {WebSocketMessagePreset} message
     * @returns {HTMLElement}
     */
    _row(message) {
        const row = document.createElement('div');
        row.className = 'row';
        row.setAttribute('role', 'listitem');
        row.dataset.id = message.id;

        const content = document.createElement('div');
        content.className = 'row-content';
        const title = document.createElement('span');
        title.className = 'title';
        title.textContent = message.name;
        const subtitle = document.createElement('span');
        subtitle.className = 'subtitle monospace';
        subtitle.textContent = firstLine(message.content);
        content.append(title, subtitle);

        const suffix = document.createElement('div');
        suffix.className = 'suffix';
        const mode = document.createElement('span');
        mode.className = 'badge neutral caption websocket-message-mode';
        mode.textContent = message.mode;
        suffix.append(
            mode,
            this._button('load', translate('websocket.load', 'Load'), message),
            this._button('send', translate('websocket.send', 'Send'), message),
            this._button('delete', translate('websocket.delete', 'Delete'), message)
        );

        row.append(content, suffix);
        return row;
    }

    /**
     * @param {'load'|'send'|'delete'} action
     * @param {string} label
     * @param {WebSocketMessagePreset} message
     * @returns {HTMLButtonElement}
     */
    _button(action, label, message) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'button flat small';
        button.dataset.action = action;
        button.dataset.id = message.id;
        button.textContent = label;
        button.setAttribute('aria-label', `${label}: ${message.name}`);
        return button;
    }

    /**
     * @param {MouseEvent} event
     * @returns {void}
     */
    _onListClick(event) {
        const target = /** @type {HTMLElement|null} */ (event.target instanceof HTMLElement
            ? event.target.closest('[data-action][data-id]')
            : null);
        if (!target) {
            return;
        }
        const message = this.messages.find((entry) => entry.id === target.dataset.id);
        if (!message) {
            return;
        }
        if (target.dataset.action === 'load') {
            this.loadMessage({ ...message });
        } else if (target.dataset.action === 'send') {
            void this.sendMessage(message.content);
        } else if (target.dataset.action === 'delete') {
            this.remove(message.id);
        }
    }
}
