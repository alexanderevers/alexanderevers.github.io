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
    
    const TRANSPONDER_COOKIE_KEY = 'savedTransponders';

    let userActivities = [];
    let mainLapChart = null;
    let contextLapChart = null;
    let currentLapData = [];
    let estimatedRowHeight = 28;
    let hoveredRowIndex = null;
    let MAX_FAST_LAP_TIME_SECONDS = parseFloat(maxFastLapSlider.value);

    Chart.register(ChartDataLabels);
    
    function resetUI() {
        hide(loadingDiv); hide(errorDiv); hide(activitiesListDiv); hide(lapsDataDiv);
        hide(maxFastLapControls); hide(tableAndContextSection); hide(sessionSummaryContainer);
        hide(activityInfoPanel); resetGpxState(downloadGpxBtn);
        errorDiv.textContent = '';
        activitySelect.innerHTML = '<option value="">Select an activity</option>';
        fetchLapsBtn.disabled = true;
        lapsTableContainer.innerHTML = '';
        sessionSummaryContainer.innerHTML = '';
        activityInfoTable.innerHTML = '';
        userActivities = []; currentLapData = [];
        if (mainChartContainer) mainChartContainer.style.height = '';
        if (mainLapChart) { mainLapChart.destroy(); mainLapChart = null; }
        if (contextLapChart) { contextLapChart.destroy(); contextLapChart = null; }
    }
    
    function updateCharts(lapData, startIndex = 0) {
        if (!lapData || lapData.length === 0) return;
        updateMainLapChart(lapData);
        updateContextLapChart(lapData, startIndex);
    }

    function updateMainLapChart(lapData) {
        const numberOfLaps = lapData.length;
        const heightPerLap = 25;
        const minChartHeight = 300;
        const calculatedHeight = Math.max(minChartHeight, numberOfLaps * heightPerLap);
        mainChartContainer.style.height = `${calculatedHeight}px`;
        const chartData = prepareChartData(lapData, MAX_FAST_LAP_TIME_SECONDS);
        if (mainLapChart) mainLapChart.destroy();
        mainLapChart = new Chart(mainLapChartCanvas, {
            type: 'bar',
            data: { labels: chartData.lapNumbers, datasets: [{ data: chartData.lapTimesInSeconds, backgroundColor: chartData.backgroundColors, borderColor: chartData.borderColors, borderWidth: chartData.borderWidths }] },
            options: getChartOptions(chartData.yAxisMin, true, lapData, hoveredRowIndex, MAX_FAST_LAP_TIME_SECONDS, mainLapChart, contextLapChart, currentLapData)
        });
    }

    function updateContextLapChart(lapData, startIndex = 0) {
        const dataSlice = lapData.slice(startIndex, startIndex + 10);
        const chartData = prepareChartData(dataSlice, MAX_FAST_LAP_TIME_SECONDS);
        const contextLapNumbers = dataSlice.map(lap => `Lap ${lap.nr}`);
        if (contextLapChart) contextLapChart.destroy();
        contextLapChart = new Chart(contextLapChartCanvas, {
            type: 'bar',
            data: { labels: contextLapNumbers, datasets: [{ data: chartData.lapTimesInSeconds, backgroundColor: chartData.backgroundColors, borderColor: chartData.borderColors, borderWidth: chartData.borderWidths }] },
            options: getChartOptions(chartData.yAxisMin, false, dataSlice, hoveredRowIndex, MAX_FAST_LAP_TIME_SECONDS, mainLapChart, contextLapChart, currentLapData)
        });
        contextLapChart.startIndex = startIndex;
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
            userActivities = await fetchActivities(transponder);
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
                sessionSummaryContainer.innerHTML = `
                    <div class="stat-card"><span class="label">Total Laps</span><span class="value">${stats.lapCount || 'N/A'}</span></div>
                    <div class="stat-card"><span class="label">Best Lap</span><span class="value">${stats.fastestTime || 'N/A'}</span><span class="sub-value">(Lap ${bestLap.lapNr || 'N/A'})</span></div>
                    <div class="stat-card"><span class="label">Average Lap</span><span class="value">${stats.averageTime || 'N/A'}</span></div>
                    <div class="stat-card"><span class="label">Total Time</span><span class="value">${stats.totalTrainingTime || 'N/A'}</span></div>
                    <div class="stat-card"><span class="label">Avg Speed</span><span class="value">${stats.averageSpeed?.kph?.toFixed(1) || 'N/A'}</span><span class="sub-value">km/h</span></div>
                    <div class="stat-card"><span class="label">Top Speed</span><span class="value">${stats.fastestSpeed?.kph?.toFixed(1) || 'N/A'}</span><span class="sub-value">km/h</span></div>`;
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
                        if (mainLapChart) mainLapChart.update('none');
                        if (contextLapChart) contextLapChart.update('none');
                    });
                    row.addEventListener('mouseleave', () => {
                        hoveredRowIndex = null;
                        if (mainLapChart) mainLapChart.update('none');
                        if (contextLapChart) contextLapChart.update('none');
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

    downloadGpxBtn.addEventListener('click', handleGpxDownload);

    activitySelect.addEventListener('change', () => {
        hide(lapsDataDiv); hide(errorDiv); hide(maxFastLapControls);
        hide(tableAndContextSection); hide(sessionSummaryContainer);
        lapsTableContainer.removeEventListener('scroll', () => throttle(handleTableScroll, 100));
        fetchLapsBtn.disabled = !activitySelect.value;
        if (mainLapChart) { mainLapChart.destroy(); mainLapChart = null; }
        if (contextLapChart) { contextLapChart.destroy(); contextLapChart = null; }
        currentLapData = [];
        const selectedActivityId = activitySelect.value;
        if (selectedActivityId) {
            const activity = userActivities.find(act => act.id === parseInt(selectedActivityId));
            if (activity) {
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
        if (currentLapData.length > 0) updateCharts(currentLapData, contextLapChart?.startIndex || 0);
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
            if (currentLapData.length > 0) updateCharts(currentLapData, contextLapChart?.startIndex || 0);
        }
    });

    loadSavedTransponders(TRANSPONDER_COOKIE_KEY, transponderDatalist);
    maxFastLapSlider.value = parseFloat(maxFastLapSlider.value).toFixed(1);
    maxFastLapInput.value = formatSecondsToDuration(MAX_FAST_LAP_TIME_SECONDS);
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
});