const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadBrowserScripts, hostCopy } = require('../helpers/browser-scripts');

// chart-factory.js reads colours from CSS and Chart.js defaults; a stand-in for both is enough here
const app = loadBrowserScripts(['utils.js', 'chart-factory.js'], {
    document: { cookie: '', documentElement: {} },
    getComputedStyle: () => ({ getPropertyValue: () => '#336699' }),
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
