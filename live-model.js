/**
 * The live picture of a rink: who is on the ice right now, how fast they go, and where on the track they probably are.
 * Depends on replay-model.js (normalizeLaps, MIN_SKATING_KPH) and replay-track.js.
 *
 * MYLAPS only tells us about a rider at the moment he crosses the finish line. Between two crossings his position is
 * an estimate: the time since his last crossing, divided by the time his last lap took.
 */

// Somebody whose last finish crossing is 15 minutes ago or more is no longer in the list at all.
const LIVE_WINDOW_MS = 15 * 60 * 1000;
// A rider is "on the ice" while his last crossing is less than 2 minutes ago: a lap that takes longer sends him to "Recently on the ice".
const LIVE_ACTIVE_MS = 2 * 60 * 1000;

const isSkatingLapMs = (lap, trackLengthM) => (trackLengthM / (lap.durMs / 1000)) * 3.6 >= MIN_SKATING_KPH;

/** The activities of a rink that may be on the ice: not ended yet, or ended within the window. */
function liveCandidates(activities, nowMs, windowMs = LIVE_WINDOW_MS) {
    return (activities || []).filter(activity => {
        const start = Date.parse(activity.startTime);
        if (!Number.isFinite(start) || start > nowMs + 60000) return false;          // (a clock a little off is fine)
        if (!activity.endTime) return true;                                            // no end yet: still running
        const end = Date.parse(activity.endTime);
        return Number.isFinite(end) && nowMs - end <= windowMs;
    });
}

/**
 * How far into the current lap a rider is, from the time since his last crossing. The laps arrive a few seconds after the
 * crossing, so the estimate never waits at the line:
 *  - a rider who is not getting slower keeps going at the usual lap time (paceMs), past the line into the next lap (the result
 *    is then above 1: it is the number of laps since the last known crossing);
 *  - a rider who was slower in his last lap than in the one before is still in the current lap (else it would be in already):
 *    that lap is expected to take longer by the same difference (lastMs + (lastMs - previousMs)), and when even that time has
 *    passed the dot slows down further and creeps towards the line without reaching it.
 */
function liveFraction(sinceMs, paceMs, lastMs, previousMs) {
    const slowing = previousMs !== null && previousMs !== undefined && lastMs > previousMs;
    if (!slowing) return paceMs ? sinceMs / paceMs : 0;
    const expectedMs = lastMs + (lastMs - previousMs);
    const share = sinceMs / expectedMs;
    const KNEE = 0.9;                                  // from here on the dot slows down, smoothly, towards 0.99
    return share <= KNEE ? share : KNEE + (0.99 - KNEE) * (1 - Math.exp(-(share - KNEE) / (0.99 - KNEE)));
}

/**
 * One step of the dot that is shown: from position pos (laps, going up all the time) it moves dtS seconds towards the estimated
 * position target. It runs at the usual speed of the rider (1 lap per paceMs), a little faster or slower to close in on the
 * target: a difference, for example when a real lap arrives, is worked away during the coming lap. The speed stays between 40 %
 * and 200 % of the usual one, so the dot never stops (at the finish line or anywhere) and never jumps.
 */
function liveShownStep(pos, target, paceMs, dtS) {
    const lapS = paceMs ? paceMs / 1000 : 30;
    const usual = 1 / lapS;
    const speed = Math.min(2 * usual, Math.max(0.4 * usual, usual + (target - pos) / Math.max(0.4 * lapS, 3)));
    return pos + speed * dtS;
}

/**
 * What the page shows for one rider. `laps` are normalized laps ([{nr, startMs, durMs}]) or null when not loaded yet.
 * startMs and durationMs are those of the activity: when the rider started, and how long he has been at it (up to now
 * while he is on the ice, otherwise up to his last crossing).
 */
