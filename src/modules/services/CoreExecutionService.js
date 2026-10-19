import { app } from '../appContext.js';
import { clone } from '../utils/clone.js';
import { findRequest } from '../collections/collectionTree.js';
import { normalizeFormRows } from '../utils/formDataRows.js';
import { newRequestId } from '../state/inFlightRequests.js';
import { translate } from '../utils/translate.js';

// Repositories use read/modify/write operations. Serialize deltas across concurrent sends.
let persistenceQueue = Promise.resolve();

export function executionError(error) {
    if (!error) {
        return null;
    }
    const { code, details } = error;
    if (code === 'unresolvedVariables') {
        const shown = details.slice(0, 5).map(name => `{{${name}}}`).join(', ');
        const more = details.length > 5 ? ` and ${details.length - 5} more` : '';
        return translate('execution.unresolvedVariables', 'Request sent with unresolved variables: {{message}}', { message: shown + more });
    }
    const messages = {
        credentialsRemoved: 'Authentication was removed because the script changed the request origin.',
        oauthRefreshFailed: 'OAuth token refresh failed: {{message}}',
        cancelled: 'Request cancelled',
        preRequestFailed: 'Pre-request script failed: {{message}}',
        invalidBody: 'Invalid Body JSON: {{message}}',
        invalidGraphqlVariables: 'Invalid GraphQL Variables JSON: {{message}}',
        missingBinaryFile: 'No file selected for binary body',
        missingCollection: 'The collection this request came from is not open.',
        missingRequest: 'The request no longer exists in its collection.',
        unsupportedProtocol: 'This protocol cannot be run by the collection runner.',
        executionLimit: 'Execution limit reached.',
        invalidTarget: 'Next request is missing or ambiguous in the selected queue.',
        emptyQueue: 'Runner has no requests to execute',
        emptyDataFile: 'Data file has no rows',
        invalidExecutionLimit: 'Invalid maximum executions per iteration',
        testsFailed: 'Test script failed',
        persistenceFailed: 'Execution persistence failed: {{message}}'
    };
    const message = Array.isArray(details)
        ? details.join('; ')
        : typeof details === 'string'
          ? details
          : JSON.stringify(details ?? '');
    return translate(`execution.${code}`, messages[code] || `${code}: {{message}}`, { message });
}
export function adaptResult(result) {
    if (result.apiResponse) {
        const response = result.apiResponse;
        result.body = response.data;
        result.headers = response.headers;
        result.response = { status: response.status, statusText: response.statusText,
            headers: response.headers, body: response.data };
    }
    if (result.executionError) {
        result.error = executionError(result.executionError);
    }
    for (const request of result.requests || []) {
        adaptResult(request);
    }
    return result;
}

export class CoreExecutionService {
    constructor(pipeline, backendAPI = pipeline.backendAPI) {
        this.pipeline = pipeline;
        this.backend = backendAPI;
    }

    async captureContext(collectionIds = []) {
        const { environmentRepository, variableRepository, certificates } = this.pipeline;
        const active = await environmentRepository.getActiveEnvironment?.();
        const environmentId = active?.id || null;
        const [environment, settings, certs, proxy, cookies, collections] = await Promise.all([
            environmentId && environmentRepository.getVariablesForEnvironment
                ? environmentRepository.getVariablesForEnvironment(environmentId)
                : environmentRepository.getActiveEnvironmentVariables(),
            this.backend.settings.get(),
            certificates?.getItems?.() ?? [],
            this.backend.proxySettings?.get?.() ?? {},
            app.cookieController?.service?.getAll(environmentId || 'default') ?? [],
            Promise.all(
                [...new Set(collectionIds.filter(Boolean))].map(async (id) => [
                    id,
                    await variableRepository.getVariablesForCollection(id)
                ])
            )
        ]);
        return clone({
            environmentId,
            environmentName: active?.name || null,
            environment: environment || {},
            settings: settings || {},
            certificates: certs || [],
            proxy: proxy || {},
            cookies: cookies || [],
            collections: Object.fromEntries(collections)
        });
    }

