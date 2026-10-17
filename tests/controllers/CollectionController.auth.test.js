import { CollectionController } from '../../src/modules/controllers/CollectionController.js';
import { app } from '../../src/modules/appContext.js';

function makeController() {
    const controller = Object.create(CollectionController.prototype);
    controller.repository = {
        saveCollectionAuthConfig: jest.fn().mockResolvedValue(undefined),
        saveFolderAuthConfig: jest.fn().mockResolvedValue(undefined)
    };
    controller.collectionAuthDialog = { show: jest.fn() };
    controller.renameDialog = { show: jest.fn() };
    controller.variableManager = { show: jest.fn() };
    controller.service = { renameCollection: jest.fn().mockResolvedValue(undefined) };
    controller.variableService = {
        getCollectionVariableEntries: jest.fn().mockResolvedValue([{ key: 'host', value: 'h' }]),
        setMultipleVariables: jest.fn().mockResolvedValue(undefined)
    };
    controller.loadCollections = jest.fn().mockResolvedValue(undefined);
    return controller;
}

const collection = { id: 'c1', name: 'Petstore' };
const folder = { id: 'f1', name: 'Admin' };

afterEach(() => {
    delete app.authManager;
});

describe('CollectionController auth dialogs', () => {
    test('saves a collection auth result and re-renders an inheriting form', async () => {
        const controller = makeController();
        const result = { type: 'bearer', config: { token: 't' } };
        controller.collectionAuthDialog.show.mockResolvedValue(result);
        app.authManager = { getAuthConfig: () => ({ type: 'inherit' }), renderAuthFields: jest.fn() };

        await controller.handleCollectionAuth(collection);

        expect(controller.collectionAuthDialog.show).toHaveBeenCalledWith(collection, controller.repository);
        expect(controller.repository.saveCollectionAuthConfig).toHaveBeenCalledWith('c1', result);
        expect(app.authManager.renderAuthFields).toHaveBeenCalledWith('inherit');
    });

    test('saves a folder auth result and leaves a non-inheriting form alone', async () => {
        const controller = makeController();
        const result = { type: 'basic', config: {} };
        controller.collectionAuthDialog.show.mockResolvedValue(result);
        app.authManager = { getAuthConfig: () => ({ type: 'bearer' }), renderAuthFields: jest.fn() };

        await controller.handleFolderAuth(collection, folder);

        expect(controller.collectionAuthDialog.show).toHaveBeenCalledWith(collection, controller.repository, { folder });
        expect(controller.repository.saveFolderAuthConfig).toHaveBeenCalledWith('c1', 'f1', result);
        expect(app.authManager.renderAuthFields).not.toHaveBeenCalled();
    });

    test('a cancelled dialog saves nothing', async () => {
        const controller = makeController();
        controller.collectionAuthDialog.show.mockResolvedValue(null);

        await controller.handleCollectionAuth(collection);
        await controller.handleFolderAuth(collection, folder);

        expect(controller.repository.saveCollectionAuthConfig).not.toHaveBeenCalled();
        expect(controller.repository.saveFolderAuthConfig).not.toHaveBeenCalled();
    });

    test('refreshInheritHint tolerates a missing auth manager', () => {
        expect(() => makeController().refreshInheritHint()).not.toThrow();
    });
});

describe('CollectionController rename and variables', () => {
    test('renames the collection only when the name changed', async () => {
        const controller = makeController();
        controller.renameDialog.show.mockResolvedValueOnce('Petstore').mockResolvedValueOnce('Zoo');

        await controller.handleRename(collection);
        expect(controller.service.renameCollection).not.toHaveBeenCalled();

        await controller.handleRename(collection);
        expect(controller.service.renameCollection).toHaveBeenCalledWith('c1', 'Zoo');
        expect(controller.loadCollections).toHaveBeenCalledTimes(1);
    });

    test('opens the variable manager with the current entries and stores the result', async () => {
        const controller = makeController();
        controller.variableManager.show.mockResolvedValue({ variables: { host: 'x' }, secretKeys: ['host'] });

        await controller.handleVariables(collection);

        expect(controller.variableManager.show).toHaveBeenCalledWith('Petstore', [{ key: 'host', value: 'h' }]);
        expect(controller.variableService.setMultipleVariables).toHaveBeenCalledWith('c1', { host: 'x' }, ['host']);
    });

    test('a cancelled variable manager stores nothing', async () => {
        const controller = makeController();
        controller.variableManager.show.mockResolvedValue(null);

        await controller.handleVariables(collection);

        expect(controller.variableService.setMultipleVariables).not.toHaveBeenCalled();
    });
});
