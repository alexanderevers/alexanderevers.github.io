const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadBrowserScripts, hostCopy } = require('../helpers/browser-scripts');

const app = loadBrowserScripts(['utils.js', 'replay-track.js', 'replay-model.js', 'live-model.js']);
const { liveCandidates, riderLive, sortLiveRiders, liveInitials } = app.sandbox;
const LIVE_WINDOW_MS = app.get('LIVE_WINDOW_MS');   // (a const is not a property of the sandbox)
const LIVE_ACTIVE_MS = app.get('LIVE_ACTIVE_MS');

const NOW = Date.parse('2026-09-21T10:50:00Z');
const iso = ms => new Date(ms).toISOString();
const SECOND = 1000;
const activity = (id, startAgoS, endAgoS, extra = {}) => ({
    id, chipCode: `AB-${String(10000 + id)}`, chipLabel: '',
    startTime: iso(NOW - startAgoS * SECOND), endTime: endAgoS === null ? null : iso(NOW - endAgoS * SECOND), ...extra
});
// Back-to-back laps of `seconds`, the last one ending `endedAgoS` seconds before NOW.
function laps(count, seconds, endedAgoS) {
    const end = NOW - endedAgoS * SECOND;
    return Array.from({ length: count }, (_, i) => ({ nr: i + 1, startMs: end - (count - i) * seconds * SECOND, durMs: seconds * SECOND }));
}

describe('liveCandidates: which activities may be on the ice', () => {
    it('keeps activities that have no end yet and those that ended within the window', () => {
        const list = [activity(1, 600, null), activity(2, 900, 30), activity(3, 3000, 14 * 60), activity(4, 4000, 16 * 60), activity(5, 9000, 3 * 3600)];
        assert.deepEqual(hostCopy(liveCandidates(list, NOW).map(a => a.id)), [1, 2, 3]);
    });
    it('ignores activities that start in the future and ones without a usable time', () => {
        const list = [activity(1, -600, null), { id: 2, chipCode: 'AB-10002', startTime: 'nonsense', endTime: null }, activity(3, 60, 5)];
        assert.deepEqual(hostCopy(liveCandidates(list, NOW).map(a => a.id)), [3]);
    });
    it('takes the window as a parameter and copes with an empty list', () => {
        assert.deepEqual(hostCopy(liveCandidates([activity(1, 900, 120)], NOW, 60 * SECOND)), []);
        assert.deepEqual(hostCopy(liveCandidates(null, NOW)), []);
        assert.equal(LIVE_WINDOW_MS, 15 * 60 * 1000);
        assert.equal(LIVE_ACTIVE_MS, 2 * 60 * 1000);
    });
});