    async captureTarget(collectionId, endpointId) {
        const repository = this.pipeline.collectionRepository;
        const [collection, persisted, inherited, scripts, mockBaseUrl] = await Promise.all([
            repository.getById(collectionId),
            repository.getAllPersistedEndpointData(collectionId, endpointId),
            repository.getExecutionAuthSources(collectionId, endpointId),
            app.scriptController?.getScriptsForEndpoint(collectionId, endpointId) ?? {},
            this.pipeline.mockBaseUrlFor(collectionId)
        ]);
        return clone({
            collection,
            endpoint: collection ? findRequest(collection, endpointId) : null,
            persisted: persisted || {},
            inheritedAuth: inherited || [],
            scripts,
            mockBaseUrl
        });
    }

    async captureManual(captured) {
        const ref = captured.endpoint;
        const target = ref ? await this.captureTarget(ref.collectionId, ref.endpointId) : {};
        const body = captured.bodySource;
        return clone({
            ...captured.inputs,
            collectionId: ref?.collectionId || null,
            endpointId: ref?.endpointId || null,
            name: target.endpoint?.name || '',
            path: target.endpoint?.path || '',
            baseUrl: target.collection?.baseUrl || '',
            defaultHeaders: target.collection?.defaultHeaders || {},
            auth: captured.authConfig || { type: 'none', config: {} },
            inheritedAuth: target.inheritedAuth || [],
            queryRows: captured.inputs.queryRows,
            body: {
                mode: body.bodyMode,
                content: body.bodyMode === 'text' ? body.text : body.jsonContent,
                fields: body.form?.fields || [],
                filePath: body.form?.filePath || '',
                contentType: body.form?.contentType || null,
                graphql: body.graphql || null,
                captureError: body.captureError || null
            },
            preRequestScript: captured.scripts?.preRequestScript ?? target.scripts?.preRequestScript ?? '',
            testScript: captured.scripts?.testScript ?? target.scripts?.testScript ?? '',
            mockBaseUrl: target.mockBaseUrl || null
        });
    }

    async captureRun(runner) {
        const captured = clone(runner);
        const contextPromise = this.captureContext(captured.requests.map((r) => r.collectionId)).then(
            (value) => ({ value }),
            (error) => ({ error })
        );
        // Capture each saved definition once, while preserving distinct queue entries.
        const targets = new Map();
        for (const entry of captured.requests) {
            const key = JSON.stringify([entry.collectionId, entry.endpointId]);
            if (!targets.has(key)) {
                targets.set(key, this.captureTarget(entry.collectionId, entry.endpointId));
            }
        }
        const requests = await Promise.all(
            captured.requests.map(async (entry) => {
                const target = await targets.get(JSON.stringify([entry.collectionId, entry.endpointId]));
                return captureRunnerEntry(entry, target);
            })
        );
        const collectionId = captured.collectionId ?? captured.requests[0]?.collectionId ?? null;
        const dataFile = captured.options?.dataFile?.path
            ? await this.backend.collections.runners
                .readData(collectionId, captured.options.dataFile.path)
                .then(({ name, content }) => ({ name, content }))
            : null;
        const context = await contextPromise;
        if (context.error) {
            throw context.error;
        }
        return { requests, context: context.value, options: captured.options || {}, dataFile };
    }

    createExecution() {
        const executionId = newRequestId();
        let cancelled = false;
        const cancel = async () => {
            cancelled = true;
            return this.backend.execution.cancel(executionId);
        };
        return {
            executionId,
            cancel,
            get cancelled() {
                return cancelled;
            }
        };
    }

