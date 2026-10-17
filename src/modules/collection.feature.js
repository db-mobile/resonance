/**
 * @fileoverview Feature descriptor wiring the collection sidebar stack (Repository → Services → UI → Controller)
 * @module collection.feature
 */

import { CollectionRepository } from './storage/CollectionRepository.js';
import { VariableRepository } from './storage/VariableRepository.js';
import { SchemaProcessor } from './schema/SchemaProcessor.js';
import { VariableProcessor } from './variables/VariableProcessor.js';
import { CollectionService } from './services/CollectionService.js';
import { VariableService } from './services/VariableService.js';
import { DocGeneratorService } from './services/DocGeneratorService.js';
import { CollectionEndpointLoaderService } from './services/CollectionEndpointLoaderService.js';
import { CollectionImportExportService } from './services/CollectionImportExportService.js';
import { CollectionRequestPersistenceService } from './services/CollectionRequestPersistenceService.js';
import { CollectionRenderer } from './ui/CollectionRenderer.js';
import { ContextMenu } from './ui/ContextMenu.js';
import { RenameDialog } from './ui/RenameDialog.js';
import { ConfirmDialog } from './ui/ConfirmDialog.js';
import { MoveRequestDialog } from './ui/MoveRequestDialog.js';
import { VariableManager } from './ui/VariableManager.js';
import { CurlImportDialog } from './ui/CurlImportDialog.js';
import { CollectionDialogs } from './ui/CollectionDialogs.js';
import { CollectionAuthDialog } from './ui/CollectionAuthDialog.js';
import { CollectionController } from './controllers/CollectionController.js';
import { RequestFormReader } from './requestFormReader.js';
import { app } from './appContext.js';

/** @type {import('./registry/FeatureRegistry.js').FeatureDescriptor} */
export const collectionFeature = {
    name: 'collection',
    create(ctx) {
        const repository = new CollectionRepository(ctx.backendAPI, ctx.secretStore);
        const variableRepository = new VariableRepository(ctx.backendAPI, ctx.secretStore);
        const schemaProcessor = new SchemaProcessor();
        const service = new CollectionService(repository, schemaProcessor, ctx.statusDisplay, ctx.toast ?? null);
        const variableService = new VariableService(variableRepository, new VariableProcessor(), ctx.statusDisplay);
        const renderer = new CollectionRenderer('collections-list', {
            load: () => repository.getCollectionExpansionStates(),
            save: (state) => repository.saveCollectionExpansionStates(state)
        });
        const formReader = new RequestFormReader({
            authManager: ctx.get('authManager') ?? null,
            graphqlBodyManager: ctx.get('graphqlBodyManager') ?? null,
            captureGrpcState: () => (app.captureGrpcState ? app.captureGrpcState() : {})
        });
        const collectionDialogs = new CollectionDialogs({
            backendAPI: ctx.backendAPI,
            collectionService: service,
            listCollections: () => repository.getAll()
        });
        const curlImportDialog = new CurlImportDialog();
        const docGeneratorService = new DocGeneratorService(repository);

        // eslint-disable-next-line prefer-const
        let controller;
        const refreshCollections = (preserveExpansionState = false) => (preserveExpansionState
            ? controller.loadCollectionsWithExpansionState()
            : controller.loadCollections());

        const endpointLoaderService = new CollectionEndpointLoaderService({
            repository,
            collectionService: service,
            schemaProcessor,
            setActiveEndpoint: (collectionId, endpointId) => renderer.setActiveEndpoint(collectionId, endpointId)
        });
        const importExportService = new CollectionImportExportService({
            backendAPI: ctx.backendAPI,
            repository,
            collectionService: service,
            docGeneratorService,
            statusDisplay: ctx.statusDisplay,
            collectionDialogs,
            curlImportDialog,
            refreshCollections
        });
        const requestPersistenceService = new CollectionRequestPersistenceService({
            repository,
            collectionService: service,
            statusDisplay: ctx.statusDisplay,
            refreshCollections: () => refreshCollections(true),
            formReader
        });

        controller = new CollectionController({
            backendAPI: ctx.backendAPI,
            repository,
            service,
            variableService,
            renderer,
            endpointLoaderService,
            importExportService,
            requestPersistenceService,
            collectionDialogs,
            contextMenu: new ContextMenu(),
            renameDialog: new RenameDialog(),
            confirmDialog: new ConfirmDialog(),
            moveRequestDialog: new MoveRequestDialog(),
            variableManager: new VariableManager(),
            collectionAuthDialog: new CollectionAuthDialog(),
            formReader,
            searchInput: document.getElementById('collections-search-input')
        });

        return { repository, service, variableService, renderer, controller, requestPersistenceService, importExportService };
    },
    globals: { collectionController: 'controller', collectionService: 'service' },
    provides: { collectionRepository: 'repository', collectionController: 'controller' },
};
