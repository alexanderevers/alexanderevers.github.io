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

function displayOverlappingSessions(sessions) {
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

    sessions.forEach(session => {
        const stats = session.stats;
        const card = document.createElement('div');
        card.className = 'session-card';
        if (session.togetherMs === 0) card.classList.add('no-overlap');

        const avatarUrl = session.account?.id ? `${PROXY_BASE_URL}/avatar/${encodeURIComponent(session.account.id)}` : 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
        const displayName = riderDisplayName(session);

        card.innerHTML = `
            <input type="checkbox" class="replay-select" data-activity-id="${session.id}" aria-label="Include ${escapeHtml(displayName)} in the replay">
            <img src="${avatarUrl}" class="session-card-avatar" alt="Rider Avatar" onerror="this.style.display='none'">
            <div class="session-card-main">
                <div class="session-card-header">
                    <span class="session-card-name">
                        <a href="?transponder=${encodeURIComponent(session.chipCode)}" target="_blank" rel="noopener">${escapeHtml(displayName)}</a>
                    </span>
                    <small>${formatDateTime(session.startTime)}</small>
                </div>
                <div class="session-card-stats">
                    <div class="session-stat together"><span class="label">Skated together</span><span class="value">${formatDurationShort(session.togetherMs)}</span></div>
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
        togetherMs: session.togetherMs ?? null
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
    function updateReplaySelection() {
        const boxes = replayCheckboxes();
        const count = selectedIds().length;
        selectedCount.textContent = `${count} of ${boxes.length} selected`;
        selectAllBtn.textContent = count === boxes.length ? 'Select none' : 'Select all';
    }
    document.addEventListener('overlapsrendered', updateReplaySelection);
    overlappingSessionsTable.addEventListener('change', event => {
        if (event.target.classList.contains('replay-select')) updateReplaySelection();
    });
    selectAllBtn.addEventListener('click', () => {
        const selectAll = selectedIds().length !== replayCheckboxes().length;
        replayCheckboxes().forEach(cb => { cb.checked = selectAll; });
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
        window.open(`replay.html?activity=${payload.reference.id}`, '_blank');
    });

    // Fetch details in small batches to avoid flooding the proxy (2 calls per rider).
    async function mapInBatches(items, batchSize, fn) {
        const results = [];
        for (let i = 0; i < items.length; i += batchSize) {
            results.push(...await Promise.all(items.slice(i, i + batchSize).map(fn)));
        }
        return results;
    }

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
                referenceLaps = normalizeLaps(await fetchLaps(selectedActivity.id));
            } catch (e) {
                console.error('Could not fetch the selected activity laps; skipping the "skated together" times', e);
            }

            const overlappingWithDetails = await mapInBatches(overlapping, 5, async (activity) => {
                try {
                    const [sessionDetails, accountDetails] = await Promise.all([
                        fetchLaps(activity.id),
                        fetchAccountDetails(activity.chipCode)
                    ]);
                    const togetherMs = referenceLaps
                        ? onIceOverlapMs(referenceLaps, normalizeLaps(sessionDetails), trackLengthM)
                        : null;
                    return { ...activity, stats: sessionDetails.stats, account: accountDetails, togetherMs };
                } catch (e) {
                    console.error(`Could not fetch details for activity ${activity.id}`, e);
                    return { ...activity, stats: null, account: null, togetherMs: null };
                }
            });

            // Most time on the ice together first; riders we could not measure go last.
            overlappingWithDetails.sort((a, b) => (b.togetherMs ?? -1) - (a.togetherMs ?? -1));

            lastOverlap = { reference: selectedActivity, sessions: overlappingWithDetails };
            displayOverlappingSessions(overlappingWithDetails);

        } catch (error) {
            console.error("Error fetching overlapping sessions:", error);
            errorDiv.textContent = `Error: ${error.message}`;
            show(errorDiv);
        } finally {
            hide(loadingDiv);
        }
    });
}