/* global document, DOMParser, KeyboardEvent */
import fs from 'fs';
import path from 'path';
import { templateLoader } from '../../src/modules/templateLoader.js';
import { CollectionDialogs } from '../../src/modules/ui/CollectionDialogs.js';
import { escapeHandlerCount } from '../../src/modules/ui/modalEscape.js';

const NEW_DIALOGS = './src/templates/collections/newDialogs.html';
const DOC_OPTIONS = './src/templates/docs/docOptionsDialog.html';
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function seed(templatePath, file) {
    const html = fs.readFileSync(path.join(process.cwd(), file), 'utf8');
    templateLoader.cache.set(templatePath, new DOMParser().parseFromString(html, 'text/html'));
}

function makeDeps() {
    return {
        backendAPI: {
            collections: {
                getPath: jest.fn(async () => '/default/store'),
                pickDirectory: jest.fn(async () => '/picked'),
                pickImportFile: jest.fn(async () => '/tmp/openapi.yaml')
            }
        },
        collectionService: {
            createCollection: jest.fn(async ({ name }) => ({ id: 'new-col', name })),
            addRequestToCollection: jest.fn(async () => ({ id: 'ep-1' }))
        },
        collectionRepository: {
            getAll: jest.fn(async () => [{ id: 'c1', name: 'Shop' }]),
            savePersistedPathParams: jest.fn(async () => {}),
            savePersistedQueryParams: jest.fn(async () => {}),
            savePersistedHeaders: jest.fn(async () => {}),
            saveModifiedRequestBody: jest.fn(async () => {}),
            savePersistedAuthConfig: jest.fn(async () => {}),
            savePersistedUrl: jest.fn(async () => {})
        }
    };
}

function submit(form) {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
}

