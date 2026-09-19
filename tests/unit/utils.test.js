const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadBrowserScripts } = require('../helpers/browser-scripts');

const {
    parseDurationToSeconds, formatSecondsToDuration, formatDurationShort, formatTotalTrainingTime,
    isValidTransponderFormat, escapeHtml
} = loadBrowserScripts(['utils.js']).sandbox;

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
