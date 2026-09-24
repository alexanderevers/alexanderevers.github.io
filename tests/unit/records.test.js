const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadBrowserScripts, hostCopy } = require('../helpers/browser-scripts');

const app = loadBrowserScripts(['utils.js', 'replay-track.js', 'replay-model.js', 'records.js']);
const { computePersonalRecords, seasonOf, seasonsPresent, seasonBreakdown, seasonLapTimes, lapTimeStat } = app.sandbox;
const LAP_TIME_METRICS = app.get('LAP_TIME_METRICS');   // a const is not a property of the sandbox

const SECOND = 1000;
// Back-to-back laps of `seconds` starting at `startS` seconds into the session.
const laps = (count, seconds, startS = 0) => Array.from({ length: count }, (_, i) => ({ nr: i + 1, startMs: (startS + i * seconds) * SECOND, durMs: seconds * SECOND }));
const session = (id, isoDate, lapList, extra = {}) => ({ id, startTime: isoDate, locationName: 'Thialf', trackLengthM: 400, laps: lapList, excluded: false, excludedLaps: [], ...extra });

describe('seasonOf: September through April, spanning the turn of the calendar year', () => {
    // Times are kept away from local midnight so the test does not depend on the machine's time zone (seasonOf
    // reads local month/year, the same convention the rest of records.js already used for calendar years).
    it('September through December belongs to the season that starts that year', () => {
        assert.deepEqual(hostCopy(seasonOf(Date.parse('2025-09-01T12:00:00Z'))), { startYear: 2025, label: '25/26' });
        assert.deepEqual(hostCopy(seasonOf(Date.parse('2025-12-31T12:00:00Z'))), { startYear: 2025, label: '25/26' });
    });
    it('January through April belongs to the season that started the year before', () => {
        assert.deepEqual(hostCopy(seasonOf(Date.parse('2026-01-01T12:00:00Z'))), { startYear: 2025, label: '25/26' });
        assert.deepEqual(hostCopy(seasonOf(Date.parse('2026-04-30T12:00:00Z'))), { startYear: 2025, label: '25/26' });
    });
    it('May through August is the off-season: no season at all', () => {
        assert.equal(seasonOf(Date.parse('2026-05-01T12:00:00Z')), null);
        assert.equal(seasonOf(Date.parse('2026-08-31T12:00:00Z')), null);
    });
    it('turns "99/00" style year wraps correctly (padded to two digits)', () => {
        assert.deepEqual(hostCopy(seasonOf(Date.parse('2099-10-01T12:00:00Z'))), { startYear: 2099, label: '99/00' });
    });
});

describe('computePersonalRecords: totals, the best lap ever, and per season', () => {
    it('finds the fastest lap across every session, with where and when it was skated', () => {
        const sessions = [
            session(1, '2025-01-10T10:00:00Z', laps(5, 30)),
            session(2, '2026-02-05T10:00:00Z', laps(5, 28), { locationName: 'Jaap Eden' }),
            session(3, '2025-06-01T10:00:00Z', laps(5, 35))
        ];
        const result = computePersonalRecords(sessions);
        assert.equal(result.best.durMs, 28000);
        assert.equal(result.best.sessionId, 2);
        assert.equal(result.best.locationName, 'Jaap Eden');
        assert.equal(result.sessionCount, 3);
        assert.equal(result.skatingLapCount, 15);
        assert.equal(result.lapCount, 15);
        assert.ok(Math.abs(result.distanceKm - 6) < 1e-9, String(result.distanceKm));   // 15 laps of 400 m
    });
    it('one entry per season, the fastest lap of that season, newest season first', () => {
        const sessions = [
            session(1, '2024-01-10T10:00:00Z', laps(3, 32)),             // season 23/24
            session(2, '2024-02-01T10:00:00Z', laps(3, 29)),             // faster, same season (23/24)
            session(3, '2025-01-10T10:00:00Z', laps(3, 31))              // season 24/25
        ];
        const result = computePersonalRecords(sessions);
        assert.deepEqual(hostCopy(result.perSeason.map(r => [r.season, r.durMs])), [['24/25', 31000], ['23/24', 29000]]);
    });
    it('a session in the May-August off-season adds no per-season row, but still counts towards the totals and the best lap ever', () => {
        const sessions = [session(1, '2025-06-15T10:00:00Z', laps(3, 25))];
        const result = computePersonalRecords(sessions);
        assert.deepEqual(hostCopy(result.perSeason), []);
        assert.equal(result.best.durMs, 25000);
        assert.equal(result.skatingLapCount, 3);
    });
    it('the timeline has one point per session when there are few enough of them, oldest first', () => {
        const sessions = [
            session(1, '2025-03-01T10:00:00Z', laps(3, 32)),               // season 24/25
            session(2, '2025-11-10T10:00:00Z', laps(3, 30))                // season 25/26: a different bucket
        ];
        const result = computePersonalRecords(sessions);
        assert.deepEqual(hostCopy(result.timeline.map(t => [t.sessionId, t.durMs])), [[1, 32000], [2, 30000]]);
    });
});

