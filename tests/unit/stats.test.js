const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadBrowserScripts } = require('../helpers/browser-scripts');

const { analyzeSpeedLaps } = loadBrowserScripts(['utils.js', 'stats.js']).sandbox;

// Lap 1 is slow, laps 2-4 fast, lap 5 slow, laps 6-9 fast, lap 10 slow.
const DURATIONS = ['1:10.000', '40.5', '41.0', '40.8', '1:05.0', '42.0', '41.5', '41.2', '40.9', '1:20.0'];
const laps = DURATIONS.map((duration, i) => ({ nr: i + 1, duration }));
const close = (actual, expected, tolerance = 0.001) =>
    assert.ok(Math.abs(actual - expected) < tolerance, `${actual} is not within ${tolerance} of ${expected}`);

describe('analyzeSpeedLaps', () => {
    const analysis = analyzeSpeedLaps(laps, 60, 400);

    it('counts the laps faster than the threshold', () => {
        assert.equal(analysis.fastCount, 7);
        assert.equal(analysis.totalLaps, 10);
        close(analysis.fastShare, 0.7);
    });
    it('computes average, median, best and the average of the best laps', () => {
        close(analysis.avg, 41.129);
        close(analysis.median, 41.0);
        close(analysis.best, 40.5);
        assert.equal(analysis.bestCount, 5);
        close(analysis.bestAvg, 40.88);
    });
    it('computes consistency, speed and distance', () => {
        close(analysis.stdDev, 0.459);
        close(analysis.avgSpeedKph, (400 / 41.129) * 3.6, 0.01);
        close(analysis.distanceKm, 2.8);
    });
    it('computes the fade between the second and the first half', () => {
        close(analysis.fade, 0.433);
    });
    it('finds the blocks of consecutive speed laps', () => {
        assert.equal(analysis.blocks.length, 2);
        assert.deepEqual([analysis.blocks[0].firstLap, analysis.blocks[0].lastLap, analysis.blocks[0].count], [2, 4, 3]);
        assert.deepEqual([analysis.blocks[1].firstLap, analysis.blocks[1].lastLap, analysis.blocks[1].count], [6, 9, 4]);
        close(analysis.blocks[0].avg, 40.767);
        close(analysis.blocks[1].best, 40.9);
    });
    it('returns null when no lap is faster than the threshold', () => {
        assert.equal(analyzeSpeedLaps(laps, 10, 400), null);
    });
    it('ignores laps without a valid duration', () => {
        const withBadLap = [...laps, { nr: 11, duration: 'oops' }];
        assert.equal(analyzeSpeedLaps(withBadLap, 60, 400).totalLaps, 10);
    });
    it('does not report a fade for fewer than four speed laps', () => {
        assert.equal(analyzeSpeedLaps(laps.slice(0, 4), 60, 400).fade, null);
    });
    it('a single fast lap is not a block', () => {
        const single = analyzeSpeedLaps([{ nr: 1, duration: '80' }, { nr: 2, duration: '40' }, { nr: 3, duration: '80' }], 60, 400);
        assert.equal(single.blocks.length, 0);
    });
});
