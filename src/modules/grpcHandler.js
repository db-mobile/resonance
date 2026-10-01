import { app } from './appContext.js';
import {
    grpcTargetInput,
    grpcTlsCheckbox,
    grpcConnectBtn,
    grpcConnectionStatus,
    grpcServiceSelect,
    grpcMethodSelect,
    grpcBodyInput,
    grpcGenerateSkeletonBtn,
    grpcMetadataList,
    grpcAddMetadataBtn,
    grpcSendBtn,
    grpcLoadProtoBtn,
    grpcClearProtoBtn,
    grpcProtoFilename,
    grpcProtoStatus
} from './domElements.js';

import { updateStatusDisplay } from './statusDisplay.js';
import { toast } from './ui/Toast.js';
import { markTabModified } from './state/tabModified.js';
import {
    displayResponseWithLineNumbersForTab,
    generateEffectiveAuthData,
    getRequestBuilderService,
    setRequestInProgress,
    warnUnresolvedVariables
} from './apiHandler.js';
import { getSettings, resolveRequestSettings } from './state/settingsCache.js';
import { newRequestId, trackInFlight } from './state/inFlightRequests.js';
import { renderGrpcPanes } from './ResponseDisplayHelper.js';
import { getActiveTabId, isTabCurrentlyActive } from './streaming/streamSession.js';
import { startOrSend as grpcStreamStartOrSend } from './grpcStreamHandler.js';
import { recordGrpcHistory } from './grpcHistory.js';
import { createKeyValueRow } from './keyValueManager.js';
import { getCurrentEndpoint } from './state/currentEndpoint.js';
import { fileNameFromPath } from './utils/fileName.js';

let methodsCache = new Map();
const methodFlagsCache = new Map();

/** @type {{kind: 'none'|'reflection'|'proto', protoPath: string|null, includePaths: string[]}} */
const activeSource = { kind: 'none', protoPath: null, includePaths: [] };

/** @type {string|null} */
let attemptedProtoPath = null;

/** @type {string[]} */
let pendingIncludePaths = [];

/**
 * @param {string} kind
 * @param {string|null} [protoPath]
 * @param {string[]} [includePaths]
 * @returns {void}
 */
function setActiveSource(kind, protoPath = null, includePaths = []) {
    activeSource.kind = kind;
    activeSource.protoPath = protoPath;
    activeSource.includePaths = protoPath ? [...includePaths] : [];
    updateSourceCards();
}

function updateSourceCards() {
    document.querySelectorAll('.grpc-source-card[data-source]').forEach(card => {
        card.setAttribute('data-active', String(card.dataset.source === activeSource.kind));
    });
}

function addMetadataRow(key = '', value = '') {
    if (!grpcMetadataList) {
        return;
    }
    grpcMetadataList.appendChild(createKeyValueRow(key, value));
}

function clearMetadataList() {
    if (!grpcMetadataList) {
        return;
    }
    while (grpcMetadataList.firstChild) {
        grpcMetadataList.removeChild(grpcMetadataList.firstChild);
    }
}

/** @returns {Object<string, string>} */
export function getGrpcMetadata() {
    const metadata = {};
    if (!grpcMetadataList) {
        return metadata;
    }
    grpcMetadataList.querySelectorAll('.key-value-row').forEach(row => {
        const key = row.querySelector('.key-input')?.value?.trim();
        const value = row.querySelector('.value-input')?.value || '';
        if (key) {
            metadata[key] = value;
        }
    });
    return metadata;
}

export function setGrpcMetadata(metadataObj) {
    clearMetadataList();
    if (metadataObj && typeof metadataObj === 'object') {
        Object.entries(metadataObj).forEach(([k, v]) => addMetadataRow(k, v));
    }
}

function setGrpcStatus(text, state = null) {
    if (!grpcConnectionStatus) {
        return;
    }
    grpcConnectionStatus.textContent = text || '';
    if (state) {
        grpcConnectionStatus.setAttribute('data-state', state);
    } else if (!text) {
        grpcConnectionStatus.setAttribute('data-state', 'idle');
    }
}

function clearSelect(select) {
    if (!select) {
        return;
    }
    while (select.firstChild) {
        select.removeChild(select.firstChild);
    }
}