describe('computePersonalRecords: "Best lap over time" is thinned per season (fastest 5 %, at least 1, capped at 10)', () => {
    const hourIso = (baseIso, hours) => new Date(Date.parse(baseIso) + hours * 3600 * 1000).toISOString();

    it('a small season keeps only its single fastest session (rounds down to at least one)', () => {
        const sessions = [
            session(1, '2025-01-05T10:00:00Z', laps(1, 40)),
            session(2, '2025-01-10T10:00:00Z', laps(1, 30)),               // the fastest
            session(3, '2025-01-15T10:00:00Z', laps(1, 35))
        ];
        const result = computePersonalRecords(sessions);
        assert.deepEqual(hostCopy(result.timeline.map(t => t.sessionId)), [2]);
    });
    it('keeps the fastest 5 % of a bigger season, rounded, still ordered oldest first', () => {
        // 40 sessions, all in season 24/25 (an hour apart), one lap each; later sessions are faster
        const sessions = Array.from({ length: 40 }, (_, i) => session(i + 1, hourIso('2025-01-01T00:00:00Z', i), laps(1, 60 - i)));
        const result = computePersonalRecords(sessions);
        // 5 % of 40 = 2: session 40 (21 s) and session 39 (22 s) are the fastest, session 39 came first
        assert.deepEqual(hostCopy(result.timeline.map(t => t.sessionId)), [39, 40]);
    });
    it('caps at 10 points even for a very busy season', () => {
        // durations stay well under the skating-speed threshold for every session, so all 300 make the timeline
        const sessions = Array.from({ length: 300 }, (_, i) => session(i + 1, hourIso('2025-01-01T00:00:00Z', i), laps(1, 40 - i * 0.05)));
        const result = computePersonalRecords(sessions);
        assert.equal(result.timeline.length, 10);
    });
    it('off-season sessions are bucketed by calendar year, independently of the season buckets', () => {
        const sessions = [
            session(1, '2025-06-01T10:00:00Z', laps(1, 40)),               // off-season 2025
            session(2, '2025-06-10T10:00:00Z', laps(1, 30)),               // off-season 2025, faster
            session(3, '2026-06-01T10:00:00Z', laps(1, 20))                // off-season 2026: a different bucket
        ];
        const result = computePersonalRecords(sessions);
        assert.deepEqual(hostCopy(result.timeline.map(t => t.sessionId)), [2, 3]);
    });
});

describe('computePersonalRecords: exclusions are respected', () => {
    it('an excluded session does not count at all, not even towards the totals', () => {
        const sessions = [
            session(1, '2025-01-10T10:00:00Z', laps(5, 20)),               // the fastest, but excluded
            session(2, '2025-02-10T10:00:00Z', laps(5, 30))
        ];
        sessions[0].excluded = true;
        const result = computePersonalRecords(sessions);
        assert.equal(result.best.durMs, 30000);
        assert.equal(result.sessionCount, 1);
        assert.equal(result.lapCount, 5);
    });
    it('an excluded lap is skipped, the rest of that session still counts', () => {
        const withFastGhostLap = [...laps(4, 30), { nr: 5, startMs: 4 * 30 * SECOND, durMs: 2000 }];   // lap 5: an obvious mistiming
        const sessions = [session(1, '2025-01-10T10:00:00Z', withFastGhostLap, { excludedLaps: [5] })];
        const result = computePersonalRecords(sessions);
        assert.equal(result.best.durMs, 30000);                            // not the 2 s ghost lap
        assert.equal(result.lapCount, 4);
    });
});

