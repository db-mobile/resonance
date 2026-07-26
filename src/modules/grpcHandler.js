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
import {
    displayResponseWithLineNumbersForTab,
    generateEffectiveAuthData,
    getRequestBuilderService,
    getSettingsCache,
    warnUnresolvedVariables
} from './apiHandler.js';
import { startOrSend as grpcStreamStartOrSend } from './grpcStreamHandler.js';
import { createKeyValueRow } from './keyValueManager.js';
import { getCurrentEndpoint } from './state/currentEndpoint.js';

let lastTarget = null;
let methodsCache = new Map();
const methodFlagsCache = new Map();

/**
 * Which definition source currently drives the service/method lists. Reflection and
 * a loaded proto file are mutually exclusive: whichever was used last wins, and the
 * other card stands down so sends can never route through a stale proto path.
 * @type {{kind: 'none'|'reflection'|'proto', protoPath: string|null}}
 */
const activeSource = { kind: 'none', protoPath: null };

function setActiveSource(kind, protoPath = null) {
    activeSource.kind = kind;
    activeSource.protoPath = protoPath;
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

/**
 * Read the metadata key/value rows as a plain object, skipping unnamed rows.
 * @returns {Object<string, string>} Metadata map
 */
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
 * Add an option only if the select does not already offer that value, then select it.
 * Restoring a saved request has no service/method list to hand, so the saved values
 * are injected as options — otherwise assigning `.value` silently resolves to ''.
 * @param {HTMLSelectElement} select - Target select
 * @param {string} value - Option value to guarantee
 * @param {string} label - Visible label
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

export function setGrpcTls(useTls) {
    if (grpcTlsCheckbox) {
        grpcTlsCheckbox.checked = !!useTls;
    }
}

/**
 * Snapshot the gRPC panel for persistence. Includes the selected method's streaming
 * flags and the active proto path so a restored request can be sent without first
 * re-running reflection.
 * @returns {Object} Persistable gRPC request state
 */
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
        clientStreaming: !!flags.clientStreaming,
        serverStreaming: !!flags.serverStreaming
    };
}

/**
 * Restore the gRPC panel from persisted state without touching the network. The saved
 * service/method are injected as options and their streaming flags rehydrated, so Send
 * dispatches to the right (unary vs streaming) path straight away. Connect or
 * Load .proto refreshes the full lists on demand.
 * @param {Object} grpcData - State previously produced by captureGrpcState
 */
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
        setActiveSource('proto', data.protoPath);
        updateProtoUI(true, data.protoPath);
        setGrpcStatus('', null);
        return;
    }

    setActiveSource(data.fullMethod ? 'reflection' : 'none', null);
    updateProtoUI(false, null);
    setGrpcStatus(data.fullMethod ? 'Restored' : '', 'idle');
}

/**
 * Extract the host[:port] a gRPC target resolves to, matching how the HTTP
 * path keys the certificate store (`new URL(url).host`).
 * "https://h:50051/x" and "h:50051" both yield "h:50051".
 */
export function grpcHostForCertLookup(target) {
    return (target || '')
        .trim()
        .replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
        .split('/')[0]
        .toLowerCase();
}

/**
 * Build the TLS options object for gRPC backend commands. Skip-verify follows
 * the global "Verify SSL certificates" setting (same as HTTP requests), and
 * the client certificate/CA resolve from the per-host certificate store.
 */