describe('riderLive: the picture of one rider', () => {
    it('is waiting until the first lap has arrived', () => {
        for (const noLaps of [null, []]) {
            const rider = riderLive(activity(1, 5, null), noLaps, NOW);
            assert.equal(rider.status, 'waiting');
            assert.equal(rider.lapCount, 0);
            assert.equal(rider.frac, null);
        }
    });
    it('is skating when the last lap ended a moment ago: laps, last, best and the pace over the last three laps', () => {
        const rider = riderLive(activity(1, 400, 4), laps(10, 30, 4), NOW);
        assert.equal(rider.status, 'skating');
        assert.equal(rider.lapCount, 10);
        assert.equal(rider.lastMs, 30000);
        assert.equal(rider.bestMs, 30000);
        assert.equal(rider.paceMs, 30000);
        assert.equal(rider.sinceMs, 4000);
        assert.deepEqual(hostCopy(rider.lastLap), { nr: 10, durMs: 30000, endMs: NOW - 4000 });
    });
    it('finds the best lap and its number, and averages only the last three laps for the pace', () => {
        const list = laps(6, 30, 10);
        list[1].durMs = 25000;                                   // lap 2 is the fastest
        list[5].durMs = 36000;
        const rider = riderLive(activity(1, 300, 10), list, NOW);
        assert.equal(rider.bestMs, 25000);
        assert.equal(rider.bestNr, 2);
        assert.equal(rider.paceMs, (30000 + 30000 + 36000) / 3);
    });
    it('estimates the position: the time since the last crossing as a share of the lap time', () => {
        assert.equal(riderLive(activity(1, 400, 15), laps(8, 30, 15), NOW).frac, 0.5);
        assert.equal(riderLive(activity(1, 400, 0), laps(8, 30, 0), NOW).frac, 0);
    });
    it('keeps the dot just before the finish line while the next crossing is late', () => {
        const rider = riderLive(activity(1, 400, 40), laps(8, 30, 40), NOW);      // 40 s since the last crossing, laps of 30 s
        assert.equal(rider.status, 'skating');                                     // still within 1.5 x the lap time
        assert.equal(rider.frac, 0.99);
    });
    it('is on the ice while the last crossing is less than 2 minutes ago, whatever the lap time; a lap of more than 2 minutes sends him to "Recently on the ice"', () => {
        assert.equal(riderLive(activity(1, 900, 119), laps(8, 30, 119), NOW).status, 'skating');
        assert.equal(riderLive(activity(1, 900, 121), laps(8, 30, 121), NOW).status, 'resting');
        assert.equal(riderLive(activity(1, 900, 110), laps(8, 100, 110), NOW).status, 'skating');    // slow laps of 100 s
        assert.equal(riderLive(activity(1, 900, 130), laps(8, 100, 130), NOW).status, 'resting');    // 130 s since the last crossing: the lap takes over 2 minutes
        assert.equal(riderLive(activity(1, 900, 130), laps(8, 100, 130), NOW).frac, null);
        assert.equal(riderLive(activity(1, 900, 65), laps(8, 5, 65), NOW).status, 'skating');        // fast laps of 5 s, a minute without a crossing: still on the ice
    });
    it('has left after 15 minutes without a crossing', () => {
        assert.equal(riderLive(activity(1, 4000, 14 * 60), laps(8, 30, 14 * 60), NOW).status, 'resting');   // 14 minutes: still in "Recently on the ice"
        assert.equal(riderLive(activity(1, 4000, 16 * 60), laps(8, 30, 16 * 60), NOW).status, 'left');      // 15 minutes or more: gone
    });
    it('does not count a break (a lap slower than 8 km/h) as skating', () => {
        const list = [...laps(5, 30, 400), { nr: 6, startMs: NOW - 400 * SECOND, durMs: 300 * SECOND }];   // ends 100 s ago
        const rider = riderLive(activity(1, 900, 100), list, NOW);
        assert.equal(rider.status, 'resting');
        assert.equal(rider.lapCount, 5);
        assert.equal(rider.lastMs, null);
        assert.equal(rider.bestMs, 30000);
    });
    it('uses the transponder code when the label is empty, and the label when there is one', () => {
        assert.equal(riderLive(activity(1, 5, null), null, NOW).label, 'AB-10001');
        assert.equal(riderLive(activity(2, 5, null, { chipLabel: ' Francien ' }), null, NOW).label, 'Francien');
    });
    it('uses the length of the track for the speed limit', () => {
        // 60 s laps: 24 km/h on 400 m, but only 4.5 km/h on 75 m: not skating there
        assert.equal(riderLive(activity(1, 300, 10), laps(5, 60, 10), NOW, 75).lapCount, 0);
        assert.equal(riderLive(activity(1, 300, 10), laps(5, 60, 10), NOW, 400).lapCount, 5);
    });
});

describe('sortLiveRiders and liveInitials', () => {
    const rider = (label, bestMs, sinceMs) => ({ label, bestMs, sinceMs, chipCode: 'AB-00000' });
    const names = list => hostCopy(list.map(r => r.label));
    it('best: the fastest lap first, riders without a lap last, ties by name', () => {
        const list = [rider('c', null, 5), rider('b', 31000, 5), rider('a', 29000, 5), rider('d', 31000, 5)];
        assert.deepEqual(names(sortLiveRiders(list, 'best')), ['a', 'b', 'd', 'c']);
    });
    it('recent: the rider who crossed the line last first', () => {
        const list = [rider('a', 1, 40000), rider('b', 1, 2000), rider('c', 1, null), rider('d', 1, 9000)];
        assert.deepEqual(names(sortLiveRiders(list, 'recent')), ['b', 'd', 'a', 'c']);
    });
    it('does not change the list it is given', () => {
        const list = [rider('b', 2, 2), rider('a', 1, 1)];
        sortLiveRiders(list);
        assert.deepEqual(names(list), ['b', 'a']);
    });
    it('initials come from the name, or from the transponder code when there is no name', () => {
        assert.equal(liveInitials({ label: 'Marieke de Vries', chipCode: 'SG-91333' }), 'MD');
        assert.equal(liveInitials({ label: 'B-Mag', chipCode: 'SN-16098' }), 'BM');
        assert.equal(liveInitials({ label: 'Jani', chipCode: 'NT-22016' }), 'J');
        assert.equal(liveInitials({ label: 'HC-26316', chipCode: 'HC-26316' }), 'HC');
    });
});

