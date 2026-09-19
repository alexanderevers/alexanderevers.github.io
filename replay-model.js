/**
 * Lap data -> rider position over time, for the replay page.
 * A lap starts when the rider crosses the finish line, so within a lap the position is
 * interpolated evenly: fraction = (t - lapStart) / lapDuration.
 * Depends on parseDurationToSeconds from utils.js.
 */

// Small gaps between two laps (a missed detection, a rounding difference) keep the rider at the finish line.
const LAP_GAP_TOLERANCE_MS = 5000;

// Real sessions contain "laps" of 5-10 minutes: the rider stepped off the ice or stopped. Below this
// average speed a lap is treated as a break, so nobody crawls around the track for minutes.
const MIN_SKATING_KPH = 8;

/** Flatten the sessions of a laps response into [{nr, startMs, durMs}] sorted by start time. */
function normalizeLaps(sessionData) {
    const laps = [];
    (sessionData?.sessions || []).forEach(session => {
        (session.laps || []).forEach(lap => {
            const startMs = Date.parse(lap.dateTimeStart);
            const durMs = parseDurationToSeconds(lap.duration) * 1000;
            if (Number.isFinite(startMs) && Number.isFinite(durMs) && durMs > 0) {
                laps.push({ nr: lap.nr, startMs, durMs });
            }
        });
    });
    return laps.sort((a, b) => a.startMs - b.startMs);
}

/** First lap start and last lap end of a normalized lap list, or null when empty. */
function lapExtent(laps) {
    if (!laps || laps.length === 0) return null;
    const last = laps[laps.length - 1];
    return { startMs: laps[0].startMs, endMs: last.startMs + last.durMs };
}

/**
 * @returns {null | {lap, lapIndex, frac, speedKph}} null when the rider is not on the ice at tMs.
 */
function riderStateAt(laps, tMs, trackLengthM) {
    if (!laps || laps.length === 0 || tMs < laps[0].startMs) return null;

    // Last lap that started at or before tMs.
    let lo = 0;
    let hi = laps.length - 1;
    while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        if (laps[mid].startMs <= tMs) lo = mid; else hi = mid - 1;
    }
    const lap = laps[lo];
    const endMs = lap.startMs + lap.durMs;
    const speedKph = (trackLengthM / (lap.durMs / 1000)) * 3.6;
    if (speedKph < MIN_SKATING_KPH) return null;   // a break, not a lap
    let frac;
    if (tMs < endMs) {
        frac = (tMs - lap.startMs) / lap.durMs;
    } else {
        const next = laps[lo + 1];
        if (!next || next.startMs - endMs > LAP_GAP_TOLERANCE_MS) return null;
        frac = 1;
    }
    return { lap, lapIndex: lo, frac, speedKph };
}

/**
 * Total time (ms) two riders were skating at the same moment: the overlap of their lap intervals,
 * ignoring break laps. Both lists must be sorted by start time (normalizeLaps does that).
 */
function onIceOverlapMs(lapsA, lapsB, trackLengthM) {
    const skating = laps => laps.filter(l => (trackLengthM / (l.durMs / 1000)) * 3.6 >= MIN_SKATING_KPH);
    const a = skating(lapsA);
    const b = skating(lapsB);
    let i = 0;
    let j = 0;
    let total = 0;
    while (i < a.length && j < b.length) {
        const aEnd = a[i].startMs + a[i].durMs;
        const bEnd = b[j].startMs + b[j].durMs;
        total += Math.max(0, Math.min(aEnd, bEnd) - Math.max(a[i].startMs, b[j].startMs));
        if (aEnd < bEnd) i++; else j++;   // move on from the interval that ends first
    }
    return total;
}

if (typeof module !== 'undefined') {
    module.exports = { normalizeLaps, lapExtent, riderStateAt, onIceOverlapMs };
}
