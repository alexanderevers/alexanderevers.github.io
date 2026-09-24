const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadBrowserScripts, hostCopy } = require('../helpers/browser-scripts');

// chart-factory.js reads colours from CSS and Chart.js defaults; a stand-in for both is enough here. Each token
// gets its own colour (not one flat stub) so a test can tell, for example, that the "current" and "compare"
// series really use different colours.
const TOKEN_COLORS = { '--series-1': '#2a78d6', '--series-2': '#eb6834', '--series-muted': '#c3c2b7', '--cat-3': '#1baf7a' };
const app = loadBrowserScripts(['utils.js', 'chart-factory.js'], {
    document: { cookie: '', documentElement: {} },
    getComputedStyle: () => ({ getPropertyValue: name => TOKEN_COLORS[name] || '#336699' }),
    Chart: { defaults: { font: {} } }
}).sandbox;

const lap = nr => ({ nr, duration: '38.500', dateTimeStart: '2026-09-01T18:00:00Z', speed: { kph: 37.4 }, sessionDuration: '10:00', status: 'FASTER', diffPrevLap: '0.5' });
const item = (datasetIndex, dataIndex, dataset = {}) => ({ datasetIndex, dataIndex, dataset });

describe('the tooltip of the session chart lists each lap once', () => {
    it('keeps the bar and drops the line drawn at the same lap', () => {
        const items = [item(0, 3), item(2, 3)];                           // speed-lap bar and speed-lap line
        assert.deepEqual(hostCopy(items.map(app.overviewTooltipFilter)), [true, false]);
    });
    it('never lists the average line', () => {
        const items = [item(0, 3), item(3, 3, { isAverage: true })];
        assert.deepEqual(hostCopy(items.map(app.overviewTooltipFilter)), [true, false]);
        assert.equal(app.overviewTooltipFilter(item(3, 3, { isAverage: true }), 0, [item(3, 3, { isAverage: true })]), false);
    });
    it('keeps a slower lap, which only has a bar', () => {
        const items = [item(1, 7), item(3, 7, { isAverage: true })];
        assert.deepEqual(hostCopy(items.map(app.overviewTooltipFilter)), [true, false]);
    });
    it('keeps items of different laps', () => {
        const items = [item(0, 3), item(0, 4)];
        assert.deepEqual(hostCopy(items.map(app.overviewTooltipFilter)), [true, true]);
    });
    it('is used by the chart, which describes the lap of the hovered position', () => {
        const laps = [lap(1), lap(2), lap(3)];
        const config = app.buildOverviewChartConfig(laps, 60, 38.5);
        const tooltip = config.options.plugins.tooltip;
        assert.equal(tooltip.filter, app.overviewTooltipFilter);
        const lines = hostCopy(tooltip.callbacks.label({ dataIndex: 1, dataset: {} }));
        assert.equal(lines[0], 'Lap 2: 38.500');
        assert.ok(lines.some(text => text.startsWith('Speed:')));
    });
});

describe('seasonAxisTicks: month ticks for the Season dashboard\'s day-of-season axis', () => {
    it('runs Oct..Mar (the graph itself is narrower than the full Sept-April season), strictly increasing', () => {
        const ticks = hostCopy(app.seasonAxisTicks(2025));
        assert.deepEqual(ticks.map(t => t.label), ['Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar']);
        for (let i = 1; i < ticks.length; i++) assert.ok(ticks[i].value > ticks[i - 1].value, JSON.stringify(ticks));
    });
});