describe('computePersonalRecords: only real skating laps count', () => {
    it('a break (slower than the skating speed limit) is not a lap, and not the fastest', () => {
        const sessions = [session(1, '2025-01-10T10:00:00Z', [...laps(3, 30), { nr: 4, startMs: 90 * SECOND, durMs: 300 * SECOND }])];
        const result = computePersonalRecords(sessions);
        assert.equal(result.skatingLapCount, 3);
        assert.equal(result.lapCount, 4);
        assert.equal(result.best.nr, 1);
    });
    it('follows the track length of the session for what counts as skating', () => {
        // 60 s laps: fine on 400 m (24 km/h), a break on 75 m (4.5 km/h)
        const sessions = [session(1, '2025-01-10T10:00:00Z', laps(3, 60), { trackLengthM: 75 })];
        assert.equal(computePersonalRecords(sessions).skatingLapCount, 0);
    });
});

describe('computePersonalRecords: fast laps per season, judged against one shared pace bar (not a per-season one)', () => {
    it('the same threshold applies to every season, so a season with genuinely more fast laps shows more of them', () => {
        // 10 laps at 20 s (season 24/25) and 10 laps at 40 s (season 25/26): combined, the fastest 20 % (4 laps)
        // are all from the 20 s group, so the shared threshold is 20 s - and then every one of its ten 20 s laps
        // qualifies as "fast" against that bar, while none of the 40 s laps do.
        const sessions = [
            session(1, '2025-01-10T10:00:00Z', laps(10, 20)),              // season 24/25
            session(2, '2026-01-10T10:00:00Z', laps(10, 40))               // season 25/26
        ];
        const result = computePersonalRecords(sessions);
        assert.equal(result.fastLapThresholdMs, 20000);
        const season1 = result.fastLapsPerSeason.find(r => r.season === '24/25');
        const season2 = result.fastLapsPerSeason.find(r => r.season === '25/26');
        assert.equal(season1.fastCount, 10);
        assert.equal(season1.avgFastMs, 20000);
        assert.equal(season2.fastCount, 0);
        assert.equal(season2.avgFastMs, null);
    });
    it('a season only counts its own laps that beat the shared bar, not a fixed share of its own total', () => {
        // combined pool: 5 laps at 15 s (season A) and 15 laps at 50 s (season B); the fastest 20 % (4 of 20) are
        // all from the 15 s group, so season A's fastCount (5, ALL its own laps) is well above 20 % of its own
        // total, and season B's (0) is well below - unlike a per-season 20 % share, which always lands both at
        // roughly the same proportion of their own laps.
        const sessions = [
            session(1, '2025-01-10T10:00:00Z', laps(5, 15)),
            session(2, '2026-01-10T10:00:00Z', laps(15, 50))
        ];
        const result = computePersonalRecords(sessions);
        assert.equal(result.fastLapsPerSeason.find(r => r.season === '24/25').fastCount, 5);
        assert.equal(result.fastLapsPerSeason.find(r => r.season === '25/26').fastCount, 0);
    });
    it('excluded sessions and excluded laps are left out of the shared threshold, and of every season\'s count', () => {
        const fast = laps(3, 20);
        const slow = laps(10, 40).map(lap => ({ ...lap, nr: lap.nr + 3, startMs: lap.startMs + 100 * SECOND }));
        const sessions = [session(1, '2025-01-10T10:00:00Z', [...fast, ...slow], { excludedLaps: [1, 2, 3] })];   // the fast laps are excluded
        const result = computePersonalRecords(sessions);
        assert.equal(result.fastLapsPerSeason[0].totalLaps, 10);
        // with the fast laps excluded, only the 40 s laps feed the shared threshold, so they all qualify against it
        assert.equal(result.fastLapsPerSeason[0].fastCount, 10);
        assert.equal(result.fastLapsPerSeason[0].avgFastMs, 40000);
    });
    it('a session in the May-August off-season does not add a fast-laps entry, or feed the shared threshold', () => {
        const sessions = [session(1, '2025-06-15T10:00:00Z', laps(10, 30))];
        const result = computePersonalRecords(sessions);
        assert.deepEqual(hostCopy(result.fastLapsPerSeason), []);
        assert.equal(result.fastLapThresholdMs, null);
    });
    it('is empty without any skating laps', () => {
        assert.deepEqual(hostCopy(computePersonalRecords([]).fastLapsPerSeason), []);
        assert.equal(computePersonalRecords([]).fastLapThresholdMs, null);
        const noSkating = [session(1, '2025-01-10T10:00:00Z', [{ nr: 1, startMs: 0, durMs: 300 * SECOND }])];   // a break, not a lap
        assert.deepEqual(hostCopy(computePersonalRecords(noSkating).fastLapsPerSeason), []);
    });
});

