/**
 * Performance Metrics Display Module
 * Visualizes the timing breakdown of the connection a request actually used.
 *
 * Phases are disjoint and sum to the total, so the bars and the waterfall share
 * one scale. A phase of `null` was not measured — a reused connection performs
 * no connect, and a proxy may resolve the name remotely — which is rendered
 * distinctly from a measured zero.
 */

const NOT_MEASURED = 'n/a';

const PHASE_COLORS = {
    dns: '#3584e4',
    connect: '#33d17a',
    waiting: '#ed333b',
    download: '#c061cb'
};

/**
 * Ordered phase descriptors driving the summary, the bars, the waterfall and the legend.
 */
const PHASES = [
    {
        key: 'dns',
        label: 'DNS Lookup',
        color: PHASE_COLORS.dns,
        unmeasured: 'No lookup was needed, or the proxy resolved the host remotely'
    },
    {
        key: 'connect',
        label: 'Connect (TCP + TLS)',
        color: PHASE_COLORS.connect,
        unmeasured: 'No new connection was opened — an existing one was reused'
    },
    {
        key: 'waiting',
        label: 'Waiting (TTFB)',
        color: PHASE_COLORS.waiting,
        unmeasured: 'No response was received'
    },
    {
        key: 'download',
        label: 'Content Download',
        color: PHASE_COLORS.download,
        unmeasured: 'No response body was received'
    }
];

/**
 * Format milliseconds to human-readable string
 * @param {number|null|undefined} ms - Time in fractional milliseconds
 * @returns {string} - Formatted time string
 */
function formatTime(ms) {
    if (ms === null || ms === undefined || Number.isNaN(ms)) {
        return NOT_MEASURED;
    }
    if (ms < 1) {
        return `${(ms * 1000).toFixed(0)} µs`;
    }
    if (ms < 1000) {
        return `${ms.toFixed(2)} ms`;
    }
    return `${(ms / 1000).toFixed(2)} s`;
}

/**
 * Calculate percentage for progress bar
 * @param {number} value - Current value
 * @param {number} total - Total value
 * @returns {number} - Percentage
 */
function calculatePercentage(value, total) {
    if (!value || !total || total === 0) {return 0;}
    return Math.min((value / total) * 100, 100);
}

/**
 * Create a timing bar element
 * @param {string} label - Label for the timing
 * @param {number} time - Time in milliseconds
 * @param {number} totalTime - Total request time
 * @param {string} color - Color for the bar
 * @returns {HTMLElement} - Timing bar element
 */
function createTimingBar(label, time, totalTime, color) {
    const barContainer = document.createElement('div');
    barContainer.className = 'timing-bar-container';

    const labelElement = document.createElement('div');
    labelElement.className = 'timing-label';
    labelElement.textContent = label;

    const barWrapper = document.createElement('div');
    barWrapper.className = 'timing-bar-wrapper';

    const bar = document.createElement('div');
    bar.className = 'timing-bar';
    bar.style.width = `${calculatePercentage(time, totalTime)}%`;
    bar.style.backgroundColor = color;

    const timeElement = document.createElement('div');
    timeElement.className = 'timing-value';
    timeElement.textContent = formatTime(time);

    barWrapper.appendChild(bar);
    barContainer.appendChild(labelElement);
    barContainer.appendChild(barWrapper);
    barContainer.appendChild(timeElement);

    return barContainer;
}

/**
 * Create a summary metric element
 * @param {string} label - Label for the metric
 * @param {string} value - Value to display
 * @param {string} [title] - Tooltip explaining the value
 * @returns {HTMLElement} - Metric element
 */
function createMetric(label, value, title) {
    const metric = document.createElement('div');
    metric.className = 'performance-metric';

    const labelElement = document.createElement('div');
    labelElement.className = 'metric-label';
    labelElement.textContent = label;

    const valueElement = document.createElement('div');
    valueElement.className = 'metric-value';
    valueElement.textContent = value;
    if (title) {
        valueElement.setAttribute('title', title);
    }

    metric.appendChild(labelElement);
    metric.appendChild(valueElement);

    return metric;
}

/**
 * Create a waterfall segment for one phase
 * @param {Object} phase - Phase descriptor
 * @param {number} value - Phase duration in milliseconds
 * @param {number} total - Total request time
 * @returns {HTMLElement} - Segment element
 */
function createWaterfallSegment(phase, value, total) {
    const segment = document.createElement('div');
    segment.className = 'waterfall-segment';
    segment.style.width = `${calculatePercentage(value, total)}%`;
    segment.style.backgroundColor = phase.color;
    segment.setAttribute('title', `${phase.label}: ${formatTime(value)}`);
    return segment;
}

