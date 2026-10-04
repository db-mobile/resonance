import { EnvironmentService } from '../../src/modules/services/EnvironmentService.js';

describe('EnvironmentService', () => {
    let repository;
    let statusDisplay;
    let service;
    let events;

    const env = { id: 'env1', name: 'Dev', variables: { a: '1' }, secretKeys: ['a'], color: '#AABBCC' };

    beforeEach(() => {
        repository = {
            getAllEnvironments: jest.fn().mockResolvedValue({ items: [env], activeEnvironmentId: 'env1' }),
            getActiveEnvironment: jest.fn().mockResolvedValue(env),
            getActiveEnvironmentId: jest.fn().mockResolvedValue('env1'),
            getEnvironmentById: jest.fn().mockResolvedValue(env),
            setActiveEnvironment: jest.fn().mockResolvedValue(true),
            createEnvironment: jest.fn().mockResolvedValue({ id: 'env2', name: 'Prod' }),
            updateEnvironment: jest.fn().mockResolvedValue({ id: 'env1', name: 'Renamed' }),
            deleteEnvironment: jest.fn().mockResolvedValue(true),
            duplicateEnvironment: jest.fn().mockResolvedValue({ id: 'env3', name: 'Dev (Copy)' }),
            getActiveEnvironmentVariables: jest.fn().mockResolvedValue({ a: 'secret' }),
            setEnvironmentVariable: jest.fn().mockResolvedValue(undefined),
            applyVariableChanges: jest.fn().mockResolvedValue(undefined),
            deleteEnvironmentVariable: jest.fn().mockResolvedValue(undefined),
            getEnvironmentSecretValue: jest.fn().mockResolvedValue('s3'),
            exportEnvironments: jest.fn().mockResolvedValue({ items: [env] }),
            importEnvironments: jest.fn().mockResolvedValue(true)
        };
        statusDisplay = { update: jest.fn() };
        service = new EnvironmentService(repository, statusDisplay);
        events = [];
        service.addChangeListener(event => events.push(event));
    });

    describe('read pass-throughs', () => {
        test('getAllEnvironments returns the items and reports a failure', async () => {
            expect(await service.getAllEnvironments()).toEqual([env]);

            repository.getAllEnvironments.mockRejectedValue(new Error('disk'));
            await expect(service.getAllEnvironments()).rejects.toThrow('disk');
            expect(statusDisplay.update).toHaveBeenCalledWith('Error loading environments: disk', null);
        });

        test('getActiveEnvironment, getActiveEnvironmentId and getActiveEnvironmentVariables delegate', async () => {
            expect(await service.getActiveEnvironment()).toBe(env);
            expect(await service.getActiveEnvironmentId()).toBe('env1');
            expect(await service.getActiveEnvironmentVariables()).toEqual({ a: 'secret' });
        });

        test('getSecretValue returns the stored value and falls back to an empty string', async () => {
            expect(await service.getSecretValue('env1', 'a')).toBe('s3');

            repository.getEnvironmentSecretValue.mockRejectedValue(new Error('no keychain'));
            expect(await service.getSecretValue('env1', 'a')).toBe('');
        });
    });

    describe('switchEnvironment', () => {
        test('activates the environment and notifies listeners', async () => {
            const result = await service.switchEnvironment('env1');

            expect(result).toBe(env);
            expect(repository.setActiveEnvironment).toHaveBeenCalledWith('env1');
            expect(events).toEqual([{
                type: 'environment-switched',
                environmentId: 'env1',
                environmentName: 'Dev',
                environmentColor: '#AABBCC'
            }]);
        });

        test('reports and rethrows when the environment is missing', async () => {
            repository.getEnvironmentById.mockResolvedValue(undefined);

            await expect(service.switchEnvironment('nope')).rejects.toThrow('Environment not found');
            expect(statusDisplay.update).toHaveBeenCalledWith('Error switching environment: Environment not found', null);
            expect(repository.setActiveEnvironment).not.toHaveBeenCalled();
            expect(events).toEqual([]);
        });
    });

    describe('createEnvironment', () => {
        test('trims the name, normalizes the color and notifies', async () => {
            const created = await service.createEnvironment('  Prod ', { x: '1' }, ' #abcdef ');

            expect(repository.createEnvironment).toHaveBeenCalledWith('Prod', { x: '1' }, '#ABCDEF');
            expect(statusDisplay.update).toHaveBeenCalledWith('Environment "Prod" created', null);
            expect(events).toEqual([{ type: 'environment-created', environment: created }]);
        });

        test('rejects an empty name and an invalid color with the status text', async () => {
            await expect(service.createEnvironment('   ')).rejects.toThrow('Environment name is required');
            expect(statusDisplay.update).toHaveBeenCalledWith('Error creating environment: Environment name is required', null);

            await expect(service.createEnvironment('Ok', {}, 'red')).rejects.toThrow('Environment color must be a 6-digit hex color');
            await expect(service.createEnvironment('Ok', {}, 7)).rejects.toThrow('Environment color must be a hex color');
            expect(repository.createEnvironment).not.toHaveBeenCalled();
        });
    });

    describe('updateEnvironment', () => {
        test('trims the name, normalizes color and notifies', async () => {
            const updates = { name: ' Renamed ', color: '' };
            const updated = await service.updateEnvironment('env1', updates);

            expect(repository.updateEnvironment).toHaveBeenCalledWith('env1', { name: 'Renamed', color: null });
            expect(statusDisplay.update).toHaveBeenCalledWith('Environment updated', null);
            expect(events).toEqual([{ type: 'environment-updated', environment: updated }]);
        });

        test('rejects an empty name', async () => {
            await expect(service.updateEnvironment('env1', { name: '' })).rejects.toThrow('Environment name cannot be empty');
            expect(statusDisplay.update).toHaveBeenCalledWith('Error updating environment: Environment name cannot be empty', null);
        });
    });

    describe('deleteEnvironment / duplicateEnvironment / exportEnvironment', () => {
        test('delete reports the name and notifies', async () => {
            expect(await service.deleteEnvironment('env1')).toBe(true);
            expect(statusDisplay.update).toHaveBeenCalledWith('Environment "Dev" deleted', null);
            expect(events).toEqual([{ type: 'environment-deleted', environmentId: 'env1' }]);
        });

        test('duplicate picks a unique copy name', async () => {
            repository.getAllEnvironments.mockResolvedValue({
                items: [env, { id: 'c', name: 'Dev (Copy)' }, { id: 'd', name: 'Dev (Copy) 1' }]
            });

            const copy = await service.duplicateEnvironment('env1');

            expect(repository.duplicateEnvironment).toHaveBeenCalledWith('env1', 'Dev (Copy) 2');
            expect(statusDisplay.update).toHaveBeenCalledWith('Environment duplicated as "Dev (Copy) 2"', null);
            expect(events).toEqual([{ type: 'environment-created', environment: copy }]);
        });

        test('export returns the export shape', async () => {
            expect(await service.exportEnvironment('env1')).toEqual({
                name: 'Dev',
                variables: { a: '1' },
                secretKeys: ['a'],
                color: '#AABBCC'
            });
        });

        test.each([
            ['deleteEnvironment', 'Error deleting environment: Environment not found'],
            ['duplicateEnvironment', 'Error duplicating environment: Environment not found'],
            ['exportEnvironment', 'Error exporting environment: Environment not found']
        ])('%s reports a missing environment', async (method, text) => {
            repository.getEnvironmentById.mockResolvedValue(undefined);

            await expect(service[method]('nope')).rejects.toThrow('Environment not found');
            expect(statusDisplay.update).toHaveBeenCalledWith(text, null);
        });
    });

    describe('variables', () => {
        test('setVariable, applyVariableChanges and deleteVariable delegate and return true', async () => {
            expect(await service.setVariable('env1', 'k', 'v', true)).toBe(true);
            expect(repository.setEnvironmentVariable).toHaveBeenCalledWith('env1', 'k', 'v', true);
            expect(await service.applyVariableChanges('env1', { k: null })).toBe(true);
            expect(repository.applyVariableChanges).toHaveBeenCalledWith('env1', { k: null });
            expect(await service.deleteVariable('env1', 'k')).toBe(true);
            expect(repository.deleteEnvironmentVariable).toHaveBeenCalledWith('env1', 'k');
        });

        test.each([
            ['setVariable', 'setEnvironmentVariable', 'Error setting variable: boom'],
            ['applyVariableChanges', 'applyVariableChanges', 'Error setting variable: boom'],
            ['deleteVariable', 'deleteEnvironmentVariable', 'Error deleting variable: boom']
        ])('%s reports a repository failure', async (method, repoMethod, text) => {
            repository[repoMethod].mockRejectedValue(new Error('boom'));

            await expect(service[method]('env1', 'k', 'v')).rejects.toThrow('boom');
            expect(statusDisplay.update).toHaveBeenCalledWith(text, null);
        });
    });

    describe('export / import all', () => {
        test('exportAllEnvironments wraps the items', async () => {
            expect(await service.exportAllEnvironments()).toEqual({
                version: '1.0',
                environments: [{ name: 'Dev', variables: { a: '1' }, secretKeys: ['a'], color: '#AABBCC' }]
            });
        });

        test('importEnvironments normalizes entries, reports and notifies', async () => {
            await service.importEnvironments({ environments: [{ variables: { x: '1' }, color: '#aabbcc' }] }, true);

            expect(repository.importEnvironments).toHaveBeenCalledWith({
                items: [{ id: null, name: 'Imported Environment', variables: { x: '1' }, secretKeys: [], color: '#AABBCC' }]
            }, true);
            expect(statusDisplay.update).toHaveBeenCalledWith('Environments merged successfully', null);
            expect(events).toEqual([{ type: 'environments-imported', merge: true }]);
        });

        test('importEnvironments rejects malformed data', async () => {
            await expect(service.importEnvironments({})).rejects.toThrow('Invalid import data format');
            expect(statusDisplay.update).toHaveBeenCalledWith('Error importing environments: Invalid import data format', null);
        });
    });
});
