import { translate } from '../utils/translate.js';

export function executionLimit(value, queueLength) {
    const minimum = Math.max(1, queueLength);
    const maximum = Math.max(100000, minimum);
    if (value === undefined || value === null || value === '') { return Math.max(1000, minimum); }
    const limit = Number(value);
    if (!Number.isInteger(limit) || limit < minimum || limit > maximum) {
        throw new Error(translate('runner.flow.invalid_limit', 'Maximum executions must be an integer between {{min}} and {{max}}.', { min: minimum, max: maximum }));
    }
    return limit;
}

export class RunnerScheduler {
    constructor(queue, iterations, limit) {
        this.queue = queue;
        this.iterations = iterations;
        this.limit = limit;
        this.position = 0;
        this.iteration = 1;
        this.index = 0;
        this.visits = 0;
        this.attempts = new Map();
    }

    get done() { return this.iteration > this.iterations; }

    take() {
        if (this.done) { return null; }
        if (this.visits >= this.limit) {
            const error = new Error(translate('runner.flow.limit_reached', 'Execution limit of {{limit}} reached in iteration {{iteration}}.', { limit: this.limit, iteration: this.iteration }));
            error.reason = 'executionLimit'; throw error;
        }
        this.visits++;
        const attempt = (this.attempts.get(this.position) || 0) + 1;
        this.attempts.set(this.position, attempt);
        return { index: this.index++, queuePosition: this.position, iteration: this.iteration, attempt, request: this.queue[this.position] };
    }

    advance(next = { kind: 'unchanged' }) {
        if (next.kind === 'stopIteration') { this.position = this.queue.length; }
        else if (next.kind === 'request') { this.position = this.resolve(next.target); }
        else { this.position++; }
        if (this.position >= this.queue.length) {
            this.iteration++; this.position = 0; this.visits = 0; this.attempts.clear();
        }
    }

    resolve(target) {
        if (target === this.queue[this.position]?.endpointId) { return this.position; }
        let matches = this.queue.map((item, index) => ({ item, index })).filter(({ item }) => item.endpointId === target);
        if (!matches.length) { matches = this.queue.map((item, index) => ({ item, index })).filter(({ item }) => item.name === target); }
        if (matches.length === 1) { return matches[0].index; }
        const message = matches.length
            ? translate('runner.flow.ambiguous_target', 'Next request "{{target}}" is ambiguous in the selected queue.', { target })
            : translate('runner.flow.missing_target', 'Next request "{{target}}" is not in the selected queue.', { target });
        const error = new Error(message); error.reason = 'invalidTarget'; throw error;
    }
}
