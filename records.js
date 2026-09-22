/**
 * Personal records across every session that is remembered locally (history-store.js): the fastest lap ever, the
 * fastest lap per ice-skating season, and a timeline of the best lap of every session (for a "getting faster?"
 * chart). Excluded sessions and excluded laps (history-store.js) never count. Depends on replay-model.js
 * (MIN_SKATING_KPH).
 */

// The same rule as isSkatingLapMs in live-model.js: a lap slower than this (for the length of the track) is not a
// real skating lap (a break, someone walking off the ice, ...) and never counts towards a personal record.
const recordsIsSkatingLap = (lap, trackLengthM) => (trackLengthM / (lap.durMs / 1000)) * 3.6 >= MIN_SKATING_KPH;

// A season's "fast laps" are its fastest share of that season's own skating laps (at least one), for the "Fast
// laps per season" chart: every season is judged against itself, not against a rider's best season ever.
const RECORDS_FAST_LAP_SHARE = 0.2;

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
 *                     fastLapsPerSeason }
 *   best: { durMs, nr, sessionId, startTime, locationName } of the fastest lap ever, or null
 *   perSeason: [{ season, startYear, durMs, sessionId, startTime }], newest season first. A session in the
 *     May-August off-season does not add a row (but its laps still count towards "best" and the totals).
 *   timeline: [{ sessionId, startTime, durMs }] the best lap of every session that has one, oldest first
 *   fastLapsPerSeason: [{ season, startYear, totalLaps, fastCount, thresholdMs, avgFastMs }], oldest season first
 *   (for a trend chart). The "fast" laps of a season are its fastest 20 % (at least one), found separately for
 *   every season: a slow season and a fast season each get their own threshold, so the count and the average say
 *   how a rider did relative to himself that season, not to his best season ever.
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
            timeline.push({ sessionId: session.id, startTime: session.startTime, durMs: sessionBest.durMs });
            if (season) {
                const record = perSeason.get(season.label);
                if (!record || sessionBest.durMs < record.durMs) {
                    perSeason.set(season.label, { season: season.label, startYear: season.startYear, durMs: sessionBest.durMs, sessionId: session.id, startTime: session.startTime });
                }
            }
        }
    });
    timeline.sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime));

    const fastLapsPerSeason = [...lapsBySeason.entries()].map(([label, { startYear, durations }]) => {
        const sorted = durations.slice().sort((a, b) => a - b);
        const fastCount = Math.max(1, Math.round(sorted.length * RECORDS_FAST_LAP_SHARE));
        const fast = sorted.slice(0, fastCount);
        return {
            season: label, startYear, totalLaps: sorted.length, fastCount,
            thresholdMs: fast[fast.length - 1],
            avgFastMs: fast.reduce((sum, ms) => sum + ms, 0) / fast.length
        };
    }).sort((a, b) => a.startYear - b.startYear);

    return {
        sessionCount: included.length,
        lapCount, skatingLapCount, distanceKm, activeMs, best,
        perSeason: [...perSeason.values()].sort((a, b) => b.startYear - a.startYear),
        timeline, fastLapsPerSeason
    };
}

if (typeof module !== 'undefined') {
    module.exports = { computePersonalRecords, recordsIsSkatingLap, seasonOf };
}