describe('buildSeasonDistanceChartConfig: cumulative distance, current season vs. an optional comparison', () => {
    const point = (dayOfSeason, distanceKm, cumulativeDistanceKm) => ({
        sessionId: dayOfSeason, startTime: '2025-09-01T00:00:01.000Z', dayOfSeason, distanceKm, cumulativeDistanceKm, bestLapMs: 30000, fastCount: 0, totalLaps: 1
    });
    const current = [point(0, 2, 2), point(10, 1.2, 3.2)];
    const compare = [point(0, 1, 1)];

    it('is a line chart on the day-of-season axis, one dataset without a comparison season', () => {
        const config = app.buildSeasonDistanceChartConfig(current, null, '25/26', '', 2025);
        assert.equal(config.type, 'line');
        assert.equal(config.data.datasets.length, 1);
        assert.equal(config.data.datasets[0].label, '25/26');
        assert.deepEqual(hostCopy(config.data.datasets[0].data.map(p => [p.x, p.y])), [[0, 2], [10, 3.2]]);
        assert.equal(config.options.scales.x.type, 'linear');
        assert.equal(config.options.scales.x.min, 30);       // 1 October: the graph itself starts there, not 1 September
    });
    it('adds a second, filled dataset in a different colour for the comparison season', () => {
        const config = app.buildSeasonDistanceChartConfig(current, compare, '25/26', '24/25', 2025);
        assert.equal(config.data.datasets.length, 2);
        assert.equal(config.data.datasets[1].label, '24/25');
        assert.equal(config.data.datasets[1].fill, true);
        assert.notEqual(config.data.datasets[1].borderColor, config.data.datasets[0].borderColor);
    });
    it('the tooltip shows the date, the running total and that session\'s own distance', () => {
        const config = app.buildSeasonDistanceChartConfig(current, null, '25/26', '', 2025);
        const tooltip = config.options.plugins.tooltip.callbacks;
        const raw = current[1];
        assert.match(tooltip.title([{ raw }]), /Sep|2025/);
        assert.deepEqual(hostCopy(tooltip.label({ raw: { y: raw.cumulativeDistanceKm, distanceKm: raw.distanceKm } })), ['Total: 3.2 km', 'This session: 1.2 km']);
    });
});

describe('buildSeasonFastLapsChartConfig: fast lap count (bar) and a chosen lap time metric (line), current vs. an optional comparison', () => {
    const point = (dayOfSeason, fastCount, totalLaps, lineMs) => ({
        sessionId: dayOfSeason, startTime: '2025-09-01T00:00:01.000Z', dayOfSeason, distanceKm: 1, cumulativeDistanceKm: 1, lineMs, fastCount, totalLaps
    });
    const current = [point(0, 2, 5, 30000), point(10, 0, 3, null)];   // the second session has no skating laps at all
    const compare = [point(0, 1, 4, 32000)];

    it('is a bar+line combo, two datasets without a comparison season, and drops sessions with no line value', () => {
        const config = app.buildSeasonFastLapsChartConfig(current, null, '25/26', '', 25000, 2025, 'Fastest lap');
        assert.equal(config.data.datasets.length, 2);
        assert.deepEqual(hostCopy(config.data.datasets.map(d => d.type)), ['bar', 'line']);
        assert.equal(config.data.datasets[0].data.length, 2);          // both sessions have a fast-lap count
        assert.equal(config.data.datasets[1].data.length, 1);          // only the first has a line value
    });
    it('names the line dataset after the chosen metric', () => {
        const config = app.buildSeasonFastLapsChartConfig(current, null, '25/26', '', 25000, 2025, 'Fastest-5');
        assert.equal(config.data.datasets[1].label, '25/26 – Fastest-5');
    });
    it('adds two more datasets, in a different colour, for the comparison season', () => {
        const config = app.buildSeasonFastLapsChartConfig(current, compare, '25/26', '24/25', 25000, 2025, 'Fastest lap');
        assert.equal(config.data.datasets.length, 4);
        assert.deepEqual(hostCopy(config.data.datasets.map(d => d.label)), ['25/26 – Fast laps', '25/26 – Fastest lap', '24/25 – Fast laps', '24/25 – Fastest lap']);
        assert.notEqual(config.data.datasets[3].borderColor, config.data.datasets[1].borderColor);
    });
    it('the tooltip tells the bar and the line apart, and names the pace bar', () => {
        const config = app.buildSeasonFastLapsChartConfig(current, null, '25/26', '', 25000, 2025, 'Fastest lap');
        const label = config.options.plugins.tooltip.callbacks.label;
        const barText = label({ dataset: { yAxisID: 'count', label: '25/26 – Fast laps' }, raw: { y: 2, totalLaps: 5 } });
        assert.match(barText, /2 \(of 5\), under/);
        const lineText = label({ dataset: { yAxisID: 'time', label: '25/26 – Fastest lap' }, raw: { y: 30 } });
        assert.match(lineText, /25\/26 – Fastest lap: 30/);
    });
    it('has a left "time" axis (the line) and a right "count" axis (the bars), both on the same day-of-season x-axis', () => {
        const config = app.buildSeasonFastLapsChartConfig(current, null, '25/26', '', 25000, 2025, 'Fastest lap');
        assert.equal(config.options.scales.time.position, 'left');
        assert.equal(config.options.scales.count.position, 'right');
        assert.equal(config.options.scales.x.type, 'linear');
    });
});

