const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadBrowserScripts, hostCopy } = require('../helpers/browser-scripts');
const { CAST, lapsResponseOf, T0, MINUTE } = require('../fixtures/fake-mylaps-data');

const { normalizeLaps, lapExtent, riderStateAt, onIceOverlapMs, groupMembership, finishCrossings } =
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

describe('finishCrossings', () => {
    it('is the start of every skating lap plus the end of the last one', () => {
        const crossings = finishCrossings(laps(0, 3, 40), TRACK);
        assert.deepEqual(hostCopy(crossings), [0, 40000, 80000, 120000].map(ms => t0 + ms));
    });
    it('ignores break laps (slower than 8 km/h)', () => {
        const withBreak = [lap(0, 40, 1), lap(40, 300, 2), lap(340, 40, 3)];
        assert.deepEqual(hostCopy(finishCrossings(withBreak, TRACK)), [0, 40000, 340000, 380000].map(ms => t0 + ms));
    });
});

describe('groupMembership: riders crossing the finish line right after each other', () => {
    const reference = laps(0, 30);                                    // 40 s laps, so the window is 10 s either side
    const group = (riders, ref = reference) => {
        const result = groupMembership(ref, riders.map(([id, offset, count = 30, seconds = 40]) => ({ id, laps: laps(offset, count, seconds) })), TRACK);
        return Object.fromEntries(result);
    };
    const WHOLE = 30 * 40000;

    it('a rider crossing within 1 second of you is in your group for every lap', () => {
        assert.deepEqual(group([['a', 0.5], ['b', -1], ['c', 1]]), { a: WHOLE, b: WHOLE, c: WHOLE });
    });
    it('a rider more than 1 second away is not, when nobody bridges the gap', () => {
        assert.deepEqual(group([['a', 1.5], ['b', -1.5]]), { a: 0, b: 0 });
    });
    it('the next rider counts when he crosses within 1 second of the rider before him, forwards and backwards', () => {
        const result = group([['a', 0.9], ['b', 1.8], ['c', 3.5], ['d', -0.8], ['e', -1.7], ['f', 9.9]], laps(0, 3));
        assert.deepEqual(result, { a: 120000, b: 120000, c: 0, d: 120000, e: 120000, f: 0 });
    });
    it('the chain stops at a quarter of your lap time (10 s of a 40 s lap, about 100 m)', () => {
        const riders = Array.from({ length: 14 }, (_, k) => [`r${k + 1}`, 0.9 * (k + 1), 2]);
        const result = group(riders, laps(0, 2));
        for (let k = 1; k <= 14; k++) assert.equal(result[`r${k}`], 0.9 * k <= 10 ? 80000 : 0, `rider ${k} at ${(0.9 * k).toFixed(1)} s`);
    });
    it('the window follows your own lap time', () => {
        const slow = laps(0, 10, 80);                                   // 80 s laps: 20 s either side
        const riders = Array.from({ length: 24 }, (_, k) => [`r${k + 1}`, 0.9 * (k + 1), 10, 80]);
        const result = group(riders, slow);
        assert.equal(result.r22 > 0, true);                             // 19.8 s
        assert.equal(result.r23, 0);                                    // 20.7 s
    });
    it('only counts the crossings where the rider is close: a rider who drifts past is barely in the group', () => {
        const result = group([['slow', 0, 25, 47]]);
        assert.ok(result.slow <= 3 * 40000, String(result.slow));
    });
    it('a rider who was not skating at the same time gets 0', () => {
        assert.deepEqual(group([['late', 5000]]), { late: 0 });
    });
    it('a break lap of yours gives no credit', () => {
        const ref = [lap(0, 40, 1), lap(40, 300, 2), lap(340, 40, 3)];
        const rider = [{ id: 'a', laps: [lap(0.5, 40, 1), lap(40.5, 300, 2), lap(340.5, 40, 3)] }];
        assert.equal(groupMembership(ref, rider, TRACK).get('a'), 80000);   // the two skating laps only
    });
    it('a rider without laps, and no riders at all, are fine', () => {
        assert.equal(groupMembership(reference, [{ id: 'x', laps: [] }], TRACK).get('x'), 0);
        assert.equal(groupMembership(reference, [], TRACK).size, 0);
    });
});
