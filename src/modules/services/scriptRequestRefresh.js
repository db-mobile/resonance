import { SCRIPT_MUTABLE_REQUEST_FIELDS } from './ScriptService.js';

/** Rebuild untouched template fields, preserving explicit script mutations. */
export function refreshScriptRequest(before, after, refreshed, processor, variables) {
    const merged = { ...after };
    for (const key of SCRIPT_MUTABLE_REQUEST_FIELDS) {
        const changed = JSON.stringify(before[key]) !== JSON.stringify(after[key]);
        merged[key] = processor.processObject(changed ? after[key] : refreshed[key], variables);
    }
    for (const key of ['auth', 'awsAuth', 'ntlm']) {
        if (refreshed[key]) { merged[key] = refreshed[key]; } else { delete merged[key]; }
    }
    return merged;
}
