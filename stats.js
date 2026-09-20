/**
 * Speed-lap statistics for the MYLAPS Activity Viewer.
 * A "speed lap" is any lap faster than the chosen threshold (same rule as script.js).
 * Depends on functions from utils.js.
 */

const MIN_BLOCK_LAPS = 2;
const BEST_N = 5;

function mean(values) {
    return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function median(values) {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function stdDev(values) {
    if (values.length < 2) return 0;
    const m = mean(values);
    return Math.sqrt(mean(values.map(v => (v - m) ** 2)));
}

function speedKph(lapSeconds, trackLengthM) {
    return (trackLengthM / lapSeconds) * 3.6;
}

/**
 * @returns {null | object} null when no lap is faster than the threshold.
 */
function analyzeSpeedLaps(laps, thresholdSeconds, trackLengthM) {
    const entries = laps
        .map(lap => ({ lap, time: parseDurationToSeconds(lap.duration) }))
        .filter(e => !isNaN(e.time));
    const fast = entries.filter(e => e.time < thresholdSeconds);
    if (fast.length === 0) return null;

    const times = fast.map(e => e.time);
    const avg = mean(times);
    const bestCount = Math.min(BEST_N, times.length);
    const bestAvg = mean([...times].sort((a, b) => a - b).slice(0, bestCount));

    // Fade: average of the second half of the speed laps minus the first half (positive = slower late).
    let fade = null;
    if (times.length >= 4) {
        const half = Math.floor(times.length / 2);
        fade = mean(times.slice(-half)) - mean(times.slice(0, half));
    }

    // Blocks: runs of consecutive speed laps, i.e. one interval effort.
    const blocks = [];
    let run = [];
    const closeRun = () => {
        if (run.length >= MIN_BLOCK_LAPS) {
            const runTimes = run.map(e => e.time);
            blocks.push({
                firstLap: run[0].lap.nr,
                lastLap: run[run.length - 1].lap.nr,
                count: run.length,
                avg: mean(runTimes),
                best: Math.min(...runTimes),
                totalSeconds: runTimes.reduce((s, v) => s + v, 0)
            });
        }
        run = [];
    };
    entries.forEach(e => (e.time < thresholdSeconds ? run.push(e) : closeRun()));
    closeRun();

    return {
        totalLaps: entries.length,
        fastCount: fast.length,
        fastShare: fast.length / entries.length,
        avg,
        median: median(times),
        best: Math.min(...times),
        bestCount,
        bestAvg,
        stdDev: stdDev(times),
        avgSpeedKph: speedKph(avg, trackLengthM),
        distanceKm: (fast.length * trackLengthM) / 1000,
        fade,
        blocks,
        times
    };
}

/**
 * How much of the session you were really skating: MYLAPS reports the total training time (first to last
 * lap) and the active training time (only the laps). Returns null when either is missing.
 */
function activeTimeShare(stats) {
    const active = parseTrainingTimeToSeconds(stats && stats.activeTrainingTime);
    const total = parseTrainingTimeToSeconds(stats && stats.totalTrainingTime);
    if (!(active >= 0) || !(total > 0)) return null;
    return { activeSeconds: active, totalSeconds: total, share: Math.min(active / total, 1) };
}

function formatSigned(seconds, digits = 2) {
    return `${seconds >= 0 ? '+' : '-'}${Math.abs(seconds).toFixed(digits)}s`;
}

function renderSpeedAnalysis(statsContainer, blocksContainer, analysis, trackLengthM) {
    if (!analysis) {
        statsContainer.innerHTML = '<p class="muted-note">No laps faster than the current threshold.</p>';
        blocksContainer.innerHTML = '';
        return;
    }

    const card = (label, value, sub = '') =>
        `<div class="stat-card"><span class="label">${label}</span><span class="value">${value}</span>${sub ? `<span class="sub-value">${sub}</span>` : ''}</div>`;

    statsContainer.innerHTML = [
        card('Speed laps', analysis.fastCount, `${Math.round(analysis.fastShare * 100)}% of ${analysis.totalLaps} laps`),
        card('Avg speed lap', formatSecondsToDuration(analysis.avg), `${analysis.avgSpeedKph.toFixed(1)} km/h`),
        card('Median', formatSecondsToDuration(analysis.median)),
        card(`Avg of best ${analysis.bestCount}`, formatSecondsToDuration(analysis.bestAvg), `best ${formatSecondsToDuration(analysis.best)}`),
        card('Consistency', `±${analysis.stdDev.toFixed(2)}s`, 'std deviation'),
        card('Speed distance', analysis.distanceKm.toFixed(2), 'km'),
        card('Fade', analysis.fade === null ? 'N/A' : formatSigned(analysis.fade), '2nd half vs 1st half')
    ].join('');

    if (analysis.blocks.length === 0) {
        blocksContainer.innerHTML = `<p class="muted-note">No blocks of ${MIN_BLOCK_LAPS}+ consecutive speed laps.</p>`;
        return;
    }
    const rows = analysis.blocks.map((b, i) => `
        <tr>
            <td>${i + 1}</td>
            <td>${b.firstLap}–${b.lastLap}</td>
            <td>${b.count}</td>
            <td>${((b.count * trackLengthM) / 1000).toFixed(2)}</td>
            <td>${formatSecondsToDuration(b.avg)}</td>
            <td>${formatSecondsToDuration(b.best)}</td>
            <td>${speedKph(b.avg, trackLengthM).toFixed(1)}</td>
        </tr>`).join('');
    const totalCount = analysis.blocks.reduce((sum, b) => sum + b.count, 0);
    const totalSeconds = analysis.blocks.reduce((sum, b) => sum + b.totalSeconds, 0);
    const totalAvg = totalSeconds / totalCount;
    const totalBest = Math.min(...analysis.blocks.map(b => b.best));
    blocksContainer.innerHTML = `
        <table class="laps-table blocks-table">
            <thead><tr><th>Block</th><th>Laps</th><th>Count</th><th>Distance (km)</th><th>Avg lap</th><th>Best lap</th><th>Avg km/h</th></tr></thead>
            <tbody>${rows}</tbody>
            <tfoot>
                <tr>
                    <td>Total</td>
                    <td></td>
                    <td>${totalCount}</td>
                    <td>${((totalCount * trackLengthM) / 1000).toFixed(2)}</td>
                    <td>${formatSecondsToDuration(totalAvg)}</td>
                    <td>${formatSecondsToDuration(totalBest)}</td>
                    <td>${speedKph(totalAvg, trackLengthM).toFixed(1)}</td>
                </tr>
            </tfoot>
        </table>`;
}