async function buildTlsOptions(target) {
    const useTls = getUseTls();
    let skipVerify = false;
    try {
        const settings = getSettingsCache() || await window.backendAPI.settings.get();
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
            /* certificate lookup is best-effort */
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
        lastTarget = target;
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
 * Metadata keys must be lowercase ASCII on the wire; header names produced by the
 * auth manager (and typed by hand) are normalised so servers accept them.
 * @param {Object<string, string>} metadata - Raw metadata map
 * @returns {Object<string, string>} Map with lowercased keys
 */
function lowercaseMetadataKeys(metadata) {
    const normalized = {};
    Object.entries(metadata).forEach(([key, value]) => {
        normalized[key.toLowerCase()] = value;
    });
    return normalized;
}

/**
 * Build the outgoing metadata: the panel's key/value rows with the effective
 * Authorization config folded in. Digest and AWS SigV4 sign at the HTTP transport
 * layer, which gRPC never reaches, so those are reported as unsupported instead of
 * silently sending nothing.
 * @returns {Promise<Object<string, string>>} Metadata map, before variable resolution
 */
async function buildGrpcMetadata() {
    const metadata = getGrpcMetadata();

    try {
        const authData = await generateEffectiveAuthData();
        getRequestBuilderService().mergeAuthData(metadata, {}, authData);

        if (authData.authConfig || authData.awsAuth) {
            toast.warning('Digest and AWS Signature auth are not supported over gRPC');
        }
    } catch (error) {
        toast.error(`gRPC auth error: ${error.message || String(error)}`);
    }

    return lowercaseMetadataKeys(metadata);
}

/**
 * Resolve {{variables}} in the target, message and metadata. Deliberately avoids
 * RequestBuilderService.processRequestComponents, which prefixes scheme-less URLs
 * with https:// — a gRPC target is a bare host:port. The message is resolved as
 * text before parsing so variables can appear inside JSON values.
 * @param {string} target - Raw target
 * @param {string} rawBody - Raw request JSON text
 * @param {Object} metadata - Raw metadata map
 * @returns {Promise<{target: string, rawBody: string, metadata: Object}>} Resolved request parts
 */
async function resolveGrpcRequest(target, rawBody, metadata) {
    const builder = getRequestBuilderService();
    const { variables, processor } = await builder.resolveVariables(getCurrentEndpoint(), {});

    const resolved = {
        target: processor.processTemplate(target, variables),
        rawBody: processor.processTemplate(rawBody, variables),
        metadata: processor.processObject(metadata, variables)
    };

    warnUnresolvedVariables(processor, {
        url: resolved.target,
        headers: resolved.metadata,
        body: resolved.rawBody
    });

    return resolved;
}

/**
 * Resolve variables in the target alone, for the paths that only talk to the
 * server (Connect, method listing, skeleton generation).
 * @param {string} rawTarget - Target as typed, possibly containing {{variables}}
 * @returns {Promise<string>} Resolved target
 */
async function resolveGrpcTarget(rawTarget) {
    const { target } = await resolveGrpcRequest(rawTarget, '', {});
    return target;
}

/**
 * Guarantee the active proto file is present in the backend registry, which is
 * in-memory and therefore empty after a restart even though the path was restored.
 * @returns {Promise<boolean>} True when the proto is loaded and usable
 */
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
        await window.backendAPI.grpc.parseProtoFile(protoPath, null);
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
    const uiMetadata = await buildGrpcMetadata();

    let resolved;
    try {
        resolved = await resolveGrpcRequest(rawTarget, rawBody, uiMetadata);
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

    if (isStreaming) {
        await grpcStreamStartOrSend({
            target,
            fullMethod,
            requestJson,
            metadata,
            tls,
            protoPath: usingProto ? activeSource.protoPath : null,
            canSend: !!flags.clientStreaming
        });
        return;
    }

    try {
        updateStatusDisplay('Sending gRPC request...', null);
        displayResponseWithLineNumbersForTab('Sending gRPC request...', null, null);

        let result;
        if (usingProto) {
            result = await window.backendAPI.grpc.protoInvokeUnary(activeSource.protoPath, {
                target,
                fullMethod,
                requestJson,
                metadata,
                deadlineMs: 30000,
                tls
            });
        } else {
            result = await window.backendAPI.grpc.invokeUnary({
                target,
                fullMethod,
                requestJson,
                metadata,
                deadlineMs: 30000,
                tls
            });
        }

        const formatted = typeof result.data === 'string' ? result.data : JSON.stringify(result.data, null, 2);
        displayResponseWithLineNumbersForTab(formatted, 'application/json', null);

        const containerElements = app.responseContainerManager?.getActiveElements();
        if (containerElements) {
            if (containerElements.metadataDisplay) {
                const metadataStr = result.headers ? JSON.stringify(result.headers, null, 2) : '{}';
                containerElements.metadataDisplay.textContent = metadataStr || 'No metadata.';
            }
            if (containerElements.trailersDisplay) {
                const trailersStr = result.trailers ? JSON.stringify(result.trailers, null, 2) : '{}';
                containerElements.trailersDisplay.textContent = trailersStr || 'No trailers.';
            }
        }

        if (result.success) {
            updateStatusDisplay('gRPC OK', null);
        } else {
            updateStatusDisplay(`gRPC error: ${result.statusMessage || 'unknown'}`, null);
        }
    } catch (error) {
        const msg = error.message || String(error);
        toast.error(`gRPC send error: ${msg}`);
        updateStatusDisplay(`gRPC send error: ${msg}`, null);
        displayResponseWithLineNumbersForTab(`Error: ${msg}`, null, null);
    }
}

/**
 * Load a proto file and populate services/methods from it
 * @param {string} protoPath - Path to the .proto file
 * @param {string[]} [includePaths] - Optional additional include paths
 */
export async function loadProtoFile(protoPath, includePaths = null) {
    try {
        if (grpcProtoStatus) {
            grpcProtoStatus.textContent = 'Loading…';
            grpcProtoStatus.setAttribute('data-state', 'connecting');
        }
        updateStatusDisplay('Parsing proto file...', null);

        const protoInfo = await window.backendAPI.grpc.parseProtoFile(protoPath, includePaths);

        setActiveSource('proto', protoPath);
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
        toast.error(`Proto load error: ${error.message || String(error)}`);
        updateStatusDisplay(`Proto load error: ${error.message || String(error)}`, null);
        throw error;
    }
}

/**
 * Clear proto file mode and return to reflection mode
 */
export function clearProtoFile() {
    if (activeSource.protoPath) {
        window.backendAPI.grpc.unloadProto(activeSource.protoPath).catch(() => { });
    }
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

    if (grpcClearProtoBtn) {
        grpcClearProtoBtn.addEventListener('click', onClearProtoFile);
    }

    if (grpcTlsCheckbox) {
        grpcTlsCheckbox.addEventListener('change', () => {
            if (app.workspaceTabController && !app.workspaceTabController.isRestoringState) {
                app.workspaceTabController.markCurrentTabModified();
            }
        });
    }

    if (grpcTargetInput) {
        grpcTargetInput.addEventListener('input', () => {
            if (app.workspaceTabController && !app.workspaceTabController.isRestoringState) {
                app.workspaceTabController.markCurrentTabModified();
            }
        });
        if (!grpcTargetInput.value) {
            grpcTargetInput.value = lastTarget || 'grpcb.in:9000';
        }
    }

    if (grpcServiceSelect) {
        grpcServiceSelect.addEventListener('change', () => {
            if (app.workspaceTabController && !app.workspaceTabController.isRestoringState) {
                app.workspaceTabController.markCurrentTabModified();
            }
        });
    }

    if (grpcMethodSelect) {
        grpcMethodSelect.addEventListener('change', () => {
            updateMethodKindBadge(grpcMethodSelect.value);
            if (app.workspaceTabController && !app.workspaceTabController.isRestoringState) {
                app.workspaceTabController.markCurrentTabModified();
            }
        });
    }

    const grpcMetadataList = document.getElementById('grpc-metadata-list');
    if (grpcMetadataList) {
        grpcMetadataList.addEventListener('input', (event) => {
            if ((event.target.classList.contains('key-input') || event.target.classList.contains('value-input')) &&
                app.workspaceTabController && !app.workspaceTabController.isRestoringState) {
                app.workspaceTabController.markCurrentTabModified();
            }
        });

        grpcMetadataList.addEventListener('click', (event) => {
            if (event.target.closest('.remove-row-btn')
                && app.workspaceTabController && !app.workspaceTabController.isRestoringState) {
                app.workspaceTabController.markCurrentTabModified();
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

function updateProtoUI(loaded, protoPath) {
    if (grpcClearProtoBtn) {
        grpcClearProtoBtn.style.display = loaded ? 'inline-flex' : 'none';
    }
    
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
