const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadBrowserScripts, hostCopy } = require('../helpers/browser-scripts');
const { CAST, lapsResponseOf, T0, MINUTE } = require('../fixtures/fake-mylaps-data');

const { normalizeLaps, lapExtent, riderStateAt, onIceOverlapMs, groupTimeMs } =
    loadBrowserScripts(['utils.js', 'replay-track.js', 'replay-model.js']).sandbox;

const TRACK = 400;
const iso = ms => new Date(ms).toISOString();
const t0 = 1e12;
// Normalized laps that start `start` seconds after t0 and last `seconds`.
const lap = (start, seconds, nr = 1) => ({ nr, startMs: t0 + start * 1000, durMs: seconds * 1000 });
// Back-to-back laps of the same duration.
const laps = (offsetSeconds, count = 30, seconds = 40) =>
    Array.from({ length: count }, (_, i) => lap(offsetSeconds + i * seconds, seconds, i + 1));

describe('normalizeLaps', () => {
    const response = { sessions: [{ laps: [
        { nr: 2, dateTimeStart: iso(t0 + 40000), duration: '1:00.000' },
        { nr: 1, dateTimeStart: iso(t0), duration: '40.000' },
        { nr: 3, dateTimeStart: 'not a date', duration: '40.000' },
        { nr: 4, dateTimeStart: iso(t0 + 100000), duration: 'oops' }
    ] }] };

    it('sorts by start time and drops laps that cannot be read', () => {
        const result = normalizeLaps(response);
        assert.deepEqual(hostCopy(result).map(l => l.nr), [1, 2]);
        assert.equal(result[1].durMs, 60000);
    });
    it('copes with empty answers', () => {
        assert.deepEqual(hostCopy(normalizeLaps(null)), []);
        assert.deepEqual(hostCopy(normalizeLaps({})), []);
        assert.deepEqual(hostCopy(normalizeLaps({ sessions: [{}] })), []);
    });
    it('reads all the laps of the fake rider fixture', () => {
        const rider = CAST[0];
        const expected = lapsResponseOf(rider).sessions[0].laps.length;
        assert.equal(normalizeLaps(lapsResponseOf(rider)).length, expected);
    });
});

describe('lapExtent', () => {
    it('runs from the first lap start to the last lap end', () => {
        const extent = lapExtent([lap(0, 40), lap(40, 60)]);
        assert.equal(extent.startMs, t0);
        assert.equal(extent.endMs, t0 + 100000);
    });
    it('is null without laps', () => {
        assert.equal(lapExtent([]), null);
        assert.equal(lapExtent(null), null);
    });
});

describe('riderStateAt', () => {
    const rider = [lap(0, 40, 1), lap(40, 60, 2), lap(102, 50, 3), lap(500, 50, 4)];   // 2 s gap, then a long pause

    it('is null before the first lap', () => {
        assert.equal(riderStateAt(rider, t0 - 1, TRACK), null);
    });
    it('interpolates evenly within a lap', () => {
        const state = riderStateAt(rider, t0 + 10000, TRACK);
        assert.equal(state.lap.nr, 1);
        assert.ok(Math.abs(state.frac - 0.25) < 1e-9);
        assert.ok(Math.abs(state.speedKph - 36) < 1e-9);   // 400 m in 40 s
    });
    it('a lap boundary belongs to the next lap, at the finish line', () => {
        const state = riderStateAt(rider, t0 + 40000, TRACK);
        assert.equal(state.lap.nr, 2);
        assert.equal(state.frac, 0);
    });
    it('a small gap between laps keeps the rider at the finish line', () => {
        const state = riderStateAt(rider, t0 + 101000, TRACK);
        assert.equal(state.lap.nr, 2);
        assert.equal(state.frac, 1);
    });
    it('a long pause and the time after the last lap are off the ice', () => {
        assert.equal(riderStateAt(rider, t0 + 300000, TRACK), null);
        assert.equal(riderStateAt(rider, t0 + 600000, TRACK), null);
    });
    it('a break lap (400 m in 6 minutes) is off the ice, the lap after it is normal again', () => {
        const withBreak = [lap(0, 40, 1), lap(40, 360, 2), lap(400, 41, 3)];
        assert.equal(riderStateAt(withBreak, t0 + 100000, TRACK), null);
        assert.equal(riderStateAt(withBreak, t0 + 420000, TRACK).lap.nr, 3);
    });
    it('a slow but real lap (1:30 = 16 km/h) is still shown', () => {
        assert.notEqual(riderStateAt([lap(0, 90)], t0 + 10000, TRACK), null);
    });
    it('uses the track length for the speed', () => {
        assert.ok(Math.abs(riderStateAt([lap(0, 40)], t0 + 1000, 250).speedKph - 22.5) < 1e-9);   // 250 m in 40 s
    });
});

