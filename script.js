document.addEventListener('DOMContentLoaded', () => {
    const transponderInput = document.getElementById('transponderInput');
    const fetchActivitiesBtn = document.getElementById('fetchActivitiesBtn');
    const loadingDiv = document.getElementById('loading');
    const errorDiv = document.getElementById('error');
    const activitiesListDiv = document.getElementById('activitiesList');
    const activitySelect = document.getElementById('activitySelect');
    const fetchLapsBtn = document.getElementById('fetchLapsBtn');
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
    const PROXY_BASE_URL = 'https://us-central1-proxyapi-475018.cloudfunctions.net/mylapsProxyFunction/api/mylaps';
    let userActivities = [];
    let mainLapChart = null;
    let contextLapChart = null;
    let currentLapData = [];
    let estimatedRowHeight = 28;
    let hoveredRowIndex = null;
    let MAX_FAST_LAP_TIME_SECONDS = parseFloat(maxFastLapSlider.value);
    Chart.register(ChartDataLabels);
    function setCookie(name, value, days) {
        let expires = "";
        if (days) {
            const date = new Date();
            date.setTime(date.getTime() + (days * 24 * 60 * 60 * 1000));
            expires = "; expires=" + date.toUTCString();
        }
        document.cookie = name + "=" + (value || "") + expires + "; path=/; SameSite=Lax";
    }
    function getCookie(name) {
        const nameEQ = name + "=";
        const ca = document.cookie.split(';');
        for (let i = 0; i < ca.length; i++) {
            let c = ca[i];
            while (c.charAt(0) == ' ') c = c.substring(1, c.length);
            if (c.indexOf(nameEQ) == 0) return c.substring(nameEQ.length, c.length);
        }
        return null;
    }
    function loadSavedTransponders() {
        const saved = getCookie(TRANSPONDER_COOKIE_KEY);
        const transponders = saved ? saved.split(',') : [];
        transponderDatalist.innerHTML = '';
        transponders.forEach(transponder => {
            const option = document.createElement('option');
            option.value = transponder;
            transponderDatalist.appendChild(option);
        });
    }
    function saveTransponder(transponder) {
        const saved = getCookie(TRANSPONDER_COOKIE_KEY);
        let transponders = saved ? saved.split(',') : [];
        if (!transponders.includes(transponder)) {
            transponders.push(transponder);
            setCookie(TRANSPONDER_COOKIE_KEY, transponders.join(','), 365);
            loadSavedTransponders();
        }
    }
    function show(element) {
        element.classList.remove('hidden');
    }
    function hide(element) {
        element.classList.add('hidden');
    }
    function resetUI() {
        hide(loadingDiv);
        hide(errorDiv);
        hide(activitiesListDiv);
        hide(lapsDataDiv);
        hide(maxFastLapControls);
        hide(tableAndContextSection);
        hide(sessionSummaryContainer);
        hide(activityInfoPanel);
        errorDiv.textContent = '';
        activitySelect.innerHTML = '<option value="">Select an activity</option>';
        fetchLapsBtn.disabled = true;
        lapsTableContainer.innerHTML = '';
        sessionSummaryContainer.innerHTML = '';
        activityInfoTable.innerHTML = '';
        userActivities = [];
        currentLapData = [];
        if (mainChartContainer) mainChartContainer.style.height = '';
        if (mainLapChart) {
            mainLapChart.destroy();
            mainLapChart = null;
        }
        if (contextLapChart) {
            contextLapChart.destroy();
            contextLapChart = null;
        }
    }
    function formatDateTime(isoString) {
        const date = new Date(isoString);
        const options = {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        };
        const parts = date.toLocaleString('en-GB', options).split(', ');
        return `${parts[0]} - ${parts[1]}`;
    }
    function parseDurationToSeconds(durationString) {
        if (typeof durationString !== 'string') return NaN;
        const parts = durationString.split(':');
        let totalSeconds = 0;
        if (parts.length === 1) {
            totalSeconds = parseFloat(parts[0]);
        } else if (parts.length === 2) {
            totalSeconds = (parseInt(parts[0], 10) * 60) + parseFloat(parts[1]);
        } else {
            return NaN;
        }
        return totalSeconds;
    }
    function formatSecondsToDuration(totalSeconds) {
        if (isNaN(totalSeconds) || totalSeconds < 0) return '';
        const minutes = Math.floor(totalSeconds / 60);
        const remainingSeconds = totalSeconds % 60;
        const secondsPart = remainingSeconds.toFixed(3);
        const [sec, ms] = secondsPart.split('.');
        const formattedSec = String(sec).padStart(2, '0');
        const formattedMs = ms || '000';
        if (minutes > 0) {
            return `${String(minutes).padStart(1, '0')}:${formattedSec}.${formattedMs}`;
        } else {
            return `${formattedSec}.${formattedMs}`;
        }
    }
    function isValidTransponderFormat(transponder) {
        return /^[A-Z]{2}-\d{5}$/.test(transponder);
    }
    function updateCharts(lapData, startIndex = 0) {
        if (!lapData || lapData.length === 0) return;
        updateMainLapChart(lapData);
        updateContextLapChart(lapData, startIndex);
    }
    function prepareChartData(data) {
        const lapNumbers = [];
        const lapTimesInSeconds = [];
        const backgroundColors = [];
        const borderColors = [];
        const borderWidths = [];
        let minLapTime = Infinity;
        data.forEach(lap => {
            const lapTime = parseDurationToSeconds(lap.duration);
            if (lapTime < minLapTime) minLapTime = lapTime;
        });
        const yAxisMin = Math.max(0, minLapTime - 5);
        data.forEach(lap => {
            lapNumbers.push(`Lap ${lap.nr}`);
            const lapTime = parseDurationToSeconds(lap.duration);
            lapTimesInSeconds.push(lapTime);
            if (lapTime <= MAX_FAST_LAP_TIME_SECONDS) {
                backgroundColors.push('rgba(0, 123, 255, 0.8)');
                if (lap.status === 'FASTER') {
                    borderColors.push('rgba(46, 204, 113, 0.9)');
                    borderWidths.push(3);
                } else if (lap.status === 'SLOWER') {
                    borderColors.push('rgba(231, 76, 60, 0.9)');
                    borderWidths.push(3);
                } else {
                    borderColors.push('rgba(0, 123, 255, 1)');
                    borderWidths.push(1);
                }
            } else {
                backgroundColors.push('rgba(173, 216, 230, 0.6)');
                borderColors.push('rgba(173, 216, 230, 0.8)');
                borderWidths.push(1);
            }
        });
        return {
            lapNumbers,
            lapTimesInSeconds,
            backgroundColors,
            borderColors,
            borderWidths,
            yAxisMin
        };
    }
    function getChartOptions(yAxisMin, showDataLabels, fullLapData) {
        return {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: {
                    beginAtZero: false,
                    min: yAxisMin,
                    max: MAX_FAST_LAP_TIME_SECONDS + 1,
                    ticks: {
                        callback: value => formatSecondsToDuration(value)
                    }
                },
                xTop: {
                    position: 'top',
                    beginAtZero: false,
                    min: yAxisMin,
                    max: MAX_FAST_LAP_TIME_SECONDS + 1,
                    ticks: {
                        callback: value => formatSecondsToDuration(value)
                    },
                    grid: {
                        drawOnChartArea: false
                    }
                },
                y: {
                    ticks: {
                        font: function(context) {
                            let indexToMatch;
                            if (context.chart === mainLapChart) {
                                indexToMatch = hoveredRowIndex;
                            } else {
                                const startIndex = context.chart.startIndex || 0;
                                indexToMatch = hoveredRowIndex - startIndex;
                            }
                            if (context.index === indexToMatch) {
                                return {
                                    weight: 'bold'
                                };
                            }
                            return {
                                weight: 'normal'
                            };
                        }
                    }
                }
            },
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const dataIndex = context.dataIndex;
                            let lap;
                            if (context.chart === mainLapChart) {
                                lap = currentLapData[dataIndex];
                            } else {
                                const startIndex = context.chart.startIndex || 0;
                                lap = currentLapData[startIndex + dataIndex];
                            }
                            if (!lap) return '';
                            const tooltipLines = [];
                            tooltipLines.push(`Time: ${lap.duration}`);
                            if (lap.diffPrevLap) {
                                const sign = lap.status === 'SLOWER' ? '+' : '-';
                                tooltipLines.push(`Diff: ${sign}${lap.diffPrevLap}`);
                            }
                            tooltipLines.push(`Session: ${lap.sessionDuration || 'N/A'}`);
                            const speed = lap.speed?.kph?.toFixed(1) || 'N/A';
                            tooltipLines.push(`Speed: ${speed} km/h`);
                            return tooltipLines;
                        }
                    }
                },
                datalabels: {
                    display: showDataLabels ? function(context) {
                        const lap = fullLapData[context.dataIndex];
                        const lapTime = context.dataset.data[context.dataIndex];
                        if (lapTime > 90) return false;
                        if (lapTime > MAX_FAST_LAP_TIME_SECONDS) return false;
                        if (!lap || !lap.diffPrevLap) return false;
                        const absoluteDiffString = lap.diffPrevLap.replace(/^[+-]/, '');
                        if (parseDurationToSeconds(absoluteDiffString) > 30) return false;
                        return true;
                    } : false,
                    anchor: 'end',
                    align: 'left',
                    offset: 4,
                    color: 'black',
                    font: {
                        weight: 'bold'
                    },
                    formatter: function(value, context) {
                        const lap = fullLapData[context.dataIndex];
                        const sign = lap.status === 'SLOWER' ? '+' : '-';
                        const absoluteDiffString = lap.diffPrevLap.replace(/^[+-]/, '');
                        const diffSeconds = parseDurationToSeconds(absoluteDiffString);
                        return `${sign}${diffSeconds.toFixed(1)}`;
                    }
                }
            }
        };
    }
    function updateMainLapChart(lapData) {
        if (!mainLapChartCanvas || !lapData || lapData.length === 0) return;
        const numberOfLaps = lapData.length;
        const heightPerLap = 25;
        const minChartHeight = 300;
        const calculatedHeight = Math.max(minChartHeight, numberOfLaps * heightPerLap);
        mainChartContainer.style.height = `${calculatedHeight}px`;
        const {
            lapNumbers,
            lapTimesInSeconds,
            backgroundColors,
            borderColors,
            borderWidths,
            yAxisMin
        } = prepareChartData(lapData);
        if (mainLapChart) mainLapChart.destroy();
        mainLapChart = new Chart(mainLapChartCanvas, {
            type: 'bar',
            data: {
                labels: lapNumbers,
                datasets: [{
                    data: lapTimesInSeconds,
                    backgroundColor: backgroundColors,
                    borderColor: borderColors,
                    borderWidth: borderWidths
                }]
            },
            options: getChartOptions(yAxisMin, true, lapData)
        });
    }
    function updateContextLapChart(lapData, startIndex = 0) {
        if (!contextLapChartCanvas || !lapData || lapData.length === 0) return;
        const dataSlice = lapData.slice(startIndex, startIndex + 10);
        const {
            lapTimesInSeconds,
            backgroundColors,
            borderColors,
            borderWidths,
            yAxisMin
        } = prepareChartData(dataSlice);
        const contextLapNumbers = dataSlice.map(lap => `Lap ${lap.nr}`);
        if (contextLapChart) contextLapChart.destroy();
        contextLapChart = new Chart(contextLapChartCanvas, {
            type: 'bar',
            data: {
                labels: contextLapNumbers,
                datasets: [{
                    data: lapTimesInSeconds,
                    backgroundColor: backgroundColors,
                    borderColor: borderColors,
                    borderWidth: borderWidths
                }]
            },
            options: getChartOptions(yAxisMin, false, dataSlice)
        });
        contextLapChart.startIndex = startIndex;
    }
    fetchActivitiesBtn.addEventListener('click', async () => {
        resetUI();
        const transponder = transponderInput.value.trim().toUpperCase();
        if (!transponder) {
            errorDiv.textContent = "Please enter a transponder number.";
            show(errorDiv);
            return;
        }
        if (!isValidTransponderFormat(transponder)) {
            errorDiv.textContent = "Invalid transponder format. Expected: XX-12345 (e.g., AB-12345).";
            show(errorDiv);
            return;
        }
        const newUrl = `${window.location.pathname}?transponder=${transponder}`;
        window.history.pushState({
            path: newUrl
        }, '', newUrl);
        show(loadingDiv);
        try {
            let url = `${PROXY_BASE_URL}/userid/${transponder}`;
            let response = await fetch(url);
            if (!response.ok) throw new Error((await response.json()).error || `Proxy error: ${response.status}`);
            const userData = await response.json();
            saveTransponder(transponder);
            const userID = userData.userId;
            url = `${PROXY_BASE_URL}/activities/${userID}`;
            response = await fetch(url);
            if (!response.ok) throw new Error((await response.json()).error || `Proxy error: ${response.status}`);
            const activitiesResponse = await response.json();
            userActivities = activitiesResponse.activities || [];
            hide(loadingDiv);
            if (userActivities.length > 0) {
                userActivities.forEach(activity => {
                    const option = document.createElement('option');
                    option.value = activity.id;
                    const formattedTime = formatDateTime(activity.startTime);
                    option.textContent = `${formattedTime} - ${activity.location.sport} - ${activity.location.name}`;
                    activitySelect.appendChild(option);
                });
                show(activitiesListDiv);
                fetchLapsBtn.disabled = !activitySelect.value;
            } else {
                errorDiv.textContent = "No activities found for this transponder.";
                show(errorDiv);
            }
        } catch (error) {
            console.error("Error fetching activities via proxy:", error);
            hide(loadingDiv);
            errorDiv.textContent = `Error: ${error.message}. Please check the transponder number.`;
            show(errorDiv);
        }
    });
    const handleTableScroll = () => {
        const scrollTop = lapsTableContainer.scrollTop;
        const newStartIndex = Math.floor(scrollTop / estimatedRowHeight);
        if (newStartIndex !== (contextLapChart.startIndex || 0)) {
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
        hide(lapsDataDiv);
        hide(errorDiv);
        hide(maxFastLapControls);
        hide(tableAndContextSection);
        hide(sessionSummaryContainer);
        lapsTableContainer.innerHTML = '';
        sessionSummaryContainer.innerHTML = '';
        lapsTableContainer.removeEventListener('scroll', () => throttle(handleTableScroll, 100));
        const selectedActivityId = activitySelect.value;
        if (!selectedActivityId) {
            errorDiv.textContent = "Please select an activity from the list.";
            show(errorDiv);
            return;
        }
        show(loadingDiv);
        try {
            const url = `${PROXY_BASE_URL}/laps/${selectedActivityId}`;
            const response = await fetch(url);
            if (!response.ok) throw new Error((await response.json()).error || `Proxy error: ${response.status}`);
            const fullSessionData = await response.json();
            currentLapData = [];
            if (fullSessionData && fullSessionData.sessions) {
                fullSessionData.sessions.forEach(session => {
                    if (session.laps && Array.isArray(session.laps)) {
                        currentLapData.push(...session.laps);
                    }
                });
            }
            hide(loadingDiv);
            if (fullSessionData.stats) {
                const stats = fullSessionData.stats;
                const bestLap = fullSessionData.bestLap;
                const summaryHTML = `
                    <div class="stat-card">
                        <span class="label">Total Laps</span>
                        <span class="value">${stats.lapCount || 'N/A'}</span>
                    </div>
                    <div class="stat-card">
                        <span class="label">Best Lap</span>
                        <span class="value">${stats.fastestTime || 'N/A'}</span>
                        <span class="sub-value">(Lap ${bestLap.lapNr || 'N/A'})</span>
                    </div>
                    <div class="stat-card">
                        <span class="label">Average Lap</span>
                        <span class="value">${stats.averageTime || 'N/A'}</span>
                    </div>
                    <div class="stat-card">
                        <span class="label">Total Time</span>
                        <span class="value">${stats.totalTrainingTime || 'N/A'}</span>
                    </div>
                    <div class="stat-card">
                        <span class="label">Avg Speed</span>
                        <span class="value">${stats.averageSpeed?.kph?.toFixed(1) || 'N/A'}</span>
                        <span class="sub-value">km/h</span>
                    </div>
                    <div class="stat-card">
                        <span class="label">Top Speed</span>
                        <span class="value">${stats.fastestSpeed?.kph?.toFixed(1) || 'N/A'}</span>
                        <span class="sub-value">km/h</span>
                    </div>
                `;
                sessionSummaryContainer.innerHTML = summaryHTML;
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
                        if (!lap || !lap.dataAttributes) return 'N/A';
                        const attr = lap.dataAttributes.find(a => a.type === type);
                        return attr ? attr.value.toFixed(1) : 'N/A';
                    };
                    row.insertCell().textContent = lap.nr;
                    row.insertCell().textContent = lap.duration;
                    row.insertCell().textContent = lap.sessionDuration || 'N/A';
                    let diff = 'N/A';
                    if (lap.diffPrevLap) {
                        const sign = lap.status === 'SLOWER' ? '+' : '-';
                        diff = `${sign}${lap.diffPrevLap}`;
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
                if (firstRow) {
                    estimatedRowHeight = firstRow.offsetHeight;
                }
            } else {
                lapsTableContainer.innerHTML = '<p>No lap data found for the selected activity.</p>';
            }
        } catch (error) {
            console.error("Error fetching laps via proxy:", error);
            hide(loadingDiv);
            errorDiv.textContent = `Error: ${error.message}. Could not retrieve lap data.`;
            show(errorDiv);
            hide(lapsDataDiv);
        }
    });
    activitySelect.addEventListener('change', () => {
        hide(lapsDataDiv);
        hide(errorDiv);
        hide(maxFastLapControls);
        hide(tableAndContextSection);
        hide(sessionSummaryContainer);
        lapsTableContainer.removeEventListener('scroll', () => throttle(handleTableScroll, 100));
        fetchLapsBtn.disabled = !activitySelect.value;
        if (mainLapChart) {
            mainLapChart.destroy();
            mainLapChart = null;
        }
        if (contextLapChart) {
            contextLapChart.destroy();
            contextLapChart = null;
        }
        currentLapData = [];

        const selectedActivityId = activitySelect.value;
        if (selectedActivityId) {
            const activity = userActivities.find(act => act.id === parseInt(selectedActivityId));
            if (activity) {
                const tableHTML = `
                    <table class="activity-info-table">
                        <tbody>
                            <tr><td>Sport:</td><td>${activity.location.sport}</td></tr>
                            <tr><td>Location:</td><td>${activity.location.name}</td></tr>
                            <tr><td>Start Time:</td><td>${formatDateTime(activity.startTime)}</td></tr>
                        </tbody>
                    </table>
                `;
                activityInfoTable.innerHTML = tableHTML;
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
        if (currentLapData.length > 0) updateCharts(currentLapData, contextLapChart.startIndex || 0);
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
            if (currentLapData.length > 0) updateCharts(currentLapData, contextLapChart.startIndex || 0);
        }
    });
    loadSavedTransponders();
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