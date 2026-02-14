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
import { displayResponseWithLineNumbersForTab } from './apiHandler.js';

let lastTarget = null;
let methodsCache = new Map();

// Proto file mode state
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

function setGrpcStatus(text) {
    if (grpcConnectionStatus) {
        grpcConnectionStatus.textContent = text || '';
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
        setGrpcStatus('Connecting...');
        updateStatusDisplay('Connecting to gRPC server...', null);

        const services = await loadServices(target);
        lastTarget = target;
        methodsCache = new Map();

        if (services.length === 0) {
            setGrpcStatus('No services');
            return;
        }

        const firstService = grpcServiceSelect.value;
        const methods = await loadMethods(target, firstService);
        clearSelect(grpcMethodSelect);
        methods.forEach(m => addOption(grpcMethodSelect, m.fullMethod, `${m.name} (${m.inputType} → ${m.outputType})`));

        setGrpcStatus('Connected');
        updateStatusDisplay('gRPC connected', null);
    } catch (error) {
        setGrpcStatus('Error');
        updateStatusDisplay(`gRPC connect error: ${error.message || String(error)}`, null);
    }
}

async function onServiceChange() {
    const serviceName = grpcServiceSelect?.value;
    if (!serviceName) {
        return;
    }

    // In proto file mode, use cached methods
    if (protoFileMode && methodsCache.has(serviceName)) {
        const methods = methodsCache.get(serviceName);
        clearSelect(grpcMethodSelect);
        methods.forEach(m => addOption(grpcMethodSelect, m.fullMethod, `${m.name} (${m.inputType} → ${m.outputType})`));
        return;
    }

    // In reflection mode, fetch methods from server
    const target = grpcTargetInput?.value?.trim();
    if (!target) {
        return;
    }

    try {
        setGrpcStatus('Loading methods...');
        const methods = await loadMethods(target, serviceName);
        clearSelect(grpcMethodSelect);
        methods.forEach(m => addOption(grpcMethodSelect, m.fullMethod, `${m.name} (${m.inputType} → ${m.outputType})`));
        setGrpcStatus('Connected');
    } catch (error) {
        setGrpcStatus('Error');
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
    const raw = (window.grpcBodyEditor ? window.grpcBodyEditor.getContent() : grpcBodyInput?.value || '').trim();
    if (raw) {
        try {
            requestJson = JSON.parse(raw);
        } catch (e) {
            updateStatusDisplay(`Invalid gRPC JSON: ${e.message}`, null);
            return;
        }
    }

    try {
        updateStatusDisplay('Sending gRPC request...', null);
        displayResponseWithLineNumbersForTab('Sending gRPC request...', null, null);

        const metadata = getMetadata();
        const useTls = getUseTls();

        let result;
        if (protoFileMode && loadedProtoPath) {
            // Use proto file mode
            result = await window.backendAPI.grpc.protoInvokeUnary(loadedProtoPath, {
                target,
                fullMethod,
                requestJson,
                metadata,
                deadlineMs: 30000,
                tls: { useTls, skipVerify: false }
            });
        } else {
            // Use reflection mode
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

        // Populate metadata and trailers displays
        const containerElements = window.responseContainerManager?.getActiveElements();
        if (containerElements) {
            // Display response metadata (headers)
            if (containerElements.metadataDisplay) {
                const metadataStr = result.headers ? JSON.stringify(result.headers, null, 2) : '{}';
                containerElements.metadataDisplay.textContent = metadataStr || 'No metadata.';
            }
            // Display trailers
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
        setGrpcStatus('Loading proto file...');
        updateStatusDisplay('Parsing proto file...', null);

        const protoInfo = await window.backendAPI.grpc.parseProtoFile(protoPath, includePaths);
        
        loadedProtoPath = protoPath;
        loadedProtoInfo = protoInfo;
        protoFileMode = true;
        methodsCache = new Map();

        // Populate service select
        clearSelect(grpcServiceSelect);
        protoInfo.services.forEach(svc => addOption(grpcServiceSelect, svc.fullName, svc.name));

        if (protoInfo.services.length > 0) {
            // Populate methods for first service
            const firstService = protoInfo.services[0];
            clearSelect(grpcMethodSelect);
            firstService.methods.forEach(m => 
                addOption(grpcMethodSelect, m.fullMethod, `${m.name} (${m.inputType} → ${m.outputType})`)
            );
            
            // Cache methods for all services
            protoInfo.services.forEach(svc => {
                methodsCache.set(svc.fullName, svc.methods);
            });
        }

        setGrpcStatus('Proto loaded');
        updateStatusDisplay(`Loaded proto: ${protoInfo.package || protoPath}`, null);
        
        return protoInfo;
    } catch (error) {
        setGrpcStatus('Error');
        updateStatusDisplay(`Proto load error: ${error.message || String(error)}`, null);
        throw error;
    }
}

/**
 * Clear proto file mode and return to reflection mode
 */
export function clearProtoFile() {
    if (loadedProtoPath) {
        window.backendAPI.grpc.unloadProto(loadedProtoPath).catch(() => { /* ignore unload errors */ });
    }
    protoFileMode = false;
    loadedProtoPath = null;
    loadedProtoInfo = null;
    methodsCache = new Map();
    clearSelect(grpcServiceSelect);
    clearSelect(grpcMethodSelect);
    setGrpcStatus('');
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
    
    // Note: grpcSendBtn is deprecated - use main Send Request button instead
    // Keep listener for backwards compatibility but it will be hidden
    if (grpcSendBtn) {
        grpcSendBtn.addEventListener('click', handleGrpcSend);
    }

    if (grpcAddMetadataBtn) {
        grpcAddMetadataBtn.addEventListener('click', () => addMetadataRow());
    }

    if (grpcGenerateSkeletonBtn) {
        grpcGenerateSkeletonBtn.addEventListener('click', onGenerateSkeleton);
    }

    // Proto file buttons
    if (grpcLoadProtoBtn) {
        grpcLoadProtoBtn.addEventListener('click', onLoadProtoFile);
    }

    if (grpcClearProtoBtn) {
        grpcClearProtoBtn.addEventListener('click', onClearProtoFile);
    }

    // Mark tab as modified when TLS checkbox is toggled
    if (grpcTlsCheckbox) {
        grpcTlsCheckbox.addEventListener('change', () => {
            if (window.workspaceTabController) {
                window.workspaceTabController.markCurrentTabModified();
            }
        });
    }

    if (grpcTargetInput && !grpcTargetInput.value) {
        grpcTargetInput.value = lastTarget || 'grpcb.in:9000';
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
            // Use proto file mode
            skeleton = await window.backendAPI.grpc.protoGetInputSkeleton(loadedProtoPath, fullMethod);
        } else {
            // Use reflection mode
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

        if (window.grpcBodyEditor) {
            window.grpcBodyEditor.setContent(formatted);
        }

        updateStatusDisplay('Input skeleton generated', null);
    } catch (error) {
        updateStatusDisplay(`Skeleton error: ${error.message || String(error)}`, null);
    }
}

async function onLoadProtoFile() {
    try {
        // Use Tauri file dialog to select a proto file
        const protoPath = await window.backendAPI.grpc.selectProtoFile();

        if (!protoPath) {
            return; // User cancelled
        }

        await loadProtoFile(protoPath);
        
        // Update UI to show loaded state
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
        grpcProtoStatus.textContent = loaded ? '● Loaded' : '';
        grpcProtoStatus.className = loaded ? 'proto-status proto-status-loaded' : 'proto-status';
    }
}
