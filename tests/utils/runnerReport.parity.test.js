import fs from 'fs';
import path from 'path';
import { summarizeRun, toJsonReport, toJunitXml } from '../../src/modules/utils/runnerReport.js';

const fixture = (name) => fs.readFileSync(path.join(process.cwd(), 'tests/fixtures/report', name), 'utf8');

describe('shared report fixtures', () => {
    const run = JSON.parse(fixture('run.json'));

    test('the JSON report of the shared run is the pinned summary', () => {
        expect(toJsonReport(summarizeRun(run))).toBe(fixture('summary.json'));
    });

    test('the JUnit report of the shared run is the pinned XML', () => {
        expect(toJunitXml(summarizeRun(run))).toBe(fixture('junit.xml'));
    });
});