function addOption(select, value, label) {
    if (!select) {
        return;
    }
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = label;
    select.appendChild(opt);
}

/**
 * @param {HTMLSelectElement} select
 * @param {string} value
 * @param {string} label
 */
function ensureOption(select, value, label) {
    if (!select || !value) {
        return;
    }
    const exists = Array.from(select.options).some(opt => opt.value === value);
    if (!exists) {
        addOption(select, value, label);
    }
    select.value = value;
}

function methodKindFromFlags(flags) {
    if (!flags) {
        return '';
    }
    if (flags.clientStreaming && flags.serverStreaming) {
        return 'bidi';
    }
    if (flags.serverStreaming) {
        return 'server-stream';
    }
    if (flags.clientStreaming) {
        return 'client-stream';
    }
    return 'unary';
}

function updateMethodKindBadge(fullMethod) {
    const badge = document.getElementById('grpc-method-kind-badge');
    if (!badge) {
        return;
    }
    const flags = methodFlagsCache.get(fullMethod);
    const kind = methodKindFromFlags(flags);
    badge.setAttribute('data-kind', kind);
    badge.textContent = kind;
}

function populateMethodOptions(methods) {
    clearSelect(grpcMethodSelect);
    methodFlagsCache.clear();
    methods.forEach(m => {
        const label = `${m.name} (${m.inputType} → ${m.outputType})`;
        addOption(grpcMethodSelect, m.fullMethod, label);
        methodFlagsCache.set(m.fullMethod, {
            clientStreaming: !!m.clientStreaming,
            serverStreaming: !!m.serverStreaming
        });
    });
    updateMethodKindBadge(grpcMethodSelect?.value);
}

function getUseTls() {
    return grpcTlsCheckbox?.checked || false;
}

function setGrpcTls(useTls) {
    if (grpcTlsCheckbox) {
        grpcTlsCheckbox.checked = !!useTls;
    }
}

/** @returns {Object} */
export function captureGrpcState() {
    const fullMethod = grpcMethodSelect?.value || '';
    const flags = methodFlagsCache.get(fullMethod) || {};
    const requestJson = app.grpcBodyEditor
        ? app.grpcBodyEditor.getContent()
        : grpcBodyInput?.value;

    return {
        target: grpcTargetInput?.value || '',
        service: grpcServiceSelect?.value || '',
        fullMethod,
        requestJson: requestJson || '{}',
        metadata: getGrpcMetadata(),
        useTls: grpcTlsCheckbox?.checked || false,
        protoPath: activeSource.protoPath,
        ...(activeSource.protoPath ? { includePaths: [...activeSource.includePaths] } : {}),
        clientStreaming: !!flags.clientStreaming,
        serverStreaming: !!flags.serverStreaming
    };
}

/** @param {Object} grpcData */
export function applyGrpcState(grpcData) {
    const data = grpcData || {};

    if (grpcTargetInput) {
        grpcTargetInput.value = data.target || '';
    }
    if (grpcBodyInput) {
        grpcBodyInput.value = data.requestJson || '{}';
    }
    if (app.grpcBodyEditor) {
        app.grpcBodyEditor.setContent(data.requestJson || '{}');
    }
    setGrpcMetadata(data.metadata || {});
    setGrpcTls(data.useTls);

    methodsCache = new Map();
    methodFlagsCache.clear();
    clearSelect(grpcServiceSelect);
    clearSelect(grpcMethodSelect);

    ensureOption(grpcServiceSelect, data.service, data.service);
    ensureOption(grpcMethodSelect, data.fullMethod, data.fullMethod);
    if (data.fullMethod) {
        methodFlagsCache.set(data.fullMethod, {
            clientStreaming: !!data.clientStreaming,
            serverStreaming: !!data.serverStreaming
        });
    }
    updateMethodKindBadge(data.fullMethod || null);

    if (data.protoPath) {
        setActiveSource('proto', data.protoPath, Array.isArray(data.includePaths) ? data.includePaths : []);
        attemptedProtoPath = data.protoPath;
        updateProtoUI(true, data.protoPath);
        setGrpcStatus('', null);
        return;
    }

    setActiveSource(data.fullMethod ? 'reflection' : 'none', null);
    updateProtoUI(false, null);
    setGrpcStatus(data.fullMethod ? 'Restored' : '', 'idle');
}

