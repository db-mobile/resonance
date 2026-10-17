import { RunnerScheduler, executionLimit } from '../../src/modules/services/RunnerScheduler.js';
const queue = [{endpointId:'a',name:'Login'}, {endpointId:'b',name:'Poll'}, {endpointId:'c',name:'Finish'}];
test('branches, repeats, and ends one iteration while preserving execution identity', () => {
    const scheduler = new RunnerScheduler(queue, 2, 10);
    expect(scheduler.take()).toMatchObject({ index:0, queuePosition:0, iteration:1, attempt:1 });
    scheduler.advance({kind:'request',target:'b'});
    expect(scheduler.take()).toMatchObject({ index:1, queuePosition:1, iteration:1, attempt:1 });
    scheduler.advance({kind:'request',target:'b'});
    expect(scheduler.take()).toMatchObject({ index:2, queuePosition:1, iteration:1, attempt:2 });
    scheduler.advance({kind:'stopIteration'});
    expect(scheduler.take()).toMatchObject({ index:3, queuePosition:0, iteration:2, attempt:1 });
});
test('bounds visits, rejects unselected and ambiguous targets, and preserves self queue overrides', () => {
    const scheduler = new RunnerScheduler(queue, 1, 3);
    for(let i=0;i<3;i++) { scheduler.take(); scheduler.advance({kind:'request',target:'a'}); }
    expect(() => scheduler.take()).toThrow(/limit/i);
    const duplicates = new RunnerScheduler([{endpointId:'a',name:'Same'},{endpointId:'b',name:'Same'},{endpointId:'b',name:'Variant'}],1,10);
    duplicates.take();
    expect(() => duplicates.advance({kind:'request',target:'Same'})).toThrow(/ambiguous/i);
    expect(() => duplicates.advance({kind:'request',target:'missing'})).toThrow(/selected/i);
    duplicates.advance({kind:'request',target:'Variant'}); duplicates.take(); duplicates.advance({kind:'request',target:'b'});
    expect(duplicates.take().queuePosition).toBe(2);
    expect(executionLimit(undefined,2000)).toBe(2000);
});
