/**
 * Personal records across every session that is remembered locally (history-store.js): the fastest lap ever, the
 * fastest lap per ice-skating season, and a timeline of the best lap of every session (for a "getting faster?"
 * chart). Excluded sessions and excluded laps (history-store.js) never count. Depends on replay-model.js
 * (MIN_SKATING_KPH).
 */

// The same rule as isSkatingLapMs in live-model.js: a lap slower than this (for the length of the track) is not a
// real skating lap (a break, someone walking off the ice, ...) and never counts towards a personal record.
const recordsIsSkatingLap = (lap, trackLengthM) => (trackLengthM / (lap.durMs / 1000)) * 3.6 >= MIN_SKATING_KPH;

// "Fast" is one fixed pace bar for the "Fast laps per season" chart: the fastest RECORDS_FAST_LAP_SHARE of every
// skating lap across every season combined, not recomputed separately per season. A per-season threshold would
// always end up passing roughly this same share of that season's own laps no matter how the season actually went,
// which hides real differences in effort between seasons; one shared bar lets a season that genuinely skated a lot
// more fast laps show a visibly bigger count instead.
const RECORDS_FAST_LAP_SHARE = 0.2;

// The "Best lap over time" chart would get crowded with one point per session, especially for a season with many
// of them: it keeps only that season's own fastest share of its session-best laps (at least one), capped so even a
// very busy season shows no more than this many points.
const RECORDS_TIMELINE_SHARE = 0.05;
const RECORDS_TIMELINE_MAX_PER_BUCKET = 10;

/**
 * Which ice-skating season a date falls in. A season runs from September through April and spans the turn of the
 * calendar year, so it is named after both years it touches: 3 March 2026 and 20 November 2026 are both season
 * "25/26" and "26/27" respectively. May through August is the off-season and belongs to no season.
 * @returns {{ startYear: number, label: string }|null} startYear is the calendar year the season started in
 *   (so it sorts correctly), label is the short form ("25/26"); null in the May-August off-season.
 */
function seasonOf(dateMs) {
    const date = new Date(dateMs);
    const month = date.getMonth() + 1;                 // 1-12
    const year = date.getFullYear();
    let startYear;
    if (month >= 9) startYear = year;                  // Sep-Dec: the season started this calendar year
    else if (month <= 4) startYear = year - 1;          // Jan-Apr: the season started last calendar year
    else return null;                                   // May-Aug: no season
    return { startYear, label: `${String(startYear).slice(-2)}/${String((startYear + 1) % 100).padStart(2, '0')}` };
}

/**
 * @param {Array} sessions  as historySessions() returns them: [{ id, startTime, locationName, trackLengthM, laps,
 *                          excluded, excludedLaps }]
 * @returns {object} { sessionCount, lapCount, skatingLapCount, distanceKm, activeMs, best, perSeason, timeline,
 *                     fastLapsPerSeason, fastLapThresholdMs }
 *   best: { durMs, nr, sessionId, startTime, locationName } of the fastest lap ever, or null
 *   perSeason: [{ season, startYear, durMs, sessionId, startTime }], newest season first. A session in the
 *     May-August off-season does not add a row (but its laps still count towards "best" and the totals).
 *   timeline: [{ sessionId, startTime, durMs }], oldest first: not every session with a best lap, but only the
 *     fastest RECORDS_TIMELINE_SHARE of each season's (at least one, at most RECORDS_TIMELINE_MAX_PER_BUCKET),
 *     so a season with many sessions does not crowd out the trend on the "Best lap over time" chart.
 *   fastLapsPerSeason: [{ season, startYear, totalLaps, fastCount, avgFastMs }], oldest season first (for a trend
 *   chart). "Fast" here is judged against one fixed pace bar shared by every season (fastLapThresholdMs: the
 *   fastest RECORDS_FAST_LAP_SHARE of every skating lap in the whole history), not a threshold recomputed per
 *   season - so fastCount genuinely reflects how much fast skating that season had, and can be far more (or far
 *   less) than RECORDS_FAST_LAP_SHARE of that season's own laps. avgFastMs is null for a season with no laps under
 *   the bar at all.
 *   fastLapThresholdMs: the one shared pace bar above, or null when there are no skating laps to derive it from.
 */