export function grpcHostForCertLookup(target) {
    return (target || '')
        .trim()
        .replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
        .split('/')[0]
        .toLowerCase();
}

async function buildTlsOptions(target) {
    const useTls = getUseTls();
    let skipVerify = false;
    try {
        const settings = await getSettings();
        skipVerify = settings?.verifySsl === false;
    } catch (_e) {
        void _e;
    }

    const tls = { useTls, skipVerify };
    if (useTls && app.certificateController) {
        try {
            const cert = app.certificateController.getForHost(grpcHostForCertLookup(target));
            if (cert) {
                tls.clientCert = cert;
            }
        } catch (_e) {
        }
    }
    return tls;
}

async function loadServices(target) {
    const tls = await buildTlsOptions(target);
    const services = await window.backendAPI.grpc.listServices(target, tls);
    clearSelect(grpcServiceSelect);
    services.forEach(svc => addOption(grpcServiceSelect, svc, svc));
    return services;
}

async function loadMethods(target, serviceName) {
    const tls = await buildTlsOptions(target);
    const cacheKey = `${target}::${serviceName}::${tls.useTls}`;
    if (methodsCache.has(cacheKey)) {
        return methodsCache.get(cacheKey);
    }
    const methods = await window.backendAPI.grpc.listMethods(target, serviceName, tls);
    methodsCache.set(cacheKey, methods);
    return methods;
}

async function onConnect() {
    const rawTarget = grpcTargetInput?.value?.trim();
    if (!rawTarget) {
        updateStatusDisplay('gRPC target is empty', null);
        return;
    }

    try {
        setGrpcStatus('Connecting…', 'connecting');
        updateStatusDisplay('Connecting to gRPC server...', null);

        const target = await resolveGrpcTarget(rawTarget);
        const services = await loadServices(target);
        methodsCache = new Map();

        const previousProtoPath = activeSource.protoPath;
        setActiveSource('reflection', null);
        if (previousProtoPath) {
            window.backendAPI.grpc.unloadProto(previousProtoPath).catch(() => { });
            updateProtoUI(false, null);
        }

        if (services.length === 0) {
            setGrpcStatus('No services', 'error');
            return;
        }

        const firstService = grpcServiceSelect.value;
        const methods = await loadMethods(target, firstService);
        populateMethodOptions(methods);

        setGrpcStatus('Connected', 'connected');
        updateStatusDisplay('gRPC connected', null);
    } catch (error) {
        setGrpcStatus('Error', 'error');
        toast.error(`gRPC connect error: ${error.message || String(error)}`);
        updateStatusDisplay(`gRPC connect error: ${error.message || String(error)}`, null);
    }
}

async function onServiceChange() {
    const serviceName = grpcServiceSelect?.value;
    if (!serviceName) {
        return;
    }

    if (activeSource.kind === 'proto' && methodsCache.has(serviceName)) {
        populateMethodOptions(methodsCache.get(serviceName));
        return;
    }

    const rawTarget = grpcTargetInput?.value?.trim();
    if (!rawTarget) {
        return;
    }

    try {
        setGrpcStatus('Loading methods…', 'connecting');
        const target = await resolveGrpcTarget(rawTarget);
        const methods = await loadMethods(target, serviceName);
        populateMethodOptions(methods);
        setGrpcStatus('Connected', 'connected');
    } catch (error) {
        setGrpcStatus('Error', 'error');
        toast.error(`gRPC methods error: ${error.message || String(error)}`);
        updateStatusDisplay(`gRPC methods error: ${error.message || String(error)}`, null);
    }
}

/**
 * @param {Object<string, string>} metadata
 * @returns {Object<string, string>}
 */
function lowercaseMetadataKeys(metadata) {
    const normalized = {};
    Object.entries(metadata).forEach(([key, value]) => {
        normalized[key.toLowerCase()] = value;
    });
    return normalized;
}

