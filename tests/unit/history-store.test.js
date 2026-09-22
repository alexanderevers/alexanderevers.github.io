const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { loadBrowserScripts, hostCopy } = require('../helpers/browser-scripts');

const app = loadBrowserScripts(['utils.js', 'api.js', 'history-store.js']);
const {
    historyOwner, rememberSession, setSessionExcluded, setLapExcluded, deleteSession, changeOwner,
    historySessions, historyStorageKB
} = app.sandbox;

const SECOND = 1000;
const memory = () => {
    const data = new Map();
    return { data, getItem: key => (data.has(key) ? data.get(key) : null), setItem: (key, value) => data.set(key, String(value)), removeItem: key => data.delete(key) };
};
const withStorage = storage => { app.sandbox.localStorage = storage; return storage; };
const ago = days => new Date(Date.now() - days * 86400000).toISOString();
const laps = (count, seconds) => Array.from({ length: count }, (_, i) => ({ nr: i + 1, startMs: i * seconds * SECOND, durMs: seconds * SECOND }));
const finishedActivity = (id, daysAgo = 5) => ({ id, startTime: ago(daysAgo), endTime: new Date(Date.parse(ago(daysAgo)) + 20 * 60000).toISOString(), location: { name: 'Thialf', trackLength: 400 } });
const today = id => ({ id, startTime: new Date().toISOString(), endTime: null, location: { name: 'Thialf', trackLength: 400 } });

beforeEach(() => { withStorage(memory()); });

describe('rememberSession: only finished activities, with laps, are stored, and never twice', () => {
    it('stores a finished activity, and reports what happened', () => {
        assert.equal(rememberSession('AB-12345', finishedActivity(1), laps(10, 30)), 'stored');
        assert.equal(historySessions('AB-12345').length, 1);
        assert.equal(historySessions('AB-12345')[0].laps.length, 10);
    });
    it('does nothing for an activity of today, or one without laps', () => {
        assert.equal(rememberSession('AB-12345', today(2), laps(5, 30)), 'not-finished');
        assert.equal(rememberSession('AB-12345', finishedActivity(3), []), 'no-laps');
        assert.equal(rememberSession('AB-12345', finishedActivity(4), null), 'no-laps');
        assert.equal(historySessions('AB-12345').length, 0);
    });
    it('remembering the same activity again does not overwrite it (an exclusion made earlier survives)', () => {
        rememberSession('AB-12345', finishedActivity(1), laps(10, 30));
        setSessionExcluded('AB-12345', 1, true);
        assert.equal(rememberSession('AB-12345', finishedActivity(1), laps(10, 30)), 'already-had-it');
        assert.equal(historySessions('AB-12345')[0].excluded, true);
    });
});

describe('one owner at a time: the device remembers one transponder\'s history, not one per chip looked up', () => {
    it('the first transponder ever remembered becomes the owner', () => {
        assert.equal(historyOwner(), null);
        rememberSession('AB-12345', finishedActivity(1), laps(5, 30));
        assert.equal(historyOwner(), 'AB-12345');
    });
    it('a session of a different transponder is not stored while someone else owns the history', () => {
        rememberSession('AB-12345', finishedActivity(1), laps(5, 30));
        assert.equal(rememberSession('CD-99999', finishedActivity(2), laps(5, 30)), 'different-owner');
        assert.equal(historySessions('AB-12345').length, 1);
        assert.equal(historySessions('CD-99999').length, 0);                     // not shown for the other transponder either
    });
    it('excluding, deleting or listing for a non-owner transponder does nothing and changes nothing', () => {
        rememberSession('AB-12345', finishedActivity(1), laps(5, 30));
        assert.equal(setSessionExcluded('CD-99999', 1, true), false);
        assert.equal(setLapExcluded('CD-99999', 1, 1, true), false);
        assert.equal(deleteSession('CD-99999', 1), false);
        assert.deepEqual(hostCopy(historySessions('AB-12345').map(s => s.excluded)), [false]);
        assert.equal(historySessions('AB-12345')[0].laps.length, 5);
    });
    it('changeOwner forgets everything and hands the (now empty) history to a new transponder', () => {
        rememberSession('AB-12345', finishedActivity(1), laps(5, 30));
        rememberSession('AB-12345', finishedActivity(2), laps(5, 30));
        assert.equal(changeOwner('CD-99999'), true);
        assert.equal(historyOwner(), 'CD-99999');
        assert.equal(historySessions('CD-99999').length, 0);
        assert.equal(historySessions('AB-12345').length, 0);                     // the old owner's data is gone, not just hidden
        assert.equal(rememberSession('CD-99999', finishedActivity(3), laps(5, 30)), 'stored');
        assert.equal(historySessions('CD-99999').length, 1);
    });
});

