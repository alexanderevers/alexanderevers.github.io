// This script depends on api.js and utils.js being loaded first.

function sessions_overlap(activity1, activity2) {
    const start1 = new Date(activity1.startTime);
    const end1 = activity1.endTime ? new Date(activity1.endTime) : null;
    const start2 = new Date(activity2.startTime);
    const end2 = activity2.endTime ? new Date(activity2.endTime) : null;

    if (end1 && end2) {
        return start1 < end2 && start2 < end1;
    }
    if (!end1 && end2) {
        return start2 < start1 || (start1 <= start2 && start2 < end2);
    }
    if (end1 && !end2) {
        return start1 < start2 || (start2 <= start1 && start1 < end1);
    }
    return true; // If both are ongoing, they overlap
}

const REPLAY_STORAGE_KEY = 'replayData';

/**
 * Order of the overlapping riders, by what the cards show: longest time in your group first (whole minutes).
 * Riders with the same group minutes, in particular everyone at 0 min, go by time skated together (whole
 * minutes). Exact times only break the remaining ties. Riders we could not measure (null) come last.
 */
function compareOverlappingRiders(a, b) {
    const shownMinutes = ms => (ms === null || ms === undefined ? -1 : Math.round(ms / 60000));
    const exact = ms => (ms === null || ms === undefined ? -1 : ms);
    return (shownMinutes(b.groupMs) - shownMinutes(a.groupMs))
        || (shownMinutes(b.togetherMs) - shownMinutes(a.togetherMs))
        || (exact(b.groupMs) - exact(a.groupMs))
        || (exact(b.togetherMs) - exact(a.togetherMs));
}

/** Runs fn over the items a few at a time, to avoid flooding the proxy (2 calls per rider). */
async function mapInBatches(items, batchSize, fn, onProgress) {
    const results = [];
    for (let i = 0; i < items.length; i += batchSize) {
        results.push(...await Promise.all(items.slice(i, i + batchSize).map(fn)));
        if (onProgress) onProgress(results.length, items.length);
    }
    return results;
}

/**
 * Everyone who was on the ice during an activity, with the time skated together and the time in your group,
 * in the order shown on the main page. Used by the main page and by the replay page (which rebuilds its riders
 * from a shared link).
 * @param {object} selectedActivity  an activity of the reference rider (location, startTime, endTime, id)
 * @param {function} [onStatus]      called with a progress text
 */
async function loadOverlappingRiders(selectedActivity, onStatus = () => {}) {
    const { location, startTime } = selectedActivity;
    const year = new Date(startTime).getFullYear();

    const allActivities = await fetchAllActivitiesFromLocation(location.id, year, location.sport, startTime);

    const overlapping = allActivities.filter(activity =>
        activity.id !== selectedActivity.id && sessions_overlap(selectedActivity, activity)
    );

    // The selected rider's own laps, to work out how long each rider actually skated at the same time.
    const trackLengthM = location.trackLength || 400;
    let referenceLaps = null;
    try {
        referenceLaps = normalizeLaps(await fetchLaps(selectedActivity.id, selectedActivity.endTime, selectedActivity.startTime));
    } catch (e) {
        console.error('Could not fetch the selected activity laps; skipping the "skated together" times', e);
    }

    onStatus(`Loading ${overlapping.length} overlapping riders…`);
    const overlappingWithDetails = await mapInBatches(overlapping, 5, async (activity) => {
        try {
            const [sessionDetails, accountDetails] = await Promise.all([
                fetchLaps(activity.id, activity.endTime, activity.startTime),
                fetchAccountDetails(activity.chipCode)
            ]);
            const riderLaps = normalizeLaps(sessionDetails);
            const togetherMs = referenceLaps ? onIceOverlapMs(referenceLaps, riderLaps, trackLengthM) : null;
            // riderLaps is only kept until the group times are worked out below
            return { ...activity, stats: sessionDetails.stats, account: accountDetails, togetherMs, groupMs: null, riderLaps };
        } catch (e) {
            console.error(`Could not fetch details for activity ${activity.id}`, e);
            return { ...activity, stats: null, account: null, togetherMs: null, groupMs: null, riderLaps: null };
        }
    }, (done, total) => {
        onStatus(`Loading overlapping riders… ${done} of ${total}`);
    });

    // Who skated in your group is decided from everyone's finish crossings together.
    if (referenceLaps) {
        const groupById = groupMembership(referenceLaps,
            overlappingWithDetails.filter(session => session.riderLaps).map(session => ({ id: session.id, laps: session.riderLaps })),
            trackLengthM);
        overlappingWithDetails.forEach(session => {
            session.groupMs = session.riderLaps ? (groupById.get(session.id) ?? 0) : null;
        });
    }
    overlappingWithDetails.forEach(session => { delete session.riderLaps; });

    overlappingWithDetails.sort(compareOverlappingRiders);
    return overlappingWithDetails;
}