/** @returns {Promise<{metadata: Object<string, string>, sensitiveNames: string[]}>} */
async function buildGrpcMetadata(substitution = {}) {
    const metadata = getGrpcMetadata();
    let sensitiveNames = [];
    let unresolvedAuthVariables = [];

    try {
        const authData = await generateEffectiveAuthData(substitution);
        getRequestBuilderService().mergeAuthData(metadata, {}, authData);
        sensitiveNames = Object.keys(authData.headers || {}).map(name => name.toLowerCase());
        unresolvedAuthVariables = authData.unresolvedVariables || [];

        if (authData.authConfig || authData.awsAuth || authData.ntlmAuth) {
            toast.warning('Digest, NTLM, and AWS Signature auth are not supported over gRPC');
        }
    } catch (error) {
        toast.error(`gRPC auth error: ${error.message || String(error)}`);
    }

    return { metadata: lowercaseMetadataKeys(metadata), sensitiveNames, unresolvedAuthVariables };
}

/**
 * @param {string} target
 * @param {string} rawBody
 * @param {Object} metadata
 * @param {{variables: Object, processor: Object}|null} [context]
 * @param {string[]} [extraUnresolved]
 * @returns {Promise<{target: string, rawBody: string, metadata: Object}>}
 */
async function resolveGrpcRequest(target, rawBody, metadata, context = null, extraUnresolved = []) {
    const { variables, processor } = context ||
        await getRequestBuilderService().resolveVariables(getCurrentEndpoint(), {});

    const resolved = {
        target: processor.processTemplate(target, variables),
        rawBody: processor.processTemplate(rawBody, variables),
        metadata: processor.processObject(metadata, variables)
    };

    warnUnresolvedVariables(processor, {
        url: resolved.target,
        headers: resolved.metadata,
        body: resolved.rawBody
    }, extraUnresolved);

    return resolved;
}

/**
 * @param {string} rawTarget
 * @returns {Promise<string>}
 */
async function resolveGrpcTarget(rawTarget) {
    const { target } = await resolveGrpcRequest(rawTarget, '', {});
    return target;
}

/** @returns {Promise<boolean>} */
async function ensureProtoLoaded() {
    const { protoPath } = activeSource;
    if (!protoPath) {
        return false;
    }

    try {
        const loaded = await window.backendAPI.grpc.listLoadedProtos();
        if (Array.isArray(loaded) && loaded.includes(protoPath)) {
            return true;
        }
        await window.backendAPI.grpc.parseProtoFile(protoPath, activeSource.includePaths.length ? activeSource.includePaths : null);
        return true;
    } catch (error) {
        const msg = error.message || String(error);
        toast.error(`Proto file unavailable: ${msg}`);
        updateStatusDisplay(`Proto file unavailable: ${msg}`, null);
        return false;
    }
}

