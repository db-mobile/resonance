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
                exportCollectionAsPostman: jest.fn().mockResolvedValue({}),
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
    });

    describe('handleExport*', () => {
        test('delegates to the collection service', async () => {
            await service.handleExportOpenApiJson({ id: 'c1' });
            await service.handleExportOpenApiYaml({ id: 'c1' });
            await service.handleExportPostman({ id: 'c1' });

            expect(deps.collectionService.exportCollectionAsOpenApi).toHaveBeenNthCalledWith(1, 'c1', 'json');
            expect(deps.collectionService.exportCollectionAsOpenApi).toHaveBeenNthCalledWith(2, 'c1', 'yaml');
            expect(deps.collectionService.exportCollectionAsPostman).toHaveBeenCalledWith('c1');
        });

        test('swallows export failures', async () => {
            deps.collectionService.exportCollectionAsOpenApi.mockRejectedValue(new Error('x'));
            deps.collectionService.exportCollectionAsPostman.mockRejectedValue(new Error('x'));

            await expect(service.handleExportOpenApiJson({ id: 'c1' })).resolves.toBeUndefined();
            await expect(service.handleExportOpenApiYaml({ id: 'c1' })).resolves.toBeUndefined();
            await expect(service.handleExportPostman({ id: 'c1' })).resolves.toBeUndefined();
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
                name: 'Create user', method: 'POST', path: '/users', protocol: 'http'
            });
            expect(deps.repository.saveModifiedRequestBody).toHaveBeenCalledWith('c1', 'e1', '{"a":1}');
            expect(deps.repository.savePersistedHeaders).toHaveBeenCalledWith('c1', 'e1', [{ key: 'Accept', value: 'application/json' }]);
            expect(deps.repository.savePersistedQueryParams).toHaveBeenCalledWith('c1', 'e1', [
                { key: 'page', value: '2' },
                { key: 'q', value: '' }
            ]);
            expect(deps.repository.savePersistedAuthConfig).toHaveBeenCalledWith('c1', 'e1', { type: 'bearer', config: { token: 't' } });
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
            expect(deps.collectionService.addRequestToCollection).toHaveBeenCalledWith('c2', expect.any(Object));
            expect(deps.repository.saveModifiedRequestBody).not.toHaveBeenCalled();
            expect(deps.repository.savePersistedHeaders).not.toHaveBeenCalled();
            expect(deps.repository.savePersistedQueryParams).not.toHaveBeenCalled();
            expect(deps.repository.savePersistedAuthConfig).not.toHaveBeenCalled();
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
