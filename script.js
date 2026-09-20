document.addEventListener('DOMContentLoaded', () => {
    const transponderInput = document.getElementById('transponderInput');
    const fetchActivitiesBtn = document.getElementById('fetchActivitiesBtn');
    const loadingDiv = document.getElementById('loading');
    const errorDiv = document.getElementById('error');
    const activitiesListDiv = document.getElementById('activitiesList');
    const activitySelect = document.getElementById('activitySelect');
    const fetchLapsBtn = document.getElementById('fetchLapsBtn');
    const downloadGpxBtn = document.getElementById('downloadGpxBtn');
    const sessionSummaryContainer = document.getElementById('sessionSummary');
    const lapsDataDiv = document.getElementById('lapsData');
    const maxFastLapControls = document.getElementById('maxFastLapControls');
    const mainLapChartCanvas = document.getElementById('mainLapChart');
    const mainChartContainer = document.getElementById('mainChartContainer');
    const maxFastLapSlider = document.getElementById('maxFastLapSlider');
    const maxFastLapInput = document.getElementById('maxFastLapInput');
    const maxFastLapValueError = document.getElementById('maxFastLapValueError');
    const transponderDatalist = document.getElementById('transponder-list');
    const activityInfoPanel = document.getElementById('activityInfoPanel');
    const activityInfoTable = document.getElementById('activityInfoTable');
    const profileInfoDiv = document.getElementById('profile-info');
    const profileAvatar = document.getElementById('profile-avatar');
    const profileName = document.getElementById('profile-name');
    const profileNickname = document.getElementById('profile-nickname');
    const fetchOverlappingBtn = document.getElementById('fetchOverlappingBtn');
    const overlappingSessions = document.getElementById('overlappingSessions');
    const overlappingSessionsTable = document.getElementById('overlappingSessionsTable');
    const speedStatsContainer = document.getElementById('speedStats');
    const speedBlocksContainer = document.getElementById('speedBlocks');
    const distributionSection = document.getElementById('distributionSection');
    const distributionChartCanvas = document.getElementById('distributionChart');
    const yearFilter = document.getElementById('yearFilter');
    const yearFilterWrap = document.getElementById('yearFilterWrap');

    const TRANSPONDER_COOKIE_KEY = 'savedTransponders';

    let userActivities = [];
    let currentUserId = null;
    let mainLapChart = null;
    let distributionChart = null;
    let currentLapData = [];
    let currentTrackLength = 400; // Standaardwaarde, wordt bijgewerkt bij activiteitselectie
    // The "lap time threshold" is remembered between visits (when it is a value the slider can show).
    const savedMaxFastLap = Number(loadSetting('maxFastLapSeconds', NaN));
    if (Number.isFinite(savedMaxFastLap) && savedMaxFastLap >= parseFloat(maxFastLapSlider.min) && savedMaxFastLap <= parseFloat(maxFastLapSlider.max)) {
        maxFastLapSlider.value = savedMaxFastLap;
    }
    let MAX_FAST_LAP_TIME_SECONDS = parseFloat(maxFastLapSlider.value);
    let generatedGpxFilename = 'training_session.gpx'; // Variabele voor de bestandsnaam
    let showOnlySpeedLaps = false;
    // The page is a row of full-screen dashboards; after loading something, go to the dashboard that shows it.
    const goToDashboard = id => { if (typeof Dashboards !== 'undefined') Dashboards.goTo(id); };
    // A shared link (?transponder=XX-12345&activity=123) opens straight on that session.
    let pendingActivityId = null;

    /** The address of the page for this transponder (and activity), so the address bar can be shared. */
    function addressFor(transponder, activityId) {
        const params = new URLSearchParams({ transponder });
        if (activityId) params.set('activity', activityId);
        return `${window.location.pathname}?${params}`;
    }

    function updateAddressBar() {
        const transponder = transponderInput.value.trim().toUpperCase();
        if (!currentUserId || !isValidTransponderFormat(transponder)) return;
        try {
            window.history.replaceState({}, '', addressFor(transponder, activitySelect.value));
        } catch {
            // some browsers refuse this (for example on a file:// page): the link is just not updated
        }
    }

    function destroyCharts() {
        if (mainLapChart) { mainLapChart.destroy(); mainLapChart = null; }
        if (distributionChart) { distributionChart.destroy(); distributionChart = null; }
    }

    // Charts read their colors from CSS tokens, so redraw when the OS theme flips.
    const redrawForTheme = () => {
        if (currentLapData.length > 0) updateCharts(currentLapData);
    };
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', redrawForTheme);
    document.addEventListener('themechange', redrawForTheme);

    function resetUI() {
        hide(loadingDiv); hide(errorDiv); hide(activitiesListDiv); hide(lapsDataDiv);
        hide(maxFastLapControls); hide(sessionSummaryContainer);
        hide(activityInfoPanel); resetGpxState(downloadGpxBtn); hide(overlappingSessions); hide(fetchOverlappingBtn);
        profileInfoDiv.style.display = 'none'; // Force hide with inline style
        errorDiv.textContent = '';
        hide(yearFilterWrap);
        yearFilter.innerHTML = '';
        activitySelect.innerHTML = '<option value="">Select an activity</option>';
        fetchLapsBtn.disabled = true;
        fetchOverlappingBtn.disabled = true;
        sessionSummaryContainer.innerHTML = '';
        activityInfoTable.innerHTML = '';
        overlappingSessionsTable.innerHTML = '';
        userActivities = []; currentLapData = []; currentUserId = null;
        profileName.textContent = '';
        profileNickname.textContent = '';
        profileAvatar.onerror = null;
        profileAvatar.removeAttribute('src');   // (src = "" would make the browser try to load a picture again)
        generatedGpxFilename = 'training_session.gpx'; // Reset de bestandsnaam
        destroyCharts();
        speedStatsContainer.innerHTML = '';
        speedBlocksContainer.innerHTML = '';
    }
    
    // Average of a transponder data attribute (VOLTAGE / TEMPERATURE) over all laps that report it.
    function averageDataAttribute(laps, type) {
        const values = laps
            .map(lap => lap.dataAttributes?.find(a => a.type === type)?.value)
            .filter(v => typeof v === 'number');
        return values.length ? (values.reduce((sum, v) => sum + v, 0) / values.length).toFixed(1) : 'N/A';
    }

    function updateSpeedLapDistance() {
        if (currentLapData.length === 0) return;
    
        const speedLaps = currentLapData.filter(lap => {
            const durationInSeconds = parseDurationToSeconds(lap.duration);
            return !isNaN(durationInSeconds) && durationInSeconds < MAX_FAST_LAP_TIME_SECONDS;
        });
        const speedLapsDistanceInMeters = speedLaps.length * currentTrackLength;
        const speedLapsDistanceInKm = (speedLapsDistanceInMeters / 1000).toFixed(2);
    
        const speedLapElement = document.querySelector('.speed-laps-distance-value');
        if (speedLapElement) {
            speedLapElement.innerHTML = `${speedLapsDistanceInKm} <span class="sub-value">km</span>`;
        }
    }

    function updateCharts(lapData) {
        if (!lapData || lapData.length === 0) return;

        const dataToDisplay = showOnlySpeedLaps
            ? lapData.filter(lap => {
                const durationInSeconds = parseDurationToSeconds(lap.duration);
                return !isNaN(durationInSeconds) && durationInSeconds < MAX_FAST_LAP_TIME_SECONDS;
            })
            : lapData;

        updateMainLapChart(dataToDisplay);
        updateSpeedAnalysis();
    }

    function updateSpeedAnalysis() {
        const analysis = analyzeSpeedLaps(currentLapData, MAX_FAST_LAP_TIME_SECONDS, currentTrackLength);
        renderSpeedAnalysis(speedStatsContainer, speedBlocksContainer, analysis, currentTrackLength);
        if (distributionChart) { distributionChart.destroy(); distributionChart = null; }
        distributionSection.classList.toggle('hidden', !analysis);
        if (analysis) {
            distributionChart = new Chart(distributionChartCanvas, buildDistributionChartConfig(analysis.times));
        }
    }

    function updateMainLapChart(lapData) {
        const analysis = analyzeSpeedLaps(currentLapData, MAX_FAST_LAP_TIME_SECONDS, currentTrackLength);
        if (mainLapChart) mainLapChart.destroy();
        mainLapChart = new Chart(mainLapChartCanvas, buildOverviewChartConfig(lapData, MAX_FAST_LAP_TIME_SECONDS, analysis?.avg));
    }

    function displayProfileInfo(account, userId) {
        // Always hide profile info at the start of this function to prevent flash of old content
        profileInfoDiv.style.display = 'none';
        profileAvatar.style.display = 'none'; // Also hide avatar by default

        if (account) {
            let name = '';
            // Handle both possible account info structures
            if (account.name && (account.name.givenName || account.name.surName)) {
                name = `${account.name.givenName || ''} ${account.name.surName || ''}`.trim();
            } else if (account.givenName || account.surName) {
                name = `${account.givenName || ''} ${account.surName || ''}`.trim();
            }

            if (name) {
                profileName.textContent = name;
                profileNickname.textContent = account.name.nickName || ''; // Use the nested nickName field
                profileInfoDiv.style.display = 'flex'; // Show the name/nickname container

                const avatarUrl = `${PROXY_BASE_URL}/avatar/${userId}`;

                // Set up handlers before setting src to avoid race conditions
                profileAvatar.onload = () => {
                    profileAvatar.style.display = 'block'; // Show the avatar if it loads
                };

                profileAvatar.onerror = () => {
                    // No picture: remove it. Setting src to "" here would fail again, over and over, and the page would never finish loading.
                    profileAvatar.onerror = null;
                    profileAvatar.removeAttribute('src');
                    profileAvatar.style.display = 'none'; // Keep avatar hidden on error
                };

                profileAvatar.src = avatarUrl;
            }
        }
    }

    // The activity list can hold hundreds of sessions, so it can be narrowed down to one year.
    function fillYearFilter() {
        const years = activityYearCounts(userActivities);
        yearFilter.innerHTML = `<option value="all">All years (${userActivities.length})</option>`
            + years.map(({ year, count }) => `<option value="${year}">${year} (${count})</option>`).join('');
        yearFilter.value = 'all';
        yearFilterWrap.classList.toggle('hidden', years.length < 2);   // one year needs no filter
    }

    function fillActivitySelect() {
        const previous = activitySelect.value;
        activitySelect.innerHTML = '<option value="">Select an activity</option>';
        filterActivitiesByYear(userActivities, yearFilter.value || 'all').forEach(activity => {
            const option = document.createElement('option');
            option.value = activity.id;
            option.textContent = `${formatDateTime(activity.startTime)} - ${activity.location.sport} - ${activity.location.name}`;
            activitySelect.appendChild(option);
        });
        if (previous && [...activitySelect.options].some(option => option.value === previous)) {
            activitySelect.value = previous;                                // the selected activity is in this year: keep it
        } else if (previous) {
            activitySelect.dispatchEvent(new Event('change'));              // it is not: clear laps, charts and buttons
        }
        fetchLapsBtn.disabled = !activitySelect.value;
    }
    yearFilter.addEventListener('change', fillActivitySelect);

    fetchActivitiesBtn.addEventListener('click', async () => {
        resetUI();
        const transponder = transponderInput.value.trim().toUpperCase();
        if (!transponder || !isValidTransponderFormat(transponder)) {
            errorDiv.textContent = "Invalid transponder format. Expected: XX-12345.";
            show(errorDiv);
            return;
        }
        const newUrl = addressFor(transponder, pendingActivityId);
        window.history.pushState({ path: newUrl }, '', newUrl);
        show(loadingDiv);
        try {
            const { activities, account, userId } = await fetchActivities(transponder);
            userActivities = activities;
            currentUserId = userId;

            displayProfileInfo(account, userId);
            if (typeof Pwa !== 'undefined') Pwa.useTransponder(transponder);   // "Install" now installs the app of this transponder
            saveTransponder(transponder, TRANSPONDER_COOKIE_KEY);
            loadSavedTransponders(TRANSPONDER_COOKIE_KEY, transponderDatalist);
            hide(loadingDiv);
            if (userActivities.length > 0) {
                fillYearFilter();
                fillActivitySelect();
                show(activitiesListDiv);
                fetchLapsBtn.disabled = !activitySelect.value;
                if (pendingActivityId) {
                    const wanted = [...activitySelect.options].find(option => option.value === pendingActivityId);
                    if (wanted) {
                        activitySelect.value = pendingActivityId;
                        activitySelect.dispatchEvent(new Event('change'));
                        fetchLapsBtn.click();
                    } else {
                        errorDiv.textContent = `Activity ${pendingActivityId} was not found for this transponder.`;
                        show(errorDiv);
                        updateAddressBar();
                    }
                    pendingActivityId = null;
                }
            } else {
                errorDiv.textContent = "No activities found for this transponder.";
                show(errorDiv);
            }
        } catch (error) {
            console.error("Error fetching activities:", error);
            hide(loadingDiv);
            pendingActivityId = null;
            errorDiv.textContent = `Error: ${error.message}. Please check the transponder number.`;
            show(errorDiv);
        }
    });

    fetchLapsBtn.addEventListener('click', async () => {
        hide(lapsDataDiv); hide(errorDiv); hide(maxFastLapControls);
        hide(sessionSummaryContainer);
        sessionSummaryContainer.innerHTML = '';
        resetGpxState(downloadGpxBtn);
        generatedGpxFilename = 'training_session.gpx';

        const selectedActivityId = activitySelect.value;
        if (!selectedActivityId) {
            errorDiv.textContent = "Please select an activity from the list.";
            show(errorDiv);
            return;
        }
        show(loadingDiv);
        try {
            const selectedActivity = userActivities.find(act => act.id === parseInt(selectedActivityId));
            const fullSessionData = await fetchLaps(selectedActivityId, selectedActivity?.endTime);
            currentLapData = [];
            if (fullSessionData?.sessions) {
                fullSessionData.sessions.forEach(session => {
                    if (session.laps?.length) currentLapData.push(...session.laps);
                });
            }
            hide(loadingDiv);
            if (fullSessionData.stats) {
                const { stats, bestLap } = fullSessionData;

                // Bereken de afstanden
                const totalDistanceInMeters = currentLapData.length * currentTrackLength;
                const speedLaps = currentLapData.filter(lap => {
                    const durationInSeconds = parseDurationToSeconds(lap.duration);
                    return !isNaN(durationInSeconds) && durationInSeconds < MAX_FAST_LAP_TIME_SECONDS;
                });
                const speedLapsDistanceInMeters = speedLaps.length * currentTrackLength;

                const totalDistanceInKm = (totalDistanceInMeters / 1000).toFixed(2);
                const speedLapsDistanceInKm = (speedLapsDistanceInMeters / 1000).toFixed(2);

                const activeTime = activeTimeShare(stats);
                sessionSummaryContainer.innerHTML = `
                    <div class="stat-card"><span class="label">Total Laps</span><span class="value">${stats.lapCount || 'N/A'}</span></div>
                    <div class="stat-card">
                        <span class="label">Best Lap</span>
                        <span class="value">
                            ${stats.fastestTime || 'N/A'}
                            <br><span class="best-lap-number">(Lap ${bestLap.lapNr || 'N/A'})</span>
                        </span>
                    </div>
                    <div class="stat-card"><span class="label">Average Lap</span><span class="value">${stats.averageTime || 'N/A'}</span></div>
                    <div class="stat-card"><span class="label">Total Time</span><span class="value">${formatTotalTrainingTime(stats.totalTrainingTime) || 'N/A'}</span></div>
                    <div class="stat-card" title="Time spent skating (the laps). The rest of the session you were standing still or resting.">
                        <span class="label">Active Time</span>
                        <span class="value">
                            ${activeTime ? formatTotalTrainingTime(stats.activeTrainingTime) : 'N/A'}
                            ${activeTime ? `<br><span class="speed-laps-distance-value">${Math.round(activeTime.share * 100)}% of total time</span>` : ''}
                        </span>
                    </div>
                    <div class="stat-card">
                        <span class="label">Total Distance</span>
                        <span class="value">
                            ${totalDistanceInKm} <span class="sub-value">km</span> /
                            <br><span class="speed-laps-distance-value">${speedLapsDistanceInKm} <span class="sub-value">km</span></span>
                        </span>
                    </div>
                    <div class="stat-card"><span class="label">Avg Speed</span><span class="value">${stats.averageSpeed?.kph?.toFixed(1) || 'N/A'}</span><span class="sub-value"> km/h</span></div>
                    <div class="stat-card"><span class="label">Top Speed</span><span class="value">${stats.fastestSpeed?.kph?.toFixed(1) || 'N/A'}</span><span class="sub-value"> km/h</span></div>
                    <div class="stat-card">
                        <span class="label">Avg Transponder</span>
                        <span class="value">${averageDataAttribute(currentLapData, 'VOLTAGE')} <span class="sub-value">V</span></span>
                        <br><span class="speed-laps-distance-value">${averageDataAttribute(currentLapData, 'TEMPERATURE')} <span class="sub-value">°C</span></span>
                    </div>`;
                show(sessionSummaryContainer);
            }
            show(lapsDataDiv);
            if (currentLapData.length > 0) {
                show(maxFastLapControls);
                updateCharts(currentLapData);

                // Bouw de bestandsnaam op
                if (selectedActivity) {
                    const sport = selectedActivity.location.sport.replace(/\s+/g, '');
                    const location = selectedActivity.location.name.replace(/\s+/g, '_');
                    const date = new Date(selectedActivity.startTime);
                    const year = date.getFullYear();
                    const month = String(date.getMonth() + 1).padStart(2, '0');
                    const day = String(date.getDate()).padStart(2, '0');
                    const dateString = `${year}-${month}-${day}`;
                    generatedGpxFilename = `${sport}-${location}-${dateString}-session.gpx`;
                }

                generateAndPrepareGpxDownload(currentLapData, downloadGpxBtn, selectedActivity?.location);
                goToDashboard('dashSession');
            } else {
                hide(lapsDataDiv);
                errorDiv.textContent = 'No lap data found for the selected activity.';
                show(errorDiv);
            }
        } catch (error) {
            console.error("Error fetching laps:", error);
            hide(loadingDiv);
            errorDiv.textContent = `Error: ${error.message}. Could not retrieve lap data.`;
            show(errorDiv);
            hide(lapsDataDiv);
        }
    });

    downloadGpxBtn.addEventListener('click', () => {
        handleGpxDownload(generatedGpxFilename);
    });

    activitySelect.addEventListener('change', () => {
        hide(lapsDataDiv); hide(errorDiv); hide(maxFastLapControls);
        hide(sessionSummaryContainer); hide(overlappingSessions);
        const hasSelection = !!activitySelect.value;
        fetchLapsBtn.disabled = !hasSelection;
        fetchOverlappingBtn.disabled = !hasSelection;
        if (hasSelection) {
            show(fetchOverlappingBtn);
        } else {
            hide(fetchOverlappingBtn);
        }
        destroyCharts();
        currentLapData = [];
        const selectedActivityId = activitySelect.value;
        if (selectedActivityId) {
            const activity = userActivities.find(act => act.id === parseInt(selectedActivityId));
            if (activity) {
                currentTrackLength = activity.location.trackLength || 400; // Update track length
                activityInfoTable.innerHTML = `
                    <table class="activity-info-table">
                        <tbody>
                            <tr><td>Sport:</td><td>${escapeHtml(activity.location.sport)}</td></tr>
                            <tr><td>Location:</td><td>${escapeHtml(activity.location.name)}</td></tr>
                            <tr><td>Start Time:</td><td>${formatDateTime(activity.startTime)}</td></tr>
                        </tbody>
                    </table>`;
                show(activityInfoPanel);
            }
        } else {
            hide(activityInfoPanel);
            activityInfoTable.innerHTML = '';
        }
        updateAddressBar();
    });

    maxFastLapSlider.addEventListener('input', () => {
        MAX_FAST_LAP_TIME_SECONDS = parseFloat(maxFastLapSlider.value);
        saveSetting('maxFastLapSeconds', MAX_FAST_LAP_TIME_SECONDS);
        maxFastLapInput.value = formatSecondsToDuration(MAX_FAST_LAP_TIME_SECONDS);
        hide(maxFastLapValueError);
        if (currentLapData.length > 0) {
            updateCharts(currentLapData);
            updateSpeedLapDistance();
        }
    });
    
    maxFastLapInput.addEventListener('input', () => {
        const inputText = maxFastLapInput.value.trim();
        const parsedSeconds = parseDurationToSeconds(inputText);
        const sliderMin = parseFloat(maxFastLapSlider.min);
        const sliderMax = parseFloat(maxFastLapSlider.max);
        if (isNaN(parsedSeconds) || parsedSeconds < sliderMin || parsedSeconds > sliderMax) {
            maxFastLapValueError.textContent = `Invalid time or out of range (${formatSecondsToDuration(sliderMin)} - ${formatSecondsToDuration(sliderMax)})`;
            show(maxFastLapValueError);
        } else {
            hide(maxFastLapValueError);
            MAX_FAST_LAP_TIME_SECONDS = parsedSeconds;
            saveSetting('maxFastLapSeconds', MAX_FAST_LAP_TIME_SECONDS);
            maxFastLapSlider.value = parsedSeconds;
            if (currentLapData.length > 0) {
                updateCharts(currentLapData);
                updateSpeedLapDistance();
            }
        }
    });

    loadSavedTransponders(TRANSPONDER_COOKIE_KEY, transponderDatalist);

    // The transponder number is written as XX-12345 while typing: capitals, the dash by itself (a typed dash
    // is not added twice), five digits.
    transponderInput.addEventListener('input', event => {
        const deleting = typeof event.inputType === 'string' && event.inputType.startsWith('delete');
        const options = { trailingDash: !deleting };
        const formatted = formatTransponderInput(transponderInput.value, options);
        if (formatted === transponderInput.value) return;
        const caret = transponderInput.selectionStart;
        const position = formatTransponderInput(caret === null ? transponderInput.value : transponderInput.value.slice(0, caret), options).length;
        transponderInput.value = formatted;
        transponderInput.setSelectionRange(position, position);
    });
    // Pasted text that holds a whole number ("Transponder: pz - 28583") replaces the field as XX-12345.
    transponderInput.addEventListener('paste', event => {
        const found = findTransponderInText(event.clipboardData && event.clipboardData.getData('text'));
        if (!found) return;   // otherwise the text is pasted as usual and cleaned up by the input handler
        event.preventDefault();
        transponderInput.value = found;
        transponderInput.setSelectionRange(found.length, found.length);
    });
    maxFastLapSlider.value = parseFloat(maxFastLapSlider.value).toFixed(1);
    maxFastLapInput.value = formatSecondsToDuration(MAX_FAST_LAP_TIME_SECONDS);
    
    const toggleLapsBtn = document.getElementById('toggleLapsBtn');
    toggleLapsBtn.addEventListener('click', () => {
        showOnlySpeedLaps = !showOnlySpeedLaps;
        toggleLapsBtn.textContent = showOnlySpeedLaps ? 'Show All Laps' : 'Show Speed Laps';
        toggleLapsBtn.classList.toggle('active', showOnlySpeedLaps);
        if (currentLapData.length > 0) {
            updateCharts(currentLapData);
        }
    });

    resetUI();
    
    function handleUrlParameter() {
        const urlParams = new URLSearchParams(window.location.search);
        const transponderFromUrl = urlParams.get('transponder');
        const activityFromUrl = urlParams.get('activity');
        pendingActivityId = activityFromUrl && /^\d{1,15}$/.test(activityFromUrl) ? activityFromUrl : null;
        if (transponderFromUrl) {
            transponderInput.value = transponderFromUrl.toUpperCase();
            fetchActivitiesBtn.click();
        }
    }
    handleUrlParameter();

    // Setup event listeners from the new module
    const getReferenceRider = () => ({
        name: [profileName.textContent, profileNickname.textContent].filter(Boolean).join(' - ')
            || transponderInput.value.trim().toUpperCase(),
        chipCode: transponderInput.value.trim().toUpperCase(),
        accountId: currentUserId
    });
    setupOverlappingSessionsEventListeners(() => userActivities, getReferenceRider);
});