export async function handleGrpcSend() {
    const rawTarget = grpcTargetInput?.value?.trim();
    const fullMethod = grpcMethodSelect?.value;

    if (!rawTarget || !fullMethod) {
        updateStatusDisplay('gRPC target/method missing', null);
        return;
    }

    const rawBody = (app.grpcBodyEditor ? app.grpcBodyEditor.getContent() : grpcBodyInput?.value || '').trim();

    let context;
    try {
        context = await getRequestBuilderService().resolveVariables(getCurrentEndpoint(), {});
    } catch (error) {
        updateStatusDisplay(`Variable processing error: ${error.message || String(error)}`, null);
        return;
    }

    const { metadata: uiMetadata, sensitiveNames, unresolvedAuthVariables } =
        await buildGrpcMetadata(context);

    let resolved;
    try {
        resolved = await resolveGrpcRequest(rawTarget, rawBody, uiMetadata, context, unresolvedAuthVariables);
    } catch (error) {
        updateStatusDisplay(`Variable processing error: ${error.message || String(error)}`, null);
        return;
    }

    const { target, metadata } = resolved;

    let requestJson = {};
    if (resolved.rawBody) {
        try {
            requestJson = JSON.parse(resolved.rawBody);
        } catch (e) {
            toast.error(`Invalid gRPC JSON: ${e.message}`);
            return;
        }
    }

    const usingProto = activeSource.kind === 'proto' && !!activeSource.protoPath;
    if (usingProto && !(await ensureProtoLoaded())) {
        return;
    }

    const tls = await buildTlsOptions(target);
    const flags = methodFlagsCache.get(fullMethod);
    const isStreaming = !!(flags && (flags.serverStreaming || flags.clientStreaming));

    const historyContext = {
        rawTarget,
        target,
        fullMethod,
        metadata,
        requestJson,
        useTls: !!tls.useTls,
        protoPath: usingProto ? activeSource.protoPath : null,
        clientStreaming: !!flags?.clientStreaming,
        serverStreaming: !!flags?.serverStreaming,
        sensitiveNames
    };

    if (isStreaming) {
        await grpcStreamStartOrSend({
            target,
            fullMethod,
            requestJson,
            metadata,
            tls,
            protoPath: usingProto ? activeSource.protoPath : null,
            canSend: !!flags.clientStreaming,
            historyContext
        });
        return;
    }

    const startedAt = Date.now();
    const requestTabId = await getActiveTabId();
    const requestId = newRequestId();
    const untrack = trackInFlight(requestTabId, requestId);
    const { timeout } = await resolveRequestSettings();
    const showStatus = async (text) => {
        if (await isTabCurrentlyActive(requestTabId)) {
            updateStatusDisplay(text, null);
        }
    };

    setRequestInProgress(true);
    try {
        await showStatus('Sending gRPC request...');
        displayResponseWithLineNumbersForTab('Sending gRPC request...', null, requestTabId);

        const unaryRequest = {
            target,
            fullMethod,
            requestJson,
            metadata,
            deadlineMs: timeout,
            tls,
            requestId
        };
        const result = usingProto
            ? await window.backendAPI.grpc.protoInvokeUnary(activeSource.protoPath, unaryRequest)
            : await window.backendAPI.grpc.invokeUnary(unaryRequest);

        if (result.cancelled) {
            displayResponseWithLineNumbersForTab('Request was cancelled', null, requestTabId);
            await showStatus('Request cancelled');
            return;
        }

        const formatted = typeof result.data === 'string' ? result.data : JSON.stringify(result.data, null, 2);
        displayResponseWithLineNumbersForTab(formatted, 'application/json', requestTabId);

        const grpcPanes = {
            ok: Boolean(result.success),
            statusMessage: result.statusMessage || '',
            metadata: result.headers || {},
            trailers: result.trailers || {}
        };
        const containerElements = requestTabId
            ? app.responseContainerManager?.getOrCreateContainer(requestTabId)
            : app.responseContainerManager?.getActiveElements();
        renderGrpcPanes(containerElements, grpcPanes);

        await showStatus(result.success ? 'gRPC OK' : `gRPC error: ${result.statusMessage || 'unknown'}`);

        const ttfb = Date.now() - startedAt;
        if (app.workspaceTabController && requestTabId) {
            app.workspaceTabController.service.updateTab(requestTabId, {
                response: {
                    data: result.data ?? null,
                    headers: {},
                    status: null,
                    statusText: '',
                    ttfb,
                    size: null,
                    timings: null,
                    cookies: [],
                    grpc: grpcPanes
                }
            }).catch(() => { });
        }

        await recordGrpcHistory({
            ...historyContext,
            result: { ...result, ttfb }
        });
    } catch (error) {
        const msg = error.message || String(error);
        toast.error(`gRPC send error: ${msg}`);
        await showStatus(`gRPC send error: ${msg}`);
        displayResponseWithLineNumbersForTab(`Error: ${msg}`, null, requestTabId);

        await recordGrpcHistory({
            ...historyContext,
            result: {
                success: false,
                status: null,
                statusMessage: msg,
                data: null,
                ttfb: Date.now() - startedAt
            }
        });
    } finally {
        untrack();
        setRequestInProgress(false);
    }
}

/**
 * @param {string} protoPath
 * @param {string[]} [includePaths]
 */
