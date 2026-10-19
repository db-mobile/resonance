import { toRunnerDoc, fromRunnerDoc, normalizeRunnerOptions } from '../../src/modules/storage/runnerDoc.js';

describe('runnerDoc', () => {
    test('a runner round-trips through the file shape with collection ids re-attached', () => {
        const runner = {
            id: 'runner_1',
            collectionId: 'c1',
            name: 'Smoke',
            seq: 20,
            options: { stopOnError: false, delayMs: 250, iterations: 3, maxExecutionsPerIteration: 50, dataFile: { path: 'data/users.csv', name: 'users.csv', rowCount: 4 } },
            requests: [{ collectionId: 'c1', endpointId: 'req_a', name: 'Create', method: 'POST', path: '/pets', postResponseScript: 'x();', overrides: { headers: [] } }],
            lastRunAt: 5
        };

        const doc = toRunnerDoc(runner);
        expect(doc).toEqual({
            id: 'runner_1',
            name: 'Smoke',
            seq: 20,
            options: { stopOnError: false, delayMs: 250, iterations: 3, maxExecutionsPerIteration: 50, dataFile: { path: 'data/users.csv', name: 'users.csv' } },
            requests: [{ requestId: 'req_a', name: 'Create', method: 'POST', path: '/pets', overrides: { headers: [] }, postResponseScript: 'x();' }]
        });
        expect(fromRunnerDoc('c1', doc, 5)).toEqual({ ...runner, options: { ...runner.options, dataFile: { path: 'data/users.csv', name: 'users.csv' } } });
    });

    test('a derived row count, timestamps and the overrides marker never reach the file', () => {
        const doc = toRunnerDoc({ name: 'x', overridesVersion: 2, createdAt: 1, lastRunAt: 2, options: { dataFile: { path: 'a.csv', name: 'a.csv', rowCount: 9 } } });

        expect(doc).not.toHaveProperty('overridesVersion');
        expect(doc).not.toHaveProperty('createdAt');
        expect(doc).not.toHaveProperty('lastRunAt');
        expect(doc.options.dataFile).toEqual({ path: 'a.csv', name: 'a.csv' });
    });

    test('defaults fill gaps and an unsaved seq is omitted', () => {
        expect(toRunnerDoc({})).toEqual({ id: '', name: '', options: { stopOnError: true, delayMs: 0, iterations: 1, dataFile: null }, requests: [] });
        expect(fromRunnerDoc('c1', { id: 'r', name: 'R' })).toEqual({
            id: 'r', collectionId: 'c1', name: 'R', seq: 0, options: { stopOnError: true, delayMs: 0, iterations: 1, dataFile: null }, requests: [], lastRunAt: null
        });
    });

    test('normalizeRunnerOptions drops an invalid execution limit and clamps iterations', () => {
        expect(normalizeRunnerOptions({ iterations: '0', maxExecutionsPerIteration: 'abc' })).toEqual({ stopOnError: true, delayMs: 0, iterations: 1, dataFile: null });
        expect(normalizeRunnerOptions({ iterations: 4, maxExecutionsPerIteration: 10 }).maxExecutionsPerIteration).toBe(10);
    });
});
