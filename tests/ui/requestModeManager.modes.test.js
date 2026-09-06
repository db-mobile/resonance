/* global document */
/** @fileoverview Characterization tests for updateUIForMode across all six protocols. */

import { setRequestMode, RequestMode } from '../../src/modules/requestModeManager.js';
import {
    ALL_BODY_MODES,
    buildRequestBar,
    installGraphqlBodyManagerStub,
    resetRequestBar,
    visibleRequestTabs,
    activeRequestTab,
    bodyModeValues
} from '../helpers/requestBarFixture.js';

const ALL_MODE_VALUES = ALL_BODY_MODES.map(([value]) => value);

const MODES = [
    RequestMode.HTTP,
    RequestMode.GRPC,
    RequestMode.SSE,
    RequestMode.WEBSOCKET,
    RequestMode.MQTT,
    RequestMode.GRAPHQL
];

const EXPECTED = {
    [RequestMode.HTTP]: {
        tabs: ['path-params', 'query-params', 'headers', 'body', 'scripts', 'authorization', 'schema'],
        defaultTab: 'path-params',
        methodSelect: true,
        sharedUrlBar: true,
        urlSection: null,
        bodyModes: ALL_MODE_VALUES,
        selectorVisible: true
    },
    [RequestMode.GRPC]: {
        tabs: ['grpc', 'grpc-message', 'grpc-metadata', 'authorization'],
        defaultTab: 'grpc',
        methodSelect: false,
        sharedUrlBar: false,
        urlSection: 'grpc-url-section',
        bodyModes: ALL_MODE_VALUES,
        selectorVisible: true
    },
    [RequestMode.SSE]: {
        tabs: ['query-params', 'headers', 'body', 'authorization'],
        defaultTab: 'headers',
        methodSelect: true,
        sharedUrlBar: false,
        urlSection: 'sse-url-section',
        bodyModes: ['json', 'text'],
        selectorVisible: true
    },
    [RequestMode.WEBSOCKET]: {
        tabs: ['query-params', 'headers', 'body'],
        defaultTab: 'body',
        methodSelect: false,
        sharedUrlBar: false,
        urlSection: 'websocket-url-section',
        bodyModes: ALL_MODE_VALUES,
        selectorVisible: false
    },
    [RequestMode.MQTT]: {
        tabs: ['mqtt', 'body'],
        defaultTab: 'mqtt',
        methodSelect: false,
        sharedUrlBar: false,
        urlSection: 'mqtt-url-section',
        bodyModes: ALL_MODE_VALUES,
        selectorVisible: false
    },
    [RequestMode.GRAPHQL]: {
        tabs: ['body', 'headers', 'authorization', 'scripts'],
        defaultTab: 'body',
        methodSelect: false,
        sharedUrlBar: false,
        urlSection: 'graphql-url-section',
        bodyModes: ALL_MODE_VALUES,
        selectorVisible: false
    }
};

const ALL_URL_SECTIONS = [
    'grpc-url-section',
    'sse-url-section',
    'websocket-url-section',
    'mqtt-url-section',
    'graphql-url-section'
];

function displayOf(selector) {
    return document.querySelector(selector)?.style.display;
}

function isShown(selector) {
    return displayOf(selector) !== 'none';
}

describe('updateUIForMode renders each protocol', () => {
    beforeEach(() => {
        buildRequestBar();
        setRequestMode(RequestMode.HTTP);
    });

    afterEach(resetRequestBar);

    for (const mode of MODES) {
        const expected = EXPECTED[mode];

        describe(mode, () => {
            beforeEach(() => setRequestMode(mode));

            test('shows exactly its own request tabs', () => {
                expect(visibleRequestTabs().sort()).toEqual([...expected.tabs].sort());
            });

            test('lands on its default tab', () => {
                expect(activeRequestTab()).toBe(expected.defaultTab);
            });

            test('shows the method select only when the protocol takes a verb', () => {
                expect(isShown('.method-select-container')).toBe(expected.methodSelect);
            });

            test('shows the shared URL bar and cURL button together', () => {
                expect(isShown('.url-autocomplete-wrapper')).toBe(expected.sharedUrlBar);
                expect(isShown('#curl-btn')).toBe(expected.sharedUrlBar);
            });

            test('shows exactly one protocol URL section', () => {
                for (const sectionId of ALL_URL_SECTIONS) {
                    const section = document.getElementById(sectionId);
                    const shown = Boolean(section) && section.style.display !== 'none';
                    expect({ sectionId, shown }).toEqual({
                        sectionId,
                        shown: sectionId === expected.urlSection
                    });
                }
            });

            test('offers its body modes', () => {
                expect(bodyModeValues()).toEqual(expected.bodyModes);
            });

            test('shows the body-mode selector when the protocol lets you pick', () => {
                expect(isShown('.body-mode-selector-container')).toBe(expected.selectorVisible);
            });
        });
    }

    test('never creates a URL section for HTTP', () => {
        setRequestMode(RequestMode.HTTP);
        expect(document.getElementById('http-url-section')).toBeNull();
    });

    test('an unknown mode falls back to HTTP', () => {
        setRequestMode('carrier-pigeon');
        expect(visibleRequestTabs().sort()).toEqual([...EXPECTED[RequestMode.HTTP].tabs].sort());
    });
});

