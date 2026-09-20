const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadBrowserScripts, hostCopy } = require('../helpers/browser-scripts');

const app = loadBrowserScripts(['utils.js']);
const {
    parseDurationToSeconds, formatSecondsToDuration, formatDurationShort, formatTotalTrainingTime,
    isValidTransponderFormat, escapeHtml, formatDateTimeWithDay
} = app.sandbox;

describe('parseDurationToSeconds', () => {
    it('reads seconds and minutes:seconds', () => {
        assert.equal(parseDurationToSeconds('40.123'), 40.123);
        assert.equal(parseDurationToSeconds('1:02.500'), 62.5);
        assert.equal(parseDurationToSeconds('10:00.000'), 600);
    });
    it('gives NaN for anything else', () => {
        assert.ok(Number.isNaN(parseDurationToSeconds('1:2:3')));
        assert.ok(Number.isNaN(parseDurationToSeconds('abc')));
        assert.ok(Number.isNaN(parseDurationToSeconds(null)));
        assert.ok(Number.isNaN(parseDurationToSeconds(42)));
    });
});

describe('formatSecondsToDuration', () => {
    it('formats seconds and minutes', () => {
        assert.equal(formatSecondsToDuration(40.5), '40.500');
        assert.equal(formatSecondsToDuration(62.5), '1:02.500');
        assert.equal(formatSecondsToDuration(60), '1:00.000');
        assert.equal(formatSecondsToDuration(5), '05.000');
    });
    it('gives an empty string for invalid input', () => {
        assert.equal(formatSecondsToDuration(NaN), '');
        assert.equal(formatSecondsToDuration(-1), '');
    });
    it('round-trips with parseDurationToSeconds', () => {
        for (const seconds of [33.052, 59.999, 61.5, 143.001]) {
            assert.ok(Math.abs(parseDurationToSeconds(formatSecondsToDuration(seconds)) - seconds) < 0.0005);
        }
    });
});

describe('formatDurationShort', () => {
    it('shows minutes, hours or a placeholder', () => {
        assert.equal(formatDurationShort(null), 'N/A');
        assert.equal(formatDurationShort(undefined), 'N/A');
        assert.equal(formatDurationShort(0), '0 min');
        assert.equal(formatDurationShort(20000), '<1 min');
        assert.equal(formatDurationShort(12 * 60000 + 10000), '12 min');
        assert.equal(formatDurationShort(65 * 60000), '1 h 05 min');
    });
});

describe('formatTotalTrainingTime', () => {
    it('drops the fraction and pads to HH:MM:SS', () => {
        assert.equal(formatTotalTrainingTime('01:02:03.5'), '01:02:03');
        assert.equal(formatTotalTrainingTime('52:10.4'), '00:52:10');
    });
    it('handles missing values', () => {
        assert.equal(formatTotalTrainingTime(null), 'N/A');
        assert.equal(formatTotalTrainingTime(''), 'N/A');
    });
});

describe('isValidTransponderFormat', () => {
    it('accepts two capital letters, a dash and five digits', () => {
        assert.equal(isValidTransponderFormat('PZ-28583'), true);
        assert.equal(isValidTransponderFormat('pz-28583'), false);
        assert.equal(isValidTransponderFormat('P-28583'), false);
        assert.equal(isValidTransponderFormat('PZ-2858'), false);
        assert.equal(isValidTransponderFormat('PZ-285831'), false);
    });
});

