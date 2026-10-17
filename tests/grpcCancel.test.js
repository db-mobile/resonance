/* global document, window */

const GRPC_MARKUP = `
    <div class="grpc-source-cards">
        <article class="grpc-source-card" data-source="reflection">
            <span id="grpc-connection-status" data-state="idle"></span>
            <input id="grpc-target-input" type="text" aria-label="gRPC Target">
            <input id="grpc-tls-checkbox" type="checkbox">
        </article>
        <article class="grpc-source-card" data-source="proto">
            <span id="grpc-proto-status" data-state="idle"></span>
            <span id="grpc-proto-filename"></span>
            <p id="grpc-proto-includes" hidden></p>
            <button id="grpc-add-include-btn" style="display: none;"></button>
            <button id="grpc-clear-proto-btn" style="display: none;"></button>
        </article>
    </div>
    <select id="grpc-service-select"></select>
    <select id="grpc-method-select"></select>
    <span id="grpc-method-kind-badge" data-kind=""></span>
    <textarea id="grpc-body-input"></textarea>
    <div id="grpc-metadata-list" class="key-value-list" role="group"></div>
    <span id="status-display"></span>
`;

async function loadGrpcCancel({ activeTabId = 'tab-1', streamActive = false, unaryId = null } = {}) {
    document.body.innerHTML = GRPC_MARKUP;
    jest.resetModules();

    const setRequestInProgress = jest.fn();
    const cancelStream = jest.fn(async () => {});
    jest.doMock('../src/modules/state/settingsCache.js', () => ({
        getSettings: jest.fn(async () => ({})),
        resolveRequestSettings: jest.fn(async () => ({ timeout: 12000 }))
    }));
    jest.doMock('../src/modules/responseView.js', () => ({ displayResponseWithLineNumbersForTab: jest.fn() }));
    jest.doMock('../src/modules/requestServices.js', () => ({
        generateEffectiveAuthData: jest.fn(),
        getRequestBuilderService: jest.fn(),
        warnUnresolvedVariables: jest.fn()
    }));
    jest.doMock('../src/modules/sendControls.js', () => ({ setRequestInProgress }));
    jest.doMock('../src/modules/streaming/streamSession.js', () => ({
        getActiveTabId: jest.fn(async () => activeTabId),
        isTabCurrentlyActive: jest.fn(async () => true)
    }));
    jest.doMock('../src/modules/grpcStreamHandler.js', () => ({
        startOrSend: jest.fn(),
        cancelStream,
        hasActiveStream: jest.fn(() => streamActive)
    }));
    jest.doMock('../src/modules/state/inFlightRequests.js', () => ({
        newRequestId: jest.fn(() => 'req-new'),
        trackInFlight: jest.fn(() => () => {}),
        inFlightRequestFor: jest.fn(() => unaryId)
    }));

    const unaryCancel = jest.fn(async () => {});
    window.backendAPI = { grpc: { unaryCancel } };
    const { handleGrpcCancel } = await import('../src/modules/grpcHandler.js');
    return { handleGrpcCancel, setRequestInProgress, cancelStream, unaryCancel };
}

afterEach(() => {
    document.body.innerHTML = '';
    delete window.backendAPI;
});

describe('handleGrpcCancel', () => {
    test('cancels an active stream and clears the in-progress bracket', async () => {
        const { handleGrpcCancel, cancelStream, setRequestInProgress, unaryCancel } = await loadGrpcCancel({ streamActive: true, unaryId: 'req-1' });

        await handleGrpcCancel();

        expect(cancelStream).toHaveBeenCalledWith('tab-1');
        expect(setRequestInProgress).toHaveBeenCalledWith(false);
        expect(unaryCancel).not.toHaveBeenCalled();
    });

    test('cancels an in-flight unary call through the bridge without touching the bracket', async () => {
        const { handleGrpcCancel, cancelStream, setRequestInProgress, unaryCancel } = await loadGrpcCancel({ unaryId: 'req-1' });

        await handleGrpcCancel();

        expect(unaryCancel).toHaveBeenCalledWith('req-1');
        expect(cancelStream).not.toHaveBeenCalled();
        expect(setRequestInProgress).not.toHaveBeenCalled();
    });

    test('does nothing when neither a stream nor a unary call is active', async () => {
        const { handleGrpcCancel, cancelStream, unaryCancel } = await loadGrpcCancel();

        await handleGrpcCancel();

        expect(cancelStream).not.toHaveBeenCalled();
        expect(unaryCancel).not.toHaveBeenCalled();
    });

    test('swallows a failed unary cancel', async () => {
        const { handleGrpcCancel, unaryCancel } = await loadGrpcCancel({ unaryId: 'req-1' });
        unaryCancel.mockRejectedValue(new Error('gone'));

        await expect(handleGrpcCancel()).resolves.toBeUndefined();
    });
});