    async execute(kind, input, execution, onEvent = () => {}, isCurrent = () => true) {
        if (execution.cancelled) {
            return { cancelled: true, status: 'skipped', requests: [], terminationReason: 'stoppedByUser' };
        }
        let effectQueue = Promise.resolve();
        let persistenceError = null;
        let completionEvent;
        let settled = false;
        const responses = new Map();
        const pending = new Map();
        let expected = 1;
        const consume = (event) => {
            if (event.kind === 'response') {
                responses.set(event.visit?.index ?? 0, event.data.response);
            }
            if (event.kind === 'request-completed') {
                const response = responses.get(event.data.index);
                if (response) { event.data.result.apiResponse = response; }
                adaptResult(event.data.result);
                responses.delete(event.data.index);
            }
            if (event.kind === 'effect') {
                // Already emitted effects are committed even if cancellation follows.
                effectQueue = persistenceQueue = persistenceQueue
                    .then(() => this.applyEffect(event.data))
                    .catch((error) => {
                        persistenceError ||= error;
                        this.backend.execution.cancel(execution.executionId).catch(() => {});
                    });
            }
            if (event.kind === 'completed') {
                completionEvent = event;
            } else if (isCurrent()) {
                try {
                    onEvent(event);
                } catch (error) {
                    persistenceError ||= error;
                    this.backend.execution.cancel(execution.executionId).catch(() => {});
                }
            }
        };
        const receive = (event) => {
            if (settled || event.executionId !== execution.executionId) {
                return;
            }
            if (event.kind === 'registered') {
                if (execution.cancelled) {
                    this.backend.execution.cancel(execution.executionId).catch(() => {});
                }
                return;
            }
            if (event.sequence < expected) {
                return;
            }
            pending.set(event.sequence, event);
            while (pending.has(expected)) {
                const next = pending.get(expected);
                pending.delete(expected++);
                consume(next);
            }
        };
        const unlisten = await this.backend.execution.listen(receive);
        try {
            if (execution.cancelled) {
                return { cancelled: true, status: 'skipped', requests: [], terminationReason: 'stoppedByUser' };
            }
            const receipt = await this.backend.execution[kind]({ ...input, executionId: execution.executionId });
            // The invoke reply is authoritative even if an event never arrives.
            // Replay the ordered effect journal before draining persistence; sequence
            // filtering prevents writes already delivered through events from repeating.
            for (const event of receipt?.effects || []) { receive(event); }
            for (const event of [...pending.values()].sort((a, b) => a.sequence - b.sequence)) {
                consume(event);
            }
            pending.clear();
            settled = true;
            const result = adaptResult(receipt?.result ?? receipt ?? completionEvent?.data);
            completionEvent = { executionId: execution.executionId, sequence: receipt?.sequence ?? completionEvent?.sequence,
                kind: 'completed', visit: null, data: result };
            await effectQueue;
            if (persistenceError) {
                result.executionError = {
                    code: 'persistenceFailed',
                    details: persistenceError.message || String(persistenceError)
                };
                result.error = executionError(result.executionError);
                result.status = 'error';
                if (kind === 'run') {
                    result.terminationReason = 'persistenceError';
                }
            }
            if (isCurrent()) {
                onEvent({ ...completionEvent, data: result });
            }
            return result;
        } finally {
            await effectQueue;
            await unlisten();
        }
    }

    async applyEffect(effect) {
        const { collectionRepository, environmentRepository, variableRepository } = this.pipeline;
        if (effect.kind === 'script') {
            if (effect.environmentId && Object.keys(effect.environment || {}).length) {
                await environmentRepository.applyVariableChanges(effect.environmentId, effect.environment);
            }
            if (effect.collectionId && Object.keys(effect.collection || {}).length) {
                await variableRepository.applyVariableChanges(effect.collectionId, effect.collection);
            }
        }
        if (effect.kind === 'auth') {
            const repository = collectionRepository;
            if (!effect.collectionId) {
                return;
            }
            let auth;
            if (effect.source.kind === 'request') {
                auth = (await repository.getAllPersistedEndpointData(effect.collectionId, effect.endpointId))
                    .authConfig;
            } else if (effect.source.kind === 'collection') {
                auth = await repository.getCollectionAuthConfig(effect.collectionId);
            } else {
                auth = await repository.getFolderAuthConfig(effect.collectionId, effect.source.folderId);
            }
            if (!auth || auth.type !== 'oauth2') {
                return;
            }
            const next = clone(auth);
            next.config ||= {};
            for (const [key, value] of Object.entries(effect.changes)) {
                if (value === null) {
                    delete next.config[key];
                } else {
                    next.config[key] = value;
                }
            }
            await repository.saveAuthConfigAtSource(effect.collectionId, effect.endpointId, effect.source, next);
        }
        if (effect.cookies?.length) {
            await app.cookieController?.applyScriptCookieChanges(effect.cookies, effect.environmentId || 'default');
        }
    }
}

