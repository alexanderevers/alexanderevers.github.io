/**
 * Marathon mode: a group of about 50 riders crosses the finish line more or less together. Every lap gives a new list: the
 * order in which the riders crossed the line, with the time and the distance to the first rider (the one who crossed first).
 * Depends on live-model.js (LIVE_WINDOW_MS, riderLive, liveShownStep: this file only holds the settings that adapt those two
 * for the marathon page, MARATHON_ESTIMATE_OPTIONS and MARATHON_SHOWN_OPTIONS).
 */

// The settings of the marathon (marathon.html). Measured against the real lap times of the marathon of 11/03/2026 at Jaap Eden (33 riders,
// 343,000 moments, a lap known 3 s after it ended): the place of a dot was 15.5 m off on average with the settings of the live page, and
// 11.7 m (median 7.9 m instead of 11.6 m) with these: the estimate from the last lap, without the rule for a rider who is slowing down (a
// pack skates evenly), and a dot that catches up with the estimate quickly (in 5 % of a lap instead of 40 %) within 0.2 to 3 times his speed.
const MARATHON_ESTIMATE_OPTIONS = { fromLastLap: true, slowingRule: false };
const MARATHON_SHOWN_OPTIONS = { catchUp: 0.05, minCatchUpS: 1, minSpeed: 0.2, maxSpeed: 3 };

// Before the start of a race there is always a gap of more than 5 minutes in the crossings of a rider; laps from before that gap
// (a warm-up) are not part of the race.
const MARATHON_GAP_MS = 5 * 60 * 1000;
// Nobody has crossed the line for this long: the race is over.
const MARATHON_QUIET_MS = 90 * 1000;
// After the last lap of the race a rider sometimes crosses the line once more (a lap to skate out). That crossing does not count. It
// is recognised by a lap of the group that takes at least this much longer than the usual lap (the last lap of a race is a fast one).
const MARATHON_SKATE_OUT = 1.3;
// Laps at the end are only taken for laps to skate out when at least this many riders crossed in them, and not before this lap.
const MARATHON_MIN_CROSSINGS = 3;
const MARATHON_MIN_LAPS = 5;

/** The finish crossings of the race of one rider: the ends of the laps after his last gap of 5 minutes or more. */
function marathonCrossings(laps) {
    let from = 0;
    (laps || []).forEach((lap, i) => {
        const gapBefore = i > 0 ? lap.startMs - (laps[i - 1].startMs + laps[i - 1].durMs) : 0;
        if (lap.durMs > MARATHON_GAP_MS) from = i + 1;          // this "lap" is the waiting for the start: the race starts after it
        else if (gapBefore > MARATHON_GAP_MS) from = i;
    });
    return (laps || []).slice(from).map(lap => ({ startMs: lap.startMs, endMs: lap.startMs + lap.durMs, durMs: lap.durMs }));
}

// A crossing that took at least this many times the usual lap time of the rider is a lap in which the timing mat missed the rider one or
// more times.
const MARATHON_MISSED = 1.7;
// A new lap of the group starts when somebody crosses the line at least this share of the usual lap time after the first crossing of the
// lap before (the riders of a group cross within a part of a lap of each other).
const MARATHON_LAP_SHARE = 0.75;

const medianOf = list => {
    const sorted = [...list].sort((x, y) => x - y);
    return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
};

/**
 * The laps of a rider for the picture of the track in marathon mode: a rider is shown from his first real crossing since the start: the
 * first crossing the API really gives from 20 seconds before the start time (in the first lap nobody has been dropped yet, so it is about
 * the same time for everybody). Before it he is not on the track, and the crossings before it (the warming up, the waiting for the start)
 * are not looked at, so nobody is guessed to be somewhere: from that crossing he goes round at his own pace, and from there on the
 * picture follows the real crossings as usual. His first lap is measured from the start time, not from the crossing before it.
 * @param {Array} laps    normalized laps of the rider (as far as they are known)
 * @param {number} startMs the start time of the race (absolute)
 * @param {number} nowMs  the moment of the picture
 */
