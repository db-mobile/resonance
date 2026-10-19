/**
 * @fileoverview One-time, resumable move of saved runners from the desktop store into collection files
 * @module storage/runnerMigration
 */

import { OVERRIDES_VERSION, endpointDefaults, stripUnchangedOverrides } from '../utils/requestOverrides.js';
import { toCollectionRelativePath } from '../utils/dataFilePath.js';

export const LEGACY_RUNNERS_KEY = 'collectionRunners';
export const LEGACY_BACKUP_KEY = 'collectionRunnersLegacyBackup';
export const MIGRATED_COLLECTIONS_KEY = 'runnersMigratedCollections';

/**
 * @param {Object} runner
 * @returns {string|null}
 */
export function ownerCollectionId(runner) {
    return runner?.requests?.[0]?.collectionId ?? null;
}

/**
 * @param {Object} legacy
 * @param {Object} collection
 * @returns {{runner: Object, droppedCount: number}}
 */
export function convertLegacyRunner(legacy, collection) {
    const requests = (legacy.requests || []).filter(entry => entry.collectionId === collection.id);
    const options = { ...(legacy.options || {}) };
    if (options.dataFile?.path) {
        const { path } = toCollectionRelativePath(options.dataFile.path, collection.storagePath);
        options.dataFile = { path, name: options.dataFile.name || '' };
    } else {
        options.dataFile = null;
    }
    return {
        runner: {
            id: legacy.id,
            collectionId: collection.id,
            name: legacy.name || '',
            options,
            requests: requests.map(entry => ({
                collectionId: collection.id,
                endpointId: entry.endpointId,
                name: entry.name || '',
                method: entry.method || '',
                path: entry.path || '',
                postResponseScript: entry.postResponseScript || '',
                overrides: entry.overrides || {}
            }))
        },
        droppedCount: (legacy.requests || []).length - requests.length
    };
}

/**
 * @param {Object} runner
 * @param {number|null} overridesVersion
 * @param {function(string, string): Promise<Object>} resolveDefaults
 * @returns {Promise<Object>}
 */
async function withCurrentOverrides(runner, overridesVersion, resolveDefaults) {
    if (overridesVersion === OVERRIDES_VERSION) {
        return runner;
    }
    const requests = await Promise.all(runner.requests.map(async (entry) => {
        try {
            const config = await resolveDefaults(entry.collectionId, entry.endpointId);
            return { ...entry, overrides: stripUnchangedOverrides(entry.overrides, endpointDefaults(config)) };
        } catch {
            return entry;
        }
    }));
    return { ...runner, requests };
}

/**
 * @param {Object} params
 * @param {Object} params.backendAPI
 * @param {Object} params.repository
 * @param {Array<Object>} params.collections
 * @param {function(string, string): Promise<Object>} params.resolveDefaults
 * @returns {Promise<{moved: Array<{id: string, name: string, collectionId: string}>, dropped: Array<{name: string, count: number}>, skipped: Array<string>, pending: Array<string>, finished: boolean}>}
 */
export async function migrateLegacyRunners({ backendAPI, repository, collections, resolveDefaults }) {
    const summary = { moved: [], dropped: [], skipped: [], pending: [], finished: true };
    const legacy = await backendAPI.store.get(LEGACY_RUNNERS_KEY);
    if (!Array.isArray(legacy) || legacy.length === 0) {
        return summary;
    }
    if (!(await backendAPI.store.get(LEGACY_BACKUP_KEY))) {
        await backendAPI.store.set(LEGACY_BACKUP_KEY, { runners: legacy, savedAt: Date.now() });
    }

    const done = new Set((await backendAPI.store.get(MIGRATED_COLLECTIONS_KEY)) || []);
    const byOwner = new Map();
    for (const runner of legacy) {
        const owner = ownerCollectionId(runner);
        if (!owner) {
            summary.skipped.push(runner.name || runner.id);
            continue;
        }
        if (!byOwner.has(owner)) {
            byOwner.set(owner, []);
        }
        byOwner.get(owner).push(runner);
    }

    for (const [collectionId, runners] of byOwner) {
        if (done.has(collectionId)) {
            continue;
        }
        const collection = (collections || []).find(candidate => candidate.id === collectionId);
        if (!collection) {
            summary.pending.push(collectionId);
            continue;
        }
        const existing = new Set((await repository.getAllByCollection(collectionId)).map(runner => runner.id));
        const lastRuns = {};
        for (const legacyRunner of runners) {
            if (existing.has(legacyRunner.id)) {
                continue;
            }
            const { runner, droppedCount } = convertLegacyRunner(legacyRunner, collection);
            const converted = await withCurrentOverrides(runner, legacyRunner.overridesVersion ?? null, resolveDefaults);
            await repository.put(collectionId, converted);
            if (typeof legacyRunner.lastRunAt === 'number') {
                lastRuns[legacyRunner.id] = legacyRunner.lastRunAt;
            }
            summary.moved.push({ id: legacyRunner.id, name: converted.name, collectionId });
            if (droppedCount > 0) {
                summary.dropped.push({ name: converted.name, count: droppedCount });
            }
        }
        await repository.mergeLastRuns(lastRuns);
        done.add(collectionId);
        await backendAPI.store.set(MIGRATED_COLLECTIONS_KEY, [...done]);
    }

    summary.finished = summary.pending.length === 0;
    if (summary.finished) {
        await backendAPI.store.set(LEGACY_RUNNERS_KEY, null);
    }
    return summary;
}