export async function loadProtoFile(protoPath, includePaths = null) {
    attemptedProtoPath = protoPath;
    try {
        if (grpcProtoStatus) {
            grpcProtoStatus.textContent = 'Loading…';
            grpcProtoStatus.setAttribute('data-state', 'connecting');
        }
        updateStatusDisplay('Parsing proto file...', null);

        const protoInfo = await window.backendAPI.grpc.parseProtoFile(protoPath, includePaths?.length ? includePaths : null);

        setActiveSource('proto', protoPath, includePaths || []);
        setGrpcStatus('', 'idle');
        methodsCache = new Map();

        clearSelect(grpcServiceSelect);
        protoInfo.services.forEach(svc => addOption(grpcServiceSelect, svc.fullName, svc.name));

        if (protoInfo.services.length > 0) {
            const firstService = protoInfo.services[0];
            populateMethodOptions(firstService.methods);

            protoInfo.services.forEach(svc => {
                methodsCache.set(svc.fullName, svc.methods);
            });
        }

        updateStatusDisplay(`Loaded proto: ${protoInfo.package || protoPath}`, null);

        return protoInfo;
    } catch (error) {
        setProtoStatusError('Failed');
        pendingIncludePaths = includePaths ? [...includePaths] : [];
        renderIncludePaths(pendingIncludePaths, true);
        toast.error(`Proto load error: ${error.message || String(error)}`);
        updateStatusDisplay(`Proto load error: ${error.message || String(error)}`, null);
        throw error;
    }
}

function clearProtoFile() {
    if (activeSource.protoPath) {
        window.backendAPI.grpc.unloadProto(activeSource.protoPath).catch(() => { });
    }
    attemptedProtoPath = null;
    pendingIncludePaths = [];
    setActiveSource('none', null);
    methodsCache = new Map();
    methodFlagsCache.clear();
    clearSelect(grpcServiceSelect);
    clearSelect(grpcMethodSelect);
    updateMethodKindBadge(null);
    updateStatusDisplay('Proto file cleared', null);
}

export function initGrpcUI() {
    if (!grpcConnectBtn || !grpcServiceSelect) {
        return;
    }

    grpcConnectBtn.addEventListener('click', onConnect);
    grpcServiceSelect.addEventListener('change', onServiceChange);
    
    if (grpcSendBtn) {
        grpcSendBtn.addEventListener('click', handleGrpcSend);
    }

    if (grpcAddMetadataBtn) {
        grpcAddMetadataBtn.addEventListener('click', () => addMetadataRow());
    }

    if (grpcGenerateSkeletonBtn) {
        grpcGenerateSkeletonBtn.addEventListener('click', onGenerateSkeleton);
    }

    if (grpcLoadProtoBtn) {
        grpcLoadProtoBtn.addEventListener('click', onLoadProtoFile);
    }

    document.getElementById('grpc-add-include-btn')?.addEventListener('click', onAddIncludePath);

    if (grpcClearProtoBtn) {
        grpcClearProtoBtn.addEventListener('click', onClearProtoFile);
    }

    if (grpcTlsCheckbox) {
        grpcTlsCheckbox.addEventListener('change', () => {
            markTabModified();
        });
    }

    if (grpcTargetInput) {
        grpcTargetInput.addEventListener('input', () => {
            markTabModified();
        });
        if (!grpcTargetInput.value) {
            grpcTargetInput.value = 'grpcb.in:9000';
        }
    }

    if (grpcServiceSelect) {
        grpcServiceSelect.addEventListener('change', () => {
            markTabModified();
        });
    }

    if (grpcMethodSelect) {
        grpcMethodSelect.addEventListener('change', () => {
            updateMethodKindBadge(grpcMethodSelect.value);
            markTabModified();
        });
    }

    const grpcMetadataList = document.getElementById('grpc-metadata-list');
    if (grpcMetadataList) {
        grpcMetadataList.addEventListener('input', (event) => {
            if (event.target.classList.contains('key-input') || event.target.classList.contains('value-input')) {
                markTabModified();
            }
        });

        grpcMetadataList.addEventListener('click', (event) => {
            if (event.target.closest('.remove-row-btn')) {
                markTabModified();
            }
        });
    }

    updateSourceCards();
}

