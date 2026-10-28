import fs from 'fs';
import path from 'path';
import { summarizeRun } from '../../src/modules/utils/runnerReport.js';

const fixture = (name) => fs.readFileSync(path.join(process.cwd(), 'tests/fixtures/report', name), 'utf8');

describe('shared report fixtures', () => {
    const run = JSON.parse(fixture('run.json'));

    test('the desktop summary matches the shared report fixture', () => {
        expect(summarizeRun(run)).toEqual(JSON.parse(fixture('summary.json')));
    });
});
