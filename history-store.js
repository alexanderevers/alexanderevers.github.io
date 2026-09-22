/**
 * Local, permanent storage (browser localStorage) of a rider's finished sessions, for the "Records" dashboard. This
 * lets it show personal bests across every session that was ever opened on this site, on this browser, without
 * asking MYLAPS again. Only *finished* activities are remembered (isFinishedActivity in api.js: started on an
 * earlier day and ended a while ago), because a session that may still be recording should not be kept forever.
 *
 * The device remembers one transponder's history at a time (the "owner"): the first transponder that is ever
 * remembered becomes the owner, and later sessions of a different transponder are not stored (records-ui.js shows
 * a "Change my transponder" button instead, which calls changeOwner after a warning that the other transponder's
 * history is lost). This keeps a shared or public computer from silently piling up other people's session history.
 *
 * A session, or a single lap inside it, can be excluded (it was not really you, or the timing was wrong that day)
 * without deleting the data: excluded sessions/laps are kept but left out of every calculation. A session can also
 * be deleted outright. Everything survives until the visitor clears their own browser data (nothing is sent
 * anywhere).
 *
 * Storage shape, one key for the whole device:
 *   { v: 2, ownerChip: "XX-12345"|null,
 *     sessions: { "<activityId>": { startTime, endTime, locationName, trackLengthM,
 *                                    laps: [{nr, startMs, durMs}], excluded, excludedLaps: [nr, ...], savedAt } } }
 */
const HISTORY_VERSION = 2;
const HISTORY_KEY = 'mylaps.history';

/** The stored history, or an empty one (no owner yet) when there is none or it cannot be read. */
function loadHistory() {
    const empty = () => ({ v: HISTORY_VERSION, ownerChip: null, sessions: {} });
    try {
        if (typeof localStorage === 'undefined' || !localStorage) return empty();
        const raw = localStorage.getItem(HISTORY_KEY);
        if (!raw) return empty();
        const data = JSON.parse(raw);
        if (!data || data.v !== HISTORY_VERSION || typeof data.sessions !== 'object' || data.sessions === null) return empty();
        return data;
    } catch (error) {
        return empty();                     // damaged JSON, or storage blocked (private window): start fresh
    }
}

/** @returns {boolean} whether it was actually saved (false when storage is blocked or full) */
function saveHistory(history) {
    try {
        if (typeof localStorage === 'undefined' || !localStorage) return false;
        localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
        return true;
    } catch (error) {
        return false;                       // quota exceeded, or storage blocked
    }
}

/** The transponder whose history this device remembers, or null when nothing is stored yet. */
function historyOwner() {
    return loadHistory().ownerChip;
}

/**
 * Remembers one finished activity's laps, so it never has to be fetched again. Does nothing for an activity that
 * is not finished yet, one with no skating laps, one that is already stored, or one of a transponder that is not
 * the current owner of this device's history (call changeOwner first to switch). The first session ever remembered
 * makes its transponder the owner.
 * @param {object} activity  { id, startTime, endTime, location: { name, trackLength } }
 * @param {Array} laps       normalized laps ([{ nr, startMs, durMs }], see normalizeLaps in replay-model.js)
 * @returns {'stored'|'already-had-it'|'not-finished'|'no-laps'|'different-owner'|'storage-failed'}
 */
function rememberSession(chipCode, activity, laps) {
    const history = loadHistory();
    if (history.ownerChip && history.ownerChip !== chipCode) return 'different-owner';
    if (!isFinishedActivity(activity.startTime, activity.endTime)) return 'not-finished';
    if (!laps || laps.length === 0) return 'no-laps';
    const id = String(activity.id);
    if (history.sessions[id]) return 'already-had-it';
    history.ownerChip = chipCode;
    history.sessions[id] = {
        startTime: activity.startTime, endTime: activity.endTime,
        locationName: (activity.location && activity.location.name) || '',
        trackLengthM: (activity.location && activity.location.trackLength) || 400,
        laps: laps.map(lap => ({ nr: lap.nr, startMs: lap.startMs, durMs: lap.durMs })),
        excluded: false, excludedLaps: [], savedAt: Date.now()
    };
    return saveHistory(history) ? 'stored' : 'storage-failed';
}

/** Exclude (or bring back) a whole session: for example, it was not really you, or the chip malfunctioned that day. */
function setSessionExcluded(chipCode, activityId, excluded) {
    const history = loadHistory();
    if (history.ownerChip !== chipCode) return false;
    const session = history.sessions[String(activityId)];
    if (!session) return false;
    session.excluded = !!excluded;
    return saveHistory(history);
}

/** Exclude (or bring back) one lap of a session: for example a single mistimed crossing. */
function setLapExcluded(chipCode, activityId, lapNr, excluded) {
    const history = loadHistory();
    if (history.ownerChip !== chipCode) return false;
    const session = history.sessions[String(activityId)];
    if (!session) return false;
    const set = new Set(session.excludedLaps || []);
    if (excluded) set.add(lapNr); else set.delete(lapNr);
    session.excludedLaps = [...set].sort((a, b) => a - b);
    return saveHistory(history);
}

/** Forgets one session entirely (not just excludes it). */
function deleteSession(chipCode, activityId) {
    const history = loadHistory();
    if (history.ownerChip !== chipCode) return false;
    const id = String(activityId);
    if (!history.sessions[id]) return false;
    delete history.sessions[id];
    return saveHistory(history);
}

/** Forgets every stored session and makes newChipCode the new owner (used by "Change my transponder"). */
function changeOwner(newChipCode) {
    return saveHistory({ v: HISTORY_VERSION, ownerChip: newChipCode, sessions: {} });
}

/** The stored sessions, newest first, or an empty list when nothing is stored or it belongs to another transponder. */
function historySessions(chipCode) {
    const history = loadHistory();
    if (history.ownerChip && history.ownerChip !== chipCode) return [];
    return Object.keys(history.sessions)
        .map(id => ({ id: Number(id), ...history.sessions[id] }))
        .sort((a, b) => Date.parse(b.startTime) - Date.parse(a.startTime));
}

/** A rough size in kilobytes of everything stored on this device (for the "Change my transponder" warning). */
function historyStorageKB() {
    try {
        if (typeof localStorage === 'undefined' || !localStorage) return 0;
        const raw = localStorage.getItem(HISTORY_KEY);
        return raw ? Math.round((raw.length / 1024) * 10) / 10 : 0;
    } catch (error) {
        return 0;
    }
}

if (typeof module !== 'undefined') {
    module.exports = {
        loadHistory, saveHistory, historyOwner, rememberSession, setSessionExcluded, setLapExcluded,
        deleteSession, changeOwner, historySessions, historyStorageKB, HISTORY_VERSION, HISTORY_KEY
    };
}