/**
 * Address of the replay page for an activity and the riders that are shown. It holds everything the page needs
 * (transponder, activity, riders), so it works on any computer, not only where the replay was opened from.
 */
function replayAddress(transponder, activityId, riderIds) {
    const riders = riderIds && riderIds.length ? riderIds.join(',') : 'none';
    return `replay.html?transponder=${encodeURIComponent(transponder)}&activity=${activityId}&riders=${riders}`;
}

/** The rider activity ids of a "riders" address parameter: null when it is absent, [] for "none". */
function parseReplayRiders(param) {
    if (param === null || param === undefined) return null;
    return param.split(',').map(Number).filter(id => Number.isInteger(id) && id > 0);
}

/** Estimated durations get a "~" in front; N/A stays N/A. */
function formatEstimate(ms) {
    const text = formatDurationShort(ms);
    return text === 'N/A' ? text : `~${text}`;
}

function riderDisplayName(session) {
    let displayName = session.chipLabel || 'Unknown Rider';
    if (session.account) {
        const givenName = session.account.givenName || (session.account.name && session.account.name.givenName);
        const surName = session.account.name && session.account.name.surName;
        const nickName = session.account.name && session.account.name.nickName;
        const fullName = `${givenName || ''} ${surName || ''}`.trim();
        if (fullName && nickName) {
            displayName = `${fullName} - ${nickName}`;
        } else {
            displayName = fullName || session.chipLabel || 'Unknown Rider';
        }
    }
    return displayName;
}

/**
 * The list of everyone on the ice, drawn like a timing tower: position, rider, and bars that show how much of
 * your session you skated together and in the same group.
 * @param {number} [sessionMs] length of your session, the full width of the bars
 */
