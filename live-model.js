/**
 * The live picture of a rink: who is on the ice right now, how fast they go, and where on the track they probably are.
 * Depends on replay-model.js (normalizeLaps, MIN_SKATING_KPH) and replay-track.js.
 *
 * MYLAPS only tells us about a rider at the moment he crosses the finish line. Between two crossings his position is
 * an estimate: the time since his last crossing, divided by the time his last lap took.
 *
 * marathon-model.js (the list per lap of a race) builds on this file: it uses LIVE_WINDOW_MS, and its riders are shown with
 * riderLive/liveShownStep too, just with its own MARATHON_ESTIMATE_OPTIONS/MARATHON_SHOWN_OPTIONS.
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
function liveShownStep(pos, target, paceMs, dtS, options = {}) {
    const { catchUp = 0.4, minCatchUpS = 3, minSpeed = 0.4, maxSpeed = 2 } = options;
    const lapS = paceMs ? paceMs / 1000 : 30;
    const usual = 1 / lapS;
    const speed = Math.min(maxSpeed * usual, Math.max(minSpeed * usual, usual + (target - pos) / Math.max(catchUp * lapS, minCatchUpS)));
    return pos + speed * dtS;
}

/**
 * What the page shows for one rider. `laps` are normalized laps ([{nr, startMs, durMs}]) or null when not loaded yet.
 * startMs and durationMs are those of the activity: when the rider started, and how long he has been at it (up to now
 * while he is on the ice, otherwise up to his last crossing).
 */
function riderLive(activity, laps, nowMs, trackLengthM = 400, options = {}) {
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
        // the estimate: normally from his pace over the last laps, with the rule for a rider who is slowing down; in a marathon (options) from
        // his last lap and without that rule (measured on the marathon of 11/03/2026: about 25 % less error)
        const estimatePace = options.fromLastLap ? last.durMs : paceMs;
        const into = liveFraction(sinceMs, estimatePace, last.durMs, options.slowingRule === false || !previous ? null : previous.durMs);
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

/**
 * Where on the track a rider is at a moment when the whole activity is known (a replay): between two crossings he is exactly as far as
 * the time since the last crossing is a share of the real time of the lap, so nothing has to be predicted from his pace.
 * @param {Array} laps    normalized laps of the whole activity
 * @param {number} nowMs  the moment
 * @param {number} trackLengthM
 * @returns {number|null} 0 to 1, or null when he is not in a lap of skating at that moment (before the first lap, after the last, or in a break)
 */
function knownFraction(laps, nowMs, trackLengthM = 400) {
    if (!laps || laps.length === 0) return null;
    const lap = laps.find(l => l.startMs <= nowMs && nowMs < l.startMs + l.durMs);
    if (!lap || !isSkatingLapMs(lap, trackLengthM)) return null;
    return (nowMs - lap.startMs) / lap.durMs;
}

if (typeof module !== 'undefined') {
    module.exports = { liveCandidates, riderLive, sortLiveRiders, liveInitials, lapsFetchDue, knownFraction, liveFraction, liveShownStep, liveNiceTicks, liveShowAllMax, liveLapWindow, LIVE_WINDOW_MS, LIVE_ACTIVE_MS };
}