/**
 * Whether a phase holds a duration worth drawing
 * @param {number|null|undefined} value - Phase duration
 * @returns {boolean} - True when the phase is measured and non-zero
 */
function isDrawable(value) {
    return typeof value === 'number' && !Number.isNaN(value) && value > 0;
}

/**
 * Build the summary grid of headline numbers
 * @param {Object} timings - Timing data object
 * @param {number} size - Response size in bytes
 * @returns {HTMLElement} - Summary element
 */
function buildSummary(timings, size) {
    const summary = document.createElement('div');
    summary.className = 'performance-summary';

    const summaryTitle = document.createElement('h4');
    summaryTitle.textContent = 'Summary';
    summary.appendChild(summaryTitle);

    const metricsGrid = document.createElement('div');
    metricsGrid.className = 'metrics-grid';

    metricsGrid.appendChild(createMetric('Total Time', formatTime(timings.total)));

    PHASES.forEach(phase => {
        const value = timings[phase.key];
        const unmeasured = value === null || value === undefined;
        metricsGrid.appendChild(
            createMetric(phase.label, formatTime(value), unmeasured ? phase.unmeasured : undefined)
        );
    });

    if (size) {
        const sizeKB = (size / 1024).toFixed(2);
        const speed = isDrawable(timings.download)
            ? `${((size / 1024) / (timings.download / 1000)).toFixed(2)} KB/s`
            : '-';
        metricsGrid.appendChild(createMetric('Response Size', `${sizeKB} KB`));
        metricsGrid.appendChild(createMetric('Transfer Speed', speed));
    }

    summary.appendChild(metricsGrid);

    if (timings.connectCount > 1) {
        const note = document.createElement('p');
        note.className = 'performance-note';
        note.textContent = `${timings.connectCount} connections were opened — the phases above are their total.`;
        summary.appendChild(note);
    }

    return summary;
}

/**
 * Build the per-phase bars and the stacked waterfall
 * @param {Object} timings - Timing data object
 * @returns {HTMLElement} - Breakdown element
 */
function buildBreakdown(timings) {
    const breakdown = document.createElement('div');
    breakdown.className = 'performance-breakdown';

    const breakdownTitle = document.createElement('h4');
    breakdownTitle.textContent = 'Timing Breakdown';
    breakdown.appendChild(breakdownTitle);

    const timingBars = document.createElement('div');
    timingBars.className = 'timing-bars';

    const waterfall = document.createElement('div');
    waterfall.className = 'timing-waterfall';
    waterfall.setAttribute('aria-label', 'Request timing waterfall');

    const waterfallBar = document.createElement('div');
    waterfallBar.className = 'waterfall-bar';

    PHASES.forEach(phase => {
        const value = timings[phase.key];
        if (!isDrawable(value)) {
            return;
        }
        timingBars.appendChild(createTimingBar(phase.label, value, timings.total, phase.color));
        waterfallBar.appendChild(createWaterfallSegment(phase, value, timings.total));
    });

    waterfall.appendChild(waterfallBar);
    breakdown.appendChild(timingBars);
    breakdown.appendChild(waterfall);

    return breakdown;
}

/**
 * Build the phase colour legend
 * @returns {HTMLElement} - Legend element
 */
function buildLegend() {
    const legend = document.createElement('div');
    legend.className = 'timing-legend';

    const legendTitle = document.createElement('h4');
    legendTitle.textContent = 'Legend';
    legend.appendChild(legendTitle);

    const legendItems = document.createElement('div');
    legendItems.className = 'legend-items';

    PHASES.forEach(phase => {
        const item = document.createElement('div');
        item.className = 'legend-item';

        const colorBox = document.createElement('div');
        colorBox.className = 'legend-color';
        colorBox.style.backgroundColor = phase.color;

        const label = document.createElement('span');
        label.textContent = phase.label;

        item.appendChild(colorBox);
        item.appendChild(label);
        legendItems.appendChild(item);
    });

    legend.appendChild(legendItems);

    return legend;
}

/**
 * Display performance metrics for a request
 * @param {HTMLElement} container - Container element
 * @param {Object} timings - Timing data object
 * @param {number} size - Response size in bytes
 */
export function displayPerformanceMetrics(container, timings, size) {
    if (!container) {
        return;
    }

    container.innerHTML = '';

    if (!timings) {
        container.innerHTML = '<p class="no-data">No performance data available</p>';
        return;
    }

    container.appendChild(buildSummary(timings, size));
    container.appendChild(buildBreakdown(timings));
    container.appendChild(buildLegend());
}

/**
 * Clear performance metrics display
 * @param {HTMLElement} container - Container element
 */
export function clearPerformanceMetrics(container) {
    if (container) {
        container.innerHTML = '<p class="no-data">Send a request to see performance metrics</p>';
    }
}