describe('lapsFetchDue: when the laps of a rider are asked for again', () => {
    const { lapsFetchDue } = app.sandbox;
    const skater = (endedAgoS, paceS = 30) => riderLive(activity(1, 900, endedAgoS), laps(10, paceS, endedAgoS), NOW);
    const ask = (state, fetchedAgoS, changed = false) => lapsFetchDue(state, NOW, NOW - fetchedAgoS * SECOND, changed);

    it('always when the activity in the list of the rink changed', () => {
        assert.equal(ask(skater(2), 0.1, true), true);
        assert.equal(ask(riderLive(activity(2, 900, 300), laps(10, 30, 300), NOW), 1, true), true);
    });
    it('not before the next crossing is expected: a rider with laps of 30 s crossed 2 s ago, so nothing for a while', () => {
        assert.equal(ask(skater(2), 2), false);
        assert.equal(ask(skater(10), 10), false);
        assert.equal(ask(skater(20), 20), false);
    });
    it('asks a second after the expected crossing (the laps are in the API a few seconds after they ended)', () => {
        assert.equal(ask(skater(30), 10), false);          // the crossing is expected now: the lap cannot be there yet
        assert.equal(ask(skater(31.5), 10), true);         // half a second past the moment to ask
        assert.equal(ask(skater(40), 10), true);           // it is overdue
    });
    it('keeps asking while the lap is late, less and less often, at least once every 8 seconds', () => {
        assert.equal(ask(skater(33), 1), false);            // overdue by 2 s: asked 1 s ago, wait for 1.5 s
        assert.equal(ask(skater(33), 1.6), true);
        assert.equal(ask(skater(45), 4.5), false);          // overdue by 14 s: every 4.7 s
        assert.equal(ask(skater(45), 4.8), true);
        assert.equal(ask(skater(80, 90), 7), false);        // laps of 90 s: nothing due yet
        assert.equal(ask(skater(100, 60), 7.9), false);     // laps of a minute, 39 s overdue: at most every 8 s
        assert.equal(ask(skater(100, 60), 8.1), true);
    });
    it('asks a safety refresh every 30 s, even when nothing seems due', () => {
        assert.equal(ask(skater(2, 120), 31), true);        // laps of 2 minutes: the next crossing is far away, but 30 s have passed
        assert.equal(ask(skater(2, 120), 29), false);
    });
    it('asks for a rider who has just started every 3 s until the first lap is there', () => {
        const waiting = riderLive(activity(3, 5, null), null, NOW);
        assert.equal(ask(waiting, 2), false);
        assert.equal(ask(waiting, 3.1), true);
    });
    it('looks at a resting rider only every 20 s, and never at somebody who has left', () => {
        const resting = riderLive(activity(4, 900, 400), laps(8, 30, 400), NOW);
        assert.equal(resting.status, 'resting');
        assert.equal(ask(resting, 15), false);
        assert.equal(ask(resting, 21), true);
        const left = riderLive(activity(5, 4000, 16 * 60), laps(8, 30, 16 * 60), NOW);
        assert.equal(ask(left, 100), false);
    });
    it('expects the next lap to take as long as the last one or the recent average, whichever is shorter', () => {
        const build = durations => {                          // the last crossing 20 s ago
            let start = NOW - 20 * SECOND - durations.reduce((sum, d) => sum + d, 0) * SECOND;
            return durations.map((d, i) => { const lap = { nr: i + 1, startMs: start, durMs: d * SECOND }; start += d * SECOND; return lap; });
        };
        const spedUp = riderLive(activity(6, 900, 20), build([60, 60, 60, 15, 15, 15]), NOW);   // laps of 15 s now
        assert.equal(ask(spedUp, 5), true);                  // expected 15 s + 1 s after the last crossing: 4 s ago
        const slower = riderLive(activity(7, 900, 20), build([30, 30, 30, 30, 30, 50]), NOW);   // last lap 50 s, average 36.7 s
        assert.equal(ask(slower, 5), false);                 // expected 36.7 s: not yet (the last crossing was 20 s ago)
        assert.equal(ask(riderLive(activity(8, 900, 40), build([30, 30, 30, 30, 30, 50]).map(l => ({ ...l, startMs: l.startMs - 20 * SECOND })), NOW), 5), true);   // 40 s ago: due
    });
});

