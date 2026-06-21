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
import { displayResponseWithLineNumbersForTab } from './apiHandler.js';
import { startOrSend as grpcStreamStartOrSend } from './grpcStreamHandler.js';

let lastTarget = null;
let methodsCache = new Map();
const methodFlagsCache = new Map();

let protoFileMode = false;
let loadedProtoPath = null;
let loadedProtoInfo = null;

function addMetadataRow(key = '', value = '') {
    if (!grpcMetadataList) {
        return;
    }
    const li = document.createElement('li');
    li.className = 'key-value-row';
    li.innerHTML = `
        <input type="text" class="key-input" placeholder="Key" value="${key}">
        <input type="text" class="value-input" placeholder="Value" value="${value}">
        <button type="button" class="btn-xs btn-danger remove-row-btn" aria-label="Remove">Remove</button>
    `;
    li.querySelector('.remove-row-btn').addEventListener('click', () => li.remove());
    grpcMetadataList.appendChild(li);
}

function clearMetadataList() {
    if (!grpcMetadataList) {
        return;
    }
    while (grpcMetadataList.firstChild) {
        grpcMetadataList.removeChild(grpcMetadataList.firstChild);
    }
}

function getMetadata() {
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

async function loadServices(target) {
    const useTls = getUseTls();
    const services = await window.backendAPI.grpc.listServices(target, useTls);
    clearSelect(grpcServiceSelect);
    services.forEach(svc => addOption(grpcServiceSelect, svc, svc));
    return services;
}

async function loadMethods(target, serviceName) {
    const useTls = getUseTls();
    const cacheKey = `${target}::${serviceName}::${useTls}`;
    if (methodsCache.has(cacheKey)) {
        return methodsCache.get(cacheKey);
    }
    const methods = await window.backendAPI.grpc.listMethods(target, serviceName, useTls);
    methodsCache.set(cacheKey, methods);
    return methods;
}

async function onConnect() {
    const target = grpcTargetInput?.value?.trim();
    if (!target) {
        updateStatusDisplay('gRPC target is empty', null);
        return;
    }

    try {
        setGrpcStatus('Connecting…', 'connecting');
        updateStatusDisplay('Connecting to gRPC server...', null);

        const services = await loadServices(target);
        lastTarget = target;
        methodsCache = new Map();

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

    if (protoFileMode && methodsCache.has(serviceName)) {
        populateMethodOptions(methodsCache.get(serviceName));
        return;
    }

    const target = grpcTargetInput?.value?.trim();
    if (!target) {
        return;
    }

    try {
        setGrpcStatus('Loading methods…', 'connecting');
        const methods = await loadMethods(target, serviceName);
        populateMethodOptions(methods);
        setGrpcStatus('Connected', 'connected');
    } catch (error) {
        setGrpcStatus('Error', 'error');
        toast.error(`gRPC methods error: ${error.message || String(error)}`);
        updateStatusDisplay(`gRPC methods error: ${error.message || String(error)}`, null);
    }
}

export async function handleGrpcSend() {
    const target = grpcTargetInput?.value?.trim();
    const fullMethod = grpcMethodSelect?.value;

    if (!target || !fullMethod) {
        updateStatusDisplay('gRPC target/method missing', null);
        return;
    }

    let requestJson = {};
    const raw = (app.grpcBodyEditor ? app.grpcBodyEditor.getContent() : grpcBodyInput?.value || '').trim();
    if (raw) {
        try {
            requestJson = JSON.parse(raw);
        } catch (e) {
            toast.error(`Invalid gRPC JSON: ${e.message}`);
            return;
        }
    }

    const metadata = getMetadata();
    const useTls = getUseTls();
    const flags = methodFlagsCache.get(fullMethod);
    const isStreaming = !!(flags && (flags.serverStreaming || flags.clientStreaming));

    if (isStreaming) {
        await grpcStreamStartOrSend({
            target,
            fullMethod,
            requestJson,
            metadata,
            tls: { useTls, skipVerify: false },
            protoPath: protoFileMode ? loadedProtoPath : null,
            canSend: !!flags.clientStreaming
        });
        return;
    }

    try {
        updateStatusDisplay('Sending gRPC request...', null);
        displayResponseWithLineNumbersForTab('Sending gRPC request...', null, null);

        let result;
        if (protoFileMode && loadedProtoPath) {
            result = await window.backendAPI.grpc.protoInvokeUnary(loadedProtoPath, {
                target,
                fullMethod,
                requestJson,
                metadata,
                deadlineMs: 30000,
                tls: { useTls, skipVerify: false }
            });
        } else {
            result = await window.backendAPI.grpc.invokeUnary({
                target,
                fullMethod,
                requestJson,
                metadata,
                deadlineMs: 30000,
                tls: { useTls, skipVerify: false }
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
        
        loadedProtoPath = protoPath;
        loadedProtoInfo = protoInfo;
        protoFileMode = true;
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
    if (loadedProtoPath) {
        window.backendAPI.grpc.unloadProto(loadedProtoPath).catch(() => { });
    }
    protoFileMode = false;
    loadedProtoPath = null;
    loadedProtoInfo = null;
    methodsCache = new Map();
    methodFlagsCache.clear();
    clearSelect(grpcServiceSelect);
    clearSelect(grpcMethodSelect);
    updateMethodKindBadge(null);
    updateStatusDisplay('Proto file cleared', null);
}

/**
 * Check if currently in proto file mode
 */
export function isProtoFileMode() {
    return protoFileMode;
}

/**
 * Get the currently loaded proto info
 */
export function getLoadedProtoInfo() {
    return loadedProtoInfo;
}

/**
 * Get the currently loaded proto path
 */
export function getLoadedProtoPath() {
    return loadedProtoPath;
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
    }
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
        if (protoFileMode && loadedProtoPath) {
            skeleton = await window.backendAPI.grpc.protoGetInputSkeleton(loadedProtoPath, fullMethod);
        } else {
            const target = grpcTargetInput?.value?.trim();
            if (!target) {
                updateStatusDisplay('Enter a target first', null);
                return;
            }
            const useTls = getUseTls();
            skeleton = await window.backendAPI.grpc.getInputSkeleton(target, fullMethod, useTls);
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