describe('excluding and deleting: a session or a single lap can be left out without losing the data', () => {
    beforeEach(() => { rememberSession('AB-12345', finishedActivity(1), laps(6, 30)); });

    it('a session is included by default, and can be excluded and brought back', () => {
        assert.equal(historySessions('AB-12345')[0].excluded, false);
        assert.equal(setSessionExcluded('AB-12345', 1, true), true);
        assert.equal(historySessions('AB-12345')[0].excluded, true);
        assert.equal(setSessionExcluded('AB-12345', 1, false), true);
        assert.equal(historySessions('AB-12345')[0].excluded, false);
    });
    it('a single lap can be excluded and brought back, without touching the others', () => {
        setLapExcluded('AB-12345', 1, 3, true);
        setLapExcluded('AB-12345', 1, 5, true);
        assert.deepEqual(hostCopy(historySessions('AB-12345')[0].excludedLaps), [3, 5]);
        assert.equal(historySessions('AB-12345')[0].laps.length, 6);          // the laps themselves are kept
        setLapExcluded('AB-12345', 1, 3, false);
        assert.deepEqual(hostCopy(historySessions('AB-12345')[0].excludedLaps), [5]);
    });
    it('excluding a session or lap that does not exist changes nothing and says so', () => {
        assert.equal(setSessionExcluded('AB-12345', 999, true), false);
        assert.equal(setLapExcluded('AB-12345', 999, 1, true), false);
    });
    it('deleteSession forgets a session entirely, and leaves the others (and the owner) alone', () => {
        rememberSession('AB-12345', finishedActivity(2), laps(6, 30));
        assert.equal(deleteSession('AB-12345', 1), true);
        assert.deepEqual(hostCopy(historySessions('AB-12345').map(s => s.id)), [2]);
        assert.equal(deleteSession('AB-12345', 1), false);                    // already gone
        assert.equal(historyOwner(), 'AB-12345');
    });
});

describe('historySessions: newest first', () => {
    it('sorts by start time, newest first', () => {
        rememberSession('AB-12345', finishedActivity(1, 10), laps(3, 30));
        rememberSession('AB-12345', finishedActivity(2, 2), laps(3, 30));
        rememberSession('AB-12345', finishedActivity(3, 5), laps(3, 30));
        assert.deepEqual(hostCopy(historySessions('AB-12345').map(s => s.id)), [2, 3, 1]);
    });
});

describe('does not break the page when storage is not available (private window, blocked site data)', () => {
    it('historyOwner and historySessions give an empty result; the write functions say so and do not throw', () => {
        const blocked = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() { throw new Error('denied'); } };
        withStorage(blocked);
        assert.equal(historyOwner(), null);
        assert.deepEqual(hostCopy(historySessions('AB-12345')), []);
        assert.equal(rememberSession('AB-12345', finishedActivity(1), laps(5, 30)), 'storage-failed');
        assert.doesNotThrow(() => setSessionExcluded('AB-12345', 1, true));
        assert.doesNotThrow(() => changeOwner('AB-12345'));
        app.sandbox.localStorage = undefined;
        assert.deepEqual(hostCopy(historySessions('AB-12345')), []);
    });
    it('falls back to empty when the stored text is damaged', () => {
        const storage = withStorage(memory());
        storage.data.set('mylaps.history', '{not json');
        assert.deepEqual(hostCopy(historySessions('AB-12345')), []);
        assert.equal(historyOwner(), null);
    });
});

describe('historyStorageKB: a rough size for the "change my transponder" warning', () => {
    it('is 0 with nothing stored, and grows with more sessions', () => {
        assert.equal(historyStorageKB(), 0);
        rememberSession('AB-12345', finishedActivity(1), laps(30, 30));
        const one = historyStorageKB();
        assert.ok(one > 0);
        rememberSession('AB-12345', finishedActivity(2), laps(30, 30));
        assert.ok(historyStorageKB() > one);
    });
});
