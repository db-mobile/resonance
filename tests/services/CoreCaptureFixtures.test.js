import { CoreExecutionService, captureRunnerEntry } from '../../src/modules/services/CoreExecutionService.js';
import runnerFixtures from '../fixtures/execution/template-capture.json';
import manualFixtures from '../fixtures/execution/manual-capture.json';

test.each(runnerFixtures)('saved capture contract: $name', ({ entry, target, expected }) => {
    expect(captureRunnerEntry(entry, target)).toEqual(expected);
});

test.each(manualFixtures)('editor capture contract: $name', async ({ input, target, expected }) => {
    const service = new CoreExecutionService({});
    service.captureTarget = jest.fn(async () => target);
    expect(await service.captureManual(input)).toEqual(expected);
});
