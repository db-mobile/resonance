/** Desktop IPC test double. It returns prepared core results; it never executes JS request logic. */
export function installExecutionMock(
    backend,
    respond = async (input) => ({
        status: 'success',
        sent: true,
        requestConfig: { ...input.request, requestId: input.executionId },
        historySensitive: {},
        apiResponse: await backend.sendApiRequest(input.request)
    })
) {
    const listeners = new Set();
    const emit = (event) => {
        for (const listener of listeners) {
            listener(event);
        }
    };
    const execution = {
        listen: jest.fn(async (listener) => {
            listeners.add(listener);
            return jest.fn(async () => listeners.delete(listener));
        }),
        cancel: jest.fn(async () => ({ success: true })),
        request: jest.fn(async (input) => {
            emit({ executionId: input.executionId, sequence: 0, kind: 'registered' });
            const result = await respond(input, emit);
            emit({ executionId: input.executionId, sequence: 1, kind: 'completed', data: result });
            return result;
        }),
        run: jest.fn()
    };
    backend.execution = execution;
    return { execution, emit, listeners };
}

export function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((yes, no) => {
        resolve = yes;
        reject = no;
    });
    return { promise, resolve, reject };
}