function displayOverlappingSessions(sessions, sessionMs = 0) {
    const overlappingSessionsTable = document.getElementById('overlappingSessionsTable');
    const overlappingSessions = document.getElementById('overlappingSessions');
    const replayToolbar = document.getElementById('replayToolbar');

    overlappingSessionsTable.innerHTML = ''; // Clear previous results
    hide(replayToolbar);
    if (sessions.length === 0) {
        overlappingSessionsTable.innerHTML = '<p>No overlapping sessions found.</p>';
        show(overlappingSessions);
        return;
    }
    show(replayToolbar);

    const meter = ms => {
        const share = sessionMs > 0 && ms > 0 ? Math.min(100, (ms / sessionMs) * 100) : 0;
        return `<span class="meter" role="presentation"><span style="width:${share.toFixed(1)}%"></span></span>`;
    };

    sessions.forEach((session, index) => {
        const stats = session.stats;
        const card = document.createElement('div');
        card.className = 'session-card';
        if (session.togetherMs === 0) card.classList.add('no-overlap');

        const avatarUrl = session.account?.id ? `${PROXY_BASE_URL}/avatar/${encodeURIComponent(session.account.id)}` : 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
        const displayName = riderDisplayName(session);

        card.innerHTML = `
            <span class="session-rank">${index + 1}</span>
            <input type="checkbox" class="replay-select" data-activity-id="${session.id}" data-together-ms="${session.togetherMs ?? ''}" aria-label="Include ${escapeHtml(displayName)} in the replay">
            <img src="${avatarUrl}" class="session-card-avatar" alt="Rider Avatar" onerror="this.style.display='none'">
            <div class="session-card-main">
                <div class="session-card-header">
                    <span class="session-card-name">
                        <a href="?transponder=${encodeURIComponent(session.chipCode)}" target="_blank" rel="noopener">${escapeHtml(displayName)}</a>
                    </span>
                    <small>${formatDateTime(session.startTime)}</small>
                </div>
                <div class="session-card-stats">
                    <div class="session-stat together"><span class="label">Skated together</span><span class="value">${formatDurationShort(session.togetherMs)}</span>${meter(session.togetherMs)}</div>
                    <div class="session-stat together" title="Time you skated in the same group: riders crossing the finish line within 1 second of you, or within 1 second of the rider before them in that chain, up to a quarter of a lap before and after you"><span class="label">In your group</span><span class="value">${formatEstimate(session.groupMs)}</span>${meter(session.groupMs)}</div>
                    <div class="session-stat"><span class="label">Best Lap</span><span class="value">${stats?.fastestTime || 'N/A'}</span></div>
                    <div class="session-stat"><span class="label">Laps</span><span class="value">${stats?.lapCount || 'N/A'}</span></div>
                    <div class="session-stat"><span class="label">Duration</span><span class="value">${stats ? formatTotalTrainingTime(stats.totalTrainingTime) : 'N/A'}</span></div>
                    <div class="session-stat"><span class="label">Avg Lap</span><span class="value">${stats?.averageTime || 'N/A'}</span></div>
                </div>
            </div>
        `;
        overlappingSessionsTable.appendChild(card);
    });

    document.dispatchEvent(new CustomEvent('overlapsrendered'));
    show(overlappingSessions);
    if (typeof Dashboards !== 'undefined') Dashboards.goTo('overlappingSessions');
}

/**
 * Everything replay.html needs, without lap data (the replay page fetches laps for the riders it shows).
 * The reference rider (the person whose activity was selected) is the first rider.
 */
function buildReplayPayload(reference, referenceRider, sessions, selectedIds) {
    const toRider = (session, isReference) => ({
        id: session.id,
        isReference,
        chipCode: session.chipCode,
        name: isReference ? referenceRider.name : riderDisplayName(session),
        accountId: isReference ? referenceRider.accountId : (session.account?.id || null),
        startTime: session.startTime,
        endTime: session.endTime || null,
        fastestTime: session.stats?.fastestTime || null,
        lapCount: session.stats?.lapCount || null,
        togetherMs: session.togetherMs ?? null,
        groupMs: session.groupMs ?? null
    });
    return {
        version: 1,
        createdAt: Date.now(),
        location: { name: reference.location.name, sport: reference.location.sport },
        trackLengthM: reference.location.trackLength || 400,
        reference: { id: reference.id, chipCode: referenceRider.chipCode },
        riders: [
            toRider({ ...reference, chipCode: referenceRider.chipCode, stats: null }, true),
            ...sessions.map(session => toRider(session, false))
        ],
        selected: selectedIds
    };
}

