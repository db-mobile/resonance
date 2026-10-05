/* global document, DOMParser, window */
import fs from 'fs';
import path from 'path';
import { describeMigrationIssue, showDataMigrationIssues } from '../../src/modules/ui/MigrationNoticeDialog.js';
import { templateLoader } from '../../src/modules/templateLoader.js';

const TEMPLATE_PATH = './src/templates/dialogs/migrationNotice.html';

describe('MigrationNoticeDialog', () => {
    beforeEach(() => {
        const html = fs.readFileSync(path.join(process.cwd(), 'src/templates/dialogs/migrationNotice.html'), 'utf8');
        templateLoader.cache.set(TEMPLATE_PATH, new DOMParser().parseFromString(html, 'text/html'));
        document.body.innerHTML = '';
    });

    afterEach(() => {
        document.body.innerHTML = '';
        delete window.backendAPI;
    });

    test('a failed step names the step and says it is retried', () => {
        const text = describeMigrationIssue({ kind: 'failed', step: 'store split', message: 'disk full' });
        expect(text).toContain('"store split": disk full');
        expect(text).toContain('runs again the next time');
    });

    test('too-old and unsupported data point at the last converting release', () => {
        expect(describeMigrationIssue({ kind: 'tooOld', found: 0, min: 2 })).toContain('Install Resonance 3.3.0');
        expect(describeMigrationIssue({ kind: 'unsupported', data: 'globalStoreCollections' })).toContain('before March 2026');
    });

    test('no dialog opens when the migration reported nothing', async () => {
        window.backendAPI = { app: { migrationStatus: async () => [] } };

        await showDataMigrationIssues();

        expect(document.querySelector('.migration-notice-dialog')).toBeNull();
    });

    test('one paragraph per issue, dismissed by OK', async () => {
        window.backendAPI = {
            app: {
                migrationStatus: async () => [
                    { kind: 'failed', step: 'a', message: 'b' },
                    { kind: 'unsupported', data: 'globalStoreCollections' }
                ]
            }
        };

        await showDataMigrationIssues();

        expect(document.querySelectorAll('.migration-notice-dialog [data-role="messages"] p')).toHaveLength(2);
        document.getElementById('migration-notice-ok-btn').click();
        expect(document.querySelector('.migration-notice-dialog')).toBeNull();
    });
});