describe('mode transitions always leave a visible tab active', () => {
    beforeEach(buildRequestBar);
    afterEach(resetRequestBar);

    for (const from of MODES) {
        for (const to of MODES) {
            test(`${from} -> ${to}`, () => {
                setRequestMode(from);
                setRequestMode(to);
                expect(EXPECTED[to].tabs).toContain(activeRequestTab());
            });
        }
    }
});

describe('tab fallback only fires when the active tab goes away', () => {
    beforeEach(() => {
        buildRequestBar();
        setRequestMode(RequestMode.HTTP);
    });

    afterEach(resetRequestBar);

    test('switching to gRPC actually moves the active tab', () => {
        expect(activeRequestTab()).toBe('path-params');
        setRequestMode(RequestMode.GRPC);
        expect(activeRequestTab()).toBe('grpc');
    });

    test('an HTTP-shared tab does not survive the move to gRPC', () => {
        document.querySelector('.tab-button[data-tab="schema"]').click();
        expect(activeRequestTab()).toBe('schema');

        setRequestMode(RequestMode.GRPC);
        expect(activeRequestTab()).toBe('grpc');
    });

    test('a gRPC-only tab does not survive the move back to HTTP', () => {
        setRequestMode(RequestMode.GRPC);
        document.querySelector('.tab-button[data-tab="grpc-metadata"]').click();

        setRequestMode(RequestMode.HTTP);
        expect(activeRequestTab()).toBe('path-params');
    });

    test('a tab both modes share is kept across WebSocket -> SSE', () => {
        setRequestMode(RequestMode.WEBSOCKET);
        expect(activeRequestTab()).toBe('body');

        setRequestMode(RequestMode.SSE);
        expect(activeRequestTab()).toBe('body');
    });

    test('GraphQL jumps to Body even from a tab it still shows', () => {
        document.querySelector('.tab-button[data-tab="headers"]').click();
        expect(activeRequestTab()).toBe('headers');

        setRequestMode(RequestMode.GRAPHQL);
        expect(activeRequestTab()).toBe('body');
    });
});

describe('body-mode list survives repeated mode changes', () => {
    beforeEach(() => {
        buildRequestBar();
        setRequestMode(RequestMode.HTTP);
    });

    afterEach(resetRequestBar);

    test('re-entering SSE keeps the narrowed list, and HTTP restores the full one', () => {
        setRequestMode(RequestMode.SSE);
        expect(bodyModeValues()).toEqual(['json', 'text']);

        setRequestMode(RequestMode.SSE);
        expect(bodyModeValues()).toEqual(['json', 'text']);

        setRequestMode(RequestMode.HTTP);
        expect(bodyModeValues()).toEqual(ALL_MODE_VALUES);
    });
});

describe('graphql body manager interactions', () => {
    let stub;

    beforeEach(() => {
        buildRequestBar();
        setRequestMode(RequestMode.HTTP);
        stub = installGraphqlBodyManagerStub();
    });

    afterEach(resetRequestBar);

    test('entering GraphQL turns the Workbench on', () => {
        setRequestMode(RequestMode.GRAPHQL);
        expect(stub.setGraphQLModeEnabled).toHaveBeenCalledWith(true);
    });

    test('leaving GraphQL turns the Workbench off', () => {
        setRequestMode(RequestMode.GRAPHQL);
        stub.setGraphQLModeEnabled.mockClear();

        setRequestMode(RequestMode.HTTP);
        expect(stub.setGraphQLModeEnabled).toHaveBeenCalledWith(false);
    });

    test.each([RequestMode.WEBSOCKET, RequestMode.MQTT])(
        '%s forces the body to JSON and swaps the visible panel',
        (mode) => {
            document.getElementById('body-mode-select').value = 'formdata';
            stub.switchMode('formdata');

            setRequestMode(mode);

            expect(document.getElementById('body-mode-select').value).toBe('json');
            expect(document.querySelector('.body-mode-panel.active').dataset.mode).toBe('json');
        }
    );

    test('SSE keeps a text body selection', () => {
        setRequestMode(RequestMode.SSE);
        document.getElementById('body-mode-select').value = 'text';
        stub.switchMode('text');

        setRequestMode(RequestMode.SSE);

        expect(document.getElementById('body-mode-select').value).toBe('text');
    });
});