describe('buildSeasonDistributionChartConfig: lap time distribution as a share of the season\'s laps, current vs. an optional comparison', () => {
    // 8 laps of 20 s, 2 of 30 s: shares should read 80% and 20% in their own bins
    const currentTimes = [20, 20, 20, 20, 20, 20, 20, 20, 30, 30];
    const compareTimes = [25, 25];

    it('is a line chart, one dataset without a comparison season, values in seconds (not the MM:SS duration format)', () => {
        const config = app.buildSeasonDistributionChartConfig(currentTimes, null, '25/26', '');
        assert.equal(config.type, 'line');
        assert.equal(config.data.datasets.length, 1);
        assert.equal(config.data.datasets[0].label, '25/26');
        assert.ok(hostCopy(config.data.labels).every(label => /^\d+(\.\d+)?$/.test(label)), JSON.stringify(hostCopy(config.data.labels)));
    });
    it('reports each bin as a percentage of that season\'s own total, not a raw count', () => {
        const config = app.buildSeasonDistributionChartConfig(currentTimes, null, '25/26', '');
        const total = config.data.datasets[0].data.reduce((sum, share) => sum + share, 0);
        assert.ok(Math.abs(total - 100) < 1e-9, String(total));
    });
    it('adds a second dataset, in a different colour, for the comparison season, sharing the same bins', () => {
        const config = app.buildSeasonDistributionChartConfig(currentTimes, compareTimes, '25/26', '24/25');
        assert.equal(config.data.datasets.length, 2);
        assert.equal(config.data.datasets[1].label, '24/25');
        assert.notEqual(config.data.datasets[1].borderColor, config.data.datasets[0].borderColor);
        assert.equal(config.data.datasets[0].data.length, config.data.datasets[1].data.length);
        // the comparison season's own 2 laps still sum to 100% of itself, not diluted by the current season's laps
        const compareTotal = config.data.datasets[1].data.reduce((sum, share) => sum + share, 0);
        assert.ok(Math.abs(compareTotal - 100) < 1e-9, String(compareTotal));
    });
    it('the tooltip shows the bin range in seconds and the share as a percentage', () => {
        const config = app.buildSeasonDistributionChartConfig(currentTimes, null, '25/26', '');
        const tooltip = config.options.plugins.tooltip.callbacks;
        assert.match(tooltip.title([{ dataIndex: 0 }]), /s$/);
        assert.match(tooltip.label({ dataset: { label: '25/26' }, parsed: { y: 80 } }), /25\/26: 80\.0%/);
    });
    it('stops at 60 s: a rare, much slower lap does not stretch the axis or get folded into the last bin', () => {
        const withOutlier = [...currentTimes, 300];                        // one 5-minute "lap" (a break, not a real one)
        const config = app.buildSeasonDistributionChartConfig(withOutlier, null, '25/26', '');
        const withoutOutlier = app.buildSeasonDistributionChartConfig(currentTimes, null, '25/26', '');
        assert.deepEqual(hostCopy(config.data.labels), hostCopy(withoutOutlier.data.labels));
        // the outlier is simply not counted, so the visible bins no longer sum to a full 100%
        const total = config.data.datasets[0].data.reduce((sum, share) => sum + share, 0);
        assert.ok(total < 100 && total > 90, String(total));
    });
    it('bins are always exactly 1 second wide, one label per whole second, however wide the spread', () => {
        // a 39 s spread: pickDistributionBins would have picked wider bins to stay under 14 of them
        const wideSpread = [20, 59];
        const config = app.buildSeasonDistributionChartConfig(wideSpread, null, '25/26', '');
        assert.deepEqual(hostCopy(config.data.labels), Array.from({ length: 40 }, (_, i) => String(20 + i)));
    });
    it('shows small dots on the line', () => {
        const config = app.buildSeasonDistributionChartConfig(currentTimes, null, '25/26', '');
        assert.equal(config.data.datasets[0].pointRadius, 2);
    });
    it('"relative" (the default) reports a percentage of that season\'s own laps; "absolute" reports the raw count', () => {
        const relative = app.buildSeasonDistributionChartConfig(currentTimes, null, '25/26', '', 'relative');
        const absolute = app.buildSeasonDistributionChartConfig(currentTimes, null, '25/26', '', 'absolute');
        assert.equal(relative.data.datasets[0].data[0], 80);            // 8 of 10 laps in the 20 s bin
        assert.equal(absolute.data.datasets[0].data[0], 8);             // the real count, not a share
        assert.match(relative.options.plugins.tooltip.callbacks.label({ dataset: { label: '25/26' }, parsed: { y: 80 } }), /%$/);
        assert.match(absolute.options.plugins.tooltip.callbacks.label({ dataset: { label: '25/26' }, parsed: { y: 8 } }), /8 laps$/);
    });
});