describe('computePersonalRecords: nothing stored yet', () => {
    it('gives zeros and no best lap, without throwing', () => {
        const result = computePersonalRecords([]);
        assert.equal(result.best, null);
        assert.equal(result.sessionCount, 0);
        assert.equal(result.lapCount, 0);
        assert.deepEqual(hostCopy(result.perSeason), []);
        assert.deepEqual(hostCopy(result.timeline), []);
        assert.deepEqual(hostCopy(computePersonalRecords(undefined)), hostCopy(result));
    });
});

describe('seasonsPresent: which seasons have stored data, for the Season dashboard', () => {
    it('lists the distinct seasons, newest first', () => {
        const sessions = [
            session(1, '2024-01-10T10:00:00Z', laps(1, 30)),               // 23/24
            session(2, '2025-11-10T10:00:00Z', laps(1, 30)),               // 25/26
            session(3, '2025-01-10T10:00:00Z', laps(1, 30))                // 24/25
        ];
        assert.deepEqual(hostCopy(seasonsPresent(sessions).map(s => s.label)), ['25/26', '24/25', '23/24']);
    });
    it('lists a season once, no matter how many sessions fall in it', () => {
        const sessions = [session(1, '2025-01-10T10:00:00Z', laps(1, 30)), session(2, '2025-02-10T10:00:00Z', laps(1, 30))];
        assert.deepEqual(hostCopy(seasonsPresent(sessions).map(s => s.label)), ['24/25']);
    });
    it('leaves out an excluded session\'s season entirely, and the May-August off-season', () => {
        const sessions = [
            session(1, '2025-01-10T10:00:00Z', laps(1, 30), { excluded: true }),
            session(2, '2025-06-15T10:00:00Z', laps(1, 30))                // off-season
        ];
        assert.deepEqual(hostCopy(seasonsPresent(sessions)), []);
    });
});

describe('seasonBreakdown: one season\'s sessions, for the "how is this season building up" chart', () => {
    it('is sorted oldest first, regardless of the input order', () => {
        const sessions = [
            session(1, '2025-11-10T10:00:00Z', laps(1, 30)),
            session(2, '2025-10-01T10:00:00Z', laps(1, 30))
        ];
        assert.deepEqual(hostCopy(seasonBreakdown(sessions, 2025, null).map(p => p.sessionId)), [2, 1]);
    });
    it('leaves out sessions from any other season', () => {
        const sessions = [
            session(1, '2025-10-01T10:00:00Z', laps(1, 30)),               // 25/26
            session(2, '2025-01-10T10:00:00Z', laps(1, 30))                // 24/25
        ];
        assert.deepEqual(hostCopy(seasonBreakdown(sessions, 2025, null).map(p => p.sessionId)), [1]);
    });
    it('adds up distance session by session (400 m track), keeping each session\'s own distance too', () => {
        const sessions = [
            session(1, '2025-09-05T10:00:00Z', laps(5, 30)),               // 5 laps: 2 km
            session(2, '2025-09-12T10:00:00Z', laps(3, 30))                // 3 laps: 1.2 km
        ];
        const [first, second] = seasonBreakdown(sessions, 2025, null);
        assert.ok(Math.abs(first.distanceKm - 2) < 1e-9);
        assert.ok(Math.abs(first.cumulativeDistanceKm - 2) < 1e-9);
        assert.ok(Math.abs(second.distanceKm - 1.2) < 1e-9);
        assert.ok(Math.abs(second.cumulativeDistanceKm - 3.2) < 1e-9);
    });
    it('dayOfSeason counts days since 1 September, local time', () => {
        // just after local midnight, so the day difference lands on a whole number regardless of the machine's
        // time zone (a UTC-anchored time like noon would round to the wrong local day in some time zones)
        const localIso = (y, m, d) => new Date(y, m, d, 0, 0, 1).toISOString();
        const sessions = [
            session(1, localIso(2025, 8, 1), laps(1, 30)),                 // 1 September
            session(2, localIso(2025, 11, 15), laps(1, 30))                // 15 December
        ];
        const [first, second] = seasonBreakdown(sessions, 2025, null);
        assert.equal(first.dayOfSeason, 0);
        assert.equal(second.dayOfSeason, 105);                            // 29 (Sep) + 31 (Oct) + 30 (Nov) + 15
    });
    it('lapDurationsMs lists the session\'s skating lap times, fastest first, empty when it has none', () => {
        const sessions = [
            session(1, '2025-09-05T10:00:00Z', [{ nr: 1, startMs: 0, durMs: 32000 }, { nr: 2, startMs: 32000, durMs: 28000 }]),
            session(2, '2025-09-12T10:00:00Z', [{ nr: 1, startMs: 0, durMs: 300 * SECOND }])   // a break, not a lap
        ];
        const [first, second] = seasonBreakdown(sessions, 2025, null);
        assert.deepEqual(hostCopy(first.lapDurationsMs), [28000, 32000]);
        assert.deepEqual(hostCopy(second.lapDurationsMs), []);
    });
    it('fastCount is judged against the given threshold, the same one "Fast laps per season" uses', () => {
        const sessions = [session(1, '2025-09-05T10:00:00Z', [...laps(2, 20), ...laps(3, 40)])];
        const [point] = seasonBreakdown(sessions, 2025, 25000);
        assert.equal(point.fastCount, 2);
        assert.equal(point.totalLaps, 5);
    });
    it('excluded sessions and excluded laps are left out, same as computePersonalRecords', () => {
        const sessions = [
            session(1, '2025-09-05T10:00:00Z', laps(3, 30), { excluded: true }),
            session(2, '2025-09-12T10:00:00Z', laps(3, 30), { excludedLaps: [1] })
        ];
        const points = seasonBreakdown(sessions, 2025, null);
        assert.equal(points.length, 1);
        assert.equal(points[0].totalLaps, 2);
    });
});

