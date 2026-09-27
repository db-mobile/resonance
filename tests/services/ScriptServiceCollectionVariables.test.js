/* global window */
import { ScriptService } from '../../src/modules/services/ScriptService.js';
import { VariableRepository } from '../../src/modules/storage/VariableRepository.js';

describe('scripts and collection variables', () => {
    let variableRepository;
    let service;

    beforeEach(() => {
        variableRepository = {
            getVariablesForCollection: jest.fn().mockResolvedValue({ baseUrl: 'https://api.test', retries: 3 }),
            applyVariableChanges: jest.fn().mockResolvedValue(undefined)
        };
        const environmentService = { getActiveEnvironmentVariables: jest.fn().mockResolvedValue({}) };
        service = new ScriptService(null, environmentService, null, variableRepository);
        window.backendAPI = {
            scripts: {
                executePreRequest: jest.fn().mockResolvedValue({
                    success: true, logs: [], errors: [], testResults: [],
                    modifiedRequest: null, modifiedEnvironment: {},
                    modifiedCollectionVariables: { token: 'abc', stale: null }
                })
            }
        };
    });

    afterEach(() => {
        delete window.backendAPI;
    });

    test('the script receives the collection variables as strings and its writes are saved', async () => {
        await service.executePreRequestScript('pm.collectionVariables.set("token", "abc")', { url: 'x', method: 'GET' }, {
            collectionId: 'c1'
        });

        const sent = window.backendAPI.scripts.executePreRequest.mock.calls[0][0];
        expect(sent.collectionVariables).toEqual({ baseUrl: 'https://api.test', retries: '3' });
        expect(variableRepository.applyVariableChanges).toHaveBeenCalledWith('c1', { token: 'abc', stale: null });
    });

    test('without a collection nothing is read or written', async () => {
        await service.executePreRequestScript('1', { url: 'x', method: 'GET' });

        expect(window.backendAPI.scripts.executePreRequest.mock.calls[0][0].collectionVariables).toEqual({});
        expect(variableRepository.applyVariableChanges).not.toHaveBeenCalled();
    });
});

describe('VariableRepository cache', () => {
    test('instances on the same backend share their cache, so one sees the other\'s writes', async () => {
        let stored = [{ key: 'a', value: '1' }];
        const backendAPI = {
            collections: {
                getVariables: jest.fn(async () => stored),
                saveVariables: jest.fn(async (id, vars) => { stored = vars; })
            }
        };
        const reader = new VariableRepository(backendAPI);
        const writer = new VariableRepository(backendAPI);

        expect(await reader.getVariablesForCollection('c1')).toEqual({ a: '1' });
        await writer.setVariable('c1', 'a', '2');

        expect((await reader.getVariablesForCollection('c1')).a).toBe('2');
    });
});