function setupOverlappingSessionsEventListeners(getActivities, getReferenceRider) {
    const fetchOverlappingBtn = document.getElementById('fetchOverlappingBtn');
    const activitySelect = document.getElementById('activitySelect');
    const errorDiv = document.getElementById('error');
    const loadingDiv = document.getElementById('loading');
    const overlappingSessions = document.getElementById('overlappingSessions');
    const overlappingSessionsTable = document.getElementById('overlappingSessionsTable');
    const openReplayBtn = document.getElementById('openReplayBtn');
    const selectAllBtn = document.getElementById('replaySelectAllBtn');
    const selectedCount = document.getElementById('replaySelectedCount');

    let lastOverlap = null; // { reference, sessions } of the most recent search

    const replayCheckboxes = () => [...overlappingSessionsTable.querySelectorAll('.replay-select')];
    const selectedIds = () => replayCheckboxes().filter(cb => cb.checked).map(cb => Number(cb.dataset.activityId));
    // "Select all" only picks riders who really skated with you (more than 0 min). If none of the riders
    // could be measured (no lap data for your own activity), it falls back to everyone.
    const hasTogetherTime = cb => Number(cb.dataset.togetherMs) > 0;
    function selectAllTargets() {
        const boxes = replayCheckboxes();
        const measured = boxes.some(cb => cb.dataset.togetherMs !== '');
        return measured ? boxes.filter(hasTogetherTime) : boxes;
    }
    function updateReplaySelection() {
        const boxes = replayCheckboxes();
        const count = selectedIds().length;
        selectedCount.textContent = `${count} of ${boxes.length} selected`;
        const targets = selectAllTargets();
        const allTargetsSelected = targets.length > 0 && targets.every(cb => cb.checked);
        selectAllBtn.textContent = allTargetsSelected ? 'Select none' : `Select all skated together (${targets.length})`;
        selectAllBtn.disabled = targets.length === 0;
    }
    document.addEventListener('overlapsrendered', updateReplaySelection);
    overlappingSessionsTable.addEventListener('change', event => {
        if (event.target.classList.contains('replay-select')) updateReplaySelection();
    });
    selectAllBtn.addEventListener('click', () => {
        const targets = selectAllTargets();
        const allTargetsSelected = targets.length > 0 && targets.every(cb => cb.checked);
        if (allTargetsSelected) {
            replayCheckboxes().forEach(cb => { cb.checked = false; });
        } else {
            targets.forEach(cb => { cb.checked = true; });
        }
        updateReplaySelection();
    });
    openReplayBtn.addEventListener('click', () => {
        if (!lastOverlap) return;
        const payload = buildReplayPayload(lastOverlap.reference, getReferenceRider(), lastOverlap.sessions, selectedIds());
        try {
            localStorage.setItem(REPLAY_STORAGE_KEY, JSON.stringify(payload));
        } catch (error) {
            errorDiv.textContent = 'Could not open the replay: browser storage is not available.';
            show(errorDiv);
            return;
        }
        window.open(replayAddress(payload.reference.chipCode, payload.reference.id, payload.selected), '_blank');
    });

    fetchOverlappingBtn.addEventListener('click', async () => {
        const userActivities = getActivities();
        const selectedActivityId = activitySelect.value;
        if (!selectedActivityId) {
            errorDiv.textContent = "Please select an activity first.";
            show(errorDiv);
            return;
        }

        hide(errorDiv);
        hide(overlappingSessions);
        show(loadingDiv);

        try {
            const selectedActivity = userActivities.find(act => act.id === parseInt(selectedActivityId));
            if (!selectedActivity) {
                throw new Error("Could not find the selected activity details.");
            }

            const overlappingWithDetails = await loadOverlappingRiders(selectedActivity, text => { loadingDiv.textContent = text; });

            lastOverlap = { reference: selectedActivity, sessions: overlappingWithDetails };
            displayOverlappingSessions(overlappingWithDetails, Date.parse(selectedActivity.endTime) - Date.parse(selectedActivity.startTime));

        } catch (error) {
            console.error("Error fetching overlapping sessions:", error);
            errorDiv.textContent = `Error: ${error.message}`;
            show(errorDiv);
        } finally {
            hide(loadingDiv);
            loadingDiv.textContent = 'Loading...';
        }
    });
}