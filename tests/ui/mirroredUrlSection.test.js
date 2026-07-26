/* global document */
import {
    URL_UPDATED_EVENT,
    createMirroredUrlSection,
    notifyUrlUpdated,
    syncMirroredUrlInput
} from '../../src/modules/ui/mirroredUrlSection.js';

const SSE_CONFIG = {
    sectionId: 'sse-url-section',
    method: 'SSE',
    label: 'SSE',
    inputId: 'sse-url-input',
    inputType: 'url',
    placeholder: 'https://example.com/events',
    ariaLabel: 'SSE URL',
    peerId: 'url-input',
    syncQueryParams: true
};

const GRPC_CONFIG = {
    sectionId: 'grpc-url-section',
    method: 'GRPC',
    label: 'gRPC',
    inputId: 'grpc-url-target-input',
    inputType: 'text',
    placeholder: 'localhost:50051',
    ariaLabel: 'gRPC Target',
    peerId: 'grpc-target-input'
};

function buildRequestBar({ peerId = 'url-input', peerValue = '' } = {}) {
    const requestUrlSection = document.createElement('div');
    requestUrlSection.className = 'request-url-section';

    const methodSelectContainer = document.createElement('div');
    methodSelectContainer.className = 'method-select-container';

    const peerInput = document.createElement('input');
    peerInput.id = peerId;
    peerInput.value = peerValue;

    requestUrlSection.appendChild(methodSelectContainer);
    requestUrlSection.appendChild(peerInput);
    document.body.appendChild(requestUrlSection);

    return { requestUrlSection, methodSelectContainer, peerInput };
}

function typeInto(input, value) {
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('createMirroredUrlSection', () => {
    afterEach(() => {
        document.body.innerHTML = '';
    });

    it('builds the section with the configured ids and inserts it after the method select', () => {
        const { methodSelectContainer, peerInput } = buildRequestBar({ peerValue: 'https://a/events' });

        const section = createMirroredUrlSection(SSE_CONFIG);

        expect(section.id).toBe('sse-url-section');
        expect(section.style.display).toBe('none');
        expect(methodSelectContainer.nextElementSibling).toBe(section);

        const badge = section.querySelector('.method-pill');
        expect(badge.dataset.method).toBe('SSE');
        expect(badge.textContent).toBe('SSE');

        const mirror = section.querySelector('#sse-url-input');
        expect(mirror.type).toBe('url');
        expect(mirror.placeholder).toBe('https://example.com/events');
        expect(mirror.getAttribute('aria-label')).toBe('SSE URL');
        expect(mirror.value).toBe(peerInput.value);
    });

    it('returns null when there is no request URL bar to attach to', () => {
        expect(createMirroredUrlSection(SSE_CONFIG)).toBeNull();
    });

    it('propagates typing to the peer and fires one input event when query sync is on', () => {
        const { peerInput } = buildRequestBar();
        const peerInputEvents = jest.fn();
        peerInput.addEventListener('input', peerInputEvents);

        createMirroredUrlSection(SSE_CONFIG);
        typeInto(document.getElementById('sse-url-input'), 'https://example.com/events?token=abc');

        expect(peerInput.value).toBe('https://example.com/events?token=abc');
        expect(peerInputEvents).toHaveBeenCalledTimes(1);
    });

    it('propagates typing without an input event when query sync is off', () => {
        const { peerInput } = buildRequestBar({ peerId: 'grpc-target-input' });
        const peerInputEvents = jest.fn();
        peerInput.addEventListener('input', peerInputEvents);

        createMirroredUrlSection(GRPC_CONFIG);
        typeInto(document.getElementById('grpc-url-target-input'), 'localhost:9090');

        expect(peerInput.value).toBe('localhost:9090');
        expect(peerInputEvents).not.toHaveBeenCalled();
    });

    it('follows a programmatic peer rewrite announced with notifyUrlUpdated', () => {
        const { peerInput } = buildRequestBar({ peerValue: 'https://example.com/events' });
        createMirroredUrlSection(SSE_CONFIG);
        const mirror = document.getElementById('sse-url-input');

        peerInput.value = 'https://example.com/events?token=abc';
        notifyUrlUpdated(peerInput);

        expect(mirror.value).toBe('https://example.com/events?token=abc');
    });

    it('follows a peer input event', () => {
        const { peerInput } = buildRequestBar();
        createMirroredUrlSection(SSE_CONFIG);

        typeInto(peerInput, 'https://other/events');

        expect(document.getElementById('sse-url-input').value).toBe('https://other/events');
    });

    it('does not reassign the mirror when the values already match', () => {
        const { peerInput } = buildRequestBar();
        createMirroredUrlSection(SSE_CONFIG);
        const mirror = document.getElementById('sse-url-input');

        const setValue = jest.fn();
        Object.defineProperty(mirror, 'value', {
            get: () => 'https://example.com/events',
            set: setValue
        });
        peerInput.value = 'https://example.com/events';

        peerInput.dispatchEvent(new CustomEvent(URL_UPDATED_EVENT));

        expect(setValue).not.toHaveBeenCalled();
    });
});

describe('syncMirroredUrlInput', () => {
    afterEach(() => {
        document.body.innerHTML = '';
    });

    it('copies the peer value into the mirror', () => {
        const { peerInput } = buildRequestBar();
        createMirroredUrlSection(SSE_CONFIG);
        peerInput.value = 'https://restored/events';

        syncMirroredUrlInput('sse-url-input', 'url-input');

        expect(document.getElementById('sse-url-input').value).toBe('https://restored/events');
    });

    it('is a no-op when either side is missing', () => {
        expect(() => syncMirroredUrlInput('sse-url-input', 'url-input')).not.toThrow();
    });
});