function computePersonalRecords(sessions) {
    const included = (sessions || []).filter(session => !session.excluded);
    let best = null;
    let lapCount = 0;
    let skatingLapCount = 0;
    let distanceKm = 0;
    let activeMs = 0;
    const perSeason = new Map();                        // season label -> { season, startYear, durMs, sessionId, startTime }
    const timeline = [];
    const lapsBySeason = new Map();                      // season label -> { startYear, durations: durMs[] }

    included.forEach(session => {
        const trackLengthM = session.trackLengthM || 400;
        const excludedLaps = new Set(session.excludedLaps || []);
        const laps = (session.laps || []).filter(lap => !excludedLaps.has(lap.nr));
        lapCount += laps.length;
        const season = seasonOf(Date.parse(session.startTime));     // null in the off-season (May-Aug)
        let sessionBest = null;
        laps.forEach(lap => {
            if (!recordsIsSkatingLap(lap, trackLengthM)) return;
            skatingLapCount++;
            distanceKm += trackLengthM / 1000;
            activeMs += lap.durMs;
            if (season) {
                if (!lapsBySeason.has(season.label)) lapsBySeason.set(season.label, { startYear: season.startYear, durations: [] });
                lapsBySeason.get(season.label).durations.push(lap.durMs);
            }
            if (!sessionBest || lap.durMs < sessionBest.durMs) sessionBest = { durMs: lap.durMs, nr: lap.nr };
            if (!best || lap.durMs < best.durMs) {
                best = { durMs: lap.durMs, nr: lap.nr, sessionId: session.id, startTime: session.startTime, locationName: session.locationName };
            }
        });
        if (sessionBest) {
            // Off-season sessions (no season of their own) are bucketed by calendar year instead, just so the
            // thinning below still has a sensible group to work with; everything else about them is unaffected.
            const bucket = season ? season.label : `off-${new Date(Date.parse(session.startTime)).getFullYear()}`;
            timeline.push({ sessionId: session.id, startTime: session.startTime, durMs: sessionBest.durMs, bucket });
            if (season) {
                const record = perSeason.get(season.label);
                if (!record || sessionBest.durMs < record.durMs) {
                    perSeason.set(season.label, { season: season.label, startYear: season.startYear, durMs: sessionBest.durMs, sessionId: session.id, startTime: session.startTime });
                }
            }
        }
    });

    const byBucket = new Map();
    timeline.forEach(point => {
        if (!byBucket.has(point.bucket)) byBucket.set(point.bucket, []);
        byBucket.get(point.bucket).push(point);
    });
    const thinnedTimeline = [...byBucket.values()].flatMap(points => {
        const keep = Math.min(RECORDS_TIMELINE_MAX_PER_BUCKET, Math.max(1, Math.round(points.length * RECORDS_TIMELINE_SHARE)));
        return points.slice().sort((a, b) => a.durMs - b.durMs).slice(0, keep);
    }).map(({ bucket, ...point }) => point);   // "bucket" was only needed for the thinning above
    thinnedTimeline.sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime));

    const mean = list => list.reduce((sum, ms) => sum + ms, 0) / list.length;

    // One fixed pace bar for every season: the fastest RECORDS_FAST_LAP_SHARE of every skating lap in the whole
    // history, found once, up front - not a threshold recomputed separately per season.
    const allDurations = [...lapsBySeason.values()].flatMap(entry => entry.durations).sort((a, b) => a - b);
    const globalFastCount = allDurations.length ? Math.max(1, Math.round(allDurations.length * RECORDS_FAST_LAP_SHARE)) : 0;
    const fastLapThresholdMs = globalFastCount ? allDurations[globalFastCount - 1] : null;

    const fastLapsPerSeason = [...lapsBySeason.entries()].map(([label, { startYear, durations }]) => {
        const fast = fastLapThresholdMs === null ? [] : durations.filter(ms => ms <= fastLapThresholdMs);
        return {
            season: label, startYear, totalLaps: durations.length,
            fastCount: fast.length,
            avgFastMs: fast.length ? mean(fast) : null
        };
    }).sort((a, b) => a.startYear - b.startYear);

    return {
        sessionCount: included.length,
        lapCount, skatingLapCount, distanceKm, activeMs, best,
        perSeason: [...perSeason.values()].sort((a, b) => b.startYear - a.startYear),
        timeline: thinnedTimeline, fastLapsPerSeason, fastLapThresholdMs
    };
}

/**
 * Distinct ice-skating seasons found among the (non-excluded) sessions, newest first - for example to offer as
 * "compare to" choices, or to pick the most recent one as "the current season" (the data itself is a more useful
 * and deterministic notion of "current" than today's calendar date: a device whose owner has not skated yet this
 * season would otherwise default to an empty view).
 * @returns {Array<{ label: string, startYear: number }>}
 */
function seasonsPresent(sessions) {
    const seen = new Map();
    (sessions || []).filter(session => !session.excluded).forEach(session => {
        const season = seasonOf(Date.parse(session.startTime));
        if (season && !seen.has(season.label)) seen.set(season.label, season);
    });
    return [...seen.values()].sort((a, b) => b.startYear - a.startYear);
}

function sessionsInSeason(sessions, startYear) {
    return (sessions || []).filter(session => {
        if (session.excluded) return false;
        const season = seasonOf(Date.parse(session.startTime));
        return season && season.startYear === startYear;
    });
}

