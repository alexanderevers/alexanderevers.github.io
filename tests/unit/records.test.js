const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadBrowserScripts, hostCopy } = require('../helpers/browser-scripts');

const app = loadBrowserScripts(['utils.js', 'replay-track.js', 'replay-model.js', 'records.js']);
const { computePersonalRecords, seasonOf } = app.sandbox;

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
    it('the timeline has one point per session (its best lap), oldest first', () => {
        const sessions = [
            session(1, '2025-03-01T10:00:00Z', laps(3, 32)),
            session(2, '2025-01-10T10:00:00Z', laps(3, 30))
        ];
        const result = computePersonalRecords(sessions);
        assert.deepEqual(hostCopy(result.timeline.map(t => [t.sessionId, t.durMs])), [[2, 30000], [1, 32000]]);
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

describe('computePersonalRecords: fast laps per season (the fastest 20 % of that season, and their average)', () => {
    it('finds the fastest 20 % of a season and their average, oldest season first', () => {
        // season 24/25: 10 laps of 30 s except one of 20 s -> the fastest 20 % is 2 laps: 20 s and 30 s
        const lapsSeason1 = [...laps(9, 30), { nr: 10, startMs: 9 * 30 * SECOND, durMs: 20 * SECOND }];
        // season 25/26: 5 laps, all 40 s -> the fastest 20 % is still at least 1 lap
        const sessions = [session(1, '2025-01-10T10:00:00Z', lapsSeason1), session(2, '2026-01-10T10:00:00Z', laps(5, 40))];
        const result = computePersonalRecords(sessions);
        assert.deepEqual(hostCopy(result.fastLapsPerSeason.map(r => r.season)), ['24/25', '25/26']);   // oldest first
        const season1 = result.fastLapsPerSeason[0];
        assert.equal(season1.totalLaps, 10);
        assert.equal(season1.fastCount, 2);
        assert.equal(season1.thresholdMs, 30000);
        assert.equal(season1.avgFastMs, 25000);                           // (20000 + 30000) / 2
        const season2 = result.fastLapsPerSeason[1];
        assert.equal(season2.totalLaps, 5);
        assert.equal(season2.fastCount, 1);                               // rounded up from 20 % of 5 = 1
        assert.equal(season2.avgFastMs, 40000);
    });
    it('every season has its own threshold: a slow season is not judged against a fast season', () => {
        const sessions = [session(1, '2025-01-10T10:00:00Z', laps(10, 60)), session(2, '2026-01-10T10:00:00Z', laps(10, 30))];
        const result = computePersonalRecords(sessions);
        assert.equal(result.fastLapsPerSeason.find(r => r.season === '24/25').avgFastMs, 60000);
        assert.equal(result.fastLapsPerSeason.find(r => r.season === '25/26').avgFastMs, 30000);
    });
    it('excluded sessions and excluded laps do not count towards the fast laps of a season either', () => {
        const fast = laps(3, 20);
        const slow = laps(10, 40).map(lap => ({ ...lap, nr: lap.nr + 3, startMs: lap.startMs + 100 * SECOND }));
        const sessions = [session(1, '2025-01-10T10:00:00Z', [...fast, ...slow], { excludedLaps: [1, 2, 3] })];   // the fast laps are excluded
        const result = computePersonalRecords(sessions);
        assert.equal(result.fastLapsPerSeason[0].totalLaps, 10);
        assert.equal(result.fastLapsPerSeason[0].avgFastMs, 40000);
    });
    it('a session in the May-August off-season does not add a fast-laps entry either', () => {
        const sessions = [session(1, '2025-06-15T10:00:00Z', laps(10, 30))];
        assert.deepEqual(hostCopy(computePersonalRecords(sessions).fastLapsPerSeason), []);
    });
    it('is empty without any skating laps', () => {
        assert.deepEqual(hostCopy(computePersonalRecords([]).fastLapsPerSeason), []);
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