describe('the lap graph: what is in view and the axis', () => {
    const { liveNiceTicks, liveShowAllMax, liveLapWindow } = app.sandbox;
    const seconds = list => hostCopy(list.map(lap => lap.durMs / 1000));
    const mixed = () => [30, 32, 31, 90, 45, 300, 29].map((s, i) => ({ nr: i + 1, startMs: NOW - (10 - i) * 400 * SECOND, durMs: s * SECOND }));

    it('liveNiceTicks: round values with four or five gridlines that cover the range', () => {
        const ticks = hostCopy(liveNiceTicks(29.4, 41));
        assert.ok(ticks[0] <= 29.4 && ticks[ticks.length - 1] >= 41);
        assert.ok(ticks.length >= 3 && ticks.length <= 7, String(ticks));
        assert.deepEqual(hostCopy(liveNiceTicks(36.5, 40)), [36, 37, 38, 39, 40]);
        assert.equal(hostCopy(liveNiceTicks(0, 3))[0], 0);
    });
    it('liveShowAllMax: the slowest skating lap plus a second; breaks do not count; 60 without laps', () => {
        assert.equal(liveShowAllMax(mixed()), 91);          // 90 s is the slowest skating lap; the 300 s lap is a break
        assert.equal(liveShowAllMax([]), 60);
        assert.equal(liveShowAllMax(null), 60);
    });
    it('liveLapWindow: laps under the maximum are in view; slower laps and breaks are greyed out, none are lost', () => {
        const window = liveLapWindow(mixed(), 50);
        assert.deepEqual(seconds(window.fast), [30, 32, 31, 45, 29]);
        assert.deepEqual(seconds(window.slow), [90, 300]);
        assert.equal(window.fast.length + window.slow.length, 7);
    });
    it('liveLapWindow: the axis starts at the fastest lap in view and ends at the maximum, on round numbers', () => {
        const window = liveLapWindow(mixed(), 50);
        assert.ok(window.yMin <= 29 && window.yMin >= 25, String(window.yMin));
        assert.ok(window.yMax >= 50, String(window.yMax));
        assert.deepEqual(hostCopy(window.ticks), hostCopy(liveNiceTicks(29, 50)));
    });
    it('liveLapWindow: with nothing in view the axis still has a range just under the maximum', () => {
        const window = liveLapWindow(mixed(), 20);
        assert.equal(window.fast.length, 0);
        assert.ok(window.yMin <= 10 && window.yMax >= 20);
    });
    it('liveLapWindow follows the length of the track for what counts as skating', () => {
        const laps = [{ nr: 1, startMs: NOW, durMs: 60 * SECOND }];
        assert.equal(liveLapWindow(laps, 90, 400).fast.length, 1);
        assert.equal(liveLapWindow(laps, 90, 75).fast.length, 0);        // 75 m in 60 s is 4.5 km/h: a break
    });
});

describe('riderLive: when the rider started and how long the activity lasts', () => {
    it('gives the start time of the activity', () => {
        const rider = riderLive(activity(1, 600, 5), laps(8, 30, 5), NOW);
        assert.equal(rider.startMs, NOW - 600 * SECOND);
    });
    it('while on the ice the duration runs up to now, and grows with the clock', () => {
        const rider = riderLive(activity(1, 600, 5), laps(8, 30, 5), NOW);
        assert.equal(rider.status, 'skating');
        assert.equal(rider.durationMs, 600 * SECOND);
        assert.equal(riderLive(activity(1, 600, 5), laps(8, 30, 5), NOW + 30 * SECOND).durationMs, 630 * SECOND);
    });
    it('after he stopped, the duration stops at his last crossing (or the end time of the activity, when that is later)', () => {
        // started 30 minutes ago, last crossing 10 minutes ago
        const rider = riderLive(activity(1, 1800, 600), laps(8, 30, 600), NOW);
        assert.equal(rider.status, 'resting');
        assert.equal(rider.durationMs, 1200 * SECOND);
        assert.equal(riderLive(activity(1, 1800, 590), laps(8, 30, 600), NOW).durationMs, 1210 * SECOND);
    });
    it('somebody who has not crossed yet has been at it since the start; after two minutes without a crossing he moves to "Recently on the ice"', () => {
        const fresh = riderLive(activity(1, 30, null), null, NOW);
        assert.equal(fresh.status, 'waiting');
        assert.equal(fresh.durationMs, 30 * SECOND);
        const stale = riderLive(activity(2, 200, 190), null, NOW);
        assert.equal(stale.status, 'resting');
        assert.equal(stale.durationMs, 10 * SECOND);          // from the start to the end time of the activity
    });
    it('has no start time for an activity without a usable one', () => {
        const rider = riderLive({ id: 1, chipCode: 'AB-1', startTime: 'nonsense', endTime: null }, null, NOW);
        assert.equal(rider.startMs, null);
        assert.equal(rider.durationMs, null);
    });
});