async function onGenerateSkeleton() {
    const fullMethod = grpcMethodSelect?.value;

    if (!fullMethod) {
        updateStatusDisplay('Select a method first', null);
        return;
    }

    try {
        updateStatusDisplay('Generating input skeleton...', null);
        
        let skeleton;
        if (activeSource.kind === 'proto' && activeSource.protoPath) {
            if (!(await ensureProtoLoaded())) {
                return;
            }
            skeleton = await window.backendAPI.grpc.protoGetInputSkeleton(activeSource.protoPath, fullMethod);
        } else {
            const rawTarget = grpcTargetInput?.value?.trim();
            if (!rawTarget) {
                updateStatusDisplay('Enter a target first', null);
                return;
            }
            const target = await resolveGrpcTarget(rawTarget);
            const tls = await buildTlsOptions(target);
            skeleton = await window.backendAPI.grpc.getInputSkeleton(target, fullMethod, tls);
        }
        
        const formatted = JSON.stringify(skeleton, null, 2);

        if (grpcBodyInput) {
            grpcBodyInput.value = formatted;
        }

        if (app.grpcBodyEditor) {
            app.grpcBodyEditor.setContent(formatted);
        }

        updateStatusDisplay('Input skeleton generated', null);
    } catch (error) {
        updateStatusDisplay(`Skeleton error: ${error.message || String(error)}`, null);
    }
}

async function onLoadProtoFile() {
    try {
        const protoPath = await window.backendAPI.grpc.selectProtoFile();

        if (!protoPath) {
            return;
        }

        await loadProtoFile(protoPath);
        
        updateProtoUI(true, protoPath);
    } catch (error) {
        updateStatusDisplay(`Failed to load proto: ${error.message || String(error)}`, null);
    }
}

function onClearProtoFile() {
    clearProtoFile();
    updateProtoUI(false, null);
}

/** @returns {Promise<void>} */
async function onAddIncludePath() {
    const protoPath = activeSource.protoPath || attemptedProtoPath;
    if (!protoPath) {
        return;
    }
    const folder = await window.backendAPI.collections.pickDirectory(false);
    if (!folder) {
        return;
    }
    const current = activeSource.protoPath ? activeSource.includePaths : pendingIncludePaths;
    const includePaths = current.includes(folder) ? [...current] : [...current, folder];
    try {
        await window.backendAPI.grpc.unloadProto(protoPath).catch(() => { });
        await loadProtoFile(protoPath, includePaths);
        pendingIncludePaths = [];
        updateProtoUI(true, protoPath);
    } catch (error) {
        void error;
    }
}

/**
 * @param {string[]} includePaths
 * @param {boolean} visible
 * @returns {void}
 */
function renderIncludePaths(includePaths, visible) {
    const addBtn = document.getElementById('grpc-add-include-btn');
    if (addBtn) {
        addBtn.style.display = visible ? 'inline-flex' : 'none';
    }
    const list = document.getElementById('grpc-proto-includes');
    if (!list) {
        return;
    }
    list.hidden = includePaths.length === 0;
    list.textContent = includePaths.length
        ? `Import paths: ${includePaths.map(fileNameFromPath).join(', ')}`
        : '';
    list.title = includePaths.join('\n');
}

function updateProtoUI(loaded, protoPath) {
    if (grpcClearProtoBtn) {
        grpcClearProtoBtn.style.display = loaded ? 'inline-flex' : 'none';
    }
    renderIncludePaths(loaded ? activeSource.includePaths : [], Boolean(loaded && protoPath));
    
    if (grpcProtoFilename) {
        if (loaded && protoPath) {
            const filename = protoPath.split(/[/\\]/).pop();
            grpcProtoFilename.textContent = filename;
            grpcProtoFilename.title = protoPath;
        } else {
            grpcProtoFilename.textContent = '';
            grpcProtoFilename.title = '';
        }
    }
    
    if (grpcProtoStatus) {
        grpcProtoStatus.textContent = loaded ? 'Loaded' : '';
        grpcProtoStatus.setAttribute('data-state', loaded ? 'loaded' : 'idle');
    }
}

function setProtoStatusError(message) {
    if (grpcProtoStatus) {
        grpcProtoStatus.textContent = message || 'Error';
        grpcProtoStatus.setAttribute('data-state', 'error');
    }
}
