/**
 * @fileoverview Reads and edits the saved example responses of a request and broadcasts changes
 * @module services/ExamplesService
 */

export const EXAMPLES_CHANGED_EVENT = 'resonance:examples-changed';

export class ExamplesService {
    /**
     * @param {{getExamples: Function, updateExamples: Function}} repository
     * @param {Object} [options]
     * @param {EventTarget|null} [options.eventTarget]
     */
    constructor(repository, { eventTarget = undefined } = {}) {
        this.repository = repository;
        this.eventTarget = eventTarget === undefined
            ? (typeof document !== 'undefined' && typeof document.dispatchEvent === 'function' ? document : null)
            : eventTarget;
    }

    /**
     * @param {string} collectionId
     * @param {string} endpointId
     * @returns {Promise<Array<Object>>}
     */
    getExamples(collectionId, endpointId) {
        return this.repository.getExamples(collectionId, endpointId);
    }

    /**
     * @param {string} collectionId
     * @param {string} endpointId
     * @param {Object} example
     * @returns {Promise<Array<Object>>}
     */
    addExample(collectionId, endpointId, example) {
        return this._update(collectionId, endpointId, (list) => [...list, example]);
    }

    /**
     * @param {string} collectionId
     * @param {string} endpointId
     * @param {string} exampleId
     * @param {string} name
     * @returns {Promise<Array<Object>>}
     */
    renameExample(collectionId, endpointId, exampleId, name) {
        return this._update(collectionId, endpointId, (list) =>
            list.map((example) => (example.id === exampleId ? { ...example, name } : example)));
    }

    /**
     * @param {string} collectionId
     * @param {string} endpointId
     * @param {string} exampleId
     * @returns {Promise<Array<Object>>}
     */
    deleteExample(collectionId, endpointId, exampleId) {
        return this._update(collectionId, endpointId, (list) => list.filter((example) => example.id !== exampleId));
    }

    /**
     * @param {string} collectionId
     * @param {string} endpointId
     * @param {function(Array<Object>): Array<Object>} mutate
     * @returns {Promise<Array<Object>>}
     */
    async _update(collectionId, endpointId, mutate) {
        const examples = await this.repository.updateExamples(collectionId, endpointId, mutate);
        this.eventTarget?.dispatchEvent(new CustomEvent(EXAMPLES_CHANGED_EVENT, {
            detail: { collectionId, endpointId, examples }
        }));
        return examples;
    }
}
