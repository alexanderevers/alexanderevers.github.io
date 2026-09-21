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
    it('estimates the position: the time since the last crossing as a share of the lap time (and keeps going round)', () => {
        assert.equal(riderLive(activity(1, 400, 15), laps(8, 30, 15), NOW).frac, 0.5);
        assert.equal(riderLive(activity(1, 400, 0), laps(8, 30, 0), NOW).frac, 0);
    });
    it('does not wait at the finish line while the next lap is not in yet: the dot goes on into the next lap', () => {
        const rider = riderLive(activity(1, 400, 40), laps(8, 30, 40), NOW);      // 40 s since the last crossing, laps of 30 s
        assert.equal(rider.status, 'skating');
        assert.ok(Math.abs(rider.frac - 10 / 30) < 1e-9, String(rider.frac));     // a third into the next lap
        assert.ok(Math.abs(rider.progress - (8 + 40 / 30)) < 1e-9, String(rider.progress));   // 8 laps known, then 4/3 of a lap
        const later = riderLive(activity(1, 400, 40), laps(8, 30, 40), NOW + 5 * SECOND);
        assert.ok(later.frac > rider.frac, 'the dot must keep moving');
    });
    it('the position stays continuous when the real crossing arrives: the lap is as long as expected, so the dot does not jump', () => {
        const before = riderLive(activity(1, 400, 33), laps(8, 30, 33), NOW);      // 33 s since the last crossing, the new lap is not in yet
        const after = riderLive(activity(1, 400, 3), laps(9, 30, 3), NOW);         // the new lap arrives: the crossing was 3 s ago
        assert.ok(Math.abs(before.frac - after.frac) < 1e-9, before.frac + ' against ' + after.frac);
        assert.ok(Math.abs(before.progress - after.progress) < 1e-9, before.progress + " against " + after.progress);   // one more lap known, one less lap since: the same place
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

describe('liveFraction: where the dot is while the next lap is not in yet', () => {
    const { liveFraction } = app.sandbox;
    it('not slowing down: goes on at the usual lap time, past the line into the next lap', () => {
        assert.equal(liveFraction(15000, 30000, 30000, 30000), 0.5);
        assert.ok(Math.abs(liveFraction(40000, 30000, 30000, 30000) - 4 / 3) < 1e-9);      // 1 = the line: a third into the next lap
        assert.ok(Math.abs(liveFraction(40000, 30000, 30000, 32000) - 4 / 3) < 1e-9);      // speeding up: the same
        assert.equal(liveFraction(15000, 30000, 30000, null), 0.5);                          // only one lap known
    });
    it('slowing down: the current lap is expected to take as much longer as the last lap was slower than the one before', () => {
        // laps of 30 s, then 33 s: the current lap is expected to take 36 s
        assert.ok(Math.abs(liveFraction(18000, 33000, 33000, 30000) - 0.5) < 1e-9);
        assert.ok(Math.abs(liveFraction(30000, 33000, 33000, 30000) - 30 / 36) < 1e-9);
    });
    it('slowing down: it never goes past the finish line while the lap is not in, and keeps creeping forward', () => {
        let previous = 0;
        for (const seconds of [20, 30, 32.4, 36, 40, 50, 80]) {
            const frac = liveFraction(seconds * 1000, 33000, 33000, 30000);
            assert.ok(frac > previous && frac < 1, seconds + ' s: ' + frac);
            previous = frac;
        }
    });
    it('slowing down: the change where the dot starts to slow is smooth', () => {
        const a = liveFraction(0.9 * 36000 - 1, 33000, 33000, 30000);
        const b = liveFraction(0.9 * 36000 + 1, 33000, 33000, 30000);
        assert.ok(b > a && b - a < 1e-4);
    });
    it('riderLive uses it: a rider who slowed down in his last lap stays in front of the line', () => {
        const all = laps(7, 30, 34 + 33);                                                       // seven laps of 30 s ...
        all.push({ nr: 8, startMs: NOW - 34 * SECOND - 33 * SECOND, durMs: 33 * SECOND });      // ... then 33 s, the last crossing 34 s ago
        const rider = riderLive(activity(1, 900, 34), all, NOW);
        assert.equal(rider.status, 'skating');
        assert.ok(rider.frac > 0.9 && rider.frac < 0.99, String(rider.frac));                  // expected 36 s: 34 s is 94 %
    });
});

describe('marathon mode: the crossings of the race and the list of a lap', () => {
    const { marathonCrossings, marathonStandings } = app.sandbox;
    const RACE_START = NOW - 20 * 60 * SECOND;
    // A rider: crossings at the given seconds after the start of the race (lap times are the differences; the first lap starts at 0)
    const rider = (id, label, ends, before = []) => ({
        id, label,
        laps: [...before, ...ends.map((end, i) => ({ nr: i + 1, startMs: RACE_START + (i === 0 ? 0 : ends[i - 1]) * SECOND, durMs: (end - (i === 0 ? 0 : ends[i - 1])) * SECOND }))]
    });
    const cross = (start, count, lap) => Array.from({ length: count }, (_, i) => start + (i + 1) * lap);
    const times = list => hostCopy(list.map(c => c.endMs));

    it('laps from before a gap of more than 5 minutes are not part of the race', () => {
        const warmUp = [{ nr: 1, startMs: RACE_START - 900 * SECOND, durMs: 40 * SECOND }, { nr: 2, startMs: RACE_START - 860 * SECOND, durMs: 40 * SECOND }];
        // the warm-up ends 820 s before the start; the next crossing is the first of the race
        const laps = [...warmUp, { nr: 3, startMs: RACE_START - 300 * SECOND + 1, durMs: 320 * SECOND }, { nr: 4, startMs: RACE_START + 21 * SECOND, durMs: 30 * SECOND }];
        assert.deepEqual(times(marathonCrossings(laps)), [RACE_START + 51 * SECOND]);
    });
    it('a gap between two laps counts as well, and without a gap all laps are race laps', () => {
        const gap = [{ nr: 1, startMs: 0, durMs: 30000 }, { nr: 2, startMs: 30000 + 400000, durMs: 30000 }];
        assert.equal(marathonCrossings(gap).length, 1);
        assert.equal(marathonCrossings(hostCopy(laps(5, 30, 0))).length, 5);
        assert.equal(marathonCrossings([]).length, 0);
    });

    it('the first rider of a lap is the one who crosses first; the others get place, time gap and distance', () => {
        const entries = [rider(1, 'Anna', cross(0, 6, 30)), rider(2, 'Ben', cross(0, 6, 30).map(t => t + 1.5)), rider(3, 'Cor', cross(0, 6, 30).map(t => t + 0.6))];
        const result = marathonStandings(entries, { lapNr: 3, nowMs: RACE_START + 100 * SECOND, trackLengthM: 400 });
        assert.equal(result.lapNr, 3);
        assert.deepEqual(hostCopy(result.rows.map(r => r.label)), ['Anna', 'Cor', 'Ben']);
        assert.deepEqual(hostCopy(result.rows.map(r => r.place)), [1, 2, 3]);
        assert.deepEqual(hostCopy(result.rows.map(r => Math.round(r.gapMs))), [0, 600, 1500]);
        assert.ok(Math.abs(result.rows[2].distanceM - 1.5 * 400 / 30) < 1e-6, String(result.rows[2].distanceM));      // 1.5 s at 13.3 m/s = 20 m
        assert.equal(result.first.label, 'Anna');
    });
    it('the first rider can change every lap: he is whoever crosses the line first in that lap', () => {
        const a = rider(1, 'Anna', [30, 61, 90.5]);
        const b = rider(2, 'Ben', [31, 60, 90]);
        assert.equal(marathonStandings([a, b], { lapNr: 1, nowMs: RACE_START + 215 * SECOND }).first.label, 'Anna');
        assert.equal(marathonStandings([a, b], { lapNr: 2, nowMs: RACE_START + 215 * SECOND }).first.label, 'Ben');
        assert.equal(marathonStandings([a, b], { lapNr: 3, nowMs: RACE_START + 215 * SECOND }).first.label, 'Ben');
    });
    it('by default the list is that of the newest lap: the lap the rider with the most laps has finished; riders who did not cross yet wait below', () => {
        const entries = [rider(1, 'Anna', cross(0, 5, 30)), rider(2, 'Ben', cross(0, 4, 30).map(t => t + 1)), rider(3, 'Cor', cross(0, 3, 30)), rider(4, 'Dan', cross(0, 5, 30).map(t => t + 2))];
        const result = marathonStandings(entries, { nowMs: RACE_START + 152 * SECOND });
        assert.equal(result.lapNr, 5);
        assert.equal(result.latest, true);
        assert.deepEqual(hostCopy(result.rows.map(r => r.label)), ['Anna', 'Dan']);
        assert.deepEqual(hostCopy(result.pending.map(p => [p.label, p.status, p.behind])), [['Ben', 'coming', 1], ['Cor', 'lapped', 2]]);
    });
    it('an older lap lists only the riders who had crossed by then, and no waiting riders', () => {
        const entries = [rider(1, 'Anna', cross(0, 5, 30)), rider(2, 'Ben', cross(0, 4, 30).map(t => t + 1))];
        const result = marathonStandings(entries, { lapNr: 3, nowMs: RACE_START + 152 * SECOND });
        assert.equal(result.latest, false);
        assert.deepEqual(hostCopy(result.rows.map(r => r.label)), ['Anna', 'Ben']);
        assert.equal(result.pending.length, 0);
    });
    it('everybody who comes in during the finish lap counts, with his own number of laps: lapped riders after the riders with the most laps', () => {
        const entries = [rider(1, 'Anna', cross(0, 6, 30)), rider(2, 'Ben', cross(0, 6, 30).map(t => t + 1)), rider(3, 'Lapped', cross(0, 5, 40))];
        const result = marathonStandings(entries, { nowMs: RACE_START + 205 * SECOND });     // the finish lap is lap 6 (the first rider crosses at 180 s)
        assert.equal(result.leaderCount, 6);
        assert.deepEqual(hostCopy(result.rows.map(r => [r.label, r.laps])), [['Anna', 6], ['Ben', 6], ['Lapped', 5]]);       // the lapped rider comes in at 200 s
        assert.equal(result.first.label, 'Anna');
        assert.equal(result.pending.length, 0);
        // in an older lap: everybody who crossed between the first rider of that lap and the first rider of the next one
        const lap4 = marathonStandings(entries, { lapNr: 4, nowMs: RACE_START + 205 * SECOND });
        assert.deepEqual(hostCopy(lap4.rows.map(r => [r.label, r.laps])), [['Anna', 4], ['Ben', 4], ['Lapped', 3]]);         // (lap 4: from 120 s, when Anna crosses, to 150 s; Lapped crosses at 120 s)
    });
    it('the rider with the most laps from the start is the first rider: laps before the start do not help', () => {
        const before = Array.from({ length: 10 }, (_, i) => ({ nr: i + 1, startMs: RACE_START - 1500 * SECOND + i * 40 * SECOND, durMs: 40 * SECOND }));
        const early = rider(1, 'Early', cross(0, 4, 30), before);        // 10 laps of warm-up, then a gap of about 18 minutes
        const plain = rider(2, 'Plain', cross(0, 5, 30));
        const result = marathonStandings([early, plain], { nowMs: RACE_START + 152 * SECOND });
        assert.equal(result.lapNr, 5);
        assert.equal(result.first.label, 'Plain');
        assert.equal(result.pending[0].label, 'Early');
    });
    it('raceLaps: crossings after the last lap of the race are ignored, and the race is finished when the first rider has done them all', () => {
        const entries = [rider(1, 'Anna', cross(0, 6, 30)), rider(2, 'Ben', cross(0, 5, 30).map(t => t + 1))];
        const result = marathonStandings(entries, { raceLaps: 5, nowMs: RACE_START + 200 * SECOND });
        assert.equal(result.leaderCount, 5);
        assert.equal(result.finished, true);
        assert.deepEqual(hostCopy(result.rows.map(r => r.label)), ['Anna', 'Ben']);
        assert.equal(marathonStandings(entries, { raceLaps: 8, nowMs: RACE_START + 200 * SECOND }).finished, false);
    });
    it('without a number of laps, the lap to skate out after the last (fast) lap does not count', () => {
        // four riders: eight racing laps of 30 s, then a slow lap of 70 s to skate out
        const group = extra => ['Anna', 'Ben', 'Cor', 'Dan'].map((name, i) => rider(i + 1, name, [...cross(0, 8, 30).map(t => t + i * 0.5), ...extra.map(t => t + i * 0.5)]));
        const busy = marathonStandings(group([]), { nowMs: RACE_START + 250 * SECOND });
        assert.equal(busy.leaderCount, 8);
        assert.equal(busy.finished, false);                   // the race is still going
        const over = marathonStandings(group([310]), { nowMs: RACE_START + 320 * SECOND });
        assert.equal(over.leaderCount, 8);                    // the slow lap after the fast one is not a lap of the race
        assert.equal(over.finished, true);
        assert.equal(over.rows.length, 4);
        assert.equal(over.first.label, 'Anna');
    });
    it('a missed crossing does not shift the laps of a rider, and what a rider did before the gap before the start does not count', () => {
        const before = Array.from({ length: 10 }, (_, i) => ({ nr: i + 1, startMs: RACE_START - 1500 * SECOND + i * 40 * SECOND, durMs: 40 * SECOND }));
        const early = rider(1, 'Early', cross(0, 8, 30), before);                    // a warm-up of 10 laps before the start
        const plain = rider(2, 'Plain', cross(0, 8, 30).map(t => t + 1));
        const missed = rider(3, 'Missed', cross(0, 8, 30).filter((t, i) => i !== 3).map(t => t + 2));      // the crossing of lap 4 was not registered
        const list = lap => marathonStandings([early, plain, missed], { lapNr: lap, nowMs: RACE_START + 250 * SECOND });
        assert.deepEqual(hostCopy(list(5).rows.map(r => r.label)), ['Early', 'Plain', 'Missed']);
        assert.deepEqual(hostCopy(list(8).rows.map(r => [r.label, r.laps])), [['Early', 8], ['Plain', 8], ['Missed', 8]]);      // Missed still has 8 laps
        assert.equal(list(8).leaderCount, 8);
    });
    it('the start time is an absolute time: everything is measured from it, and the first crossing from 20 seconds before it is lap 1', () => {
        const entries = [rider(1, 'Anna', cross(0, 8, 30)), rider(2, 'Ben', cross(0, 8, 30).map(t => t + 3))];
        // start at 55 s: riders are selected from 35 s, so the crossing at 60 s is the end of lap 1 (Anna: 60, 90, 120, 150 ...)
        const part = marathonStandings(entries, { startMs: RACE_START + 55 * SECOND, lapNr: 4, nowMs: RACE_START + 250 * SECOND });
        assert.equal(part.startMs, RACE_START + 55 * SECOND);
        assert.equal(part.finishMs, RACE_START + 150 * SECOND);           // Anna crosses her 4th lap of the race first
        assert.equal(part.leaderCount, 7);                                 // the crossings from 60 s to 240 s
        assert.deepEqual(hostCopy(part.rows.map(r => Math.round(r.segmentMs))), [95000, 98000]);
        // the first lap is measured from the start: 5 s from the start (55 s) to the crossing at 60 s
        assert.equal(marathonStandings(entries, { startMs: RACE_START + 55 * SECOND, lapNr: 1, nowMs: RACE_START + 250 * SECOND }).rows[0].lapMs, 5000);
        // the crossings from 20 seconds before the start are selected: start at 45 s: the crossing at 30 s is not, the one at 60 s is lap 1
        assert.equal(marathonStandings(entries, { startMs: RACE_START + 57 * SECOND, nowMs: RACE_START + 250 * SECOND }).leaderCount, 7);   // from 37 s: the crossings at 30 s and 33 s are before it
        assert.equal(marathonStandings(entries, { startMs: RACE_START + 49 * SECOND, nowMs: RACE_START + 250 * SECOND }).leaderCount, 8);   // from 29 s: the crossing at 30 s counts as lap 1
        const whole = marathonStandings(entries, { lapNr: 6, nowMs: RACE_START + 250 * SECOND });
        assert.equal(whole.startMs, whole.autoStartMs);                     // no start time chosen: the program picks one (the start of the first lap)
        assert.equal(whole.startMs, RACE_START);
        assert.equal(whole.finishMs, RACE_START + 180 * SECOND);
        assert.equal(whole.firstMs, RACE_START + 30 * SECOND);
        assert.equal(whole.lastMs, RACE_START + 243 * SECOND);
    });
    it('a lap in which nobody was registered still exists (no rows); the laps behind it are numbered on', () => {
        const entries = [rider(1, 'Anna', [30, 60, 150, 180, 210, 240]), rider(2, 'Ben', [31, 61, 151, 181, 211, 241])];      // nothing between 60 s and 150 s
        const result = marathonStandings(entries, { lapNr: 3, nowMs: RACE_START + 250 * SECOND });
        assert.equal(result.rows.length, 0);
        assert.equal(result.first, null);
        assert.equal(marathonStandings(entries, { nowMs: RACE_START + 250 * SECOND }).leaderCount, 8);      // 2 laps missed: 30 s laps
    });
    it('with a start time the laps and the time of every rider run from there, and what came before is not counted', () => {
        const entries = [rider(1, 'Anna', cross(0, 8, 30)), rider(2, 'Ben', cross(0, 8, 31))];
        const whole = marathonStandings(entries, { lapNr: 4, nowMs: RACE_START + 250 * SECOND });
        assert.deepEqual(hostCopy(whole.rows.map(r => r.segmentMs)), [120000, 124000]);        // 4 laps from the start
        const part = marathonStandings(entries, { startMs: RACE_START + 55 * SECOND, lapNr: 3, nowMs: RACE_START + 250 * SECOND });
        assert.deepEqual(hostCopy(part.rows.map(r => r.label)), ['Anna', 'Ben']);
        assert.deepEqual(hostCopy(part.rows.map(r => r.segmentMs)), [65000, 69000]);           // Anna: 120 s - 55 s; Ben: 124 s - 55 s (their 3rd crossings from 35 s)
    });
    it('nothing is listed when nobody has crossed since the start time; the finish lap follows the race while it is left out', () => {
        const entries = [rider(1, 'Anna', cross(0, 6, 30))];
        assert.equal(marathonStandings(entries, { startMs: RACE_START + 400 * SECOND, nowMs: RACE_START + 215 * SECOND }), null);   // the start is still to come
        assert.equal(marathonStandings(entries, { startMs: RACE_START + 150 * SECOND, nowMs: RACE_START + 215 * SECOND }).leaderCount, 2);    // crossings 150 and 180
        const later = [rider(1, 'Anna', cross(0, 7, 30))];
        assert.equal(marathonStandings(entries, { startMs: RACE_START + 55 * SECOND, nowMs: RACE_START + 215 * SECOND }).lapNr, 5);
        assert.equal(marathonStandings(later, { startMs: RACE_START + 55 * SECOND, nowMs: RACE_START + 250 * SECOND }).lapNr, 6);
    });
    it('the minutes of waiting for the start are not laps: with the start time where the group starts, the first crossing is lap 1 of the race', () => {
        // Ann and Ben cross once (40 s), then wait for the start: the next crossing (at 290 s, a lap of 250 s) is the end of the first lap
        // of the race. Cas and Dirk only join at the start. The mat registers nothing in between.
        const ends = [290, 330, 370, 410, 450, 490];
        const waiting = (id, name, extra) => ({ id, label: name, laps: [...extra, ...ends.map((end, i) => ({ nr: i + 1, startMs: RACE_START + (i === 0 ? extra.length ? 40 : 0 : ends[i - 1]) * SECOND, durMs: (end - (i === 0 ? (extra.length ? 40 : 0) : ends[i - 1])) * SECOND }))] });
        const early = [{ nr: 0, startMs: RACE_START, durMs: 40 * SECOND }];
        const entries = [waiting(1, 'Ann', early), waiting(2, 'Ben', early), waiting(3, 'Cas', []), waiting(4, 'Dirk', [])];
        const result = marathonStandings(entries, { nowMs: RACE_START + 500 * SECOND });
        assert.ok(Math.abs(result.autoStartMs - (RACE_START + 250 * SECOND)) < 5000, String(result.autoStartMs - RACE_START));    // the group starts about a lap before its first crossing
        assert.equal(result.leaderCount, 6);                    // the waiting is not counted
        assert.equal(result.rows.length, 4);
        // the first lap of the race is not 250 s: it runs from the start
        assert.ok(Math.abs(marathonStandings(entries, { lapNr: 1, nowMs: RACE_START + 500 * SECOND }).rows[0].lapMs - 40000) < 5000);
        // a start time of 21:00 (here: at the beginning) counts everything: the first crossing is lap 1 and the crossing after the waiting
        // counts as the laps of the group in that time
        assert.equal(marathonStandings(entries, { startMs: RACE_START, nowMs: RACE_START + 500 * SECOND }).leaderCount, 12);
        // an absolute time chosen by hand, at the moment the group starts
        assert.equal(marathonStandings(entries, { startMs: RACE_START + 250 * SECOND, nowMs: RACE_START + 500 * SECOND }).leaderCount, 6);
    });
    it('the laps are counted from the start: a rider who is lapped has one lap fewer than the group, and comes in later', () => {
        // the group: laps of 30 s; the other one: laps of 45 s, so after 240 s he has done 5 laps and the group 8
        const group = [rider(1, 'Anna', cross(0, 8, 30)), rider(2, 'Ben', cross(0, 8, 30).map(t => t + 1)), rider(3, 'Cor', cross(0, 8, 30).map(t => t + 2))];
        const slow = rider(4, 'Slow', cross(0, 5, 45));
        const result = marathonStandings([...group, slow], { nowMs: RACE_START + 250 * SECOND });
        assert.equal(result.leaderCount, 8);
        assert.deepEqual(hostCopy(result.rows.map(r => r.label)), ['Anna', 'Ben', 'Cor']);
        const behind = result.pending.find(p => p.label === 'Slow');
        assert.equal(behind.laps, 5);                          // his own count from the start
        assert.equal(behind.behind, 3);
        // in the lap he comes in during, he is listed after the group with his own number of laps
        const lap4 = marathonStandings([...group, slow], { lapNr: 4, nowMs: RACE_START + 250 * SECOND });
        assert.deepEqual(hostCopy(lap4.rows.map(r => [r.label, r.laps])), [['Anna', 4], ['Ben', 4], ['Cor', 4], ['Slow', 3]]);
    });
    it('a rider who is one lap behind is in the list, later than the group, with the gap of a lap', () => {
        const group = [rider(1, 'Anna', cross(0, 8, 30)), rider(2, 'Ben', cross(0, 8, 30).map(t => t + 1))];
        const lapped = rider(3, 'Lapped', cross(0, 7, 30).map(t => t + 20));     // the same speed, but a lap behind: he has 7 laps when the group has 8
        const result = marathonStandings([...group, lapped], { lapNr: 7, nowMs: RACE_START + 250 * SECOND });
        assert.deepEqual(hostCopy(result.rows.map(r => r.label)), ['Anna', 'Ben', 'Lapped']);
        assert.equal(Math.round(result.rows[2].gapMs), 20000);
        assert.equal(marathonStandings([...group, lapped], { nowMs: RACE_START + 250 * SECOND }).pending.length, 1);
    });
    it('a rider who started late counts his laps from his own start', () => {
        const pack = [rider(1, 'Anna', cross(0, 8, 30)), rider(2, 'Ben', cross(0, 8, 30).map(t => t + 1)), rider(3, 'Cor', cross(0, 8, 30).map(t => t + 2))];
        // Late starts after 90 s: his first lap starts after a gap of 20 minutes; his laps are 1, 2, 3 ...
        const late = { id: 4, label: 'Late', laps: [{ nr: 1, startMs: RACE_START + 90 * SECOND, durMs: 30 * SECOND }, { nr: 2, startMs: RACE_START + 120 * SECOND, durMs: 30 * SECOND }, { nr: 3, startMs: RACE_START + 150 * SECOND, durMs: 30 * SECOND }] };
        const early = { id: 5, label: 'Earlier', laps: [{ nr: 1, startMs: RACE_START - 1500 * SECOND, durMs: 30 * SECOND }, ...late.laps.map(l => ({ ...l, nr: l.nr + 1 }))] };
        const result = marathonStandings([...pack, early], { nowMs: RACE_START + 250 * SECOND });
        const p = result.pending.find(x => x.label === 'Earlier');
        assert.equal(p.laps, 3);                                // three laps from his start, the warm-up before the gap does not count
        assert.equal(p.behind, 5);
    });
    it('a lap in which the mat missed a rider who skated with the group counts as the laps of the group in that time', () => {
        const a = rider(1, 'Anna', cross(0, 8, 30));
        const b = rider(2, 'Ben', cross(0, 8, 30).map(t => t + 1));
        const c = rider(3, 'Cor', cross(0, 8, 30).filter((t, i) => ![2, 3, 4].includes(i)).map(t => t + 2));      // no crossing of laps 3, 4 and 5
        const result = marathonStandings([a, b, c], { nowMs: RACE_START + 250 * SECOND });
        assert.equal(result.leaderCount, 8);
        assert.equal(result.pending.length, 0);
        assert.deepEqual(hostCopy(result.rows.map(r => r.label)), ['Anna', 'Ben', 'Cor']);      // he has 8 laps, not 5
    });
    it('placesOf: the place of a rider in the list of every lap (for the graph)', () => {
        // Ben leads the first lap, then Anna is first every lap; Cor is last
        const entries = [rider(1, 'Anna', [31, 60, 90, 120]), rider(2, 'Ben', [30, 61, 91, 121]), rider(3, 'Cor', [32, 63, 93, 123])];
        const result = marathonStandings(entries, { nowMs: RACE_START + 130 * SECOND });
        assert.deepEqual(hostCopy(result.placesOf(1).map(p => [p.lapNr, p.place])), [[1, 2], [2, 1], [3, 1], [4, 1]]);
        assert.deepEqual(hostCopy(result.placesOf(2).map(p => [p.lapNr, p.place])), [[1, 1], [2, 2], [3, 2], [4, 2]]);
        assert.deepEqual(hostCopy(result.placesOf(3).map(p => p.place)), [3, 3, 3, 3]);
        assert.equal(result.placesOf(3)[0].riders, 3);
        assert.deepEqual(hostCopy(result.placesOf(99)), []);                                  // a rider who is not in the race
        assert.equal(result.placesOf(1)[3].place, result.rows.find(r => r.id === 1).place);     // the newest lap: the place in the list
    });
    it('nobody in the race yet: nothing to list', () => {
        assert.equal(marathonStandings([], {}), null);
        assert.equal(marathonStandings([{ id: 1, label: 'A', laps: [] }], {}), null);
    });
});

describe('the settings of the marathon: the dots follow the last lap and catch up quickly', () => {
    const { liveShownStep } = app.sandbox;
    const MARATHON_ESTIMATE_OPTIONS = app.get('MARATHON_ESTIMATE_OPTIONS');
    const MARATHON_SHOWN_OPTIONS = app.get('MARATHON_SHOWN_OPTIONS');
    it('live: the pace of the last three laps and the rule for a rider who is slowing down; marathon: the last lap, without that rule', () => {
        // laps of 30, 30, 36 s; 40 s since the last crossing
        const list = [...laps(2, 30, 76), { nr: 3, startMs: NOW - 76 * SECOND, durMs: 36 * SECOND }];
        const live = riderLive(activity(1, 900, 40), list, NOW);
        const marathon = riderLive(activity(1, 900, 40), list, NOW, 400, MARATHON_ESTIMATE_OPTIONS);
        assert.ok(live.frac > 0.9 && live.frac < 0.99, String(live.frac));                    // slowing: still in front of the line (expected 42 s)
        assert.ok(Math.abs(marathon.frac - (40 / 36 - 1)) < 1e-9, String(marathon.frac));     // his last lap was 36 s: he is 4/36 into the next lap
        assert.equal(marathon.paceMs, live.paceMs);                                          // (the pace shown in the list is the same)
    });
    it('the marathon dot catches up with the estimate faster than the live dot, and never stops', () => {
        const step = options => { let pos = 8.9; for (let i = 0; i < 20; i++) pos = liveShownStep(pos, 9.0, 40000, 0.1, options); return pos; };
        const live = step({});
        const marathon = step(MARATHON_SHOWN_OPTIONS);
        assert.ok(marathon > live, live + ' against ' + marathon);                             // 2 s later the marathon dot is closer to the estimate
        assert.ok(marathon <= 9.0 + 1e-9 || marathon - 9.0 < 0.05);
        // it does not stand still when the estimate is behind it
        assert.ok(liveShownStep(9.5, 9.0, 40000, 0.1, MARATHON_SHOWN_OPTIONS) > 9.5);
        assert.deepEqual(hostCopy(MARATHON_SHOWN_OPTIONS), { catchUp: 0.05, minCatchUpS: 1, minSpeed: 0.2, maxSpeed: 3 });
    });
});

describe('knownFraction: a replay knows the lap time, so nothing is predicted', () => {
    const { knownFraction } = app.sandbox;
    it('between two crossings the rider is as far as the time since the last crossing is a share of the real lap', () => {
        const list = [{ nr: 1, startMs: NOW, durMs: 30 * SECOND }, { nr: 2, startMs: NOW + 30 * SECOND, durMs: 40 * SECOND }];
        assert.equal(knownFraction(list, NOW + 15 * SECOND), 0.5);
        assert.equal(knownFraction(list, NOW + 30 * SECOND), 0);                       // at the crossing: at the finish line
        assert.equal(knownFraction(list, NOW + 50 * SECOND), 0.5);                     // the second lap took 40 s, not the 30 s of the first
        assert.ok(Math.abs(knownFraction(list, NOW + 69 * SECOND) - 39 / 40) < 1e-9);
    });
    it('null before the first lap, after the last, and in a break (the caller then predicts, or shows nobody)', () => {
        const list = [{ nr: 1, startMs: NOW, durMs: 30 * SECOND }, { nr: 2, startMs: NOW + 30 * SECOND, durMs: 300 * SECOND }];    // the second lap is a break
        assert.equal(knownFraction(list, NOW - 5 * SECOND), null);
        assert.equal(knownFraction(list, NOW + 100 * SECOND), null);
        assert.equal(knownFraction(list, NOW + 400 * SECOND), null);
        assert.equal(knownFraction([], NOW), null);
        assert.equal(knownFraction(null, NOW), null);
    });
});

describe('marathonDetect: was the activity a marathon?', () => {
    const { marathonDetect, marathonRaceStart } = app.sandbox;
    const START = NOW - 3600 * SECOND;
    // n riders: 12 laps of 40 s from the start; the first "withBreak" of them had a warm-up 20 minutes before (a break of more than 2.5 minutes)
    const riderAt = (id, offsetS, breakBefore) => ({
        id,
        laps: [
            ...(breakBefore ? [{ nr: 1, startMs: START - 1500 * SECOND, durMs: 40 * SECOND }, { nr: 2, startMs: START - 1400 * SECOND, durMs: 40 * SECOND }] : []),
            ...Array.from({ length: 12 }, (_, i) => ({ nr: 3 + i, startMs: START + (offsetS + i * 40) * SECOND, durMs: 40 * SECOND }))
        ]
    });
    const group = (n, withBreak, spreadS = 20) => Array.from({ length: n }, (_, i) => riderAt(i + 1, (i % 5) * (spreadS / 5), i < withBreak));
    // the same, but the riders from number "from" on do not come by a lap later (they stop or leave the ice after the start)
    const leaving = (entries, from) => entries.map((e, i) => (i + 1 >= from ? { id: e.id, laps: e.laps.slice(0, e.laps.findIndex(l => l.startMs >= START) + 1) } : e));

    it('a marathon: 15 or more riders start around the same time, a good part of them after a break', () => {
        const result = marathonDetect(group(40, 20), 1);
        assert.equal(result.isMarathon, true);
        assert.equal(result.riders, 40);
        assert.equal(result.withBreak, 20);
        assert.ok(Math.abs(result.startMs - (START + 40 * SECOND)) <= 40 * SECOND);
    });
    it('the reference rider does not need a break himself (he may have been at the line already), the others do', () => {
        const entries = group(40, 20);
        entries[24] = riderAt(25, 10, false);                                              // the reference: no break
        assert.equal(marathonDetect(entries, 25).isMarathon, true);
    });
    it('not a marathon with fewer than 15 riders, or without a break before the start (a busy training session)', () => {
        assert.equal(marathonDetect(group(14, 7), 1).isMarathon, false);
        assert.equal(marathonDetect(group(15, 8), 1).isMarathon, true);                    // 15 is enough
        assert.equal(marathonDetect(group(40, 0), 1).isMarathon, false);
        assert.equal(marathonDetect(group(40, 5), 1).isMarathon, false);                   // only 12 % after a break
    });
    it('the riders have to start around the same time: riders of another race (an hour later) do not count', () => {
        const other = Array.from({ length: 30 }, (_, i) => ({ id: 100 + i, laps: riderAt(100 + i, 3600, true).laps }));
        assert.equal(marathonDetect([...group(10, 5), ...other], 1).isMarathon, false);
        assert.equal(marathonDetect([...group(10, 5), ...other], 1).riders, 10);
    });
    it('a lap later at least 75 % of the group has to cross the finish line as a group again (the empty lap)', () => {
        const entries = group(40, 20);
        assert.equal(marathonDetect(entries, 1).again, 40);
        assert.equal(marathonDetect(leaving(entries, 32), 1).isMarathon, true);            // 31 of 40 (77 %) come by again
        const twoThirds = marathonDetect(leaving(entries, 28), 1);                        // 27 of 40 (67 %)
        assert.equal(twoThirds.isMarathon, false);
        assert.equal(twoThirds.again, 27);
        assert.equal(marathonDetect(leaving(entries, 1), 1).isMarathon, false);            // the reference rider himself does not come by again
    });
    it('a lap later means together: riders who come by minutes later do not count', () => {
        const entries = group(40, 20).map((e, i) => (i < 25 ? e : { id: e.id, laps: e.laps.map((l, j) => (j >= 1 ? { ...l, startMs: l.startMs + 200 * SECOND } : l)) }));
        assert.equal(marathonDetect(entries, 1).isMarathon, false);
    });
    it('a reference rider without laps (or who is not in the list) gives no marathon', () => {
        assert.equal(marathonDetect(group(40, 20), 999).isMarathon, false);
        assert.equal(marathonDetect([{ id: 1, laps: [] }], 1).isMarathon, false);
    });
    it('a long lap at the end of the activity (a lap to skate out) is not taken for the break before the start', () => {
        const entries = group(40, 20).map(e => ({ id: e.id, laps: [...e.laps, { nr: 99, startMs: e.laps[e.laps.length - 1].startMs + e.laps[e.laps.length - 1].durMs, durMs: 200 * SECOND }] }));
        const result = marathonDetect(entries, 1);
        assert.equal(result.isMarathon, true);
        assert.ok(Math.abs(result.startMs - (START + 40 * SECOND)) <= 40 * SECOND);          // the start of the race, not the end of the activity
        // the main run counts, not the last break: 10 laps, a break, 20 laps, a break, 3 laps: the start is after the first break
        const mk = (dur, start) => ({ nr: 1, startMs: start, durMs: dur * SECOND });
        const laps = [...Array.from({ length: 10 }, (_, i) => mk(40, START + i * 40 * SECOND)), mk(300, START + 400 * SECOND), ...Array.from({ length: 20 }, (_, i) => mk(40, START + (700 + i * 40) * SECOND)), mk(300, START + 1500 * SECOND), ...Array.from({ length: 3 }, (_, i) => mk(40, START + (1800 + i * 40) * SECOND))];
        assert.equal(marathonRaceStart(laps).startMs, START + 700 * SECOND);
    });
    it('marathonRaceStart: the end of the lap after his break, else his first crossing', () => {
        const withBreak = marathonRaceStart(riderAt(1, 0, true).laps);
        assert.equal(withBreak.afterBreak, true);
        assert.equal(withBreak.startMs, START + 40 * SECOND);                            // his first race lap ends 40 s after the start
        assert.equal(marathonRaceStart(riderAt(2, 0, false).laps).afterBreak, false);
        assert.equal(marathonRaceStart([]), null);
    });
});

describe('marathonTrackLaps: riders are shown from their first real crossing since the start', () => {
    const { marathonTrackLaps } = app.sandbox;
    it('a rider is not on the track until the API gives a crossing from 20 seconds before the start time', () => {
        const start = NOW;
        const list = laps(8, 30, 60);                                   // his last crossing was 60 s before the start: warming up
        assert.equal(marathonTrackLaps(list, start, start).length, 0);
        assert.equal(riderLive(activity(1, 900, 60), marathonTrackLaps(list, start, start), start).frac, null);      // no dot
        // 45 s after the start his first crossing arrives: from there he goes round from the finish line
        const arrived = [...list, { nr: 9, startMs: start + 5 * SECOND, durMs: 40 * SECOND }];
        const rider = riderLive(activity(1, 900, 60), marathonTrackLaps(arrived, start, start + 50 * SECOND), start + 50 * SECOND);
        assert.equal(rider.lapCount, 1);
        assert.equal(rider.sinceMs, 5000);
        assert.equal(rider.status, 'skating');
    });
    it('the crossings before the start (the warming up) are not looked at any more, nor is the pace taken from them', () => {
        const start = NOW;
        const list = [...laps(6, 20, 120), { nr: 7, startMs: start - 30 * SECOND, durMs: 60 * SECOND }];      // 20 s laps before, the first race crossing after 30 s
        const race = marathonTrackLaps(list, start, start + 80 * SECOND);
        assert.equal(race.length, 1);
        assert.equal(riderLive(activity(1, 900, 60), race, start + 80 * SECOND).paceMs, 30000);          // his one lap of the race, from the start (30 s)
    });
    it('the first lap is measured from the start time, not from the crossing before it (a long lap of waiting is a lap from the start)', () => {
        const start = NOW;
        // the lap that ends the waiting: 199 s, of which the last 45 s are after the start
        const long = [{ nr: 1, startMs: start - 154 * SECOND, durMs: 199 * SECOND }];
        const race = marathonTrackLaps(long, start, start + 50 * SECOND);
        assert.equal(race.length, 1);
        assert.equal(race[0].durMs, 45000);
        assert.equal(race[0].startMs, start);
        assert.equal(riderLive(activity(1, 900, 5), race, start + 50 * SECOND).status, 'skating');       // (199 s would have been a break)
    });
    it('the crossings from 20 seconds before the start count as the first crossing; before that time nothing is changed', () => {
        const start = NOW;
        const near = [{ nr: 1, startMs: start - 45 * SECOND, durMs: 30 * SECOND }];                   // crossed 15 s before the start
        assert.equal(marathonTrackLaps(near, start, start + 10 * SECOND).length, 1);
        const list = laps(4, 30, 10);
        assert.equal(marathonTrackLaps(list, start + 60 * SECOND, start), list);                        // the start is still far ahead
        assert.equal(marathonTrackLaps([], start, start).length, 0);
        assert.equal(marathonTrackLaps(null, start, start), null);
    });
});

describe('liveShownStep: the shown dot never stops and never jumps', () => {
    const { liveShownStep } = app.sandbox;
    const run = (pos, targetAt, seconds, paceMs = 30000) => {          // 10 steps a second; targetAt(t) is the estimate at second t
        const path = [pos];
        for (let t = 0; t < seconds; t += 0.1) path.push(pos = liveShownStep(pos, targetAt(t), paceMs, 0.1));
        return path;
    };
    it('runs at the usual speed when it is where it should be', () => {
        const path = run(8, t => 8 + t / 30, 30);
        assert.ok(Math.abs(path[path.length - 1] - 9) < 1e-6);
    });
    it('never stands still, whatever the estimate does (also when the estimate stops at the line)', () => {
        const path = run(8.95, () => 8.99, 20);                          // the estimate waits in front of the line
        for (let i = 1; i < path.length; i++) assert.ok(path[i] - path[i - 1] >= 0.4 * 0.1 / 30 - 1e-12, 'stood still at step ' + i);
        const back = run(9.5, () => 9.0, 20);                            // the estimate is behind the dot
        for (let i = 1; i < back.length; i++) assert.ok(back[i] > back[i - 1]);
    });
    it('never runs faster than twice, never slower than 0.4 times the usual speed', () => {
        const path = run(8, () => 20, 10);
        for (let i = 1; i < path.length; i++) assert.ok(path[i] - path[i - 1] <= 2 * 0.1 / 30 + 1e-12);
    });
    it('a difference is worked away during the coming lap: a dot 0.05 lap behind the estimate is level again after about a lap', () => {
        const path = run(8.95, t => 9 + t / 30, 60);                     // the real lap has arrived: the estimate is 0.05 lap ahead
        const gap = i => (9 + (i * 0.1) / 30) - path[i];
        assert.ok(gap(0) > 0.04);
        assert.ok(Math.abs(gap(300)) < 0.01, 'still ' + gap(300) + ' laps off after 30 s');
        const speeds = path.slice(1).map((p, i) => (p - path[i]) / 0.1 * 30);      // relative to the usual speed
        assert.ok(Math.max(...speeds) < 1.6 && Math.min(...speeds) > 0.9, speeds[0] + ' .. ' + speeds[speeds.length - 1]);   // only a gentle speeding up
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
