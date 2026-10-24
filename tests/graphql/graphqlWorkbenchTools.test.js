import { GraphQLBodyManager } from '../../src/modules/graphqlBodyManager.js';

describe('GraphQL workbench global tools', () => {
    beforeEach(() => {
        jest.useFakeTimers();
        globalThis.document.body.innerHTML = `
            <aside>
                <button id="mock-server-btn">Mock Server</button>
                <button id="cookie-jar-btn">Cookie Jar</button>
                <button id="runner-btn">Collection Runner</button>
            </aside>
            <main class="main-content-area">
                <div class="method-select-container">
                    <select id="method-select"><option>GET</option><option>POST</option></select>
                </div>
            </main>
        `;
    });

    afterEach(() => {
        jest.runOnlyPendingTimers();
        jest.useRealTimers();
        globalThis.document.body.innerHTML = '';
    });

    test('keeps global launchers visible when entering and leaving GraphQL mode', () => {
        const manager = new GraphQLBodyManager({});
        const tools = globalThis.document.querySelectorAll('aside button');

        for (const active of [true, false]) {
            manager.setWorkbenchActive(active);

            for (const tool of tools) {
                expect(globalThis.getComputedStyle(tool).display).not.toBe('none');
            }
        }
    });
});
