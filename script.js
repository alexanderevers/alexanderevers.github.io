document.addEventListener('DOMContentLoaded', () => {
    const transponderInput = document.getElementById('transponderInput');
    const fetchActivitiesBtn = document.getElementById('fetchActivitiesBtn');
    const loadingDiv = document.getElementById('loading');
    const errorDiv = document.getElementById('error');
    const activitiesListDiv = document.getElementById('activitiesList');
    const activitySelect = document.getElementById('activitySelect');
    const fetchLapsBtn = document.getElementById('fetchLapsBtn');
    const lapsDataDiv = document.getElementById('lapsData');
    
    const maxFastLapControls = document.getElementById('maxFastLapControls'); 

    const lapsOutput = document.getElementById('lapsOutput');
    const lapTimeChartCanvas = document.getElementById('lapTimeChart');
    const chartContainer = document.querySelector('.chart-container');

    const transponderDatalist = document.getElementById('transponder-list');
    const TRANSPONDER_COOKIE_KEY = 'savedTransponders';

    const PROXY_BASE_URL = 'https://us-central1-proxyapi-475018.cloudfunctions.net/mylapsProxyFunction/api/mylaps';

    let userActivities = [];
    let lapChart = null;
    let currentLapData = [];

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
        hide(maxFastLapValueError);
        hide(maxFastLapControls);
        errorDiv.textContent = '';
        activitySelect.innerHTML = '<option value="">Select an activity</option>';
        fetchLapsBtn.disabled = true;
        lapsOutput.textContent = '';
        userActivities = [];
        currentLapData = [];
        if (chartContainer) {
            chartContainer.style.height = '';
        }
        if (lapChart) {
            lapChart.destroy();
            lapChart = null;
        }
    }

    function formatDateTime(isoString) {
        const date = new Date(isoString);
        const options = {
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit', hour12: false
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

    function updateLapChart(lapData) {
        if (!lapTimeChartCanvas || !lapData || lapData.length === 0) {
            if (lapChart) {
                lapChart.destroy();
                lapChart = null;
            }
            return;
        }
    
        const numberOfLaps = lapData.length;
        const heightPerLap = 25;
        const minChartHeight = 300;
        const calculatedHeight = Math.max(minChartHeight, numberOfLaps * heightPerLap);
        
        if (chartContainer) {
            chartContainer.style.height = `${calculatedHeight}px`;
        }

        const lapNumbers = [];
        const lapTimesInSeconds = [];
        const backgroundColors = [];
        const borderColors = [];
        const borderWidths = [];
    
        let minLapTime = Infinity;
        lapData.forEach(lap => {
            const lapTime = parseDurationToSeconds(lap.duration);
            if (lapTime < minLapTime) minLapTime = lapTime;
        });
    
        const yAxisMin = Math.max(0, minLapTime - 5);
    
        lapData.forEach((lap, index) => {
            lapNumbers.push(`Lap ${index + 1}`);
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
    
        if (lapChart) lapChart.destroy();
    
        lapChart = new Chart(lapTimeChartCanvas, {
            type: 'bar',
            data: {
                labels: lapNumbers,
                datasets: [{
                    label: 'Lap Time',
                    data: lapTimesInSeconds,
                    backgroundColor: backgroundColors,
                    borderColor: borderColors,
                    borderWidth: borderWidths
                }]
            },
            options: {
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: { 
                        title: { display: true, text: 'Lap Time' },
                        beginAtZero: false,
                        min: yAxisMin,
                        max: MAX_FAST_LAP_TIME_SECONDS + 1,
                        ticks: { callback: value => formatSecondsToDuration(value) }
                    },
                    xTop: {
                        position: 'top',
                        beginAtZero: false,
                        min: yAxisMin,
                        max: MAX_FAST_LAP_TIME_SECONDS + 1,
                        ticks: { callback: value => formatSecondsToDuration(value) },
                        grid: {
                            drawOnChartArea: false 
                        }
                    },
                    y: { 
                        title: { display: true, text: 'Lap Number' }
                    }
                },
                plugins: {
                    legend: {
                        display: false
                    },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                const lap = currentLapData[context.dataIndex];
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
                        display: function(context) {
                            const lap = currentLapData[context.dataIndex];
                            if (!lap || !lap.diffPrevLap) return false;
                            const absoluteDiffString = lap.diffPrevLap.replace(/^[+-]/, '');
                            if (parseDurationToSeconds(absoluteDiffString) > 30) return false;
                            return true;
                        },
                        anchor: 'end',
                        align: 'left',
                        offset: 4,
                        color: 'black',
                        font: { weight: 'bold' },
                        formatter: function(value, context) {
                            const lap = currentLapData[context.dataIndex];
                            const sign = lap.status === 'SLOWER' ? '+' : '-';
                            const absoluteDiffString = lap.diffPrevLap.replace(/^[+-]/, '');
                            const diffSeconds = parseDurationToSeconds(absoluteDiffString);
                            return `${sign}${diffSeconds.toFixed(1)}`;
                        }
                    }
                }
            }
        });
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

        // --- AANGEPAST: Update de URL in de adresbalk ---
        const newUrl = `${window.location.pathname}?transponder=${transponder}`;
        window.history.pushState({ path: newUrl }, '', newUrl);
        // --- Einde aanpassing ---

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
    
    fetchLapsBtn.addEventListener('click', async () => {
        hide(lapsDataDiv);
        hide(errorDiv);
        hide(maxFastLapControls);
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
            const activitySessions = await response.json();
            currentLapData = [];
            if (activitySessions && activitySessions.sessions) {
                activitySessions.sessions.forEach(session => {
                    if (session.laps && Array.isArray(session.laps)) {
                        currentLapData.push(...session.laps);
                    }
                });
            }
            hide(loadingDiv);
            show(lapsDataDiv);
            if (currentLapData.length > 0) {
                let header = ['Lap'.padEnd(5), 'Duration'.padEnd(12), 'S. Duration'.padEnd(13), 'Diff Prev'.padEnd(11), 'Speed (km/h)'.padEnd(15)].join('');
                let separator = '-'.repeat(header.length);
                const lapRows = currentLapData.map(lap => {
                    const nr = String(lap.nr).padEnd(5);
                    const duration = lap.duration.padEnd(12);
                    const sessionDuration = (lap.sessionDuration || 'N/A').padEnd(13);
                    let diff = 'N/A';
                    if (lap.diffPrevLap) {
                        const sign = lap.status === 'SLOWER' ? '+' : '-';
                        diff = `${sign}${lap.diffPrevLap}`;
                    }
                    const diffFormatted = diff.padEnd(11);
                    const speed = (lap.speed?.kph?.toFixed(1) || 'N/A').padEnd(15);
                    return `${nr}${duration}${sessionDuration}${diffFormatted}${speed}`;
                }).join('\n');
                lapsOutput.textContent = `${header}\n${separator}\n${lapRows}`;
                show(maxFastLapControls);
                updateLapChart(currentLapData);
            } else {
                lapsOutput.textContent = "No lap data found for the selected activity.";
                if (lapChart) {
                    lapChart.destroy();
                    lapChart = null;
                }
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
        fetchLapsBtn.disabled = !activitySelect.value;
        if (chartContainer) {
            chartContainer.style.height = '';
        }
        if (lapChart) {
            lapChart.destroy();
            lapChart = null;
        }
        currentLapData = [];
    });
    
    maxFastLapSlider.addEventListener('input', () => {
        MAX_FAST_LAP_TIME_SECONDS = parseFloat(maxFastLapSlider.value);
        maxFastLapInput.value = formatSecondsToDuration(MAX_FAST_LAP_TIME_SECONDS);
        hide(maxFastLapValueError);
        if (currentLapData.length > 0) updateLapChart(currentLapData);
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
            if (currentLapData.length > 0) updateLapChart(currentLapData);
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