function marathonTrackLaps(laps, startMs, nowMs) {
    if (!laps || laps.length === 0 || !Number.isFinite(startMs) || nowMs < startMs - MARATHON_BEFORE_START_MS) return laps;
    const race = laps.filter(lap => lap.startMs + lap.durMs >= startMs - MARATHON_BEFORE_START_MS);
    if (race.length === 0) return [];                                       // no real crossing since the start yet
    const first = race[0];
    const firstEnd = first.startMs + first.durMs;
    const fromStart = firstEnd - Math.max(first.startMs, startMs);
    return fromStart > 0 && fromStart < first.durMs ? [{ ...first, startMs: firstEnd - fromStart, durMs: fromStart }, ...race.slice(1)] : race;
}

// ---------- Was it a marathon? (for the overlapping sessions of the main page) ----------
// A break of at least this long (2.5 minutes) before the start (the waiting for the start)
const MARATHON_DETECT_BREAK_MS = 2.5 * 60 * 1000;
// "Around the same start time": the first crossings of the race lie within this long of each other (before and after the reference rider)
const MARATHON_DETECT_WINDOW_MS = 5 * 60 * 1000;
// A marathon needs at least this many riders that cross the finish line as a group around the same start time ...
const MARATHON_DETECT_MIN_RIDERS = 15;
// ... of whom at least this share had a break before the start (a busy training session has riders coming and going all the time)
const MARATHON_DETECT_MIN_BREAK_SHARE = 0.3;
// A lap later (the first lap after the start, the "empty lap") at least this share of the riders of the group crosses the finish line
// again as a group: within this long of the crossing of the reference rider. Riders who only pass by, or stop, do not.
const MARATHON_DETECT_NEXT_SHARE = 0.75;
const MARATHON_DETECT_NEXT_WINDOW_MS = 30 * 1000;

/** The first crossing of the race of a rider: the end of the lap after the break of 2.5 minutes or more that starts his main run of laps, else his first crossing; and the crossing one lap later. */
function marathonRaceStart(laps) {
    if (!laps || laps.length === 0) return null;
    const breaks = [];
    laps.forEach((lap, i) => {
        const gapBefore = i > 0 ? lap.startMs - (laps[i - 1].startMs + laps[i - 1].durMs) : 0;
        if (lap.durMs >= MARATHON_DETECT_BREAK_MS || gapBefore >= MARATHON_DETECT_BREAK_MS) breaks.push(i);
    });
    // The race is the main run of the rider: the stretch after a break (or from the start) in which he skated the most laps. A long lap
    // at the very end (a lap to skate out, a stop) is a break as well, but nothing follows it, so it is not taken for the start.
    let breakAt = -1;
    let longest = -1;
    [-1, ...breaks].forEach((candidate, k, list) => {
        const next = k + 1 < list.length ? list[k + 1] : laps.length;
        const run = next - 1 - Math.max(candidate, 0);
        if (run > longest) { longest = run; breakAt = candidate; }
    });
    const index = Math.max(breakAt, 0);
    const lap = laps[index];
    const next = laps[index + 1];                                          // the crossing one lap later (the "empty lap")
    return { startMs: lap.startMs + lap.durMs, afterBreak: breakAt >= 0, nextMs: next ? next.startMs + next.durMs : null };
}

/**
 * Was the activity of the reference rider a marathon? That is: a break of 2.5 minutes or more before the start, and at least 15 riders
 * (the reference rider included) that cross the finish line as a group around the same start time, of whom at least 75 % cross the
 * finish line as a group again one lap later (the first lap after the start).
 * @param {Array} entries      [{ id, laps }] the reference rider and everybody who skated at the same time, with normalized laps
 * @param {*} referenceId      the id of the reference rider's entry
 * @returns {{ isMarathon: boolean, riders: number, withBreak: number, again (riders in the group that crossed again a lap later), startMs: number|null }}
 */