describe('CollectionDialogs', () => {
    let deps;
    let dialogs;

    beforeEach(() => {
        seed(NEW_DIALOGS, 'src/templates/collections/newDialogs.html');
        seed(DOC_OPTIONS, 'src/templates/docs/docOptionsDialog.html');
        deps = makeDeps();
        dialogs = new CollectionDialogs(deps);
    });

    afterEach(() => {
        document.body.innerHTML = '';
        expect(escapeHandlerCount()).toBe(0);
    });

    describe('showNewCollectionDialog', () => {
        test('prefills the default location and resolves with name and storage path', async () => {
            const shown = dialogs.showNewCollectionDialog();
            await flush();

            expect(document.querySelector('#collection-location').value).toBe('/default/store');
            document.querySelector('#collection-location-btn').click();
            await flush();
            expect(document.querySelector('#collection-location').value).toBe('/picked');

            document.querySelector('#collection-name').value = '  My API ';
            submit(document.querySelector('#new-collection-form'));

            await expect(shown).resolves.toEqual({ name: 'My API', storageParentPath: '/picked' });
            expect(document.querySelector('#new-collection-form')).toBeNull();
        });

        test('ignores an empty name and resolves null on cancel', async () => {
            const shown = dialogs.showNewCollectionDialog();
            await flush();

            submit(document.querySelector('#new-collection-form'));
            expect(document.querySelector('#new-collection-form')).not.toBeNull();

            document.querySelector('#cancel-btn').click();
            await expect(shown).resolves.toBeNull();
        });

        test('Escape resolves null once', async () => {
            const shown = dialogs.showNewCollectionDialog();
            await flush();
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            await expect(shown).resolves.toBeNull();
        });
    });

    describe('showNewRequestDialog', () => {
        test('resolves a normalised HTTP request', async () => {
            const shown = dialogs.showNewRequestDialog();
            await flush();

            document.querySelector('#request-name').value = 'Ping';
            document.querySelector('#request-method').value = 'POST';
            document.querySelector('#request-path').value = 'ping';
            submit(document.querySelector('#new-request-form'));

            await expect(shown).resolves.toEqual({ name: 'Ping', protocol: 'http', method: 'POST', path: '/ping' });
        });

        test('switching to gRPC shows the target group and resolves a gRPC request', async () => {
            const shown = dialogs.showNewRequestDialog();
            await flush();

            const protocolSelect = document.querySelector('#request-protocol');
            protocolSelect.value = 'grpc';
            protocolSelect.dispatchEvent(new Event('change'));

            expect(document.querySelector('#grpc-target-group').classList.contains('is-hidden')).toBe(false);
            expect(document.querySelector('#request-path').parentElement.classList.contains('is-hidden')).toBe(true);

            document.querySelector('#request-name').value = 'Greet';
            document.querySelector('#grpc-target').value = 'localhost:50051';
            submit(document.querySelector('#new-request-form'));

            await expect(shown).resolves.toEqual({
                name: 'Greet', protocol: 'grpc', target: 'localhost:50051', fullMethod: '', requestJson: '{}'
            });
        });
    });

    describe('showSaveToCollectionDialog', () => {
        test('suggests a name from the URL and persists the request with its sidecars', async () => {
            const shown = dialogs.showSaveToCollectionDialog({
                name: 'New Request',
                url: 'https://api.example.com/v1/users?x=1',
                method: 'GET',
                protocol: 'http',
                pathParams: { id: '7' },
                queryParams: [{ key: 'x', value: '1' }],
                headers: [{ key: 'Accept', value: 'application/json' }],
                body: { content: '{"a":1}' },
                authType: 'bearer',
                authConfig: { token: 't' }
            });
            await flush();

            expect(document.querySelector('#save-request-name').value).toBe('GET /users');
            const options = Array.from(document.querySelectorAll('#save-collection-select option')).map(o => [o.value, o.textContent]);
            expect(options).toEqual([['', 'Select a collection...'], ['c1', 'Shop'], ['__new__', '+ Create new collection']]);
            expect(document.querySelector('#new-collection-location-input').value).toBe('/default/store');

            document.querySelector('#save-collection-select').value = 'c1';
            submit(document.querySelector('#save-to-collection-form'));

            await expect(shown).resolves.toEqual({
                collectionId: 'c1', endpointId: 'ep-1', name: 'GET /users', collectionName: 'Shop'
            });
            expect(deps.collectionService.addRequestToCollection).toHaveBeenCalledWith('c1', {
                name: 'GET /users', protocol: 'http', method: 'GET',
                path: 'https://api.example.com/v1/users?x=1'
            });
            expect(deps.collectionRepository.savePersistedPathParams).toHaveBeenCalledWith('c1', 'ep-1', [{ key: 'id', value: '7' }]);
            expect(deps.collectionRepository.savePersistedQueryParams).toHaveBeenCalledWith('c1', 'ep-1', [{ key: 'x', value: '1', enabled: true }]);
            expect(deps.collectionRepository.savePersistedHeaders).toHaveBeenCalledWith('c1', 'ep-1', [{ key: 'Accept', value: 'application/json', enabled: true }]);
            expect(deps.collectionRepository.saveModifiedRequestBody).toHaveBeenCalledWith('c1', 'ep-1', '{"a":1}');
            expect(deps.collectionRepository.savePersistedAuthConfig).toHaveBeenCalledWith('c1', 'ep-1', { type: 'bearer', config: { token: 't' } });
            expect(deps.collectionRepository.savePersistedUrl).toHaveBeenCalledWith('c1', 'ep-1', 'https://api.example.com/v1/users?x=1');
        });

        test('creating a new collection inline uses the picked location and skips empty sidecars', async () => {
            const shown = dialogs.showSaveToCollectionDialog({
                name: 'Custom name', url: 'https://x.test/a', method: 'POST', protocol: 'http', authType: 'none'
            });
            await flush();

            expect(document.querySelector('#save-request-name').value).toBe('Custom name');
            const select = document.querySelector('#save-collection-select');
            select.value = '__new__';
            select.dispatchEvent(new Event('change'));
            expect(document.querySelector('#new-collection-name-group').classList.contains('is-hidden')).toBe(false);

            submit(document.querySelector('#save-to-collection-form'));
            await flush();
            expect(deps.collectionService.createCollection).not.toHaveBeenCalled();

            document.querySelector('#new-collection-name-input').value = 'Fresh';
            submit(document.querySelector('#save-to-collection-form'));

            await expect(shown).resolves.toEqual({
                collectionId: 'new-col', endpointId: 'ep-1', name: 'Custom name', collectionName: 'Fresh'
            });
            expect(deps.collectionService.createCollection).toHaveBeenCalledWith({ name: 'Fresh', storageParentPath: '/default/store' });
            expect(deps.collectionRepository.savePersistedPathParams).not.toHaveBeenCalled();
            expect(deps.collectionRepository.savePersistedQueryParams).not.toHaveBeenCalled();
            expect(deps.collectionRepository.savePersistedHeaders).not.toHaveBeenCalled();
            expect(deps.collectionRepository.saveModifiedRequestBody).not.toHaveBeenCalled();
            expect(deps.collectionRepository.savePersistedAuthConfig).not.toHaveBeenCalled();
            expect(deps.collectionRepository.savePersistedUrl).toHaveBeenCalledWith('new-col', 'ep-1', 'https://x.test/a');
        });

        test('GraphQL and gRPC requests carry their protocol fields', async () => {
            const gqlShown = dialogs.showSaveToCollectionDialog({
                name: 'Q', url: 'https://g.test/graphql', method: 'POST', protocol: 'graphql',
                query: '{ a }', variables: '{}', operationName: 'Op'
            });
            await flush();
            document.querySelector('#save-collection-select').value = 'c1';
            submit(document.querySelector('#save-to-collection-form'));
            await gqlShown;
            expect(deps.collectionService.addRequestToCollection).toHaveBeenLastCalledWith('c1', expect.objectContaining({
                protocol: 'graphql', query: '{ a }', variables: '{}', operationName: 'Op', url: 'https://g.test/graphql'
            }));

            const grpcShown = dialogs.showSaveToCollectionDialog({
                name: 'G', protocol: 'grpc', grpc: { target: 'localhost:1', fullMethod: 'pkg.Svc/Do', requestJson: '{}' }
            });
            await flush();
            document.querySelector('#save-collection-select').value = 'c1';
            submit(document.querySelector('#save-to-collection-form'));
            await grpcShown;
            expect(deps.collectionService.addRequestToCollection).toHaveBeenLastCalledWith('c1', {
                name: 'G', protocol: 'grpc', method: 'GET', path: '/',
                target: 'localhost:1', fullMethod: 'pkg.Svc/Do', requestJson: '{}'
            });
            expect(deps.collectionRepository.savePersistedUrl).toHaveBeenCalledTimes(1);
        });

        test('a failing save rejects and closes the dialog', async () => {
            deps.collectionService.addRequestToCollection.mockRejectedValueOnce(new Error('disk full'));
            const shown = dialogs.showSaveToCollectionDialog({ name: 'X', url: 'https://x.test', method: 'GET', protocol: 'http' });
            await flush();
            document.querySelector('#save-collection-select').value = 'c1';
            submit(document.querySelector('#save-to-collection-form'));

            await expect(shown).rejects.toThrow('disk full');
            expect(document.querySelector('#save-to-collection-form')).toBeNull();
        });
    });

    describe('showCollectionImportDialog', () => {
        test('sets the collection texts, requires a file and resolves the picked paths', async () => {
            const shown = dialogs.showCollectionImportDialog({ importKind: 'collection' });
            await flush();

            expect(document.querySelector('#import-collection-title').textContent).toBe('Import Collection');
            expect(document.querySelector('#import-collection-subtitle').textContent)
                .toBe('Choose an OpenAPI/Swagger, Postman, Insomnia, or HAR file — the format is detected automatically.');
            expect(document.querySelector('#import-source-file').textContent).toBe('No file selected');
            expect(document.querySelector('#import-destination-folder').textContent).toBe('/default/store');

            submit(document.querySelector('#import-collection-form'));
            const error = document.querySelector('#import-dialog-error');
            expect(error.classList.contains('is-hidden')).toBe(false);
            expect(error.textContent).toBe('Choose an import file before continuing.');

            document.querySelector('#import-source-file-btn').click();
            await flush();
            expect(deps.backendAPI.collections.pickImportFile).toHaveBeenCalledWith('collection');
            expect(document.querySelector('#import-source-file').textContent).toBe('openapi.yaml');
            expect(document.querySelector('#import-source-card').classList.contains('is-selected')).toBe(true);
            expect(error.classList.contains('is-hidden')).toBe(true);

            submit(document.querySelector('#import-collection-form'));
            await expect(shown).resolves.toEqual({ filePath: '/tmp/openapi.yaml', storageParentPath: '/default/store' });
        });
    });

    describe('showDocOptionsDialog', () => {
        test('lists the languages and resolves the chosen options', async () => {
            const shown = dialogs.showDocOptionsDialog();
            await flush();

            const checkboxes = document.querySelectorAll('#language-checkboxes input[type="checkbox"]');
            expect(checkboxes.length).toBeGreaterThan(0);
            checkboxes.forEach(cb => { cb.checked = false; });
            checkboxes[0].checked = true;
            document.querySelector('#doc-include-examples').checked = false;
            document.querySelector('#doc-format').value = 'markdown';
            submit(document.querySelector('#doc-options-form'));

            await expect(shown).resolves.toEqual({
                format: 'markdown',
                includeExamples: false,
                languages: [checkboxes[0].dataset.langId]
            });
        });
    });
});
