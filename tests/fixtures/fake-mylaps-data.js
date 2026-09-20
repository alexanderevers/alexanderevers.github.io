/**
 * Fake MYLAPS data: one busy evening at a fake rink, in the same shape as the real API answers.
 * Used by the unit tests and by the browser test (through the fake API in fake-api-stub.js).
 *
 * The cast (start = minutes after T0, laps are back to back at the given pace):
 *   1   you (the reference rider)   0 - 20 min   38 s laps
 *   2-4, 7   riders who skate with you (partly overlapping)
 *   20-31    twelve more riders on the ice with you the whole time (so there are more than 10 riders)
 *   40       "all-day" rider: a long activity window that covers yours, but laps only long after yours
 *   5        skates 5 hours later (does not overlap)
 *   9        an old session from another month (does not overlap)
 */
const T0 = Date.parse('2026-09-01T18:00:00Z');
const MINUTE = 60000;

const LOCATION = { id: 5, name: 'Jaap Eden', sport: 'Speed Skating', trackLength: 400 };
const REFERENCE_CHIP = 'AB-12345';

const CAST = [
    { id: 1, chip: REFERENCE_CHIP, name: ['Alex', 'Evers', 'Zoom'], startMin: 0, endMin: 20, pace: 38 },
    { id: 2, chip: 'CD-11111', name: ['Bram', 'Bakker', 'Bolt'], startMin: 5, endMin: 25, pace: 36 },
    { id: 3, chip: 'EF-22222', name: ['Eva', 'Visser', null], startMin: 10, endMin: 30, pace: 41 },
    { id: 4, chip: 'GH-33333', name: ['Gijs', 'de Haan', null], startMin: 12, endMin: 40, pace: 44 },
    { id: 7, chip: 'KL-55555', name: ['Early', 'Bird', null], startMin: -5, endMin: 15, pace: 39 },
    ...Array.from({ length: 12 }, (_, i) => ({
        id: 20 + i, chip: `XY-${String(10000 + i)}`, name: ['Extra', `Rider${i + 1}`, null],
        startMin: 0, endMin: 20, pace: 37 + (i % 6)
    })),
    // Activity window 18:00-19:30 (covers yours) but the laps were skated between 18:40 and 18:55.
    { id: 40, chip: 'ZZ-40404', name: ['Daan', 'Allday', null], startMin: -30, endMin: 90, lapsFromMin: 40, lapsToMin: 55, pace: 40 },
    { id: 5, chip: 'IJ-44444', name: ['Ilse', 'Jansen', null], startMin: 300, endMin: 330, pace: 40 }
];

const OLD_SESSION = { id: 9, chip: 'ZZ-99999', name: ['Old', 'Session', null], startTime: '2026-08-01T10:00:00Z', endTime: '2026-08-01T11:00:00Z' };

const iso = ms => new Date(ms).toISOString();

/** Seconds as MYLAPS writes long times: "1:15:53.827". */
function clock(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const rest = (seconds % 60).toFixed(3).padStart(6, '0');
    return `${hours}:${String(minutes).padStart(2, '0')}:${rest}`;
}

// Older sessions of the reference rider at the same rink (mid-month dates, so the year is the same in every
// time zone), so the activity list spans several years: 12 in 2026, 9 in 2025 and 3 in 2024.
const HISTORY_DATES = [
    '2026-03-02', '2026-03-16', '2026-04-06', '2026-04-20', '2026-05-04', '2026-05-18',
    '2026-06-01', '2026-06-15', '2026-07-06', '2026-07-20', '2026-08-03', '2026-08-17',
    '2025-01-13', '2025-02-10', '2025-03-10', '2025-10-06', '2025-10-20', '2025-11-03', '2025-11-17', '2025-12-01', '2025-12-15',
    '2024-01-15', '2024-02-19', '2024-11-11'
];

function historyActivities() {
    return HISTORY_DATES.map((date, i) => ({
        id: 101 + i,
        chipCode: REFERENCE_CHIP,
        startTime: `${date}T18:00:00.000Z`,
        endTime: `${date}T19:00:00.000Z`,
        location: { ...LOCATION }
    }));
}

function activityOf(rider) {
    return {
        id: rider.id,
        chipCode: rider.chip,
        startTime: iso(T0 + rider.startMin * MINUTE),
        endTime: iso(T0 + rider.endMin * MINUTE),
        location: { ...LOCATION }
    };
}

/** Laps in the API format ("dateTimeStart" as ISO string, "duration" as a string), back to back. */
function lapsOf(rider) {
    const from = T0 + (rider.lapsFromMin ?? rider.startMin) * MINUTE;
    const to = T0 + (rider.lapsToMin ?? rider.endMin) * MINUTE;
    const laps = [];
    let t = from;
    for (let nr = 1; ; nr++) {
        const seconds = rider.pace + Math.sin(nr / 3 + rider.id) * 1.5;
        if (t + seconds * 1000 > to) break;
        laps.push({
            nr,
            duration: seconds.toFixed(3),
            sessionDuration: '10:00',
            dateTimeStart: iso(t),
            speed: { kph: (LOCATION.trackLength / seconds) * 3.6 },
            status: nr % 2 ? 'FASTER' : 'SLOWER',
            diffPrevLap: '0.5',
            dataAttributes: []
        });
        t += seconds * 1000;
    }
    return laps;
}

/** The answer of the "laps" endpoint for a rider. */
function lapsResponseOf(rider) {
    const laps = lapsOf(rider);
    return {
        stats: {
            lapCount: laps.length,
            fastestTime: (rider.pace - 1.5).toFixed(3),
            averageTime: `${rider.pace}.000`,
            totalTrainingTime: clock((rider.endMin - rider.startMin) * 60),                        // first to last minute of the activity
            activeTrainingTime: clock(laps.reduce((sum, lap) => sum + Number(lap.duration), 0)),  // only the laps
            averageSpeed: { kph: 30 },
            fastestSpeed: { kph: 40 }
        },
        bestLap: { lapNr: 3 },
        sessions: [{ laps }]
    };
}

function buildFakeData() {
    const activities = {};
    const lapsById = {};
    CAST.forEach(rider => {
        activities[rider.id] = activityOf(rider);
        lapsById[rider.id] = lapsResponseOf(rider);
    });
    historyActivities().forEach(activity => { activities[activity.id] = activity; });   // no laps needed: they are only listed
    activities[OLD_SESSION.id] = {
        id: OLD_SESSION.id, chipCode: OLD_SESSION.chip, startTime: OLD_SESSION.startTime, endTime: OLD_SESSION.endTime, location: { ...LOCATION }
    };
    const names = {};
    [...CAST, OLD_SESSION].forEach(rider => { names[rider.chip] = rider.name; });
    return { T0, referenceId: 1, referenceChip: REFERENCE_CHIP, location: LOCATION, activities, lapsById, names };
}

module.exports = { T0, MINUTE, LOCATION, CAST, buildFakeData, lapsOf, lapsResponseOf, activityOf, historyActivities, clock };