function marathonDetect(entries, referenceId) {
    const starts = entries.map(e => ({ id: e.id, start: marathonRaceStart(e.laps) })).filter(x => x.start);
    const reference = starts.find(x => x.id === referenceId);
    if (!reference) return { isMarathon: false, riders: 0, withBreak: 0, startMs: null };
    const group = starts.filter(x => Math.abs(x.start.startMs - reference.start.startMs) <= MARATHON_DETECT_WINDOW_MS);
    const withBreak = group.filter(x => x.start.afterBreak).length;
    // a lap later the group crosses the finish line together again
    const nextMs = reference.start.nextMs;
    const again = nextMs === null ? 0 : group.filter(x => x.start.nextMs !== null && Math.abs(x.start.nextMs - nextMs) <= MARATHON_DETECT_NEXT_WINDOW_MS).length;
    const isMarathon = group.length >= MARATHON_DETECT_MIN_RIDERS && withBreak >= MARATHON_DETECT_MIN_BREAK_SHARE * group.length
        && again >= MARATHON_DETECT_NEXT_SHARE * group.length;
    return { isMarathon, riders: group.length, withBreak, again, startMs: reference.start.startMs };
}

// The riders are selected from this long before the start time: what they are doing then is their first lap.
const MARATHON_BEFORE_START_MS = 20 * 1000;
// The finish closes this long after the winner crosses the line: a rider one lap behind still counts for the result (with his own,
// lower number of laps) when he was still that close at the moment the finish closed, and keeps a real chance to still cross the line
// (status "coming") until then, even once the race already counts as finished (the race laps reached) - a real mass finish is not over
// the instant the winner is over the line, and it is not decided by whoever happens to cross a fraction of a second before or after
// him. But it does not stay open forever either: a crossing after the finish has closed does not count for the result any more,
// whatever lap it was really for - a rider's previous (already real) crossing stays his final one.
const MARATHON_FINISH_GRACE_MS = 40 * 1000;

/**
 * The list of a lap of the race. The race starts at an absolute START TIME (for example 21:00:00). From 20 seconds before it all riders
 * are selected: the lap a rider is in then (his first crossing from that moment) is his lap 1 and every next crossing is the next lap.
 * Everything before is not part of the race (the warming up, the minutes of waiting for the start), and everything is measured from the
 * start time (the time of the laps, the gaps). So a rider who is lapped has one lap fewer than the group, and a rider who started late
 * has fewer laps too. A rider's own laps are simply his own real crossings, counted in order from his first one since the start.
 * The finish lap is the lap of the rider with the most laps (or the lap that was chosen). Every rider who comes in during that lap counts
 * for the result: the list of a lap is everybody who crosses the line from the moment the first rider finishes that lap until the first
 * rider finishes the next one, so also the riders who are lapped (they come in with fewer laps). They are ordered by their number of
 * laps, then by the time they crossed. The first rider is the one who passes the finish line first.
 * @param {Array} entries  [{ id, label, laps }] the riders with their normalized laps
 * @param {object} options { startMs (the start time of the race, absolute; when left out it is the start of the first lap of the group in
 *                           which at least half of the usual number of riders crossed), lapNr (the finish lap, counted from the start: the
 *                           lap of the list; the newest lap when left out, so the list follows the race), raceLaps (number of laps of
 *                           the race, when known), trackLengthM, nowMs (only crossings before this moment are looked at) }
 * @returns {object|null} { lapNr, startMs, autoStartMs, firstMs, lastMs, finishMs, leaderCount, latest, finished, first, rows, pending }
 *   or null when nobody has crossed since the start. startMs is the start time (chosen or automatic), firstMs and lastMs are the first
 *   and the last crossing of the group (the range in which a start time can be chosen), finishMs the crossing of the first rider in the
 *   finish lap (start and finish are shown in the lap graph).
 *   rows: the riders who came in during this lap, in that order: { place, id, label, laps (his own number of laps), endMs, gapMs (to the first rider),
 *   distanceM (the gap in metres at the speed of the rider in that lap), lapMs, segmentMs (the time from the start time to his crossing of
 *   the finish lap: the same start for every rider) }
 *   pending: (newest lap only) the riders who are not in the list: { id, label, laps (his last lap), behind (laps), status
 *   'coming'|'lapped', lastEndMs }
 *   placesOf(id): the place of a rider in the list of every lap: [{ lapNr, place, endMs, riders }] (for the graph)
 */
