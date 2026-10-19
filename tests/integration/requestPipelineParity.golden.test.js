import fixtures from '../fixtures/execution/editor-runner.json';
import { CoreExecutionService, captureRunnerEntry } from '../../src/modules/services/CoreExecutionService.js';
import { SCENARIOS, COLLECTION, GRAPHQL, scenarioEndpoint, scenarioPersisted } from './__fixtures__/parityScenario.js';

// Both original GUI transport outputs are preserved in this portable fixture and
// checked against the real Rust executor by editor_runner_parity.rs.
test.each(SCENARIOS)('captures editor and runner inputs for %s', async (name, scenario) => {
    const fixture = fixtures.find(entry => entry.name === name);
    const endpoint = scenarioEndpoint(scenario);
    const persisted = scenarioPersisted(scenario);
    const target = { collection: COLLECTION, endpoint, persisted, inheritedAuth: [],
        scripts: { preRequestScript: scenario.script ? "request.queryParams.added = '1';" : '', testScript: '' }, mockBaseUrl: scenario.mock || null };
    const core = new CoreExecutionService({});
    core.captureTarget = jest.fn(async () => target);
    const request = await core.captureManual({ endpoint: { collectionId: 'c1', endpointId: endpoint.id },
        authConfig: persisted.authConfig || { type: 'none', config: {} },
        inputs: { url: COLLECTION.baseUrl + endpoint.path, method: 'POST', protocol: scenario.graphql ? 'graphql' : 'http',
            headers: Object.fromEntries(persisted.headers.map(row => [row.key, row.value])),
            pathParams: Object.fromEntries(persisted.pathParams.map(row => [row.key, row.value])), queryRows: persisted.queryParams },
        bodySource: { bodyMode: 'json', jsonContent: persisted.modifiedBody || '', text: '', form: null, graphql: scenario.graphql ? GRAPHQL : null } });
    expect(request).toEqual(fixture.editor);
    expect(captureRunnerEntry({ name: endpoint.name }, target)).toEqual(fixture.runner);
});
