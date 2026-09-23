const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadBrowserScripts, hostCopy } = require('../helpers/browser-scripts');

const app = loadBrowserScripts(['utils.js', 'replay-track.js', 'replay-model.js', 'live-model.js', 'marathon-model.js']);
const { riderLive } = app.sandbox;

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
        // in an older lap: everybody who crossed between the first rider of that lap and the first rider of the next one - unless a
        // rider's own lap n was already known by then (nowMs), which always wins (see the "a rider one lap behind for a moment..." test)
        const lap4 = marathonStandings(entries, { lapNr: 4, nowMs: RACE_START + 205 * SECOND });
        assert.deepEqual(hostCopy(lap4.rows.map(r => [r.label, r.laps])), [['Anna', 4], ['Ben', 4], ['Lapped', 4]]);          // Lapped's own lap 4 (at 160 s) is already known by nowMs (205 s), so it counts as his lap 4, not his (older) lap 3
        // querying a lap Lapped had not reached yet at that real time still folds him in by his real-time position, same as before
        const lap4Early = marathonStandings(entries, { lapNr: 4, nowMs: RACE_START + 155 * SECOND });                        // his lap 4 (160 s) has not happened yet
        assert.deepEqual(hostCopy(lap4Early.rows.map(r => [r.label, r.laps])), [['Anna', 4], ['Ben', 4], ['Lapped', 3]]);
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
    it('once the race is finished, a rider one lap behind counts for the result when his own last lap was close to the winner\'s finish - the finish is decided over a window around the winner\'s finish, not by whoever happens to cross before or after him', () => {
        const group = [rider(1, 'Anna', cross(0, 6, 30)), rider(2, 'Ben', cross(0, 6, 30).map(t => t + 1))];
        const close = rider(3, 'Close', cross(0, 5, 30));               // his own last (5th) lap ends at 150 s, 30 s before Anna's finish
        const far = { id: 4, label: 'Far', laps: [20, 40, 60, 80, 100].map((end, i, a) => ({ nr: i + 1, startMs: RACE_START + (i === 0 ? 0 : a[i - 1]) * SECOND, durMs: (end - (i === 0 ? 0 : a[i - 1])) * SECOND })) };  // his last lap ends at 100 s, 80 s before Anna's finish: really too long ago to be part of the same finish
        // Anna (the winner) crosses the finish line of the 6th (and last) lap at 180 s: the race counts as finished from that moment
        const result = marathonStandings([...group, close, far], { raceLaps: 6, nowMs: RACE_START + 181 * SECOND });
        assert.equal(result.finished, true);
        // Close is already part of the result, right when the race finishes - not kept waiting in "still to cross the line" first
        assert.deepEqual(hostCopy(result.rows.map(r => [r.label, r.laps])), [['Anna', 6], ['Ben', 6], ['Close', 5]]);
        assert.deepEqual(hostCopy(result.pending.map(p => [p.label, p.status])), [['Far', 'lapped']]);
        // this does not depend on how much real time has passed since Anna's finish: it depends on how close Close's own last lap was
        // to it, a historical fact that does not change - so the same is still true much later
        const later = marathonStandings([...group, close, far], { raceLaps: 6, nowMs: RACE_START + 400 * SECOND });
        assert.deepEqual(hostCopy(later.rows.map(r => [r.label, r.laps])), [['Anna', 6], ['Ben', 6], ['Close', 5]]);
        // while the race is still going (not finished yet, no raceLaps and not quiet for 90 s), a rider one lap behind is "coming": he
        // might still cross any moment - this holds regardless of how close his last lap was, the finish-window check above only
        // applies once the race actually is finished
        const stillLive = marathonStandings([...group, close, far], { nowMs: RACE_START + 185 * SECOND });
        assert.equal(stillLive.finished, false);
        assert.deepEqual(hostCopy(stillLive.rows.map(r => r.label)), ['Anna', 'Ben']);
        assert.deepEqual(hostCopy(stillLive.pending.map(p => [p.label, p.status])), [['Far', 'coming'], ['Close', 'coming']]);
    });
    it('the finish closes 40 seconds after the winner: a crossing after that does not count for the result any more, his previous lap stays his last one, and he is placed at the bottom in the order of that last crossing', () => {
        const group = [rider(1, 'Anna', cross(0, 6, 30)), rider(2, 'Ben', cross(0, 6, 30).map(t => t + 1))];
        // Late's own 6th lap (matching Anna and Ben's) ends at 230 s - 50 s after Anna's finish (180 s), past the 40 s window - so it
        // does not count: without this, his own byLap(6) would always have been trusted, however late it really arrived. His 5th lap,
        // at 150 s, stays his result instead.
        const late = rider(3, 'Late', [30, 60, 90, 120, 150, 230]);
        // Later's own 6th lap ends even further outside the window (240 s) too, but his 5th (155 s) is still within it, so he is
        // closed out one lap behind as well, just a little later than Late
        const later = rider(4, 'Later', [30, 60, 90, 120, 155, 240]);
        // Latest never even gets that far: his own 5th lap (250 s) is also outside the window, so his frozen result falls back to his
        // 4th lap (135 s) - two laps behind, genuinely lapped rather than closed out
        const latest = rider(5, 'Latest', [30, 60, 90, 135, 250]);
        const nowMs = RACE_START + 260 * SECOND;
        const result = marathonStandings([...group, late, later, latest], { raceLaps: 6, nowMs, trackLengthM: 400 });
        assert.equal(result.finished, true);
        // Anna and Ben first (6 laps each, real finishers), then Late and Later (5 laps each, closed out at 150 s and 155 s - in the
        // order of that last crossing); Latest is lapped (4 laps, two behind), not just closed out one lap short
        assert.deepEqual(hostCopy(result.rows.map(r => [r.label, r.laps])), [['Anna', 6], ['Ben', 6], ['Late', 5], ['Later', 5]]);
        assert.deepEqual(hostCopy(result.pending.map(p => [p.label, p.status, p.laps])), [['Latest', 'lapped', 4]]);
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
    it('a crossing the mat missed is simply the next lap: it is not guessed to be worth several laps, and what a rider did before the gap before the start does not count', () => {
        // guessing that an unusually long crossing must be worth several laps, to keep a rider's count in step with the group, used to
        // let his count run ahead of his own real crossings - which could then even place him, on the clock, before riders who really
        // did cross the line first (impossible, but that is what the guess could produce). A rider the mat really did miss a lap for
        // instead simply ends up with one fewer real lap than the group: exactly what the timing shows, nothing guessed.
        const before = Array.from({ length: 10 }, (_, i) => ({ nr: i + 1, startMs: RACE_START - 1500 * SECOND + i * 40 * SECOND, durMs: 40 * SECOND }));
        const early = rider(1, 'Early', cross(0, 8, 30), before);                    // a warm-up of 10 laps before the start
        const plain = rider(2, 'Plain', cross(0, 8, 30).map(t => t + 1));
        const missed = rider(3, 'Missed', cross(0, 8, 30).filter((t, i) => i !== 3).map(t => t + 2));      // the crossing of lap 4 was not registered: 7 real crossings, not 8
        const list = lap => marathonStandings([early, plain, missed], { lapNr: lap, nowMs: RACE_START + 250 * SECOND });
        assert.deepEqual(hostCopy(list(5).rows.map(r => r.label)), ['Early', 'Plain', 'Missed']);           // still there, on his own (real) lap 5
        assert.deepEqual(hostCopy(list(8).rows.map(r => [r.label, r.laps])), [['Early', 8], ['Plain', 8], ['Missed', 7]]);      // Missed only ever really crossed 7 times
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
    it('a gap in the crossings (nobody registered for a while) does not add laps that were not really skated: it is just a slow one', () => {
        const entries = [rider(1, 'Anna', [30, 60, 150, 180, 210, 240]), rider(2, 'Ben', [31, 61, 151, 181, 211, 241])];      // nothing between 60 s and 150 s
        // the crossing at 150 s is simply Anna's third real lap (a slow one, 90 s), not a sign that a lap around 90 or 120 s was
        // skipped: both riders still line up, lap for lap, on their own six real crossings
        const result = marathonStandings(entries, { lapNr: 3, nowMs: RACE_START + 250 * SECOND });
        assert.deepEqual(hostCopy(result.rows.map(r => [r.label, r.laps, Math.round(r.lapMs / 1000)])), [['Anna', 3, 90], ['Ben', 3, 90]]);
        assert.equal(marathonStandings(entries, { nowMs: RACE_START + 250 * SECOND }).leaderCount, 6);      // 6 real crossings each, not 8
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
        // Ann and Ben cross once (40 s), then wait for the start: the next crossing (at 290 s, a lap of 250 s) is nowhere near racing
        // pace, so it is the starting lap ("lap 0"), not lap 1 - their real lap 1 is the one after it (290 to 330 s). Cas and Dirk only
        // join at the start: their own first crossing spans the whole wait (0 to 290 s), which is the starting lap for them too, for the
        // same reason. The mat registers nothing in between.
        const ends = [290, 330, 370, 410, 450, 490];
        const waiting = (id, name, extra) => ({ id, label: name, laps: [...extra, ...ends.map((end, i) => ({ nr: i + 1, startMs: RACE_START + (i === 0 ? extra.length ? 40 : 0 : ends[i - 1]) * SECOND, durMs: (end - (i === 0 ? (extra.length ? 40 : 0) : ends[i - 1])) * SECOND }))] });
        const early = [{ nr: 0, startMs: RACE_START, durMs: 40 * SECOND }];
        const entries = [waiting(1, 'Ann', early), waiting(2, 'Ben', early), waiting(3, 'Cas', []), waiting(4, 'Dirk', [])];
        const result = marathonStandings(entries, { nowMs: RACE_START + 500 * SECOND });
        assert.ok(Math.abs(result.autoStartMs - (RACE_START + 250 * SECOND)) < 5000, String(result.autoStartMs - RACE_START));    // the group starts about a lap before its first crossing
        assert.equal(result.leaderCount, 5);                    // the waiting is not counted, and neither is the starting lap
        assert.equal(result.rows.length, 4);
        // the first lap of the race is the real 40 s lap from 290 to 330 s, the same for everyone, not the straddling starting lap
        assert.ok(Math.abs(marathonStandings(entries, { lapNr: 1, nowMs: RACE_START + 500 * SECOND }).rows[0].lapMs - 40000) < 5000);
        // a start time of 21:00 (here: at the beginning) counts everything: Ann and Ben's real early lap is no longer their starting
        // lap either (it is not their first crossing any more), so their long wait is simply counted as one (very slow) lap of its own -
        // 7 real crossings for them; Cas and Dirk, who only ever had the long wait as their first crossing, still have it stripped as
        // their starting lap, leaving them with 5 - one lap behind, but still there, on their last real crossing at 490 s
        const everything = marathonStandings(entries, { startMs: RACE_START, nowMs: RACE_START + 500 * SECOND });
        assert.equal(everything.leaderCount, 7);
        assert.deepEqual(hostCopy(everything.rows.map(r => [r.label, r.laps])), [['Ann', 7], ['Ben', 7], ['Cas', 5], ['Dirk', 5]]);
        // an absolute time chosen by hand, at the moment the group starts
        assert.equal(marathonStandings(entries, { startMs: RACE_START + 250 * SECOND, nowMs: RACE_START + 500 * SECOND }).leaderCount, 5);
    });
    it('a rider without any laps before the start is not a lap ahead of a rider who was already circling near the line', () => {
        // WithHistory has skated a real lap earlier, then waits near the line: the mat keeps registering him, so that wait becomes one
        // long "lap" (260 s) that ends at the moment the group starts (300 s) - too short to be a warm-up gap (under 5 minutes), too long
        // to be a real lap. NoHistory's transponder has no earlier laps at all: his very first ever recorded lap simply starts at the
        // same moment the group starts and ends 40 s later, same as everyone's real first lap. Without recognising WithHistory's long
        // wait as a starting lap ("lap 0"), it would count as his lap 1, and his real first full lap (300-340 s) would become lap 2 -
        // one lap "ahead" of NoHistory for running the exact same real lap at the exact same time.
        const withHistory = {
            id: 1, label: 'WithHistory',
            laps: [
                { nr: 1, startMs: RACE_START, durMs: 40 * SECOND },                       // a real lap, well before the start
                { nr: 2, startMs: RACE_START + 40 * SECOND, durMs: 260 * SECOND },        // waiting near the line: ends when the group starts
                { nr: 3, startMs: RACE_START + 300 * SECOND, durMs: 40 * SECOND },
                { nr: 4, startMs: RACE_START + 340 * SECOND, durMs: 40 * SECOND }
            ]
        };
        const noHistory = {
            id: 2, label: 'NoHistory',
            laps: [
                { nr: 1, startMs: RACE_START + 300 * SECOND, durMs: 40 * SECOND },        // his very first ever lap starts as the group starts
                { nr: 2, startMs: RACE_START + 340 * SECOND, durMs: 40 * SECOND }
            ]
        };
        const nowMs = RACE_START + 400 * SECOND;
        const result = marathonStandings([withHistory, noHistory], { startMs: RACE_START + 300 * SECOND, nowMs, trackLengthM: 400 });
        assert.equal(result.leaderCount, 2);                                              // not 3: WithHistory's wait does not count as a lap
        assert.deepEqual(hostCopy(result.rows.map(r => [r.label, r.laps])), [['WithHistory', 2], ['NoHistory', 2]]);
        // both ran the very same real lap (300 to 340 s) as their lap 1
        const lap1 = marathonStandings([withHistory, noHistory], { lapNr: 1, startMs: RACE_START + 300 * SECOND, nowMs, trackLengthM: 400 });
        assert.deepEqual(hostCopy(lap1.rows.map(r => [r.label, r.laps, r.endMs - RACE_START])), [['WithHistory', 1, 340000], ['NoHistory', 1, 340000]]);
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
        // asked for later, once his own lap 4 (at 180 s) is known, that is what counts as his lap 4 - not the lap he happened to be on
        // when the group reached lap 4 (135 s, his own lap 3)
        const lap4 = marathonStandings([...group, slow], { lapNr: 4, nowMs: RACE_START + 250 * SECOND });
        assert.deepEqual(hostCopy(lap4.rows.map(r => [r.label, r.laps])), [['Anna', 4], ['Ben', 4], ['Cor', 4], ['Slow', 4]]);
        // asked at the time, before his own lap 4 has happened, he is still listed after the group with his real-time (lower) number of laps
        const lap4Early = marathonStandings([...group, slow], { lapNr: 4, nowMs: RACE_START + 170 * SECOND });
        assert.deepEqual(hostCopy(lap4Early.rows.map(r => [r.label, r.laps])), [['Anna', 4], ['Ben', 4], ['Cor', 4], ['Slow', 3]]);
    });
    it('a rider who is one lap behind is in the list, later than the group, with the gap of a lap', () => {
        const group = [rider(1, 'Anna', cross(0, 8, 30)), rider(2, 'Ben', cross(0, 8, 30).map(t => t + 1))];
        const lapped = rider(3, 'Lapped', cross(0, 7, 30).map(t => t + 20));     // the same speed, but a lap behind: he has 7 laps when the group has 8
        const result = marathonStandings([...group, lapped], { lapNr: 7, nowMs: RACE_START + 250 * SECOND });
        assert.deepEqual(hostCopy(result.rows.map(r => r.label)), ['Anna', 'Ben', 'Lapped']);
        assert.equal(Math.round(result.rows[2].gapMs), 20000);
        assert.equal(marathonStandings([...group, lapped], { nowMs: RACE_START + 250 * SECOND }).pending.length, 1);
    });
    it('a rider whose first lap was a little slow keeps up with the group from lap 2 on: he is not shown a lap behind for the rest of the race', () => {
        // Fast (400 m at a steady 20 s a lap) crosses the line at 20, 40, 60 and 80 s. Straggler skates exactly the same pace from lap 2
        // on, but needed 23 s for his own first lap (lined up further back at the start, say): his lap 1 ends at 41 s - a moment after
        // Fast has already crossed his own lap 2 (40 s). A real mass start spreads out just like this: the gap from front to back within
        // one lap can be bigger than the front rider's own gap between two laps.
        const fast = rider(1, 'Fast', cross(0, 4, 20));
        const straggler = {
            id: 2, label: 'Straggler',
            laps: [
                { nr: 1, startMs: RACE_START + 18 * SECOND, durMs: 23 * SECOND },     // ends at 41 s: 23 s, not an unusually long lap for him
                { nr: 2, startMs: RACE_START + 41 * SECOND, durMs: 20 * SECOND },     // 20 s laps from here on, exactly like Fast
                { nr: 3, startMs: RACE_START + 61 * SECOND, durMs: 20 * SECOND },
                { nr: 4, startMs: RACE_START + 81 * SECOND, durMs: 20 * SECOND }
            ]
        };
        const nowMs = RACE_START + 105 * SECOND;
        // he must not vanish from lap 1 (and turn up a lap "late", with one fewer lap, in lap 2's list): he crossed lap 1 for real, just
        // a few seconds after Fast's lap 2, so he belongs in lap 1's list, with his own lap 1
        const lap1 = marathonStandings([fast, straggler], { lapNr: 1, startMs: RACE_START, nowMs, trackLengthM: 400 });
        assert.deepEqual(hostCopy(lap1.rows.map(r => [r.label, r.laps])), [['Fast', 1], ['Straggler', 1]]);
        // and from there on he keeps his own, correct number of laps every lap - the early stagger does not compound into "one lap
        // behind" for the rest of the race
        for (const n of [2, 3, 4]) {
            const lap = marathonStandings([fast, straggler], { lapNr: n, startMs: RACE_START, nowMs, trackLengthM: 400 });
            assert.deepEqual(hostCopy(lap.rows.map(r => [r.label, r.laps])), [['Fast', n], ['Straggler', n]], `lap ${n}`);
        }
        // at the finish he is not shown as lapped either: he did the same number of laps as Fast, just a few seconds later
        const result = marathonStandings([fast, straggler], { startMs: RACE_START, nowMs, trackLengthM: 400 });
        assert.equal(result.leaderCount, 4);
        assert.equal(result.pending.length, 0);
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