function marathonStandings(entries, options = {}) {
    const { raceLaps = null, trackLengthM = 400, nowMs = Date.now() } = options;
    const riders = entries.map(e => ({
        id: e.id, label: e.label,
        crossings: marathonCrossings((e.laps || []).filter(lap => lap.startMs + lap.durMs <= nowMs))
    })).filter(r => r.crossings.length > 0 && nowMs - r.crossings[r.crossings.length - 1].endMs <= LIVE_WINDOW_MS);
    if (!riders.length) return null;

    const all = riders.flatMap(r => r.crossings).sort((x, y) => x.endMs - y.endMs);
    const usual = medianOf(all.map(c => c.durMs).filter(ms => ms <= 120000)) || medianOf(all.map(c => c.durMs));
    const quiet = nowMs - all[all.length - 1].endMs >= MARATHON_QUIET_MS;

    // The laps after the last lap of the race do not count: the crossing(s) at the end that are clearly slower than the racing pace are
    // laps to skate out. Only when at least 3 riders have such crossings (or the race is over): a rider who is slow at the end alone is
    // just slow.
    let skatedOut = false;
    if (!raceLaps) {
        const trailing = r => { let k = r.crossings.length; while (k > 0 && r.crossings[k - 1].durMs >= MARATHON_SKATE_OUT * usual) k--; return k; };
        const withSlowEnd = riders.filter(r => r.crossings.length >= MARATHON_MIN_LAPS && trailing(r) < r.crossings.length && trailing(r) > 0);
        if (withSlowEnd.length >= MARATHON_MIN_CROSSINGS) {
            skatedOut = true;
            withSlowEnd.forEach(r => { r.crossings = r.crossings.slice(0, trailing(r)); });
        }
    }

    // the laps of the group, numbered by the first rider of every lap; a stretch in which nobody was registered still gets numbered laps
    const starts = [];                                    // starts[k] = time of the first crossing of lap k + 1
    riders.flatMap(r => r.crossings).sort((x, y) => x.endMs - y.endMs).forEach(c => {
        const previous = starts.length ? starts[starts.length - 1] : null;
        if (previous !== null && c.endMs < previous + MARATHON_LAP_SHARE * usual) return;
        if (previous !== null) {
            const missing = Math.round((c.endMs - previous) / usual) - 1;
            for (let i = 1; i <= missing; i++) starts.push(previous + ((c.endMs - previous) * i) / (missing + 1));
        }
        starts.push(c.endMs);
    });
    const groupLapAt = ms => { let k = 0; while (k + 1 < starts.length && starts[k + 1] <= ms) k++; return k + 1; };

    // the automatic start time: the start of the first lap of the group in which at least half of the usual number of riders crossed
    const crossersIn = new Map();
    riders.forEach(r => new Set(r.crossings.map(c => groupLapAt(c.endMs))).forEach(k => crossersIn.set(k, (crossersIn.get(k) || 0) + 1)));
    const mostCrossers = Math.max(...crossersIn.values());
    let autoLap = 1;
    for (let k = 1; k <= starts.length; k++) if ((crossersIn.get(k) || 0) >= Math.max(MARATHON_MIN_CROSSINGS, Math.ceil(mostCrossers / 2))) { autoLap = k; break; }
    const autoStartMs = Math.round((autoLap > 1 ? starts[autoLap - 2] : Math.max(all[0].startMs, all[0].endMs - 2 * usual)) / 1000) * 1000;
    const startMs = Number.isFinite(options.startMs) ? options.startMs : autoStartMs;
    const firstMs = all[0].endMs;
    const lastMs = all[all.length - 1].endMs;

    // from 20 seconds before the start time all riders are selected: what they are in then is their first lap
    const beginMs = startMs - MARATHON_BEFORE_START_MS;
    const realTimes = new Set(all.map(c => c.endMs));
    const firstBoundary = starts.findIndex(t => t >= beginMs && realTimes.has(t));       // the first crossing of the group in the race is the end of its lap 1 (a lap in which nobody was registered has no crossing)
    if (firstBoundary < 0) return null;
    riders.forEach(r => {
        r.crossings = r.crossings.filter(c => c.endMs >= beginMs);
        const own = medianOf(r.crossings.map(c => c.durMs).filter(ms => ms <= 120000)) || usual;
        // A rider's very first crossing since the start is sometimes not a real lap at all: waiting near the line for the gun, while
        // already on the ice, can itself take a couple of minutes - under the 5-minute gap marathonCrossings uses to tell a warm-up
        // from the race, so it is still here, but nowhere near racing pace. That crossing is the starting lap ("lap 0"), not lap 1: a
        // rider without any such wait (his very first crossing already is a real lap, for example because his transponder only started
        // counting once the race was already on) would otherwise be shown one lap "ahead" of everyone else for running the exact same
        // real lap - and everyone else would seem to be missing their lap 1 entirely (see the tests).
        if (r.crossings.length && r.crossings[0].durMs >= MARATHON_MISSED * own && r.crossings[0].durMs >= MARATHON_MISSED * usual) {
            r.crossings = r.crossings.slice(1);
        }
        // Every real crossing is simply the next lap, in order - even a very long one (the mat missing a rider for a while): guessing
        // that such a crossing must be worth several laps, to keep pace with the group, used to let a rider's count run ahead of his own
        // real crossings, which could then place him before riders who really did cross the line first. A rider the mat really did miss
        // a few times ends up with fewer counted laps than he actually skated, which is honest about what the timing actually shows,
        // rather than a guess that can turn out to be wrong in either direction.
        let count = 0;
        r.crossings.forEach(c => {
            count += 1;
            c.lapNo = count;
            const fromStart = c.endMs - Math.max(c.startMs, startMs);                  // (the lap that ends the waiting starts at the start)
            c.lapMs = fromStart > 0 ? Math.min(c.durMs, fromStart) : c.durMs;
        });
        if (raceLaps) r.crossings = r.crossings.filter(c => c.lapNo <= raceLaps);
        r.byLap = new Map(r.crossings.map(c => [c.lapNo, c]));
        r.lastLap = r.crossings.length ? r.crossings[r.crossings.length - 1].lapNo : 0;
    });
    const inRace = riders.filter(r => r.byLap.size > 0);
    if (!inRace.length) return null;
    const leaderCount = Math.max(...inRace.map(r => r.lastLap));
    const latest = !options.lapNr || options.lapNr >= leaderCount;
    const lapNr = latest ? leaderCount : Math.max(1, Math.floor(options.lapNr));
    const finished = raceLaps ? leaderCount >= raceLaps : quiet || skatedOut;

    // (a lap in which nobody was registered has no rows: its time is worked out from the nearest lap with riders)
    const firstOf = n => { const times = inRace.filter(r => r.byLap.has(n)).map(r => r.byLap.get(n).endMs); return times.length ? Math.min(...times) : null; };
    const timeOfLap = n => {
        for (let d = 0; d < leaderCount; d++) {
            const before = firstOf(n - d);
            if (before !== null) return before + d * usual;
            const after = firstOf(n + d);
            if (after !== null) return after - d * usual;
        }
        return startMs;
    };
    // everybody who comes in during the finish lap: from the moment the first rider finishes it until the first rider finishes the next lap
    const firstAt = firstOf(lapNr) ?? timeOfLap(lapNr);
    // The finish closes this long after the winner (whoever has the most laps) crosses the line: a crossing after that does not count
    // for the result any more, whatever lap it was really for - a rider's previous (already real) crossing stays his final one. This is
    // worked out from the winner's own crossing (leaderCount), not from firstAt: an older lap can be queried on its own (the finish
    // slider, or placesOf below stepping through every lap) without the finish of a different, later lap closing early.
    const winnerFinishAt = firstOf(leaderCount) ?? timeOfLap(leaderCount);
    const finishCloseAt = winnerFinishAt + MARATHON_FINISH_GRACE_MS;
    // A rider's crossing once the finish has closed: his last real crossing at or before that moment - once the race is actually
    // finished. While it is still going every real crossing still counts as usual (nothing has closed yet).
    const atClose = r => {
        if (!finished) return r.byLap.get(r.lastLap);
        let last = null;
        for (const c of r.crossings) { if (c.endMs > finishCloseAt) break; last = c; }
        return last || r.crossings[0];
    };
    // the riders who came in during lap n, in the order of the list: most laps first, then the time of crossing. A rider's own lap n (his
    // n-th real crossing, r.byLap.get(n)) always counts as lap n, even when he crossed it a moment after the front of the group already
    // crossed lap n + 1: in a big, tightly bunched group the spread from front to back within one lap can be bigger than the gap between
    // the front rider's own successive laps (most visibly right after the start, before the group has spread out), and picking riders up
    // by a time window alone then skips straight over the riders at the back for that lap - they seem to have "no lap n" at all, and only
    // reappear a lap "late" in lap n + 1's list, one lap behind for the rest of the race even though he never really fell behind the
    // group's pace. Only a rider who is really behind (has no lap n of his own yet at this moment) falls back to the time window, so a
    // genuinely lapped rider still counts for the result with his own, lower number of laps, exactly as before (see the tests).
    const crossedIn = n => {
        const from = firstOf(n) ?? timeOfLap(n);
        const to = n >= leaderCount ? Infinity : (firstOf(n + 1) ?? timeOfLap(n + 1));
        return inRace.map(r => {
            // The finish lap, once the race is finished: everybody's result is his crossing at the moment the finish closed (above),
            // not necessarily his own lap n - a rider one lap behind still counts, with his own, lower number of laps, but only when he
            // was still that close within the same window: a crossing well before the winner's finish is not really part of this
            // finish either (he had, by then, already fallen far enough behind in time that his next lap is not a photo finish, just a
            // lap that happened to be one short). A rider more than one lap behind, or too far outside the window, is genuinely lapped,
            // not part of this result (see pending below).
            if (n >= leaderCount && finished) {
                const at = atClose(r);
                const inWindow = leaderCount - at.lapNo <= 1 && at.endMs >= winnerFinishAt - MARATHON_FINISH_GRACE_MS;
                return inWindow ? { rider: r, at } : { rider: r, at: null };
            }
            const own = r.byLap.get(n);
            if (own) return { rider: r, at: own };
            return { rider: r, at: r.crossings.find(c => c.endMs >= from && c.endMs < to) };
        }).filter(c => c.at)
            .sort((x, y) => y.at.lapNo - x.at.lapNo || x.at.endMs - y.at.endMs);
    };
    const crossed = crossedIn(lapNr);
    const rows = crossed.map((c, i) => ({
        place: i + 1, id: c.rider.id, label: c.rider.label, laps: c.at.lapNo, endMs: c.at.endMs, gapMs: c.at.endMs - firstAt,
        distanceM: ((c.at.endMs - firstAt) * trackLengthM) / Math.min(c.at.lapMs, MARATHON_MISSED * usual), lapMs: c.at.lapMs, segmentMs: c.at.endMs - startMs
    }));

    const listed = new Set(rows.map(r => r.id));
    // A rider one lap behind still counts as "coming" (still racing, could cross any moment) as long as the race is not finished yet.
    // Once it is finished, crossedIn above has already moved everyone whose crossing at the moment the finish closed was one lap behind
    // or better into rows (with his own, lower number of laps); anyone one lap behind still left here really is too far behind to be
    // part of the finish, so he is "lapped" straight away, not after some further wait. His laps and last crossing are his state at the
    // moment the finish closed too, once the race is finished - a later real crossing of his does not change his result any more.
    const pending = !latest ? [] : inRace.filter(r => !listed.has(r.id))
        .map(r => {
            const at = atClose(r);
            const behind = lapNr - at.lapNo;
            return { id: r.id, label: r.label, laps: at.lapNo, behind, status: behind === 1 && !finished ? 'coming' : 'lapped', lastEndMs: at.endMs };
        })
        .sort((x, y) => y.laps - x.laps || x.lastEndMs - y.lastEndMs);
    // the place of one rider in the list of every lap (for the graph): [{ lapNr, place, endMs, riders (in that list) }]
    const placesOf = id => {
        const places = [];
        for (let n = 1; n <= leaderCount; n++) {
            const list = crossedIn(n);
            const i = list.findIndex(c => c.rider.id === id);
            if (i >= 0) places.push({ lapNr: n, place: i + 1, endMs: list[i].at.endMs, riders: list.length });
        }
        return places;
    };
    return { lapNr, startMs, autoStartMs, firstMs, lastMs, finishMs: firstAt, leaderCount, latest, finished, first: rows.length ? { id: rows[0].id, label: rows[0].label } : null, rows, pending, placesOf };
}

if (typeof module !== 'undefined') {
    module.exports = { marathonRaceStart, marathonDetect, marathonTrackLaps, marathonCrossings, marathonStandings, MARATHON_ESTIMATE_OPTIONS, MARATHON_SHOWN_OPTIONS };
}
