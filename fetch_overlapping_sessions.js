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

function displayOverlappingSessions(sessions) {
    const overlappingSessionsTable = document.getElementById('overlappingSessionsTable');
    const overlappingSessions = document.getElementById('overlappingSessions');

    overlappingSessionsTable.innerHTML = ''; // Clear previous results
    if (sessions.length === 0) {
        overlappingSessionsTable.innerHTML = '<p>No overlapping sessions found.</p>';
        show(overlappingSessions);
        return;
    }

    sessions.forEach(session => {
        const stats = session.stats;
        const card = document.createElement('div');
        card.className = 'session-card';

        const avatarUrl = session.account?.id ? `${PROXY_BASE_URL}/avatar/${session.account.id}` : 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

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

        card.innerHTML = `
            <img src="${avatarUrl}" class="session-card-avatar" alt="Rider Avatar" onerror="this.style.display='none'">
            <div class="session-card-main">
                <div class="session-card-header">
                    <span class="session-card-name">
                        <a href="?transponder=${session.chipCode}" target="_blank">${displayName}</a>
                    </span>
                    <small>${formatDateTime(session.startTime)}</small>
                </div>
                <div class="session-card-stats">
                    <div class="session-stat"><span class="label">Best Lap</span><span class="value">${stats?.fastestTime || 'N/A'}</span></div>
                    <div class="session-stat"><span class="label">Laps</span><span class="value">${stats?.lapCount || 'N/A'}</span></div>
                    <div class="session-stat"><span class="label">Duration</span><span class="value">${stats ? formatTotalTrainingTime(stats.totalTrainingTime) : 'N/A'}</span></div>
                    <div class="session-stat"><span class="label">Avg Lap</span><span class="value">${stats?.averageTime || 'N/A'}</span></div>
                </div>
            </div>
        `;
        overlappingSessionsTable.appendChild(card);
    });

    show(overlappingSessions);
}

function setupOverlappingSessionsEventListeners(getActivities) {
    const fetchOverlappingBtn = document.getElementById('fetchOverlappingBtn');
    const activitySelect = document.getElementById('activitySelect');
    const errorDiv = document.getElementById('error');
    const loadingDiv = document.getElementById('loading');
    const overlappingSessions = document.getElementById('overlappingSessions');

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

            const overlappingWithDetails = await Promise.all(overlapping.map(async (activity) => {
                try {
                    const [sessionDetails, accountDetails] = await Promise.all([
                        fetchLaps(activity.id),
                        fetchAccountDetails(activity.chipCode)
                    ]);
                    return { ...activity, stats: sessionDetails.stats, account: accountDetails };
                } catch (e) {
                    console.error(`Could not fetch details for activity ${activity.id}`, e);
                    return { ...activity, stats: null, account: null };
                }
            }));

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