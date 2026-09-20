const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadBrowserScripts } = require('../helpers/browser-scripts');

const { compareOverlappingRiders } = loadBrowserScripts(['utils.js', 'fetch_overlapping_sessions.js']).sandbox;
const MIN = 60000;
const rider = (name, groupMin, togetherMin) => ({ name, groupMs: groupMin === null ? null : groupMin * MIN, togetherMs: togetherMin === null ? null : togetherMin * MIN });
const order = riders => [...riders].sort(compareOverlappingRiders).map(r => r.name);

describe('compareOverlappingRiders: the order of the overlapping riders', () => {
    it('puts the longest time in your group first', () => {
        assert.deepEqual(order([rider('a', 5, 20), rider('b', 12, 15), rider('c', 8, 25)]), ['b', 'c', 'a']);
    });
    it('sorts riders with the same group time (in particular 0 min) by time skated together', () => {
        assert.deepEqual(order([rider('a', 0, 3), rider('b', 0, 20), rider('c', 0, 11), rider('d', 6, 6)]), ['d', 'b', 'c', 'a']);
    });
    it('compares the whole minutes shown on the cards first; exact times only break the remaining ties', () => {
        const a = { name: 'a', groupMs: 10 * MIN + 10000, togetherMs: 30 * MIN };   // shows 10 min in the group, 30 together
        const b = { name: 'b', groupMs: 10 * MIN + 20000, togetherMs: 5 * MIN };    // shows 10 min in the group, 5 together
        assert.deepEqual(order([b, a]), ['a', 'b']);                                // same group minutes: more time together first
        const c = { name: 'c', groupMs: 10 * MIN + 10000, togetherMs: 30 * MIN };
        const d = { name: 'd', groupMs: 10 * MIN + 20000, togetherMs: 30 * MIN };   // same minutes everywhere: exact group time
        assert.deepEqual(order([c, d]), ['d', 'c']);
    });
    it('a longer time together does not beat a longer time in your group', () => {
        assert.deepEqual(order([rider('long-together', 1, 60), rider('long-group', 2, 10)]), ['long-group', 'long-together']);
    });
    it('riders who could not be measured come last', () => {
        assert.deepEqual(order([rider('none', null, null), rider('zero', 0, 0), rider('some', 3, 9)]), ['some', 'zero', 'none']);
    });
    it('gives 0 for identical riders and works on an empty list', () => {
        assert.equal(compareOverlappingRiders(rider('a', 4, 4), rider('b', 4, 4)), 0);
        assert.deepEqual(order([]), []);
    });
});
