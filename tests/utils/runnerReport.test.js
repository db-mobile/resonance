import { summarizeRun, toJsonReport, toJunitXml, reportFileName, MAX_SUMMARY_REQUESTS } from '../../src/modules/utils/runnerReport.js';

const results = {
    runnerId: 'r1',
    runnerName: 'Smoke <&>',
    startTime: Date.UTC(2026, 8, 22, 10, 5),
    endTime: Date.UTC(2026, 8, 22, 10, 5, 1),
    totalTime: 1000,
    iterations: 1,
    passed: 1,
    failed: 2,
    skipped: 1,
    requests: [
        { iteration: 1, name: 'List', method: 'GET', path: '/a', status: 'success', statusCode: 200, time: 100,
            testResults: [{ passed: true, message: 'is 200' }], body: { secret: 'x' }, headers: { authorization: 'Bearer t' }, logs: ['tok'] },
        { iteration: 1, name: 'Create', method: 'POST', path: '/b', status: 'error', statusCode: 201, time: 50,
            testResults: [{ passed: false, message: 'returns "id"' }], error: '1 test failed' },
        { iteration: 1, name: 'Boom', method: 'GET', path: '/c', status: 'error', statusCode: null, time: 5,
            testResults: [], error: 'dns error' },
        { iteration: 1, name: 'Later', method: 'GET', path: '/d', status: 'skipped', error: 'Skipped due to previous error' }
    ]
};

describe('summarizeRun', () => {
    test('keeps status, timing and tests but never bodies, headers or logs', () => {
        const summary = summarizeRun(results);

        expect(summary.summary).toEqual({ passed: 1, failed: 2, skipped: 1 });
        expect(summary.requests[0]).toEqual({
            iteration: 1, name: 'List', method: 'GET', path: '/a', collectionId: null, endpointId: null,
            status: 'success', statusCode: 200, time: 100, error: null, tests: [{ name: 'is 200', passed: true }]
        });
        expect(JSON.stringify(summary)).not.toMatch(/secret|Bearer|tok/);
    });

    test('is idempotent, so a stored summary can be exported again', () => {
        const summary = summarizeRun(results);

        expect(summarizeRun(summary)).toEqual(summary);
    });

    test('caps very large runs and says so', () => {
        const many = { ...results, requests: Array.from({ length: MAX_SUMMARY_REQUESTS + 5 }, () => results.requests[0]) };
        const summary = summarizeRun(many);

        expect(summary.requests).toHaveLength(MAX_SUMMARY_REQUESTS);
        expect(summary.truncated).toBe(true);
    });
});

describe('toJunitXml', () => {
    const xml = toJunitXml(summarizeRun(results));

    test('writes one suite per request and one case per assertion', () => {
        expect(xml).toContain('<testsuites name="Smoke &lt;&amp;&gt;" tests="4" failures="2" errors="0" skipped="1" time="1.000"');
        expect(xml).toContain('<testsuite name="GET List" tests="1" failures="0"');
        expect(xml).toContain('<testcase name="is 200"');
    });

    test('reports failed assertions, request errors and skips', () => {
        expect(xml).toContain('<failure type="AssertionFailure" message="returns &quot;id&quot;"/>');
        expect(xml).toMatch(/<testcase name="Response status"[^>]*>\s*<failure type="AssertionFailure" message="dns error"\/>/);
        expect(xml).toMatch(/<testcase name="Request"[^>]*>\s*<skipped message="Skipped due to previous error"\/>/);
    });

    test('prefixes suites with the iteration when there are several', () => {
        const multi = toJunitXml(summarizeRun({ ...results, iterations: 2, requests: [{ ...results.requests[0], iteration: 2 }] }));

        expect(multi).toContain('<testsuite name="Iteration 2 › GET List"');
    });

    test('strips characters XML 1.0 cannot carry', () => {
        const odd = toJunitXml(summarizeRun({ ...results, requests: [{ ...results.requests[2], error: 'bad\u0001byte' }] }));

        expect(odd).toContain('message="badbyte"');
    });
});

describe('toJsonReport / reportFileName', () => {
    test('the JSON report is the summary itself', () => {
        const summary = summarizeRun(results);

        expect(JSON.parse(toJsonReport(summary))).toEqual(summary);
    });

    test('file names are slugged and timestamped', () => {
        expect(reportFileName({ runnerName: 'My API / pets', startedAt: new Date(2026, 8, 22, 9, 7).getTime() }, 'xml'))
            .toBe('my-api-pets-20260922-0907.xml');
        expect(reportFileName({ runnerName: '!!!', startedAt: 0 }, 'json')).toMatch(/^runner-\d{8}-\d{4}\.json$/);
    });
});
