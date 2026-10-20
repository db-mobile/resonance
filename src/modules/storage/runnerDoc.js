/**
 * @fileoverview Conversion between the committed runner file shape and the in-memory runner the GUI uses
 * @module storage/runnerDoc
 */

import { normalizeTags, isEmptyTagFilter } from '../utils/requestTags.js';

/**
 * @param {Object|null|undefined} options
 * @returns {{stopOnError: boolean, delayMs: number, iterations: number, maxExecutionsPerIteration?: number, dataFile: ({path: string, name: string}|null), tags?: {include: Array<string>, exclude: Array<string>}}}
 */
export function normalizeRunnerOptions(options) {
    const source = options || {};
    const normalized = {
        stopOnError: source.stopOnError ?? true,
        delayMs: Number(source.delayMs) || 0,
        iterations: Math.max(1, parseInt(source.iterations, 10) || 1),
        dataFile: source.dataFile?.path
            ? { path: source.dataFile.path, name: source.dataFile.name || '' }
            : null
    };
    const limit = Number(source.maxExecutionsPerIteration);
    if (Number.isFinite(limit) && limit > 0) {
        normalized.maxExecutionsPerIteration = limit;
    }
    const tags = { include: normalizeTags(source.tags?.include), exclude: normalizeTags(source.tags?.exclude) };
    if (!isEmptyTagFilter(tags)) {
        normalized.tags = tags;
    }
    return normalized;
}

/**
 * @param {Object} runner
 * @returns {Object}
 */
export function toRunnerDoc(runner) {
    const doc = {
        id: runner.id || '',
        name: runner.name || '',
        options: normalizeRunnerOptions(runner.options),
        requests: (runner.requests || []).map(entry => ({
            requestId: entry.endpointId ?? entry.requestId ?? '',
            name: entry.name || '',
            method: entry.method || undefined,
            path: entry.path || undefined,
            overrides: entry.overrides || {},
            postResponseScript: entry.postResponseScript || ''
        }))
    };
    if (Number.isInteger(runner.seq) && runner.seq > 0) {
        doc.seq = runner.seq;
    }
    return doc;
}

/**
 * @param {string} collectionId
 * @param {Object} doc
 * @param {number|null} [lastRunAt]
 * @returns {Object}
 */
export function fromRunnerDoc(collectionId, doc, lastRunAt = null) {
    return {
        id: doc.id,
        collectionId,
        name: doc.name || '',
        seq: doc.seq || 0,
        options: normalizeRunnerOptions(doc.options),
        requests: (doc.requests || []).map(entry => ({
            collectionId,
            endpointId: entry.requestId,
            name: entry.name || '',
            method: entry.method || '',
            path: entry.path || '',
            postResponseScript: entry.postResponseScript || '',
            overrides: entry.overrides || {}
        })),
        lastRunAt
    };
}
