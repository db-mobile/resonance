import { CollectionImportExportService } from '../../src/modules/services/CollectionImportExportService.js';
import { toast } from '../../src/modules/ui/Toast.js';
import { app } from '../../src/modules/appContext.js';

jest.mock('../../src/modules/ui/Toast.js', () => ({
    toast: { error: jest.fn(), success: jest.fn(), info: jest.fn() }
}));

describe('CollectionImportExportService', () => {
    let deps;
    let service;

    const curlEndpoint = {
        name: 'Create user',
        method: 'POST',
        path: '/users',
        headers: { Accept: 'application/json' },
        parameters: { query: { page: { example: '2' }, q: {} } },
        requestBody: { example: '{"a":1}' }
    };

    beforeEach(() => {
        jest.clearAllMocks();
        deps = {
            backendAPI: {
                docs: { save: jest.fn().mockResolvedValue({ success: true }) },
                collections: {}
            },
            repository: {
                saveModifiedRequestBody: jest.fn().mockResolvedValue(undefined),
                savePersistedHeaders: jest.fn().mockResolvedValue(undefined),
                savePersistedQueryParams: jest.fn().mockResolvedValue(undefined),
                savePersistedAuthConfig: jest.fn().mockResolvedValue(undefined),
                getById: jest.fn().mockResolvedValue(null)
            },
            collectionService: {
                exportCollectionAsOpenApi: jest.fn().mockResolvedValue({}),
                loadCollections: jest.fn().mockResolvedValue([{ id: 'c1', name: 'Existing' }]),
                createCollection: jest.fn().mockResolvedValue({ id: 'c2', name: 'Fresh' }),
                addRequestToCollection: jest.fn().mockResolvedValue({ id: 'e1' })
            },
            docGeneratorService: {
                hasHttpEndpoints: jest.fn().mockReturnValue(true),
                generateHtml: jest.fn().mockResolvedValue('<html>'),
                generateMarkdown: jest.fn().mockResolvedValue('# md')
            },
            statusDisplay: { update: jest.fn() },
            collectionDialogs: { showDocOptionsDialog: jest.fn() },
            curlImportDialog: { show: jest.fn() },
            refreshCollections: jest.fn().mockResolvedValue(undefined)
        };
        service = new CollectionImportExportService(deps);
        delete app.collectionController;
        delete app.environmentController;
    });

    describe('importCollectionFile', () => {
        beforeEach(() => {
            deps.collectionDialogs.showCollectionImportDialog = jest.fn().mockResolvedValue({
                filePath: '/tmp/import.json',
                storageParentPath: '/store'
            });
            deps.backendAPI.collections.importCollectionFile = jest.fn();
            app.environmentController = {
                handleImportEnvironment: jest.fn(async (env) => ({ id: 'env1', name: `${env.name} 1` }))
            };
        });

        test('a collection result refreshes the sidebar, imports bundled environments and toasts', async () => {
            const collection = { id: 'c1', name: 'Pets', endpoints: [] };
            deps.backendAPI.collections.importCollectionFile.mockResolvedValue({
                format: 'insomnia',
                collection,
                environments: [{ name: 'Staging', variables: { host: 'x' } }],
                skippedRequests: 2
            });

            await expect(service.importCollectionFile()).resolves.toBe(collection);

            expect(deps.backendAPI.collections.importCollectionFile).toHaveBeenCalledWith('/tmp/import.json', '/store');
            expect(deps.refreshCollections).toHaveBeenCalledWith(false);
            expect(app.environmentController.handleImportEnvironment).toHaveBeenCalledWith({ name: 'Staging', variables: { host: 'x' } });
            expect(toast.success).toHaveBeenCalledWith('Imported "Pets" (+1 environment(s), 2 non-HTTP request(s) skipped)');
        });

        test('an environment-only result creates the environments without touching collections', async () => {
            deps.backendAPI.collections.importCollectionFile.mockResolvedValue({
                format: 'postman_environment',
                environments: [{ name: 'Dev', variables: { host: 'x' }, secretKeys: ['token'] }]
            });

            await expect(service.importCollectionFile()).resolves.toBeNull();

            expect(deps.refreshCollections).not.toHaveBeenCalled();
            expect(app.environmentController.handleImportEnvironment).toHaveBeenCalledWith({ name: 'Dev', variables: { host: 'x' }, secretKeys: ['token'] });
            expect(toast.success).toHaveBeenCalledWith('Imported environment "Dev 1"');
        });

        test('several imported environments are counted in the toast', async () => {
            deps.backendAPI.collections.importCollectionFile.mockResolvedValue({
                format: 'insomnia_environment',
                environments: [{ name: 'Staging', variables: {} }, { name: 'Prod', variables: {} }]
            });

            await service.importCollectionFile();

            expect(app.environmentController.handleImportEnvironment).toHaveBeenCalledTimes(2);
            expect(toast.success).toHaveBeenCalledWith('Imported 2 environments');
        });

        test('a cancelled dialog or picker reports the cancellation', async () => {
            deps.collectionDialogs.showCollectionImportDialog.mockResolvedValueOnce(null);
            await expect(service.importCollectionFile()).resolves.toBeNull();
            expect(deps.backendAPI.collections.importCollectionFile).not.toHaveBeenCalled();

            deps.backendAPI.collections.importCollectionFile.mockResolvedValue(null);
            await expect(service.importCollectionFile()).resolves.toBeNull();
            expect(deps.statusDisplay.update).toHaveBeenCalledWith('Import cancelled', null);
            expect(toast.success).not.toHaveBeenCalled();
        });

        test('a failed import toasts the error and rethrows', async () => {
            deps.backendAPI.collections.importCollectionFile.mockRejectedValue('Not a Postman environment file');

            await expect(service.importCollectionFile()).rejects.toBe('Not a Postman environment file');
            expect(toast.error).toHaveBeenCalledWith('Import failed: Not a Postman environment file');
        });
    });

    test.each([
        { '200': { content: { 'application/json': { schema: false } } } },
        { '200': { schema: false } }
    ])('imports a false response schema without dropping it', async (responses) => {
        deps.repository.saveResponseSchema = jest.fn().mockResolvedValue(undefined);

        await service.saveEndpointResponseSchema('c1', { id: 'e1', responses });

        expect(deps.repository.saveResponseSchema).toHaveBeenCalledWith('c1', 'e1', false);
    });

    describe('handleExport*', () => {
        test('delegates to the collection service', async () => {
            await service.handleExportOpenApiJson({ id: 'c1' });
            await service.handleExportOpenApiYaml({ id: 'c1' });

            expect(deps.collectionService.exportCollectionAsOpenApi).toHaveBeenNthCalledWith(1, 'c1', 'json');
            expect(deps.collectionService.exportCollectionAsOpenApi).toHaveBeenNthCalledWith(2, 'c1', 'yaml');
        });

        test('swallows export failures', async () => {
            deps.collectionService.exportCollectionAsOpenApi.mockRejectedValue(new Error('x'));

            await expect(service.handleExportOpenApiJson({ id: 'c1' })).resolves.toBeUndefined();
            await expect(service.handleExportOpenApiYaml({ id: 'c1' })).resolves.toBeUndefined();
        });
    });

    describe('handleGenerateDocumentation', () => {
        const collection = { id: 'c1', name: 'My API v2!' };

        test('refuses a collection without HTTP endpoints', async () => {
            deps.docGeneratorService.hasHttpEndpoints.mockReturnValue(false);

            await service.handleGenerateDocumentation(collection);

            expect(toast.error).toHaveBeenCalledWith('This collection has no HTTP requests to document');
            expect(deps.collectionDialogs.showDocOptionsDialog).not.toHaveBeenCalled();
        });

        test('does nothing when the dialog is cancelled', async () => {
            deps.collectionDialogs.showDocOptionsDialog.mockResolvedValue(null);

            await service.handleGenerateDocumentation(collection);

            expect(deps.backendAPI.docs.save).not.toHaveBeenCalled();
            expect(deps.statusDisplay.update).not.toHaveBeenCalled();
        });

        test('generates HTML with the html extension and mime type', async () => {
            deps.collectionDialogs.showDocOptionsDialog.mockResolvedValue({
                format: 'html', includeExamples: true, languages: ['curl']
            });

            await service.handleGenerateDocumentation(collection);

            expect(deps.docGeneratorService.generateHtml).toHaveBeenCalledWith(collection, {
                includePersistedData: true,
                languages: ['curl']
            });
            expect(deps.backendAPI.docs.save).toHaveBeenCalledWith('My_API_v2__docs.html', '<html>', 'text/html');
            expect(deps.statusDisplay.update.mock.calls).toEqual([
                ['Generating documentation...', null],
                ['', null]
            ]);
            expect(toast.success).toHaveBeenCalledWith('Documentation generated successfully');
        });

        test('generates markdown for any other format', async () => {
            deps.collectionDialogs.showDocOptionsDialog.mockResolvedValue({
                format: 'markdown', includeExamples: false, languages: []
            });
            deps.backendAPI.docs.save.mockResolvedValue({ success: false, cancelled: false });

            await service.handleGenerateDocumentation(collection);

            expect(deps.docGeneratorService.generateMarkdown).toHaveBeenCalledWith(collection, {
                includePersistedData: false,
                languages: []
            });
            expect(deps.backendAPI.docs.save).toHaveBeenCalledWith('My_API_v2__docs.md', '# md', 'text/markdown');
            expect(toast.error).toHaveBeenCalledWith('Failed to generate documentation');
        });

        test('a cancelled save shows no toast', async () => {
            deps.collectionDialogs.showDocOptionsDialog.mockResolvedValue({ format: 'markdown', languages: [] });
            deps.backendAPI.docs.save.mockResolvedValue({ success: false, cancelled: true });

            await service.handleGenerateDocumentation(collection);

            expect(toast.error).not.toHaveBeenCalled();
            expect(toast.success).not.toHaveBeenCalled();
        });

        test('reports a generation failure', async () => {
            deps.collectionDialogs.showDocOptionsDialog.mockResolvedValue({ format: 'html', languages: [] });
            deps.docGeneratorService.generateHtml.mockRejectedValue(new Error('kaput'));

            await service.handleGenerateDocumentation(collection);

            expect(toast.error).toHaveBeenCalledWith('Documentation generation failed: kaput');
            expect(deps.statusDisplay.update).toHaveBeenLastCalledWith('', null);
        });
    });

    describe('handleImportCurl', () => {
        test('returns when the dialog is cancelled', async () => {
            deps.curlImportDialog.show.mockResolvedValue(null);

            await service.handleImportCurl({ id: 'c1' });

            expect(deps.curlImportDialog.show).toHaveBeenCalledWith([{ id: 'c1', name: 'Existing' }], { targetCollectionId: 'c1' });
            expect(deps.collectionService.addRequestToCollection).not.toHaveBeenCalled();
        });

        test('imports into an existing collection and persists every sidecar', async () => {
            deps.curlImportDialog.show.mockResolvedValue({
                collectionId: 'c1',
                endpoint: curlEndpoint,
                auth: { type: 'bearer', config: { token: 't' } }
            });

            await service.handleImportCurl(null);

            expect(deps.curlImportDialog.show).toHaveBeenCalledWith(expect.any(Array), { targetCollectionId: null });
            expect(deps.collectionService.addRequestToCollection).toHaveBeenCalledWith('c1', {
                name: 'Create user', method: 'POST', path: '/users', protocol: 'http',
                body: '{"a":1}',
                headers: [{ key: 'Accept', value: 'application/json' }],
                queryParams: [
                    { key: 'page', value: '2' },
                    { key: 'q', value: '' }
                ],
                authConfig: { type: 'bearer', config: { token: 't' } }
            });
            expect(deps.refreshCollections).toHaveBeenCalledWith(false);
            expect(toast.success).toHaveBeenCalledWith('Imported cURL as "Create user"');
        });

        test('creates a new collection when a name is given and skips empty sidecars', async () => {
            deps.curlImportDialog.show.mockResolvedValue({
                newCollectionName: 'Fresh',
                newCollectionLocation: '/tmp/x',
                endpoint: { name: 'Ping', method: 'GET', path: '/ping', headers: {}, parameters: { query: {} } }
            });

            await service.handleImportCurl(null);

            expect(deps.collectionService.createCollection).toHaveBeenCalledWith({ name: 'Fresh', storageParentPath: '/tmp/x' });
            expect(deps.collectionService.addRequestToCollection).toHaveBeenCalledWith('c2', {
                name: 'Ping', method: 'GET', path: '/ping', protocol: 'http', headers: [], queryParams: []
            });
        });

        test('reports an unknown target collection', async () => {
            deps.curlImportDialog.show.mockResolvedValue({ collectionId: 'missing', endpoint: curlEndpoint });

            await service.handleImportCurl(null);

            expect(deps.statusDisplay.update).toHaveBeenCalledWith('Collection not found', null);
            expect(deps.collectionService.addRequestToCollection).not.toHaveBeenCalled();
        });

        test('toasts a failure', async () => {
            deps.curlImportDialog.show.mockResolvedValue({ collectionId: 'c1', endpoint: curlEndpoint });
            deps.collectionService.addRequestToCollection.mockRejectedValue(new Error('nope'));

            await service.handleImportCurl(null);

            expect(toast.error).toHaveBeenCalledWith('cURL import failed: nope');
        });
    });
});
