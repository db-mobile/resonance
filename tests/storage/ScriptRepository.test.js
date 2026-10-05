import { ScriptRepository } from '../../src/modules/storage/ScriptRepository.js';

describe('ScriptRepository', () => {
    let backendAPI;
    let repository;

    beforeEach(() => {
        backendAPI = {
            scripts: {
                get: jest.fn().mockResolvedValue({ preRequestScript: 'pre', testScript: 'test' }),
                save: jest.fn().mockResolvedValue(undefined)
            }
        };
        repository = new ScriptRepository(backendAPI);
    });

    test('getScripts returns the stored scripts', async () => {
        expect(await repository.getScripts('c1', 'e1')).toEqual({ preRequestScript: 'pre', testScript: 'test' });
        expect(backendAPI.scripts.get).toHaveBeenCalledWith('c1', 'e1');
    });

    test('getScripts defaults missing scripts to empty strings', async () => {
        backendAPI.scripts.get.mockResolvedValue(null);
        expect(await repository.getScripts('c1', 'e1')).toEqual({ preRequestScript: '', testScript: '' });

        backendAPI.scripts.get.mockResolvedValue({ testScript: 't' });
        expect(await repository.getScripts('c1', 'e1')).toEqual({ preRequestScript: '', testScript: 't' });
    });

    test('saveScripts normalizes both fields before saving', async () => {
        await repository.saveScripts('c1', 'e1', { preRequestScript: undefined, testScript: 'x' });

        expect(backendAPI.scripts.save).toHaveBeenCalledWith('c1', 'e1', { preRequestScript: '', testScript: 'x' });
    });

    test('saveScripts propagates backend failures', async () => {
        backendAPI.scripts.save.mockRejectedValue(new Error('nope'));

        await expect(repository.saveScripts('c1', 'e1', {})).rejects.toThrow('nope');
    });
});