describe('escapeHtml', () => {
    it('escapes the characters that matter in HTML', () => {
        assert.equal(escapeHtml('<a href="x">&\'</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
    });
    it('turns null and undefined into an empty string', () => {
        assert.equal(escapeHtml(null), '');
        assert.equal(escapeHtml(undefined), '');
    });
});


const { parseTrainingTimeToSeconds, activityYear, activityYearCounts, filterActivitiesByYear, loadSetting, saveSetting } = app.sandbox;

describe('parseTrainingTimeToSeconds', () => {
    it('reads HH:MM:SS.ms and MM:SS.ms like MYLAPS writes them', () => {
        assert.ok(Math.abs(parseTrainingTimeToSeconds('1:15:53.827') - 4553.827) < 1e-6);
        assert.ok(Math.abs(parseTrainingTimeToSeconds('52:10.4') - 3130.4) < 1e-6);
        assert.equal(parseTrainingTimeToSeconds('00:20:00'), 1200);
    });
    it('gives NaN for anything else', () => {
        assert.ok(Number.isNaN(parseTrainingTimeToSeconds('45')));
        assert.ok(Number.isNaN(parseTrainingTimeToSeconds(null)));
        assert.ok(Number.isNaN(parseTrainingTimeToSeconds(undefined)));
        assert.ok(Number.isNaN(parseTrainingTimeToSeconds('1:2:3:4')));
    });
});

describe('activities per year', () => {
    // Mid-year timestamps: the same year in every time zone.
    const activities = [
        { id: 1, startTime: '2026-06-15T12:00:00Z' },
        { id: 2, startTime: '2025-06-15T12:00:00Z' },
        { id: 3, startTime: '2026-03-15T12:00:00Z' },
        { id: 4, startTime: '2024-09-15T12:00:00Z' },
        { id: 5, startTime: '2025-10-15T12:00:00Z' },
        { id: 6, startTime: '2026-08-15T12:00:00Z' }
    ];
    it('reads the year of an activity', () => {
        assert.equal(activityYear(activities[0]), 2026);
    });
    it('counts the activities per year, newest year first', () => {
        assert.deepEqual(hostCopy(activityYearCounts(activities)), [{ year: 2026, count: 3 }, { year: 2025, count: 2 }, { year: 2024, count: 1 }]);
        assert.deepEqual(hostCopy(activityYearCounts([])), []);
    });
    it('filters on one year, given as a number or as text, or keeps everything for "all"', () => {
        assert.deepEqual(hostCopy(filterActivitiesByYear(activities, 2025)).map(a => a.id), [2, 5]);
        assert.deepEqual(hostCopy(filterActivitiesByYear(activities, '2024')).map(a => a.id), [4]);
        assert.equal(filterActivitiesByYear(activities, 'all').length, 6);
        assert.equal(filterActivitiesByYear(activities, 1999).length, 0);
    });
});

describe('remembered settings', () => {
    const memory = () => {
        const data = new Map();
        return {
            data,
            getItem: key => (data.has(key) ? data.get(key) : null),
            setItem: (key, value) => { data.set(key, String(value)); }
        };
    };
    const withStorage = storage => { app.sandbox.localStorage = storage; return storage; };

    it('gives the fallback when nothing is stored', () => {
        withStorage(memory());
        assert.equal(loadSetting('maxFastLapSeconds', 60), 60);
        assert.equal(loadSetting('followChip', null), null);
    });
    it('stores numbers, text and null and reads them back with their type', () => {
        const storage = withStorage(memory());
        saveSetting('speed', 30);
        saveSetting('chip', 'CD-11111');
        saveSetting('nothing', null);
        assert.strictEqual(loadSetting('speed', 0), 30);
        assert.strictEqual(loadSetting('chip', ''), 'CD-11111');
        assert.strictEqual(loadSetting('nothing', 'fallback'), null);
        assert.deepEqual([...storage.data.keys()].sort(), ['mylaps.chip', 'mylaps.nothing', 'mylaps.speed']);   // all under one prefix
    });
    it('falls back when the stored text is damaged', () => {
        const storage = withStorage(memory());
        storage.data.set('mylaps.speed', '{not json');
        assert.equal(loadSetting('speed', 5), 5);
    });
    it('does not break the page when storage is not available (private window, blocked site data)', () => {
        const blocked = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
        withStorage(blocked);
        assert.equal(loadSetting('speed', 5), 5);
        assert.doesNotThrow(() => saveSetting('speed', 30));
        app.sandbox.localStorage = undefined;                                   // no localStorage at all
        assert.equal(loadSetting('speed', 7), 7);
        assert.doesNotThrow(() => saveSetting('speed', 30));
    });
});

describe('formatTransponderInput: the number is written as XX-12345 while typing', () => {
    const { formatTransponderInput, findTransponderInText } = app.sandbox;
    it('makes capitals and adds the dash by itself after the two letters', () => {
        assert.equal(formatTransponderInput('p'), 'P');
        assert.equal(formatTransponderInput('pz'), 'PZ-');
        assert.equal(formatTransponderInput('pz2'), 'PZ-2');
        assert.equal(formatTransponderInput('pz28583'), 'PZ-28583');
    });
    it('does not type the dash twice when somebody types it', () => {
        assert.equal(formatTransponderInput('PZ--'), 'PZ-');
        assert.equal(formatTransponderInput('PZ-'), 'PZ-');
        assert.equal(formatTransponderInput('PZ-28583'), 'PZ-28583');
        assert.equal(formatTransponderInput('pz - 28583'), 'PZ-28583');
        assert.equal(formatTransponderInput('-'), '');
    });
    it('keeps exactly two letters and five digits', () => {
        assert.equal(formatTransponderInput('PZ-285839'), 'PZ-28583');
        assert.equal(formatTransponderInput('PZC-28583'), 'PZ-28583');
        assert.equal(formatTransponderInput('12PZ-28583'), 'PZ-28583');
        assert.equal(formatTransponderInput('P1Z-28583'), 'PZ-28583');
        assert.equal(formatTransponderInput('PZ-2a8b5c83'), 'PZ-28583');
    });
    it('lets the dash be deleted: without trailingDash the dash is not added back', () => {
        assert.equal(formatTransponderInput('PZ', { trailingDash: false }), 'PZ');
        assert.equal(formatTransponderInput('PZ-', { trailingDash: false }), 'PZ');
        assert.equal(formatTransponderInput('PZ-2', { trailingDash: false }), 'PZ-2');   // a digit always brings the dash
    });
    it('handles empty and missing input', () => {
        assert.equal(formatTransponderInput(''), '');
        assert.equal(formatTransponderInput(null), '');
        assert.equal(formatTransponderInput(undefined), '');
    });
    it('everything it makes from a complete number is a valid transponder number', () => {
        for (const text of ['pz28583', 'PZ-28583', 'pz - 28583', ' Pz-28583 ']) assert.equal(isValidTransponderFormat(formatTransponderInput(text)), true, text);
    });
    it('finds a whole number in pasted text and writes it as XX-12345', () => {
        assert.equal(findTransponderInText('pz-28583'), 'PZ-28583');
        assert.equal(findTransponderInText('Transponder: pz - 28583, thanks'), 'PZ-28583');
        assert.equal(findTransponderInText('PZ28583'), 'PZ-28583');
        assert.equal(findTransponderInText('AB-12'), null);            // not complete: it is pasted as usual
        assert.equal(findTransponderInText('nothing here'), null);
        assert.equal(findTransponderInText(undefined), null);
    });
});

describe('formatDateTimeWithDay: the day of the week in front of the date', () => {
    const at = (year, month, day, hour, minute) => new Date(year, month - 1, day, hour, minute).toISOString();   // local time, so it holds in every time zone
    it('writes Tue 01/09/2026 - 20:00', () => {
        assert.equal(formatDateTimeWithDay(at(2026, 9, 1, 20, 0)), 'Tue 01/09/2026 - 20:00');
    });
    it('gives every day of the week its three letters', () => {
        const days = [];
        for (let day = 7; day <= 13; day++) days.push(formatDateTimeWithDay(at(2026, 9, day, 12, 30)).slice(0, 3));   // 7 Sep 2026 is a Monday
        assert.deepEqual(days, ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
    });
    it('keeps the date and time as they were', () => {
        const iso = at(2025, 12, 31, 7, 5);
        assert.equal(formatDateTimeWithDay(iso), `Wed ${app.sandbox.formatDateTime(iso)}`);
        assert.equal(formatDateTimeWithDay(iso).slice(4), '31/12/2025 - 07:05');
    });
});
