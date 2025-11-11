/**
 * Performance Metrics Display Module
 * Visualizes detailed timing breakdown for API requests
 */

/**
 * Format milliseconds to human-readable string
 * @param {number} ms - Time in milliseconds
 * @returns {string} - Formatted time string
 */
function formatTime(ms) {
    if (ms === 0 || ms === null || ms === undefined) {
        return '-';
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
 * @returns {HTMLElement} - Metric element
 */
function createMetric(label, value) {
    const metric = document.createElement('div');
    metric.className = 'performance-metric';

    const labelElement = document.createElement('div');
    labelElement.className = 'metric-label';
    labelElement.textContent = label;

    const valueElement = document.createElement('div');
    valueElement.className = 'metric-value';
    valueElement.textContent = value;

    metric.appendChild(labelElement);
    metric.appendChild(valueElement);

    return metric;
}

/**
 * Display performance metrics for a request
 * @param {HTMLElement} container - Container element
 * @param {Object} timings - Timing data object
 * @param {number} size - Response size in bytes
 */
export function displayPerformanceMetrics(container, timings, size) {
    if (!container) {
        console.error('Performance metrics container not found');
        return;
    }

    // Clear previous content
    container.innerHTML = '';

    if (!timings) {
        container.innerHTML = '<p class="no-data">No performance data available</p>';
        return;
    }

    // Create summary section
    const summary = document.createElement('div');
    summary.className = 'performance-summary';

    const summaryTitle = document.createElement('h4');
    summaryTitle.textContent = 'Summary';
    summary.appendChild(summaryTitle);

    const metricsGrid = document.createElement('div');
    metricsGrid.className = 'metrics-grid';

    metricsGrid.appendChild(createMetric('Total Time', formatTime(timings.total)));
    metricsGrid.appendChild(createMetric('DNS Lookup', formatTime(timings.dnsLookup)));
    metricsGrid.appendChild(createMetric('TCP Connection', formatTime(timings.tcpConnection)));
    metricsGrid.appendChild(createMetric('TLS Handshake', formatTime(timings.tlsHandshake)));
    metricsGrid.appendChild(createMetric('Time to First Byte', formatTime(timings.firstByte)));
    metricsGrid.appendChild(createMetric('Content Download', formatTime(timings.download)));

    if (size) {
        const sizeKB = (size / 1024).toFixed(2);
        const transferSpeed = timings.download > 0 ? ((size / 1024) / (timings.download / 1000)).toFixed(2) : '-';
        metricsGrid.appendChild(createMetric('Response Size', `${sizeKB} KB`));
        metricsGrid.appendChild(createMetric('Transfer Speed', transferSpeed !== '-' ? `${transferSpeed} KB/s` : '-'));
    }

    summary.appendChild(metricsGrid);
    container.appendChild(summary);

    // Create timing breakdown section
    const breakdown = document.createElement('div');
    breakdown.className = 'performance-breakdown';

    const breakdownTitle = document.createElement('h4');
    breakdownTitle.textContent = 'Timing Breakdown';
    breakdown.appendChild(breakdownTitle);

    const timingBars = document.createElement('div');
    timingBars.className = 'timing-bars';

    // Define colors for each phase
    const colors = {
        dns: '#4285f4',      // Blue
        tcp: '#34a853',      // Green
        tls: '#fbbc04',      // Yellow
        ttfb: '#ea4335',     // Red
        download: '#9c27b0'  // Purple
    };

    // Add timing bars (only if time > 0)
    if (timings.dnsLookup > 0) {
        timingBars.appendChild(createTimingBar('DNS Lookup', timings.dnsLookup, timings.total, colors.dns));
    }
    if (timings.tcpConnection > 0) {
        timingBars.appendChild(createTimingBar('TCP Connection', timings.tcpConnection, timings.total, colors.tcp));
    }
    if (timings.tlsHandshake > 0) {
        timingBars.appendChild(createTimingBar('TLS Handshake', timings.tlsHandshake, timings.total, colors.tls));
    }
    if (timings.firstByte > 0) {
        timingBars.appendChild(createTimingBar('Waiting (TTFB)', timings.firstByte, timings.total, colors.ttfb));
    }
    if (timings.download > 0) {
        timingBars.appendChild(createTimingBar('Content Download', timings.download, timings.total, colors.download));
    }

    // Create waterfall visualization
    const waterfall = document.createElement('div');
    waterfall.className = 'timing-waterfall';
    waterfall.setAttribute('aria-label', 'Request timing waterfall');

    const waterfallBar = document.createElement('div');
    waterfallBar.className = 'waterfall-bar';

    let accumulatedTime = 0;

    // Add segments to waterfall
    if (timings.dnsLookup > 0) {
        const segment = document.createElement('div');
        segment.className = 'waterfall-segment';
        segment.style.width = `${calculatePercentage(timings.dnsLookup, timings.total)}%`;
        segment.style.backgroundColor = colors.dns;
        segment.setAttribute('title', `DNS Lookup: ${formatTime(timings.dnsLookup)}`);
        waterfallBar.appendChild(segment);
        accumulatedTime += timings.dnsLookup;
    }

    if (timings.tcpConnection > 0) {
        const segment = document.createElement('div');
        segment.className = 'waterfall-segment';
        segment.style.width = `${calculatePercentage(timings.tcpConnection, timings.total)}%`;
        segment.style.backgroundColor = colors.tcp;
        segment.setAttribute('title', `TCP Connection: ${formatTime(timings.tcpConnection)}`);
        waterfallBar.appendChild(segment);
        accumulatedTime += timings.tcpConnection;
    }

    if (timings.tlsHandshake > 0) {
        const segment = document.createElement('div');
        segment.className = 'waterfall-segment';
        segment.style.width = `${calculatePercentage(timings.tlsHandshake, timings.total)}%`;
        segment.style.backgroundColor = colors.tls;
        segment.setAttribute('title', `TLS Handshake: ${formatTime(timings.tlsHandshake)}`);
        waterfallBar.appendChild(segment);
        accumulatedTime += timings.tlsHandshake;
    }

    // Calculate waiting time (time until first byte minus connection overhead)
    const waitingTime = Math.max(0, timings.firstByte - accumulatedTime);
    if (waitingTime > 0) {
        const segment = document.createElement('div');
        segment.className = 'waterfall-segment';
        segment.style.width = `${calculatePercentage(waitingTime, timings.total)}%`;
        segment.style.backgroundColor = colors.ttfb;
        segment.setAttribute('title', `Waiting (TTFB): ${formatTime(waitingTime)}`);
        waterfallBar.appendChild(segment);
    }

    if (timings.download > 0) {
        const segment = document.createElement('div');
        segment.className = 'waterfall-segment';
        segment.style.width = `${calculatePercentage(timings.download, timings.total)}%`;
        segment.style.backgroundColor = colors.download;
        segment.setAttribute('title', `Content Download: ${formatTime(timings.download)}`);
        waterfallBar.appendChild(segment);
    }

    waterfall.appendChild(waterfallBar);

    breakdown.appendChild(timingBars);
    breakdown.appendChild(waterfall);
    container.appendChild(breakdown);

    // Add legend
    const legend = document.createElement('div');
    legend.className = 'timing-legend';

    const legendTitle = document.createElement('h4');
    legendTitle.textContent = 'Legend';
    legend.appendChild(legendTitle);

    const legendItems = document.createElement('div');
    legendItems.className = 'legend-items';

    const phases = [
        { label: 'DNS Lookup', color: colors.dns },
        { label: 'TCP Connection', color: colors.tcp },
        { label: 'TLS Handshake', color: colors.tls },
        { label: 'Waiting (TTFB)', color: colors.ttfb },
        { label: 'Content Download', color: colors.download }
    ];

    phases.forEach(phase => {
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
    container.appendChild(legend);
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
