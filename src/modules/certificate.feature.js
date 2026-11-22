/**
 * @fileoverview Feature descriptor wiring the client-certificate (mTLS) stack
 * @module certificate.feature
 */

import { CertificateRepository } from './storage/CertificateRepository.js';
import { CertificateService } from './services/CertificateService.js';

/** @type {import('./registry/FeatureRegistry.js').FeatureDescriptor} */
export const certificateFeature = {
    name: 'certificate',
    create(ctx) {
        const repository = new CertificateRepository(ctx.backendAPI);
        const service = new CertificateService(repository);
        return { repository, service };
    },
    globals: { certificateController: 'service' },
    provides: { certificateController: 'service' },
    async init({ service }) {
        try {
            await service.getItems();
        } catch {}
    },
};
