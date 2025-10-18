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
    const contextLapChartCanvas = document.getElementById('contextLapChart');
    const tableAndContextSection = document.getElementById('tableAndContextSection');
    const lapsTableContainer = document.getElementById('lapsTableContainer');
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

    const TRANSPONDER_COOKIE_KEY = 'savedTransponders';

    let userActivities = [];
    let currentUserId = null;
    let mainLapChart = null;
    let contextLapChart = null;
    let currentLapData = [];
    let currentTrackLength = 400; // Standaardwaarde, wordt bijgewerkt bij activiteitselectie
    let estimatedRowHeight = 28;
    let hoveredRowIndex = null;
    let MAX_FAST_LAP_TIME_SECONDS = parseFloat(maxFastLapSlider.value);
    let generatedGpxFilename = 'training_session.gpx'; // Variabele voor de bestandsnaam
    let showOnlySpeedLaps = false;

    Chart.register(ChartDataLabels);
    
    function resetUI() {
        hide(loadingDiv); hide(errorDiv); hide(activitiesListDiv); hide(lapsDataDiv);
        hide(maxFastLapControls); hide(tableAndContextSection); hide(sessionSummaryContainer);
        hide(activityInfoPanel); resetGpxState(downloadGpxBtn); hide(overlappingSessions); hide(fetchOverlappingBtn);
        profileInfoDiv.style.display = 'none'; // Force hide with inline style
        errorDiv.textContent = '';
        activitySelect.innerHTML = '<option value="">Select an activity</option>';
        fetchLapsBtn.disabled = true;
        fetchOverlappingBtn.disabled = true;
        lapsTableContainer.innerHTML = '';
        sessionSummaryContainer.innerHTML = '';
        activityInfoTable.innerHTML = '';
        overlappingSessionsTable.innerHTML = '';
        userActivities = []; currentLapData = []; currentUserId = null;
        profileName.textContent = '';
        profileNickname.textContent = '';
        profileAvatar.src = '';
        generatedGpxFilename = 'training_session.gpx'; // Reset de bestandsnaam
        if (mainChartContainer) mainChartContainer.style.height = '';
        if (mainLapChart) { mainLapChart.destroy(); mainLapChart = null; }
        if (contextLapChart) { contextLapChart.destroy(); contextLapChart = null; }
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

    function updateCharts(lapData, startIndex = 0) {
        if (!lapData || lapData.length === 0) return;

        const dataToDisplay = showOnlySpeedLaps
            ? lapData.filter(lap => {
                const durationInSeconds = parseDurationToSeconds(lap.duration);
                return !isNaN(durationInSeconds) && durationInSeconds < MAX_FAST_LAP_TIME_SECONDS;
            })
            : lapData;

        updateMainLapChart(dataToDisplay);
        updateContextLapChart(dataToDisplay, startIndex);
    }

    function updateMainLapChart(lapData) {
        const numberOfLaps = lapData.length;
        const heightPerLap = 25;
        const minChartHeight = 300;
        const calculatedHeight = Math.max(minChartHeight, numberOfLaps * heightPerLap);
        mainChartContainer.style.height = `${calculatedHeight}px`;
        const { lapNumbers, lapTimesInSeconds, backgroundColors, borderColors, borderWidths, yAxisMin } = prepareChartData(lapData, MAX_FAST_LAP_TIME_SECONDS);
        if (mainLapChart) mainLapChart.destroy();
        mainLapChart = new Chart(mainLapChartCanvas, {
            type: 'bar',
            data: { labels: lapNumbers, datasets: [{ data: lapTimesInSeconds, backgroundColor: backgroundColors, borderColor: borderColors, borderWidth: borderWidths }] },
            options: getChartOptions(yAxisMin, true, lapData, hoveredRowIndex, MAX_FAST_LAP_TIME_SECONDS, mainLapChart, contextLapChart, currentLapData, 0)
        });
    }

    function updateContextLapChart(lapData, startIndex = 0) {
        const dataSlice = lapData.slice(startIndex, startIndex + 10);
        const { lapTimesInSeconds, backgroundColors, borderColors, borderWidths, yAxisMin } = prepareChartData(dataSlice, MAX_FAST_LAP_TIME_SECONDS);
        const contextLapNumbers = dataSlice.map(lap => `Lap ${lap.nr}`);
        if (contextLapChart) contextLapChart.destroy();
        contextLapChart = new Chart(contextLapChartCanvas, {
            type: 'bar',
            data: { labels: contextLapNumbers, datasets: [{ data: lapTimesInSeconds, backgroundColor: backgroundColors, borderColor: borderColors, borderWidth: borderWidths }] },
            options: getChartOptions(yAxisMin, false, dataSlice, hoveredRowIndex, MAX_FAST_LAP_TIME_SECONDS, mainLapChart, contextLapChart, currentLapData, startIndex)
        });
        contextLapChart.startIndex = startIndex;
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
                    profileAvatar.src = ''; // Clear src on error to avoid broken image icon
                    profileAvatar.style.display = 'none'; // Keep avatar hidden on error
                };

                profileAvatar.src = avatarUrl;
            }
        }
    }

    fetchActivitiesBtn.addEventListener('click', async () => {
        resetUI();
        const transponder = transponderInput.value.trim().toUpperCase();
        if (!transponder || !isValidTransponderFormat(transponder)) {
            errorDiv.textContent = "Invalid transponder format. Expected: XX-12345.";
            show(errorDiv);
            return;
        }
        const newUrl = `${window.location.pathname}?transponder=${transponder}`;
        window.history.pushState({ path: newUrl }, '', newUrl);
        show(loadingDiv);
        try {
            const { activities, account, userId } = await fetchActivities(transponder);
            userActivities = activities;
            currentUserId = userId;

            displayProfileInfo(account, userId);
            saveTransponder(transponder, TRANSPONDER_COOKIE_KEY);
            loadSavedTransponders(TRANSPONDER_COOKIE_KEY, transponderDatalist);
            hide(loadingDiv);
            if (userActivities.length > 0) {
                activitySelect.innerHTML = '<option value="">Select an activity</option>';
                userActivities.forEach(activity => {
                    const option = document.createElement('option');
                    option.value = activity.id;
                    option.textContent = `${formatDateTime(activity.startTime)} - ${activity.location.sport} - ${activity.location.name}`;
                    activitySelect.appendChild(option);
                });
                show(activitiesListDiv);
                fetchLapsBtn.disabled = !activitySelect.value;
            } else {
                errorDiv.textContent = "No activities found for this transponder.";
                show(errorDiv);
            }
        } catch (error) {
            console.error("Error fetching activities:", error);
            hide(loadingDiv);
            errorDiv.textContent = `Error: ${error.message}. Please check the transponder number.`;
            show(errorDiv);
        }
    });

    const handleTableScroll = () => {
        const scrollTop = lapsTableContainer.scrollTop;
        const newStartIndex = Math.floor(scrollTop / estimatedRowHeight);
        if (newStartIndex !== (contextLapChart ? contextLapChart.startIndex : 0)) {
            updateContextLapChart(currentLapData, newStartIndex);
        }
    };
    let throttleTimer;
    const throttle = (callback, time) => {
        if (throttleTimer) return;
        throttleTimer = true;
        setTimeout(() => {
            callback();
            throttleTimer = false;
        }, time);
    };

    fetchLapsBtn.addEventListener('click', async () => {
        hide(lapsDataDiv); hide(errorDiv); hide(maxFastLapControls);
        hide(tableAndContextSection); hide(sessionSummaryContainer);
        lapsTableContainer.innerHTML = '';
        sessionSummaryContainer.innerHTML = '';
        resetGpxState(downloadGpxBtn);
        generatedGpxFilename = 'training_session.gpx';
        lapsTableContainer.removeEventListener('scroll', () => throttle(handleTableScroll, 100));
        
        const selectedActivityId = activitySelect.value;
        if (!selectedActivityId) {
            errorDiv.textContent = "Please select an activity from the list.";
            show(errorDiv);
            return;
        }
        show(loadingDiv);
        try {
            const fullSessionData = await fetchLaps(selectedActivityId);
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

                sessionSummaryContainer.innerHTML = `
                    <div class="stat-card"><span class="label">Total Laps</span><span class="value">${stats.lapCount || 'N/A'}</span></div>
                    <div class="stat-card">
                        <span class="label">Best Lap</span>
                        <span class="value">
                            ${stats.fastestTime || 'N/A'} /
                            <br><span class="best-lap-number">(Lap ${bestLap.lapNr || 'N/A'})</span>
                        </span>
                    </div>
                    <div class="stat-card"><span class="label">Average Lap</span><span class="value">${stats.averageTime || 'N/A'}</span></div>
                    <div class="stat-card"><span class="label">Total Time</span><span class="value">${formatTotalTrainingTime(stats.totalTrainingTime) || 'N/A'}</span></div>
                    <div class="stat-card">
                        <span class="label">Total Distance</span>
                        <span class="value">
                            ${totalDistanceInKm} <span class="sub-value">km</span> /
                            <br><span class="speed-laps-distance-value">${speedLapsDistanceInKm} <span class="sub-value">km</span></span>
                        </span>
                    </div>
                    <div class="stat-card"><span class="label">Avg Speed</span><span class="value">${stats.averageSpeed?.kph?.toFixed(1) || 'N/A'}</span><span class="sub-value"> km/h</span></div>
                    <div class="stat-card"><span class="label">Top Speed</span><span class="value">${stats.fastestSpeed?.kph?.toFixed(1) || 'N/A'}</span><span class="sub-value"> km/h</span></div>`;
                show(sessionSummaryContainer);
            }
            show(lapsDataDiv);
            if (currentLapData.length > 0) {
                const table = document.createElement('table');
                table.className = 'laps-table';
                const thead = table.createTHead();
                const headerRow = thead.insertRow();
                const headers = ['Lap', 'Duration', 'S. Duration', 'Diff Prev', 'Speed (km/h)', 'Voltage (V)', 'Temp (°C)'];
                headers.forEach(text => {
                    const th = document.createElement('th');
                    th.textContent = text;
                    headerRow.appendChild(th);
                });
                const tbody = table.createTBody();
                currentLapData.forEach((lap, index) => {
                    const row = tbody.insertRow();
                    row.addEventListener('mouseenter', () => {
                        hoveredRowIndex = index;
                        // Only update the context chart, as redrawing the main chart is slow and not needed for this effect.
                        if (contextLapChart) {
                            updateContextLapChart(currentLapData, contextLapChart.startIndex || 0);
                        }
                    });
                    row.addEventListener('mouseleave', () => {
                        hoveredRowIndex = null;
                        // Only update the context chart.
                        if (contextLapChart) {
                            updateContextLapChart(currentLapData, contextLapChart.startIndex || 0);
                        }
                    });
                    const findDataAttribute = (lap, type) => {
                        if (!lap?.dataAttributes) return 'N/A';
                        const attr = lap.dataAttributes.find(a => a.type === type);
                        return attr ? attr.value.toFixed(1) : 'N/A';
                    };
                    row.insertCell().textContent = lap.nr;
                    row.insertCell().textContent = lap.duration;
                    row.insertCell().textContent = lap.sessionDuration || 'N/A';
                    let diff = 'N/A';
                    if (lap.diffPrevLap) {
                        diff = `${lap.status === 'SLOWER' ? '+' : '-'}${lap.diffPrevLap}`;
                    }
                    row.insertCell().textContent = diff;
                    row.insertCell().textContent = lap.speed?.kph?.toFixed(1) || 'N/A';
                    row.insertCell().textContent = findDataAttribute(lap, 'VOLTAGE');
                    row.insertCell().textContent = findDataAttribute(lap, 'TEMPERATURE');
                });
                lapsTableContainer.appendChild(table);
                show(maxFastLapControls);
                show(tableAndContextSection);
                updateCharts(currentLapData, 0);
                lapsTableContainer.addEventListener('scroll', () => throttle(handleTableScroll, 100));
                const firstRow = table.querySelector('tbody tr');
                if (firstRow) estimatedRowHeight = firstRow.offsetHeight;

                // Bouw de bestandsnaam op
                const selectedActivity = userActivities.find(act => act.id === parseInt(selectedActivityId));
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

                generateAndPrepareGpxDownload(currentLapData, downloadGpxBtn);
            } else {
                lapsTableContainer.innerHTML = '<p>No lap data found for the selected activity.</p>';
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
        hide(tableAndContextSection); hide(sessionSummaryContainer); hide(overlappingSessions);
        lapsTableContainer.removeEventListener('scroll', () => throttle(handleTableScroll, 100));
        const hasSelection = !!activitySelect.value;
        fetchLapsBtn.disabled = !hasSelection;
        fetchOverlappingBtn.disabled = !hasSelection;
        if (hasSelection) {
            show(fetchOverlappingBtn);
        } else {
            hide(fetchOverlappingBtn);
        }
        if (mainLapChart) { mainLapChart.destroy(); mainLapChart = null; }
        if (contextLapChart) { contextLapChart.destroy(); contextLapChart = null; }
        currentLapData = [];
        const selectedActivityId = activitySelect.value;
        if (selectedActivityId) {
            const activity = userActivities.find(act => act.id === parseInt(selectedActivityId));
            if (activity) {
                currentTrackLength = activity.location.trackLength || 400; // Update track length
                activityInfoTable.innerHTML = `
                    <table class="activity-info-table">
                        <tbody>
                            <tr><td>Sport:</td><td>${activity.location.sport}</td></tr>
                            <tr><td>Location:</td><td>${activity.location.name}</td></tr>
                            <tr><td>Start Time:</td><td>${formatDateTime(activity.startTime)}</td></tr>
                        </tbody>
                    </table>`;
                show(activityInfoPanel);
            }
        } else {
            hide(activityInfoPanel);
            activityInfoTable.innerHTML = '';
        }
    });

    maxFastLapSlider.addEventListener('input', () => {
        MAX_FAST_LAP_TIME_SECONDS = parseFloat(maxFastLapSlider.value);
        maxFastLapInput.value = formatSecondsToDuration(MAX_FAST_LAP_TIME_SECONDS);
        hide(maxFastLapValueError);
        if (currentLapData.length > 0) {
            updateCharts(currentLapData, contextLapChart?.startIndex || 0);
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
            maxFastLapSlider.value = parsedSeconds;
            if (currentLapData.length > 0) {
                updateCharts(currentLapData, contextLapChart?.startIndex || 0);
                updateSpeedLapDistance();
            }
        }
    });

    loadSavedTransponders(TRANSPONDER_COOKIE_KEY, transponderDatalist);
    maxFastLapSlider.value = parseFloat(maxFastLapSlider.value).toFixed(1);
    maxFastLapInput.value = formatSecondsToDuration(MAX_FAST_LAP_TIME_SECONDS);
    
    const toggleLapsBtn = document.getElementById('toggleLapsBtn');
    toggleLapsBtn.addEventListener('click', () => {
        showOnlySpeedLaps = !showOnlySpeedLaps;
        toggleLapsBtn.textContent = showOnlySpeedLaps ? 'Show All Laps' : 'Show Speed Laps';
        toggleLapsBtn.classList.toggle('active', showOnlySpeedLaps);
        if (currentLapData.length > 0) {
            updateCharts(currentLapData, contextLapChart?.startIndex || 0);
        }
    });

    resetUI();
    
    function handleUrlParameter() {
        const urlParams = new URLSearchParams(window.location.search);
        const transponderFromUrl = urlParams.get('transponder');
        if (transponderFromUrl) {
            transponderInput.value = transponderFromUrl.toUpperCase();
            fetchActivitiesBtn.click();
        }
    }
    handleUrlParameter();

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
        overlappingSessionsTable.innerHTML = ''; // Clear previous results
        if (sessions.length === 0) {
            overlappingSessionsTable.innerHTML = '<p>No overlapping sessions found.</p>';
            show(overlappingSessions);
            return;
        }

        const table = document.createElement('table');
        table.className = 'laps-table'; // Reuse existing table style
        const thead = table.createTHead();
        const headerRow = thead.insertRow();
        const headers = ['Chip Code', 'Chip Label', 'Start Time', 'End Time'];
        headers.forEach(text => {
            const th = document.createElement('th');
            th.textContent = text;
            headerRow.appendChild(th);
        });

        const tbody = table.createTBody();
        sessions.forEach(session => {
            const row = tbody.insertRow();
            const chipCodeCell = row.insertCell();
            if (session.chipCode) {
                const link = document.createElement('a');
                link.href = `?transponder=${session.chipCode}`;
                link.textContent = session.chipCode;
                link.target = '_blank';
                chipCodeCell.appendChild(link);
            } else {
                chipCodeCell.textContent = 'N/A';
            }
            row.insertCell().textContent = session.chipLabel || 'N/A';
            row.insertCell().textContent = formatDateTime(session.startTime);
            row.insertCell().textContent = session.endTime ? formatDateTime(session.endTime) : 'Ongoing';
        });

        overlappingSessionsTable.appendChild(table);
        show(overlappingSessions);
    }

    fetchOverlappingBtn.addEventListener('click', async () => {
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

            const { location, startTime, sport } = selectedActivity;
            const year = new Date(startTime).getFullYear();

            const allActivities = await fetchAllActivitiesFromLocation(location.id, year, location.sport, startTime);

            const overlapping = allActivities.filter(activity =>
                activity.id !== selectedActivity.id && sessions_overlap(selectedActivity, activity)
            );

            displayOverlappingSessions(overlapping);

        } catch (error) {
            console.error("Error fetching overlapping sessions:", error);
            errorDiv.textContent = `Error: ${error.message}`;
            show(errorDiv);
        } finally {
            hide(loadingDiv);
        }
    });
});