/**
 * @fileoverview Collection-runner run summaries and their JSON / JUnit XML reports; no bodies, headers or logs
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
        summary: {
            passed: results.passed ?? results.summary?.passed ?? 0,
            failed: results.failed ?? results.summary?.failed ?? 0,
            skipped: results.skipped ?? results.summary?.skipped ?? 0
        },
        truncated: requests.length > MAX_SUMMARY_REQUESTS,
        requests: requests.slice(0, MAX_SUMMARY_REQUESTS)
    };
}

/**
 * @param {Object} summary
 * @returns {string}
 */
export function toJsonReport(summary) {
    return `${JSON.stringify(summary, null, 2)}\n`;
}

/**
 * @param {*} value
 * @returns {string}
 */
function xml(value) {
    return String(value ?? '')
        // eslint-disable-next-line no-control-regex
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

/**
 * @param {number|null} ms
 * @returns {string}
 */
function seconds(ms) {
    return ((ms || 0) / 1000).toFixed(3);
}

/**
 * @param {Object} request
 * @returns {Array<{name: string, failure: string|null, skipped: string|null}>}
 */
function testCasesFor(request) {
    if (request.status === 'skipped') {
        return [{ name: 'Request', failure: null, skipped: request.error || '' }];
    }

    const cases = request.tests.map(test => ({
        name: test.name,
        failure: test.passed ? null : test.name,
        skipped: null
    }));
    const failedTest = request.tests.some(test => !test.passed);

    if (cases.length === 0) {
        cases.push({
            name: 'Response status',
            failure: request.status === 'success' ? null : request.error || String(request.statusCode ?? ''),
            skipped: null
        });
    } else if (request.status !== 'success' && !failedTest) {
        cases.push({ name: 'Request', failure: request.error || '', skipped: null });
    }
    return cases;
}

/**
 * @param {Object} summary
 * @returns {string}
 */
export function toJunitXml(summary) {
    const suites = summary.requests.map(request => {
        const label = `${request.method} ${request.name}`.trim();
        const name = summary.iterations > 1 ? `Iteration ${request.iteration} › ${label}` : label;
        const cases = testCasesFor(request);
        const failures = cases.filter(testCase => testCase.failure !== null).length;
        const skipped = cases.filter(testCase => testCase.skipped !== null).length;
        const caseTime = seconds(cases.length > 0 ? (request.time || 0) / cases.length : 0);

        const body = cases.map(testCase => {
            const open = `    <testcase name="${xml(testCase.name)}" classname="${xml(`${summary.runnerName}.${label}`)}" time="${caseTime}"`;
            if (testCase.failure !== null) {
                return `${open}>\n      <failure type="AssertionFailure" message="${xml(testCase.failure)}"/>\n    </testcase>`;
            }
            if (testCase.skipped !== null) {
                return `${open}>\n      <skipped message="${xml(testCase.skipped)}"/>\n    </testcase>`;
            }
            return `${open}/>`;
        }).join('\n');

        return `  <testsuite name="${xml(name)}" tests="${cases.length}" failures="${failures}" errors="0" skipped="${skipped}" time="${seconds(request.time)}">\n${body}\n  </testsuite>`;
    });

    const totals = summary.requests.reduce((acc, request) => {
        const cases = testCasesFor(request);
        acc.tests += cases.length;
        acc.failures += cases.filter(testCase => testCase.failure !== null).length;
        acc.skipped += cases.filter(testCase => testCase.skipped !== null).length;
        return acc;
    }, { tests: 0, failures: 0, skipped: 0 });

    const timestamp = summary.startedAt ? ` timestamp="${new Date(summary.startedAt).toISOString()}"` : '';
    return [
        '<?xml version="1.0" encoding="UTF-8"?>',
        `<testsuites name="${xml(summary.runnerName)}" tests="${totals.tests}" failures="${totals.failures}" errors="0" skipped="${totals.skipped}" time="${seconds(summary.totalTime)}"${timestamp}>`,
        ...suites,
        '</testsuites>',
        ''
    ].join('\n');
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
