/**
 * @fileoverview Feature descriptor wiring the client-certificate (mTLS) stack
 * (Repository → Service → Controller) for the FeatureRegistry.
 * @module certificate.feature
 */

import { CertificateRepository } from './storage/CertificateRepository.js';
import { CertificateService } from './services/CertificateService.js';
import { CertificateController } from './controllers/CertificateController.js';

/** @type {import('./registry/FeatureRegistry.js').FeatureDescriptor} */
export const certificateFeature = {
    name: 'certificate',
    create(ctx) {
        const repository = new CertificateRepository(ctx.backendAPI);
        const service = new CertificateService(repository);
        const controller = new CertificateController(service);
        return { repository, service, controller };
    },
    // Exposed for the request path: apiHandler resolves a cert by host before sending.
    globals: { certificateController: 'controller' },
    async init({ controller }) {
        await controller.initialize();
    },
};
