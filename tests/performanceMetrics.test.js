/* global document */
/**
 * The performance tab reports phases measured on the connection the request
 * actually used. The phases are disjoint, so they must share one scale and add
 * up to the total, and an unmeasured phase must stay distinguishable from a
 * measured zero.
 */
import { displayPerformanceMetrics, clearPerformanceMetrics } from '../src/modules/performanceMetrics.js';

const fullTimings = {
    startTime: 1754006400000,
    dns: 18.44,
    connect: 131.07,
    waiting: 241.19,
    download: 21.6,
    total: 412.3,
    connectCount: 1
};

function render(timings, size) {
    const container = document.createElement('div');
    displayPerformanceMetrics(container, timings, size);
    return container;
}

function metricValue(container, label) {
    const metric = [...container.querySelectorAll('.performance-metric')].find(
        node => node.querySelector('.metric-label').textContent === label
    );
    return metric ? metric.querySelector('.metric-value') : null;
}

function segmentWidths(container) {
    return [...container.querySelectorAll('.waterfall-segment')].map(node =>
        parseFloat(node.style.width)
    );
}

describe('displayPerformanceMetrics', () => {
    it('renders every phase in the summary', () => {
        const container = render(fullTimings);

        expect(metricValue(container, 'Total Time').textContent).toBe('412.30 ms');
        expect(metricValue(container, 'DNS Lookup').textContent).toBe('18.44 ms');
        expect(metricValue(container, 'Connect (TCP + TLS)').textContent).toBe('131.07 ms');
        expect(metricValue(container, 'Waiting (TTFB)').textContent).toBe('241.19 ms');
        expect(metricValue(container, 'Content Download').textContent).toBe('21.60 ms');
    });

    it('draws waterfall segments that fill the total exactly once', () => {
        const container = render(fullTimings);
        const widths = segmentWidths(container);

        expect(widths).toHaveLength(4);
        const sum = widths.reduce((acc, width) => acc + width, 0);
        expect(sum).toBeCloseTo(100, 1);
    });

    it('scales the phase bars against the total rather than each other', () => {
        const container = render(fullTimings);
        const widths = [...container.querySelectorAll('.timing-bar')].map(node =>
            parseFloat(node.style.width)
        );

        expect(widths).toHaveLength(4);
        expect(widths.reduce((acc, width) => acc + width, 0)).toBeCloseTo(100, 1);
    });

    it('marks an unmeasured phase as not applicable and explains why', () => {
        const container = render({ ...fullTimings, connect: null });
        const value = metricValue(container, 'Connect (TCP + TLS)');

        expect(value.textContent).toBe('n/a');
        expect(value.getAttribute('title')).toMatch(/reused/i);
    });

    it('omits an unmeasured phase from the waterfall', () => {
        const container = render({ ...fullTimings, dns: null });

        expect(segmentWidths(container)).toHaveLength(3);
    });

    it('keeps a measured zero distinct from an unmeasured phase', () => {
        const container = render({ ...fullTimings, waiting: 0 });
        const value = metricValue(container, 'Waiting (TTFB)');

        expect(value.textContent).toBe('0 µs');
        expect(value.getAttribute('title')).toBeNull();
    });

    it('reports sub-millisecond phases in microseconds instead of blanking them', () => {
        const container = render({ ...fullTimings, connect: 0.25 });

        expect(metricValue(container, 'Connect (TCP + TLS)').textContent).toBe('250 µs');
    });

    it('flags when more than one connection was opened', () => {
        const container = render({ ...fullTimings, connectCount: 3 });

        expect(container.querySelector('.performance-note').textContent).toMatch(/3 connections/);
    });

    it('leaves the note out for a single connection', () => {
        expect(render(fullTimings).querySelector('.performance-note')).toBeNull();
    });

    it('derives transfer speed from the download phase', () => {
        const container = render(fullTimings, 102400);

        expect(metricValue(container, 'Response Size').textContent).toBe('100.00 KB');
        expect(metricValue(container, 'Transfer Speed').textContent).toBe('4629.63 KB/s');
    });

    it('reports no performance data when timings are absent', () => {
        const container = render(null);

        expect(container.querySelector('.no-data').textContent).toBe('No performance data available');
    });

    it('survives a restored tab that predates the current timing shape', () => {
        const legacy = { dnsLookup: 5, tcpConnection: 10, tlsHandshake: 20, firstByte: 40, download: 5, total: 50 };
        const container = render(legacy);

        expect(metricValue(container, 'Connect (TCP + TLS)').textContent).toBe('n/a');
        expect(segmentWidths(container)).toHaveLength(1);
    });
});

describe('clearPerformanceMetrics', () => {
    it('restores the prompt to send a request', () => {
        const container = render(fullTimings);
        clearPerformanceMetrics(container);

        expect(container.querySelector('.no-data').textContent).toBe(
            'Send a request to see performance metrics'
        );
    });
});