export function captureRunnerEntry(entry, { collection, endpoint, persisted, inheritedAuth, scripts, mockBaseUrl }) {
    if (!collection || !endpoint) {
        return {
            ...entry,
            captureError: { code: !collection ? 'missingCollection' : 'missingRequest', details: null }
        };
    }
    const overrides = entry.overrides || {};
    const pathRows = overrides.pathParams?.length ? overrides.pathParams : persisted.pathParams || [];
    const pathParams = Object.fromEntries(
        pathRows.filter((row) => row.key && row.value).map((row) => [row.key, row.value])
    );
    if (!pathRows.length) {
        for (const [key, param] of Object.entries(endpoint.parameters?.path || {})) {
            if (param.example) {
                pathParams[key] = String(param.example);
            }
        }
    }
    const headers = { ...endpoint.headers };
    for (const row of (Array.isArray(overrides.headers) ? overrides.headers : persisted.headers) || []) {
        if (row.enabled !== false && row.key) {
            headers[row.key] = row.value ?? '';
        }
    }
    let queryRows = (
        (Array.isArray(overrides.queryParams) ? overrides.queryParams : persisted.queryParams) || []
    ).filter((row) => row.enabled !== false && row.key);
    if (!queryRows.length) {
        queryRows = Object.entries(endpoint.parameters?.query || {})
            .filter(([, param]) => param.example)
            .map(([key, param]) => ({ key, value: String(param.example) }));
    }
    const form = persisted.formBodyData || {};
    const hasOverride = typeof overrides.body === 'string';
    const nonemptyOverride = hasOverride && overrides.body.trim() !== '';
    let content = nonemptyOverride
        ? overrides.body
        : hasOverride
          ? ''
          : form.mode === 'text'
            ? form.content || ''
            : persisted.modifiedBody;
    if (!content && !hasOverride && endpoint.requestBody) {
        content =
            endpoint.requestBody.example && endpoint.requestBody.example !== 'null'
                ? endpoint.requestBody.example
                : endpoint.requestBody.schema
                  ? endpoint.requestBody.schema.example || {}
                  : '';
    }
    if (typeof content !== 'string') {
        content = content ? JSON.stringify(content) : '';
    }
    const special = !nonemptyOverride && ['formdata', 'urlencoded', 'binary'].includes(form.mode);
    return clone({
        collectionId: collection.id,
        endpointId: endpoint.id,
        name: entry.name,
        path: endpoint.path,
        method: endpoint.method || 'GET',
        protocol: endpoint.protocol || 'http',
        url: persisted.url || '',
        baseUrl: collection.baseUrl || '',
        defaultHeaders: collection.defaultHeaders || {},
        pathParams,
        pathParameterNames: Object.keys(endpoint.parameters?.path || {}),
        headers,
        queryRows,
        bearerFallback: true,
        auth: persisted.authConfig || endpoint.security || { type: 'inherit', config: {} },
        inheritedAuth,
        body: {
            mode: special || form.mode === 'text' ? form.mode : 'json',
            content: content || '',
            fields: normalizeFormRows(form.fields),
            filePath: form.filePath || '',
            contentType: form.contentType || null,
            graphql: !nonemptyOverride && endpoint.protocol === 'graphql' ? persisted.graphqlData || null : null
        },
        preRequestScript: scripts?.preRequestScript || '',
        testScript: scripts?.testScript || '',
        postResponseScript: entry.postResponseScript || '',
        mockBaseUrl
    });
}