describe('onIceOverlapMs', () => {
    it('adds up the time both riders were skating', () => {
        const a = [lap(0, 40), lap(40, 40), lap(80, 40)];      // 0 - 120 s
        const b = [lap(20, 50), lap(70, 50)];                    // 20 - 120 s
        assert.equal(onIceOverlapMs(a, b, TRACK), 100000);
        assert.equal(onIceOverlapMs(b, a, TRACK), 100000);      // symmetric
    });
    it('is 0 for riders who never skated at the same time, also when they only touch', () => {
        assert.equal(onIceOverlapMs([lap(0, 40)], [lap(100, 40)], TRACK), 0);
        assert.equal(onIceOverlapMs([lap(0, 40)], [lap(40, 40)], TRACK), 0);
    });
    it('does not count break laps', () => {
        assert.equal(onIceOverlapMs([lap(0, 40), lap(40, 360)], [lap(0, 400)], TRACK), 0);
    });
    it('handles one long interval against many short ones', () => {
        assert.equal(onIceOverlapMs([lap(0, 100)], [lap(10, 40), lap(50, 40), lap(500, 40)], TRACK), 80000);
    });
    it('is 0 with no laps', () => {
        assert.equal(onIceOverlapMs([], laps(0), TRACK), 0);
    });
    it('agrees with the fake rink: the all-day rider skated with nobody, the others did', () => {
        const reference = normalizeLaps(lapsResponseOf(CAST[0]));
        const allDay = normalizeLaps(lapsResponseOf(CAST.find(r => r.id === 40)));
        const together = normalizeLaps(lapsResponseOf(CAST.find(r => r.id === 20)));
        assert.equal(onIceOverlapMs(reference, allDay, TRACK), 0);
        assert.ok(onIceOverlapMs(reference, together, TRACK) > 15 * MINUTE);
    });
});

describe('groupTimeMs: skating as a group', () => {
    const reference = laps(0);

    it('counts nearly all the shared time for a rider 20 m behind you', () => {
        const result = groupTimeMs(reference, laps(2), TRACK);      // 2 s behind = 20 m
        assert.ok(result.groupMs > result.bothMs * 0.98, JSON.stringify(result));
    });
    it('counts nothing for a rider 100 m or 200 m away', () => {
        assert.equal(groupTimeMs(reference, laps(10), TRACK).groupMs, 0);     // 100 m
        assert.equal(groupTimeMs(reference, laps(20), TRACK).groupMs, 0);     // opposite side
    });
    it('depends on the radius: 60 m apart is in a group at 100 m but not at 50 m', () => {
        assert.equal(groupTimeMs(reference, laps(6), TRACK).groupMs, 0);
        assert.ok(groupTimeMs(reference, laps(6), TRACK, 100).groupMs > 0);
    });
    it('gives almost no credit to a rider who only drifts past (chance level, about 25% close)', () => {
        const slower = Array.from({ length: 25 }, (_, i) => lap(i * 47, 47, i + 1));   // 47 s laps against 40 s
        const result = groupTimeMs(reference.slice(0, 29), slower, TRACK);
        const closeShare = result.closeMs / result.bothMs;
        assert.ok(Math.abs(closeShare - 0.25) < 0.06, `close share ${closeShare}`);
        assert.ok(result.groupMs < result.bothMs * 0.08, `${result.groupMs} of ${result.bothMs}`);
    });
    it('is 0 without overlap or without laps', () => {
        assert.equal(groupTimeMs(laps(0, 5), laps(1000, 5), TRACK).groupMs, 0);
        assert.equal(groupTimeMs([], reference, TRACK).groupMs, 0);
    });
});