function riderLive(activity, laps, nowMs, trackLengthM = 400) {
    const label = (activity.chipLabel || '').trim() || activity.chipCode;
    const startMs = Date.parse(activity.startTime);
    const listEndMs = activity.endTime ? Date.parse(activity.endTime) : NaN;
    const base = {
        id: activity.id, chipCode: activity.chipCode, label, startMs: Number.isFinite(startMs) ? startMs : null, durationMs: null,
        lapCount: 0, lastLap: null, lastMs: null, bestMs: null, bestNr: null, paceMs: null, sinceMs: null, frac: null, progress: null
    };
    const durationUntil = endMs => (base.startMs === null ? null : Math.max(0, endMs - base.startMs));

    if (!laps || laps.length === 0) {
        // nothing crossed yet: waiting for the first lap, for two minutes at most
        const waiting = base.startMs === null || nowMs - base.startMs <= LIVE_ACTIVE_MS;
        return { ...base, status: waiting ? 'waiting' : 'resting', durationMs: durationUntil(waiting ? nowMs : (Number.isFinite(listEndMs) ? listEndMs : base.startMs)) };
    }

    const skating = laps.filter(lap => isSkatingLapMs(lap, trackLengthM));
    const last = laps[laps.length - 1];
    const lastEndMs = last.startMs + last.durMs;
    const best = skating.reduce((a, b) => (!a || b.durMs < a.durMs ? b : a), null);
    const recent = skating.slice(-3);
    const paceMs = recent.length ? recent.reduce((sum, lap) => sum + lap.durMs, 0) / recent.length : null;
    const sinceMs = Math.max(0, nowMs - lastEndMs);
    const result = {
        ...base,
        lapCount: skating.length,
        lastLap: { nr: last.nr, durMs: last.durMs, endMs: lastEndMs },
        lastMs: isSkatingLapMs(last, trackLengthM) ? last.durMs : null,
        bestMs: best ? best.durMs : null,
        bestNr: best ? best.nr : null,
        paceMs,
        sinceMs
    };

    if (isSkatingLapMs(last, trackLengthM) && sinceMs <= LIVE_ACTIVE_MS) {
        const previous = skating.length >= 2 ? skating[skating.length - 2] : null;
        const into = liveFraction(sinceMs, paceMs, last.durMs, previous ? previous.durMs : null);
        // frac: where on the track (0..1); progress: laps since the first known crossing, never going back, which the page uses to
        // move the dot smoothly (see the track in live.js)
        return { ...result, status: 'skating', durationMs: durationUntil(nowMs), frac: into % 1, progress: laps.length + into };
    }
    return { ...result, status: sinceMs > LIVE_WINDOW_MS ? 'left' : 'resting', durationMs: durationUntil(Math.max(lastEndMs, Number.isFinite(listEndMs) ? listEndMs : 0)) };
}

// Ask for the laps of a rider on the ice at least this often, whatever else happens.
const LIVE_SAFETY_REFRESH_MS = 30 * 1000;
// A rider who is resting is looked at now and then, in case he starts again.
const LIVE_RESTING_REFRESH_MS = 20 * 1000;
// Someone whose first lap has not come yet is asked again this often.
const LIVE_WAITING_REFRESH_MS = 3 * 1000;
// A lap is in the API about 2 to 4 seconds after it ended (measured at Twente), so asking at the moment of the expected
// crossing is too early: ask a second after it, then again and again (less and less often) until the new lap is there.
const LIVE_DUE_AFTER_MS = 1000;
const LIVE_RETRY_MIN_MS = 1500;
const LIVE_RETRY_MAX_MS = 8000;

/**
 * Is it time to ask for the laps of this rider again? Asking for everybody every second would be far too many requests,
 * so a rider on the ice is asked when his next finish crossing is expected (the time of his last crossing plus his usual
 * lap time), and after that again and again until the new lap has arrived.
 * @param {object} state           riderLive() of the rider
 * @param {number} nowMs
 * @param {number} fetchedAt       when his laps were asked for last (0 = never)
 * @param {boolean} [activityChanged] the activity in the list of the rink changed since (its end time moved)
 */
function lapsFetchDue(state, nowMs, fetchedAt, activityChanged = false) {
    if (activityChanged) return true;
    const sinceFetch = nowMs - fetchedAt;
    if (state.status === 'waiting') return sinceFetch >= LIVE_WAITING_REFRESH_MS;
    if (state.status === 'skating' && state.lastLap) {
        // the next lap is expected to take as long as the last one or as the recent average, whichever is shorter (riders speed up)
        const expectedMs = Math.min(state.lastLap.durMs, state.paceMs || state.lastLap.durMs);
        const dueAt = state.lastLap.endMs + expectedMs + LIVE_DUE_AFTER_MS;
        if (nowMs < dueAt) return sinceFetch >= LIVE_SAFETY_REFRESH_MS;
        const overdue = nowMs - dueAt;
        return sinceFetch >= Math.min(LIVE_RETRY_MAX_MS, Math.max(LIVE_RETRY_MIN_MS, overdue / 3));
    }
    if (state.status === 'resting') return sinceFetch >= LIVE_RESTING_REFRESH_MS;
    return false;
}

/** Round tick values (seconds) that cover [min, max] with about 4 or 5 gridlines. */
function liveNiceTicks(min, max) {
    const steps = [0.5, 1, 2, 5, 10, 15, 20, 30, 60, 120, 300];
    const step = steps.find(s => (max - min) / s <= 5) || 300;
    const first = Math.max(0, Math.floor(min / step) * step);
    const last = Math.max(first + step, Math.ceil(max / step) * step);
    const ticks = [];
    for (let value = first; value <= last + 1e-9; value += step) ticks.push(value);
    return ticks;
}

/** The maximum lap time (seconds) with which every skating lap of the rider is in view: the slowest one plus a second. */
function liveShowAllMax(laps, trackLengthM = 400) {
    const seconds = (laps || []).filter(lap => isSkatingLapMs(lap, trackLengthM)).map(lap => lap.durMs / 1000);
    return seconds.length ? Math.ceil(Math.max(...seconds)) + 1 : 60;
}

