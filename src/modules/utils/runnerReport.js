/**
 * @fileoverview Collection-runner summaries and export filenames; no bodies, headers or logs
 * @module utils/runnerReport
 */

export const MAX_SUMMARY_REQUESTS = 2000;

/**
 * @param {Object} results
 * @returns {Object}
 */
export function summarizeRun(results) {
    const requests = (results.requests || []).map(request => ({
        iteration: request.iteration || 1,
        ...(request.attempt !== undefined ? { attempt: request.attempt, queuePosition: request.queuePosition, index: request.index, execution: request.execution || null } : {}),
        name: request.name || '',
        method: request.method || '',
        path: request.path || '',
        collectionId: request.collectionId || null,
        endpointId: request.endpointId || null,
        status: request.status,
        statusCode: request.statusCode ?? null,
        time: request.time ?? null,
        error: request.error || null,
        tests: (request.testResults || request.tests || []).map(test => ({
            name: test.message ?? test.name ?? '',
            passed: Boolean(test.passed)
        }))
    }));

    return {
        runnerId: results.runnerId ?? null,
        runnerName: results.runnerName || '',
        startedAt: results.startTime ?? results.startedAt ?? null,
        finishedAt: results.endTime ?? results.finishedAt ?? null,
        totalTime: results.totalTime ?? 0,
        iterations: results.iterations || 1,
        ...(results.plannedRequests !== undefined ? { plannedRequests: results.plannedRequests, sentRequests: results.sentRequests || 0,
            totalRequests: results.totalRequests ?? requests.length, terminationReason: results.terminationReason || 'completed', error: results.error || null } : {}),
        summary: {
            passed: results.passed ?? results.summary?.passed ?? 0,
            failed: results.failed ?? results.summary?.failed ?? 0,
            skipped: results.skipped ?? results.summary?.skipped ?? 0
        },
        truncated: Boolean(results.truncated) || requests.length > MAX_SUMMARY_REQUESTS,
        requests: requests.slice(0, MAX_SUMMARY_REQUESTS)
    };
}

/**
 * @param {Object} summary
 * @param {string} extension
 * @returns {string}
 */
export function reportFileName(summary, extension) {
    const slug = (summary.runnerName || 'runner')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'runner';
    const date = new Date(summary.startedAt || Date.now());
    const pad = (value) => String(value).padStart(2, '0');
    const stamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
    return `${slug}-${stamp}.${extension}`;
}
