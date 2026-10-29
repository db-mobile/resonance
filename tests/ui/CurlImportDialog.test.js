/* global document, DOMParser */
import fs from 'fs';
import path from 'path';
import { templateLoader } from '../../src/modules/templateLoader.js';
import { CurlImportDialog } from '../../src/modules/ui/CurlImportDialog.js';

const TEMPLATE_PATH = './src/templates/curl/curlImportDialog.html';
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function seedTemplate() {
    const html = fs.readFileSync(path.join(process.cwd(), TEMPLATE_PATH), 'utf8');
    templateLoader.cache.set(TEMPLATE_PATH, new DOMParser().parseFromString(html, 'text/html'));
}

async function openWith(curlCommand) {
    const dialog = new CurlImportDialog();
    dialog.show([{ id: 'c1', name: 'Collection' }]);
    for (let i = 0; i < 4; i++) {
        await flush();
    }
    const input = document.querySelector('#curl-input');
    input.value = curlCommand;
    input.dispatchEvent(new Event('input'));
    return dialog;
}

describe('CurlImportDialog preview', () => {
    beforeEach(seedTemplate);

    afterEach(() => {
        document.body.innerHTML = '';
    });

    test('keeps the parsed method uppercase on the preview pill', async () => {
        await openWith('curl -I https://api.test/users');

        const pill = document.querySelector('#preview-method');
        expect(pill.textContent).toBe('HEAD');
        expect(pill.dataset.method).toBe('HEAD');
    });
});
