/**
 * @fileoverview Modal dialog reporting data the startup migration could not convert
 * @module ui/MigrationNoticeDialog
 */

import { BaseModal } from './BaseModal.js';
import { translate } from '../utils/translate.js';

const LAST_RELEASE_CONVERTING_OLD_DATA_VERSIONS = '3.6.0';
const LAST_RELEASE_CONVERTING_GLOBAL_STORE_COLLECTIONS = '3.3.0';

const UNSUPPORTED_NOTICES = {
    globalStoreCollections: {
        key: 'data_migration.global_store_collections',
        fallback: 'Collections saved by a Resonance release from before March 2026 are still in your settings. This version can no longer convert them, so they were left unchanged. Install Resonance {{release}}, start it once, then update again.',
        release: LAST_RELEASE_CONVERTING_GLOBAL_STORE_COLLECTIONS
    },
    v1Collections: {
        key: 'data_migration.v1_collections',
        fallback: 'Some collections are still stored in the folder layout of Resonance releases from before August 2026. This version can no longer convert them, so they were left unchanged. Install Resonance {{release}}, open each of them and save any change, then update again.',
        release: LAST_RELEASE_CONVERTING_OLD_DATA_VERSIONS
    },
    collectionRunners: {
        key: 'data_migration.store_runners',
        fallback: 'Saved runners from a Resonance release from before October 2026 are still in your settings. This version can no longer move them into their collections, so they were left unchanged. Install Resonance {{release}}, start it once with those collections open, then update again.',
        release: LAST_RELEASE_CONVERTING_OLD_DATA_VERSIONS
    },
    storeScripts: {
        key: 'data_migration.store_scripts',
        fallback: 'Scripts saved by a Resonance release from before April 2026 are still in your settings. This version can no longer move them into their requests, so they were left unchanged. Install Resonance {{release}}, open each affected request once, then update again.',
        release: LAST_RELEASE_CONVERTING_OLD_DATA_VERSIONS
    }
};

/**
 * @param {{kind: string, step?: string, message?: string, found?: number, min?: number, data?: string}} issue
 * @returns {string}
 */
export function describeMigrationIssue(issue) {
    const unsupported = issue.kind === 'unsupported' ? UNSUPPORTED_NOTICES[issue.data] : null;
    if (unsupported) {
        return translate(unsupported.key, unsupported.fallback, { release: unsupported.release });
    }
    switch (issue.kind) {
        case 'failed':
            return translate(
                'data_migration.failed',
                'Converting your data to the current format failed at "{{step}}": {{message}}. Nothing was removed, and the conversion runs again the next time Resonance starts.',
                { step: issue.step, message: issue.message }
            );
        case 'tooOld':
            return translate(
                'data_migration.too_old',
                'Your data was saved by a Resonance release this version can no longer convert, so it was left unchanged. Install Resonance {{release}}, start it once, then update again.',
                { release: LAST_RELEASE_CONVERTING_OLD_DATA_VERSIONS }
            );
        default:
            return translate('data_migration.unknown', 'Your data could not be fully converted to the current format.');
    }
}

/** @augments */
export class MigrationNoticeDialog extends BaseModal {

    /**
     * @param {Array<Object>} issues
     * @returns {void}
     */
    show(issues) {
        const dialog = this.mount({
            overlayClass: 'migration-notice-overlay',
            dialogClass: 'migration-notice-dialog modal-dialog modal-dialog--sm',
            templatePath: './src/templates/dialogs/migrationNotice.html',
            templateId: 'tpl-migration-notice'
        });

        dialog.querySelector('[data-role="title"]').textContent = translate('data_migration.title', 'Data conversion');
        dialog.querySelector('[data-role="ok-text"]').textContent = translate('common.ok', 'OK');

        const messages = dialog.querySelector('[data-role="messages"]');
        for (const issue of issues) {
            const paragraph = document.createElement('p');
            paragraph.textContent = describeMigrationIssue(issue);
            messages.appendChild(paragraph);
        }

        const okButton = dialog.querySelector('#migration-notice-ok-btn');
        okButton.addEventListener('click', () => this.destroy());
        okButton.focus();
    }
}

/** @returns {Promise<void>} */
export async function showDataMigrationIssues() {
    const issues = await window.backendAPI?.app?.migrationStatus?.();
    if (Array.isArray(issues) && issues.length > 0) {
        new MigrationNoticeDialog().show(issues);
    }
}
