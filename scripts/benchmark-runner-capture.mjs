// Synthetic capture benchmark. An optional bundled baseline must export the
// same three classes; each invocation should run in a fresh Node process.
import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const [countArg = '100', warmth = 'cold', baseline] = process.argv.slice(2);
const count = Number(countArg);
if (!Number.isInteger(count) || count < 1 || !['cold', 'warm'].includes(warmth)) {
    throw new Error('Usage: node --expose-gc scripts/benchmark-runner-capture.mjs [request-count] [cold|warm] [baseline-bundle]');
}
const { CoreExecutionService, CollectionRepository, VariableRepository } = baseline
    ? await import(pathToFileURL(baseline))
    : {
        ...(await import('../src/modules/services/CoreExecutionService.js')),
        ...(await import('../src/modules/storage/CollectionRepository.js')),
        ...(await import('../src/modules/storage/VariableRepository.js'))
    };
const wire = {
    id: 'c', name: 'Example', baseUrl: 'https://example.test', defaultHeaders: {},
    endpoints: Array.from({ length: count }, (_, i) => ({
        id: `e${i}`, name: `Request ${i}`, path: `/items/${i}`, method: 'GET', protocol: 'http'
    })), folders: []
};
const endpointIndex = new Map(wire.endpoints.map(endpoint => [endpoint.id, endpoint]));
let calls = 0, bytes = 0;
function transfer(value) {
    calls++;
    const serialized = JSON.stringify(value);
    bytes += Buffer.byteLength(serialized);
    return JSON.parse(serialized);
}
const backend = {
    settings: { get: async () => ({}) },
    collections: {
        get: async () => transfer(wire),
        getEndpointData: async () => transfer({}),
        getVariables: async () => transfer([]),
        captureExecutionSnapshot: async refs => transfer([{
            collectionId: 'c', collection: { id: 'c', baseUrl: wire.baseUrl, defaultHeaders: {} }, variables: [],
            targets: refs.map(ref => ({
                endpointId: ref.endpointId, endpoint: endpointIndex.get(ref.endpointId), persisted: {},
                inheritedAuth: [{ source: { kind: 'collection' }, authConfig: { type: 'none', config: {} } }],
                scripts: { preRequestScript: '', testScript: '' }
            }))
        }])
    }
};
const repository = new CollectionRepository(backend);
const variables = new VariableRepository(backend);
if (warmth === 'warm') {
    await repository.getById('c');
    await variables.getVariablesForCollection('c');
}
calls = 0; bytes = 0;
global.gc?.();
const service = new CoreExecutionService({
    backendAPI: backend, collectionRepository: repository, variableRepository: variables,
    environmentRepository: { getActiveEnvironmentVariables: async () => ({}) }, mockBaseUrlFor: async () => null
});
const runner = {
    collectionId: 'c',
    requests: wire.endpoints.map(endpoint => ({ collectionId: 'c', endpointId: endpoint.id, name: endpoint.name })), options: {}
};
const started = performance.now();
const result = await service.captureRun(runner);
const elapsed = performance.now() - started;
console.log(JSON.stringify({
    count, warmth, ms: Number(elapsed.toFixed(2)), calls, bytes,
    peakRssMiB: Number((process.resourceUsage().maxRSS / 1024).toFixed(1)),
    hash: createHash('sha256').update(JSON.stringify(result)).digest('hex')
}));