/**
 * One season's sessions, oldest first, each with how much it added to the season so far - for a "how is this
 * season building up" trend chart. Only sessions whose seasonOf(...) matches startYear are included; other
 * seasons and excluded sessions/laps are left out, the same way computePersonalRecords filters them.
 * @param {Array} sessions        as historySessions() returns them
 * @param {number} startYear      the season's startYear (seasonOf(...).startYear), e.g. 2025 for "25/26"
 * @param {number|null} fastLapThresholdMs  the shared pace bar (computePersonalRecords' fastLapThresholdMs), so
 *   "fast" means the same thing here as on "Fast laps per season"
 * @returns {Array<{ sessionId, startTime, dayOfSeason, distanceKm, cumulativeDistanceKm, lapDurationsMs, fastCount, totalLaps }>}
 *   dayOfSeason: days since 1 September of startYear (0 = that day itself), in local time (matching seasonOf's
 *   own local-time month/year handling) - the x-axis a chart can line up two different seasons on.
 *   lapDurationsMs: that session's skating lap times, sorted fastest first (feeds lapTimeStat, for whichever lap
 *   time metric a chart chooses to show).
 */
function seasonBreakdown(sessions, startYear, fastLapThresholdMs) {
    const seasonStart = new Date(startYear, 8, 1).getTime();          // 1 September, local time
    const included = sessionsInSeason(sessions, startYear);
    included.sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime));

    let cumulativeDistanceKm = 0;
    return included.map(session => {
        const trackLengthM = session.trackLengthM || 400;
        const excludedLaps = new Set(session.excludedLaps || []);
        const laps = (session.laps || [])
            .filter(lap => !excludedLaps.has(lap.nr))
            .filter(lap => recordsIsSkatingLap(lap, trackLengthM));
        const distanceKm = laps.length * trackLengthM / 1000;
        cumulativeDistanceKm += distanceKm;
        const lapDurationsMs = laps.map(lap => lap.durMs).sort((a, b) => a - b);
        const fastCount = fastLapThresholdMs === null ? 0 : laps.filter(lap => lap.durMs <= fastLapThresholdMs).length;
        const dayOfSeason = Math.round((Date.parse(session.startTime) - seasonStart) / 86400000);
        return {
            sessionId: session.id, startTime: session.startTime, dayOfSeason,
            distanceKm, cumulativeDistanceKm, lapDurationsMs, fastCount, totalLaps: laps.length
        };
    });
}

/**
 * The lap time metrics the "Fastest laps" chart on the Season dashboard lets you pick between, in menu order.
 * `n` is how many of a session's fastest laps to average (lapTimeStat); `n: 0` means every lap (the session's
 * own average), not just its fastest ones.
 */
const LAP_TIME_METRICS = [
    { key: 'avg', label: 'Average lap time', n: 0 },
    { key: 'fastest-1', label: 'Fastest lap', n: 1 },
    { key: 'fastest-2', label: 'Fastest-2', n: 2 },
    { key: 'fastest-5', label: 'Fastest-5', n: 5 },
    { key: 'fastest-10', label: 'Fastest-10', n: 10 },
    { key: 'fastest-20', label: 'Fastest-20', n: 20 },
    { key: 'fastest-50', label: 'Fastest-50', n: 50 }
];

/**
 * The average lap time (ms) of a session's `n` fastest laps, or every lap when `n` is 0 (falsy) - for example
 * to turn `seasonBreakdown`'s `lapDurationsMs` into whichever LAP_TIME_METRICS entry a chart wants to show.
 * A session with fewer than `n` laps averages however many it has. Null when it has none at all.
 * @param {number[]} sortedAscendingMs  a session's lap times, fastest first (seasonBreakdown's lapDurationsMs)
 */
function lapTimeStat(sortedAscendingMs, n) {
    if (!sortedAscendingMs || sortedAscendingMs.length === 0) return null;
    const slice = n ? sortedAscendingMs.slice(0, n) : sortedAscendingMs;
    return slice.reduce((sum, ms) => sum + ms, 0) / slice.length;
}

/**
 * Every skating lap time of one season, in seconds, across all its sessions - for a "how are my lap times
 * distributed this season" chart. Same session/lap filtering as seasonBreakdown (excluded sessions/laps left
 * out, only real skating laps count); unordered.
 * @returns {number[]}
 */
function seasonLapTimes(sessions, startYear) {
    const times = [];
    sessionsInSeason(sessions, startYear).forEach(session => {
        const trackLengthM = session.trackLengthM || 400;
        const excludedLaps = new Set(session.excludedLaps || []);
        (session.laps || [])
            .filter(lap => !excludedLaps.has(lap.nr))
            .filter(lap => recordsIsSkatingLap(lap, trackLengthM))
            .forEach(lap => times.push(lap.durMs / 1000));
    });
    return times;
}

if (typeof module !== 'undefined') {
    module.exports = {
        computePersonalRecords, recordsIsSkatingLap, seasonOf, seasonsPresent, seasonBreakdown, seasonLapTimes,
        LAP_TIME_METRICS, lapTimeStat
    };
}
