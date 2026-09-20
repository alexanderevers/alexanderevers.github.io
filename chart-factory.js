/**
 * Chart Factory module for creating chart configurations.
 * Depends on functions from utils.js. Colors come from the CSS tokens in style.css,
 * so charts follow the light/dark theme.
 */

function chartTheme() {
    const styles = getComputedStyle(document.documentElement);
    const token = name => styles.getPropertyValue(name).trim();
    return {
        fast: token('--series-1'),
        avg: token('--series-2'),
        slow: token('--series-muted'),
        text: token('--text-secondary'),
        muted: token('--text-muted'),
        grid: token('--grid'),
        axis: token('--axis'),
        surface: token('--surface')
    };
}

function applyChartDefaults() {
    const t = chartTheme();
    Chart.defaults.font.family = 'system-ui, -apple-system, "Segoe UI", sans-serif';
    Chart.defaults.color = t.text;
    return t;
}

function withAlpha(hex, alpha) {
    const n = parseInt(hex.replace('#', ''), 16);
    return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

function timeAxis(t, position = 'bottom', extra = {}) {
    return {
        position,
        grid: { color: t.grid, lineWidth: 1 },
        border: { color: t.axis },
        ticks: { color: t.muted, callback: value => formatSecondsToDuration(value).replace(/\.?0+$/, '') },
        ...extra
    };
}

function lapTooltipLines(lap) {
    if (!lap) return '';
    const lines = [`Lap ${lap.nr}: ${lap.duration}`];
    if (lap.dateTimeStart) lines.push(`Lap start: ${formatTime(lap.dateTimeStart)}`);
    if (lap.diffPrevLap) lines.push(`Diff: ${lap.status === 'SLOWER' ? '+' : '-'}${lap.diffPrevLap}`);
    lines.push(`Session: ${lap.sessionDuration || 'N/A'}`);
    lines.push(`Speed: ${lap.speed?.kph?.toFixed(1) || 'N/A'} km/h`);
    return lines;
}

/**
 * The tooltip items to show: one per lap. The bar and the line of a speed lap are drawn at the same place and
 * would both list the same lap; the average line is explained by the legend, not by a tooltip.
 */
function overviewTooltipFilter(item, index, items) {
    if (item.dataset && item.dataset.isAverage) return false;
    return items.findIndex(other => !(other.dataset && other.dataset.isAverage) && other.dataIndex === item.dataIndex) === index;
}

/**
 * Lap times over the session: speed laps as a line, slower laps as muted dots,
 * plus a reference line at the average speed-lap time.
 */
function buildOverviewChartConfig(lapData, maxFastTime, avgFastTime) {
    const t = applyChartDefaults();
    const times = lapData.map(lap => parseDurationToSeconds(lap.duration));
    const validTimes = times.filter(x => !isNaN(x));
    const yMin = Math.max(0, Math.floor(Math.min(...validTimes) - 2));
    const yMax = Math.ceil(maxFastTime + 1);

    const fastData = times.map(x => (x < maxFastTime ? x : null));
    // Real values are kept: laps slower than the window are drawn as bars that run off the top of the axis.
    const slowData = times.map(x => (x >= maxFastTime ? x : null));
    const barStyle = { type: 'bar', grouped: false, borderRadius: { topLeft: 4, topRight: 4 }, borderSkipped: 'bottom', maxBarThickness: 24 };

    const datasets = [
        { ...barStyle, label: 'Speed laps', data: fastData, backgroundColor: withAlpha(t.fast, 0.35) },
        { ...barStyle, label: 'Slower laps', data: slowData, backgroundColor: t.slow },
        {
            type: 'line',
            label: 'Speed lap line',
            data: fastData,
            borderColor: t.fast,
            backgroundColor: t.fast,
            borderWidth: 2,
            tension: 0,
            spanGaps: false,
            pointRadius: 3,
            pointHoverRadius: 6,
            pointBorderColor: t.surface,
            pointBorderWidth: 2
        }
    ];
    if (avgFastTime) {
        datasets.push({
            type: 'line',
            label: `Avg speed lap (${formatSecondsToDuration(avgFastTime)})`,
            isAverage: true,
            data: times.map(() => avgFastTime),
            borderColor: t.avg,
            borderWidth: 2,
            pointRadius: 0,
            pointHoverRadius: 0
        });
    }

    return {
        type: 'bar',
        data: { labels: lapData.map(lap => lap.nr), datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            interaction: { mode: 'nearest', axis: 'x', intersect: false },
            scales: {
                x: {
                    grid: { display: false },
                    border: { color: t.axis },
                    ticks: { color: t.muted, maxTicksLimit: 20 },
                    title: { display: true, text: 'Lap', color: t.muted }
                },
                y: timeAxis(t, 'left', { min: yMin, max: yMax, reverse: false })
            },
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        usePointStyle: true,
                        boxWidth: 8,
                        color: t.text,
                        // The line over the bars shares the "Speed laps" entry.
                        filter: item => item.text !== 'Speed lap line'
                    }
                },
                tooltip: {
                    filter: overviewTooltipFilter,
                    callbacks: {
                        title: () => '',
                        label: context => lapTooltipLines(lapData[context.dataIndex])
                    }
                }
            }
        }
    };
}

/** Histogram of speed-lap times. Bars start at zero and grow from the baseline. */
function buildDistributionChartConfig(times) {
    const t = applyChartDefaults();
    const min = Math.min(...times);
    const max = Math.max(...times);
    const widths = [0.1, 0.2, 0.25, 0.5, 1, 2, 5];
    const width = widths.find(w => (max - min) / w <= 14) || 5;
    const start = Math.floor(min / width) * width;
    const binCount = Math.floor((max - start) / width) + 1;
    const counts = new Array(binCount).fill(0);
    times.forEach(x => { counts[Math.min(binCount - 1, Math.floor((x - start) / width))]++; });
    const labels = counts.map((_, i) => formatSecondsToDuration(start + i * width).replace(/0+$/, '').replace(/\.$/, ''));

    return {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                label: 'Laps',
                data: counts,
                backgroundColor: t.fast,
                borderRadius: { topLeft: 4, topRight: 4 },
                borderSkipped: 'bottom',
                maxBarThickness: 24
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            scales: {
                x: {
                    grid: { display: false },
                    border: { color: t.axis },
                    ticks: { color: t.muted },
                    title: { display: true, text: 'Lap time (s)', color: t.muted }
                },
                y: {
                    beginAtZero: true,
                    grid: { color: t.grid },
                    border: { display: false },
                    ticks: { color: t.muted, precision: 0 }
                }
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        title: items => `${items[0].label} – ${formatSecondsToDuration(start + (items[0].dataIndex + 1) * width)}`,
                        label: context => `${context.parsed.y} lap${context.parsed.y === 1 ? '' : 's'}`
                    }
                }
            }
        }
    };
}
