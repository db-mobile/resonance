/* global document, DOMParser, KeyboardEvent, MouseEvent */
import { BaseModal } from '../../src/modules/ui/BaseModal.js';
import { templateLoader } from '../../src/modules/templateLoader.js';
import { escapeHandlerCount } from '../../src/modules/ui/modalEscape.js';

const TEMPLATE_PATH = './tests/fixtures/baseModal.html';
const TEMPLATE_HTML = `
    <template id="tpl-test-modal">
        <div class="test-body"><button id="test-close">Close</button></div>
    </template>
`;

const pressEscape = () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

class TestModal extends BaseModal {
    constructor(name) {
        super();
        this.name = name;
        this.dismissed = 0;
    }

    open() {
        const dialog = this.mount({
            overlayClass: `${this.name}-overlay`,
            dialogClass: `${this.name}-dialog`,
            templatePath: TEMPLATE_PATH,
            templateId: 'tpl-test-modal'
        });
        dialog.querySelector('#test-close').addEventListener('click', () => this.destroy());
    }

    onDismiss() {
        this.dismissed++;
        this.destroy();
    }
}

/**
 * Closing a modal by any route must detach its Escape registration, and a modal
 * opened on top of another must absorb Escape rather than dismissing both.
 */
describe('BaseModal Escape handling', () => {
    beforeAll(() => {
        templateLoader.cache.set(
            TEMPLATE_PATH,
            new DOMParser().parseFromString(TEMPLATE_HTML, 'text/html')
        );
    });

    afterEach(() => {
        document.body.innerHTML = '';
        expect(escapeHandlerCount()).toBe(0);
    });

    test('Escape dismisses the modal and detaches its registration', () => {
        const modal = new TestModal('solo');
        modal.open();
        expect(escapeHandlerCount()).toBe(1);

        pressEscape();

        expect(modal.dismissed).toBe(1);
        expect(document.querySelector('.solo-overlay')).toBeNull();
        expect(escapeHandlerCount()).toBe(0);
    });

    test('a second Escape after closing does nothing', () => {
        const modal = new TestModal('solo');
        modal.open();

        pressEscape();
        pressEscape();

        expect(modal.dismissed).toBe(1);
    });

    test('closing via a button detaches the registration too', () => {
        const modal = new TestModal('button');
        modal.open();
        expect(escapeHandlerCount()).toBe(1);

        modal.dialog.querySelector('#test-close').click();

        expect(escapeHandlerCount()).toBe(0);
        expect(document.querySelector('.button-overlay')).toBeNull();

        pressEscape();
        expect(modal.dismissed).toBe(0);
    });

    test('closing via the backdrop detaches the registration', () => {
        const modal = new TestModal('backdrop');
        modal.open();
        const { overlay } = modal;

        overlay.dispatchEvent(new MouseEvent('click', { bubbles: true }));

        expect(modal.dismissed).toBe(1);
        expect(escapeHandlerCount()).toBe(0);
    });

    test('one Escape closes only the topmost of two stacked modals', () => {
        const parent = new TestModal('parent');
        const child = new TestModal('child');
        parent.open();
        child.open();

        pressEscape();

        expect(child.dismissed).toBe(1);
        expect(parent.dismissed).toBe(0);
        expect(document.querySelector('.child-overlay')).toBeNull();
        expect(document.querySelector('.parent-overlay')).not.toBeNull();

        pressEscape();

        expect(parent.dismissed).toBe(1);
        expect(document.querySelector('.parent-overlay')).toBeNull();
    });

    test('opening and closing repeatedly never accumulates registrations', () => {
        for (let i = 0; i < 5; i++) {
            const modal = new TestModal(`cycle-${i}`);
            modal.open();
            modal.destroy();
        }

        expect(escapeHandlerCount()).toBe(0);
    });
});