describe('seasonLapTimes: every skating lap time of one season, in seconds, for the distribution chart', () => {
    it('collects lap times across every session of the season, in seconds', () => {
        const sessions = [
            session(1, '2025-09-05T10:00:00Z', laps(2, 20)),
            session(2, '2025-09-12T10:00:00Z', laps(3, 30))
        ];
        assert.deepEqual(hostCopy(seasonLapTimes(sessions, 2025)), [20, 20, 30, 30, 30]);
    });
    it('leaves out any other season', () => {
        const sessions = [session(1, '2025-01-10T10:00:00Z', laps(2, 20))];             // 24/25
        assert.deepEqual(hostCopy(seasonLapTimes(sessions, 2025)), []);
    });
    it('only counts real skating laps, and honours exclusions', () => {
        const sessions = [
            session(1, '2025-09-05T10:00:00Z', [...laps(2, 20), { nr: 3, startMs: 40000, durMs: 300 * SECOND }]),   // a break, not a lap
            session(2, '2025-09-12T10:00:00Z', laps(2, 25), { excludedLaps: [1] }),
            session(3, '2025-09-19T10:00:00Z', laps(2, 35), { excluded: true })
        ];
        assert.deepEqual(hostCopy(seasonLapTimes(sessions, 2025)), [20, 20, 25]);
    });
});

describe('lapTimeStat: the average of a session\'s n fastest laps, for the "Fastest laps" chart\'s metric picker', () => {
    const sorted = [20000, 22000, 24000, 26000, 28000];   // fastest first, as seasonBreakdown's lapDurationsMs is

    it('averages every lap when n is 0 (falsy): the "Average lap time" metric', () => {
        assert.equal(lapTimeStat(sorted, 0), 24000);
    });
    it('is just the fastest lap when n is 1', () => {
        assert.equal(lapTimeStat(sorted, 1), 20000);
    });
    it('averages the n fastest laps for n > 1', () => {
        assert.equal(lapTimeStat(sorted, 2), 21000);
    });
    it('averages however many laps it has when there are fewer than n', () => {
        assert.equal(lapTimeStat(sorted, 50), 24000);
    });
    it('is null for a session with no skating laps at all', () => {
        assert.equal(lapTimeStat([], 5), null);
        assert.equal(lapTimeStat([], 0), null);
    });
});

describe('LAP_TIME_METRICS: the menu the "Fastest laps" chart\'s picker is built from', () => {
    it('lists average, then fastest, then fastest-2 through fastest-50, each with a distinct key', () => {
        assert.deepEqual(hostCopy(LAP_TIME_METRICS.map(m => m.key)), ['avg', 'fastest-1', 'fastest-2', 'fastest-5', 'fastest-10', 'fastest-20', 'fastest-50']);
        assert.equal(new Set(LAP_TIME_METRICS.map(m => m.key)).size, LAP_TIME_METRICS.length);
    });
});