/**
 * What the lap graph draws for a rider: the laps in view (skating and faster than maxSeconds), the greyed-out ones (slower, or a
 * break), and the window of the vertical axis: from the fastest lap in view up to the maximum, on round numbers.
 */
function liveLapWindow(laps, maxSeconds, trackLengthM = 400) {
    const fast = [];
    const slow = [];
    (laps || []).forEach(lap => (isSkatingLapMs(lap, trackLengthM) && lap.durMs / 1000 < maxSeconds ? fast : slow).push(lap));
    const lowSeconds = fast.length ? Math.min(...fast.map(lap => lap.durMs / 1000)) : Math.max(0, maxSeconds - 10);
    const ticks = liveNiceTicks(lowSeconds, maxSeconds);
    return { fast, slow, ticks, yMin: ticks[0], yMax: ticks[ticks.length - 1] };
}

/** Order of the riders in the list: 'best' = fastest lap first (riders without a lap last), 'recent' = crossed the line most recently first. */
function sortLiveRiders(riders, mode = 'best') {
    const byBest = (a, b) => (a.bestMs === null) - (b.bestMs === null) || (a.bestMs - b.bestMs) || a.label.localeCompare(b.label);
    const byRecent = (a, b) => (a.sinceMs === null) - (b.sinceMs === null) || (a.sinceMs - b.sinceMs) || a.label.localeCompare(b.label);
    return [...riders].sort(mode === 'recent' ? byRecent : byBest);
}

/** Initials for the dot on the track: two letters of the name, or the two letters of the transponder code. */
function liveInitials(rider) {
    const words = rider.label.split(/[\s-]+/).filter(Boolean);
    if (rider.label === rider.chipCode || words.length === 0) return (rider.chipCode || '?').slice(0, 2).toUpperCase();
    return words.slice(0, 2).map(word => word[0].toUpperCase()).join('');
}

// ---------- Marathon mode ----------
// A group of about 50 riders crosses the finish line more or less together. Every lap gives a new list: the order in which the riders
// crossed the line, with the time and the distance to the first rider (the one who crossed first).

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
// more times: it counts as the laps the group did in that time.
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

// The riders are selected from this long before the start time: what they are doing then is their first lap.
const MARATHON_BEFORE_START_MS = 20 * 1000;

/**
 * The list of a lap of the race. The race starts at an absolute START TIME (for example 21:00:00). From 20 seconds before it all riders
 * are selected: the lap a rider is in then (his first crossing from that moment) is his lap 1 and every next crossing is the next lap.
 * Everything before is not part of the race (the warming up, the minutes of waiting for the start), and everything is measured from the
 * start time (the time of the laps, the gaps). So a rider who is lapped has one lap fewer than the group, and a rider who started late
 * has fewer laps too. Only when the timing mat missed a rider during the race (one long lap, at least 1.7 times his usual lap time, of a
 * rider who was skating with the group) the laps are counted from the time: the laps the group did in that time (the group's laps are
 * numbered by the first rider of every lap, from the real time of the crossings).
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
        let count = 0;
        r.crossings.forEach(c => {
            const missed = c.durMs >= MARATHON_MISSED * own && c.durMs >= MARATHON_MISSED * usual;
            count = missed ? Math.max(count + 1, groupLapAt(c.endMs) - firstBoundary) : count + 1;
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
    // the riders who came in during lap n, in the order of the list: most laps first, then the time of crossing
    const crossedIn = n => {
        const from = firstOf(n) ?? timeOfLap(n);
        const to = n >= leaderCount ? Infinity : (firstOf(n + 1) ?? timeOfLap(n + 1));
        return inRace.map(r => ({ rider: r, at: r.crossings.find(c => c.endMs >= from && c.endMs < to) })).filter(c => c.at)
            .sort((x, y) => y.at.lapNo - x.at.lapNo || x.at.endMs - y.at.endMs);
    };
    const crossed = crossedIn(lapNr);
    const rows = crossed.map((c, i) => ({
        place: i + 1, id: c.rider.id, label: c.rider.label, laps: c.at.lapNo, endMs: c.at.endMs, gapMs: c.at.endMs - firstAt,
        distanceM: ((c.at.endMs - firstAt) * trackLengthM) / Math.min(c.at.lapMs, MARATHON_MISSED * usual), lapMs: c.at.lapMs, segmentMs: c.at.endMs - startMs
    }));

    const listed = new Set(rows.map(r => r.id));
    const pending = !latest ? [] : inRace.filter(r => !listed.has(r.id))
        .map(r => {
            const behind = lapNr - r.lastLap;
            return { id: r.id, label: r.label, laps: r.lastLap, behind, status: behind === 1 && !finished ? 'coming' : 'lapped', lastEndMs: r.byLap.get(r.lastLap).endMs };
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
    module.exports = { liveCandidates, riderLive, sortLiveRiders, liveInitials, lapsFetchDue, marathonTrackLaps, marathonCrossings, marathonStandings, liveFraction, liveShownStep, liveNiceTicks, liveShowAllMax, liveLapWindow, LIVE_WINDOW_MS, LIVE_ACTIVE_MS };
}
