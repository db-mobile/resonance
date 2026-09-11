/**
 * @fileoverview Shared listener registry for services that broadcast change events
 * @module services/ChangeEmitter
 */

export class ChangeEmitter {
    constructor() {
        this.listeners = new Set();
    }

    /**
     * @param {Function} callback
     * @returns {void}
     */
    add(callback) {
        this.listeners.add(callback);
    }

    /**
     * @param {Function} callback
     * @returns {void}
     */
    remove(callback) {
        this.listeners.delete(callback);
    }

    /**
     * @param {...*} args
     * @returns {void}
     */
    emit(...args) {
        this.listeners.forEach(callback => {
            try {
                callback(...args);
            } catch (error) {
                void error;
            }
        });
    }
}
