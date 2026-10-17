/**
 * @fileoverview Feature descriptor building the shared RequestPipeline from the repositories and services other features provide
 * @module requestPipeline.feature
 */

import { VariableRepository } from './storage/VariableRepository.js';
import { VariableProcessor } from './variables/VariableProcessor.js';
import { VariableService } from './services/VariableService.js';
import { RequestBuilderService } from './services/RequestBuilderService.js';
import { RequestPipeline } from './services/RequestPipeline.js';
import { setRequestPipeline } from './requestServices.js';

/**
 * @param {Object} deps
 * @param {Object} deps.backendAPI
 * @param {Object|null} [deps.secretStore]
 * @param {Object|null} [deps.statusDisplay]
 * @param {Object} deps.collectionRepository
 * @param {Object} deps.environmentRepository
 * @param {Object} deps.mockServerService
 * @param {Object|null} [deps.certificates]
 * @param {Object|null} [deps.cookies]
 * @returns {RequestPipeline}
 */
export function createRequestPipeline({
    backendAPI,
    secretStore = null,
    statusDisplay = null,
    collectionRepository,
    environmentRepository,
    mockServerService,
    certificates = null,
    cookies = null
}) {
    const variableRepository = new VariableRepository(backendAPI, secretStore);
    const variableService = new VariableService(variableRepository, new VariableProcessor(), statusDisplay, environmentRepository);
    const requestBuilder = new RequestBuilderService(() => variableService, () => collectionRepository);
    return new RequestPipeline({
        backendAPI,
        collectionRepository,
        variableRepository,
        environmentRepository,
        requestBuilder,
        mockServerService,
        certificates,
        cookies
    });
}

/** @type {import('./registry/FeatureRegistry.js').FeatureDescriptor} */
export const requestPipelineFeature = {
    name: 'requestPipeline',
    create(ctx) {
        const pipeline = createRequestPipeline({
            backendAPI: ctx.backendAPI,
            secretStore: ctx.secretStore,
            statusDisplay: ctx.statusDisplay,
            collectionRepository: ctx.get('collectionRepository'),
            environmentRepository: ctx.get('environmentRepository'),
            mockServerService: ctx.get('mockServerService'),
            certificates: ctx.get('certificateController') ?? null,
            cookies: ctx.get('cookieController') ?? null
        });
        return { pipeline };
    },
    provides: { requestPipeline: 'pipeline' },
    init({ pipeline }) {
        setRequestPipeline(pipeline);
    },
};
