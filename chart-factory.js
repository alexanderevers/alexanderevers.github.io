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
        compare: token('--cat-3'),
        text: token('--text-secondary'),
        muted: token('--text-muted'),
        grid: token('--chart-grid'),
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

/** Bin width and range for a lap-time histogram: the narrowest of a few common widths that keeps at most 14
 * bins, so the chart stays readable regardless of how spread out the times are. */
function pickDistributionBins(times) {
    const min = Math.min(...times);
    const max = Math.max(...times);
    const widths = [0.1, 0.2, 0.25, 0.5, 1, 2, 5];
    const width = widths.find(w => (max - min) / w <= 14) || 5;
    const start = Math.floor(min / width) * width;
    const binCount = Math.floor((max - start) / width) + 1;
    return { start, width, binCount };
}

/** A bin edge in seconds, e.g. 24 or 24.5 - never the MM:SS duration format, so it reads as a plain lap time. */
function secondsLabel(seconds) {
    const rounded = Math.round(seconds * 10) / 10;
    return String(rounded);
}

/** Histogram of speed-lap times. Bars start at zero and grow from the baseline. */
function buildDistributionChartConfig(times) {
    const t = applyChartDefaults();
    const { start, width, binCount } = pickDistributionBins(times);
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

const shortDateLabel = isoString => new Date(isoString).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' });

/** Tick positions (days since 1 September of startYear, the same reference seasonBreakdown's dayOfSeason uses)
 * and month labels for October through March: the graph itself is shown narrower than the full Sept-April
 * season definition (seasonOf), which still governs what data belongs to the season. Real Date objects do the
 * math, so a leap-year February is handled automatically, not a hard-coded day count. */
function seasonAxisTicks(startYear) {
    const months = [[9, startYear, 'Oct'], [10, startYear, 'Nov'], [11, startYear, 'Dec'],
        [0, startYear + 1, 'Jan'], [1, startYear + 1, 'Feb'], [2, startYear + 1, 'Mar']];
    const seasonStart = new Date(startYear, 8, 1).getTime();
    return months.map(([month, year, label]) => ({ value: Math.round((new Date(year, month, 1).getTime() - seasonStart) / 86400000), label }));
}

/** The shared x-axis of the two season charts: a linear "day since 1 September" scale (not the category axis the
 * rest of the site's charts use), so two different seasons' sessions can share one axis and line up by their
 * position within the season rather than by calendar date. Bounded tight to 1 October .. a few days into April
 * (no auto-computed "nice round number" headroom Chart.js would otherwise add) so the graph itself runs from
 * the start of October to a little over March, without empty margin on either side. */
function seasonAxis(t, startYear) {
    const ticks = seasonAxisTicks(startYear);
    const seasonStart = new Date(startYear, 8, 1).getTime();
    const dayOf = date => Math.round((date.getTime() - seasonStart) / 86400000);
    return {
        type: 'linear',
        min: dayOf(new Date(startYear, 9, 1)),           // 1 October
        max: dayOf(new Date(startYear + 1, 3, 7)),        // 7 April: a little over March, without showing April itself
        offset: false,
        grid: { display: false },
        border: { color: t.axis },
        ticks: { color: t.muted, callback: value => (ticks.find(tick => tick.value === value) || {}).label || '' },
        afterBuildTicks: scale => { scale.ticks = ticks.map(tick => ({ value: tick.value })); }
    };
}

/**
 * Cumulative distance across one season, session by session; a second, dashed series overlays another season
 * for comparison, both placed on the same day-of-season x-axis (seasonAxis) so the two seasons line up
 * regardless of which calendar years they actually fell in.
 */
function buildSeasonDistanceChartConfig(current, compare, currentLabel, compareLabel, startYear) {
    const t = applyChartDefaults();
    const toPoint = p => ({ x: p.dayOfSeason, y: p.cumulativeDistanceKm, distanceKm: p.distanceKm, startTime: p.startTime });
    const datasets = [{
        label: currentLabel, data: current.map(toPoint),
        borderColor: t.fast, backgroundColor: withAlpha(t.fast, 0.15), pointBackgroundColor: t.fast,
        tension: 0.25, fill: true, pointRadius: 2
    }];
    if (compare) {
        datasets.push({
            label: compareLabel, data: compare.map(toPoint),
            borderColor: t.compare, backgroundColor: withAlpha(t.compare, 0.15), pointBackgroundColor: t.compare,
            tension: 0.25, fill: true, pointRadius: 2
        });
    }
    return {
        type: 'line',
        data: { datasets },
        options: {
            responsive: true, maintainAspectRatio: false, layout: { padding: 0 },
            plugins: {
                legend: { display: true, position: 'bottom', labels: { color: t.text, usePointStyle: true, boxWidth: 8 } },
                tooltip: {
                    callbacks: {
                        title: items => shortDateLabel(items[0].raw.startTime),
                        label: context => [`Total: ${context.raw.y.toFixed(1)} km`, `This session: ${context.raw.distanceKm.toFixed(1)} km`]
                    }
                }
            },
            scales: {
                x: seasonAxis(t, startYear),
                y: {
                    beginAtZero: true, grid: { color: t.grid }, border: { color: t.axis }, ticks: { color: t.muted },
                    title: { display: true, text: 'Distance (km)', color: t.muted }
                }
            }
        }
    };
}

/**
 * A chosen lap time metric of each session (line, right axis - current, points already carry a "lineMs" field
 * from whichever LAP_TIME_METRICS entry the caller picked, e.g. lapTimeStat(p.lapDurationsMs, 5) for "Fastest-5")
 * and how many of that session's laps were "fast" (bar, left axis) across one season; a second, muted set of
 * series overlays another season for comparison. Same day-of-season x-axis as buildSeasonDistanceChartConfig,
 * and the same fastLapThresholdMs pace bar "Fast laps per season" (records-ui.js) uses, so "fast" means the
 * same thing on both dashboards.
 */
function buildSeasonFastLapsChartConfig(current, compare, currentLabel, compareLabel, fastLapThresholdMs, startYear, metricLabel) {
    const t = applyChartDefaults();
    const toBar = p => ({ x: p.dayOfSeason, y: p.fastCount, totalLaps: p.totalLaps, startTime: p.startTime });
    const toLine = p => (p.lineMs === null ? null : { x: p.dayOfSeason, y: p.lineMs / 1000, startTime: p.startTime });
    const trimDuration = seconds => formatSecondsToDuration(seconds).replace(/\.?0+$/, '');
    const datasets = [
        { type: 'bar', label: `${currentLabel} – Fast laps`, data: current.map(toBar), backgroundColor: withAlpha(t.fast, 0.35), yAxisID: 'count', barThickness: 8 },
        { type: 'line', label: `${currentLabel} – ${metricLabel}`, data: current.map(toLine).filter(Boolean), borderColor: t.avg, backgroundColor: t.avg, pointBackgroundColor: t.avg, tension: 0.25, pointRadius: 2, yAxisID: 'time' }
    ];
    if (compare) {
        datasets.push(
            { type: 'bar', label: `${compareLabel} – Fast laps`, data: compare.map(toBar), backgroundColor: withAlpha(t.compare, 0.5), yAxisID: 'count', barThickness: 8 },
            { type: 'line', label: `${compareLabel} – ${metricLabel}`, data: compare.map(toLine).filter(Boolean), borderColor: t.compare, backgroundColor: t.compare, pointBackgroundColor: t.compare, tension: 0.25, pointRadius: 2, yAxisID: 'time' }
        );
    }
    return {
        data: { datasets },
        options: {
            responsive: true, maintainAspectRatio: false, layout: { padding: 0 },
            plugins: {
                legend: { display: true, labels: { color: t.text, boxWidth: 14 } },
                tooltip: {
                    callbacks: {
                        title: items => shortDateLabel(items[0].raw.startTime),
                        label: context => (context.dataset.yAxisID === 'time'
                            ? `${context.dataset.label}: ${trimDuration(context.raw.y)}`
                            : `${context.dataset.label}: ${context.raw.y} (of ${context.raw.totalLaps})${fastLapThresholdMs === null ? '' : `, under ${trimDuration(fastLapThresholdMs / 1000)}`}`)
                    }
                }
            },
            scales: {
                x: seasonAxis(t, startYear),
                count: {
                    position: 'right', beginAtZero: true, grid: { display: false }, border: { color: t.axis },
                    ticks: { color: t.muted, precision: 0 }, title: { display: true, text: 'Fast laps', color: t.muted }
                },
                time: timeAxis(t, 'left', { reverse: false })
            }
        }
    };
}

/**
 * How one season's lap times are distributed, one bin per whole second (always 1 s wide, regardless of how
 * spread out the times are - unlike pickDistributionBins' auto-picked width): a line of either each bin's
 * share of that season's own laps ("relative", the default - so a season with far fewer laps than another is
 * still comparable) or the raw lap count ("absolute", the real value); a second line overlays another season
 * for comparison. Both series share the same bins (picked from the combined times of both seasons), so their
 * shapes line up on one x-axis.
 */
function buildSeasonDistributionChartConfig(currentTimes, compareTimes, currentLabel, compareLabel, mode) {
    const t = applyChartDefaults();
    const CHART_MAX_SECONDS = 60;   // a lap this slow is a rare break or mistiming, not interesting to chart in detail
    const isRelative = mode !== 'absolute';
    const allTimes = compareTimes && compareTimes.length ? [...currentTimes, ...compareTimes] : currentTimes;
    const capped = allTimes.filter(x => x <= CHART_MAX_SECONDS);
    const times = capped.length ? capped : allTimes;
    const width = 1;
    const start = Math.floor(Math.min(...times));
    const binCount = Math.floor(Math.max(...times)) - start + 1;
    const labels = Array.from({ length: binCount }, (_, i) => secondsLabel(start + i * width));
    // Times past the last bin are left uncounted (not folded into it), so that bin is not inflated by a long tail.
    const toValues = laps => {
        const counts = new Array(binCount).fill(0);
        laps.forEach(x => {
            const index = Math.floor(x - start);
            if (index >= 0 && index < binCount) counts[index]++;
        });
        return isRelative && laps.length ? counts.map(c => (c / laps.length) * 100) : counts;
    };
    const datasets = [{
        label: currentLabel, data: toValues(currentTimes),
        borderColor: t.fast, backgroundColor: withAlpha(t.fast, 0.15), fill: true, tension: 0.3, pointRadius: 2
    }];
    if (compareTimes) {
        datasets.push({
            label: compareLabel, data: toValues(compareTimes),
            borderColor: t.compare, backgroundColor: 'transparent', fill: false, tension: 0.3, pointRadius: 2
        });
    }
    return {
        type: 'line',
        data: { labels, datasets },
        options: {
            responsive: true, maintainAspectRatio: false, layout: { padding: 0 },
            plugins: {
                legend: { display: true, position: 'bottom', labels: { color: t.text, usePointStyle: true, boxWidth: 8 } },
                tooltip: {
                    callbacks: {
                        title: items => `${items[0].label} – ${secondsLabel(start + (items[0].dataIndex + 1) * width)} s`,
                        label: context => (isRelative
                            ? `${context.dataset.label}: ${context.parsed.y.toFixed(1)}%`
                            : `${context.dataset.label}: ${context.parsed.y} lap${context.parsed.y === 1 ? '' : 's'}`)
                    }
                }
            },
            scales: {
                x: {
                    grid: { display: false }, border: { color: t.axis }, ticks: { color: t.muted },
                    title: { display: true, text: 'Lap time (s)', color: t.muted }
                },
                y: {
                    beginAtZero: true, grid: { color: t.grid }, border: { color: t.axis },
                    ticks: { color: t.muted, callback: value => (isRelative ? `${value}%` : value) },
                    title: { display: true, text: isRelative ? 'Share of laps' : 'Laps', color: t.muted }
                }
            }
        }
    };
}
