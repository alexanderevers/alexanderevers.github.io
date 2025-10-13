document.addEventListener('DOMContentLoaded', () => {
    const transponderInput = document.getElementById('transponderInput');
    const fetchActivitiesBtn = document.getElementById('fetchActivitiesBtn');
    const loadingDiv = document.getElementById('loading');
    const errorDiv = document.getElementById('error');
    const activitiesListDiv = document.getElementById('activitiesList');
    const activitySelect = document.getElementById('activitySelect');
    const fetchLapsBtn = document.getElementById('fetchLapsBtn');
    const lapsDataDiv = document.getElementById('lapsData');
    
    // NIEUW: Referentie naar de container voor de slider en input
    const maxFastLapControls = document.getElementById('maxFastLapControls'); 

    const lapsOutput = document.getElementById('lapsOutput');
    const lapTimeChartCanvas = document.getElementById('lapTimeChart');

    const maxFastLapSlider = document.getElementById('maxFastLapSlider');
    const maxFastLapInput = document.getElementById('maxFastLapInput');
    const maxFastLapValueError = document.getElementById('maxFastLapValueError');

    const PROXY_BASE_URL = 'https://us-central1-proxyapi-475018.cloudfunctions.net/mylapsProxyFunction/api/mylaps';

    let userActivities = [];
    let lapChart = null;
    let currentLapData = [];

    // Initialiseer met de waarde van de slider, die de 'source of truth' is bij start
    let MAX_FAST_LAP_TIME_SECONDS = parseFloat(maxFastLapSlider.value);

    Chart.register(ChartDataLabels);

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
        hide(maxFastLapControls); // VERBORGEN bij reset
        errorDiv.textContent = '';
        activitySelect.innerHTML = '<option value="">Select an activity</option>';
        fetchLapsBtn.disabled = true;
        lapsOutput.textContent = '';
        userActivities = [];
        currentLapData = [];

        if (lapChart) {
            lapChart.destroy();
            lapChart = null;
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
        const parts = durationString.split(':');
        let totalSeconds = 0;

        if (parts.length === 1) { // SS.ms formaat
            totalSeconds = parseFloat(parts[0]);
        } else if (parts.length === 2) { // MM:SS.ms formaat
            const minutes = parseInt(parts[0], 10);
            const seconds = parseFloat(parts[1]);
            totalSeconds = (minutes * 60) + seconds;
        } else {
            return NaN; // Ongeldig formaat
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
            const formattedMin = String(minutes).padStart(1, '0');
            return `${formattedMin}:${formattedSec}.${formattedMs}`;
        } else {
            return `${formattedSec}.${formattedMs}`;
        }
    }

    function isValidTransponderFormat(transponder) {
        const regex = /^[A-Z]{2}-\d{5}$/;
        return regex.test(transponder);
    }

    function updateLapChart(lapData) {
        if (!lapTimeChartCanvas || !lapData || lapData.length === 0) {
            if (lapChart) {
                lapChart.destroy();
                lapChart = null;
            }
            return;
        }

        const lapNumbers = [];
        const lapTimesInSeconds = [];
        const backgroundColors = [];
        const borderColors = [];

        let minLapTime = Infinity;
        lapData.forEach(lap => {
            const lapTime = parseDurationToSeconds(lap.duration);
            if (lapTime < minLapTime) {
                minLapTime = lapTime;
            }
        });

        // Bereken de minimale y-as waarde. Dit is de referentie voor onze labels.
        const yAxisMin = Math.max(0, minLapTime - 5);
        const labelTargetValue = yAxisMin + 2; // De doellocatie in seconden voor de labels

        lapData.forEach((lap, index) => {
            lapNumbers.push(`Lap ${index + 1}`);
            const lapTime = parseDurationToSeconds(lap.duration);
            lapTimesInSeconds.push(lapTime);

            if (lapTime <= MAX_FAST_LAP_TIME_SECONDS) {
                backgroundColors.push('rgba(0, 123, 255, 0.8)');
                borderColors.push('rgba(0, 123, 255, 1)');
            } else {
                backgroundColors.push('rgba(173, 216, 230, 0.6)');
                borderColors.push('rgba(173, 216, 230, 0.8)');
            }
        });

        if (lapChart) {
            lapChart.destroy();
        }

        lapChart = new Chart(lapTimeChartCanvas, {
            type: 'bar',
            data: {
                labels: lapNumbers,
                datasets: [{
                    label: 'Lap Time',
                    data: lapTimesInSeconds,
                    backgroundColor: backgroundColors,
                    borderColor: borderColors,
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: {
                        title: {
                            display: true,
                            text: 'Lap Number'
                        }
                    },
                    y: {
                        title: {
                            display: true,
                            text: 'Lap Time'
                        },
                        beginAtZero: false,
                        min: yAxisMin, // Gebruik de berekende minimale waarde
                        max: MAX_FAST_LAP_TIME_SECONDS + 1,
                        ticks: {
                            callback: function(value, index, ticks) {
                                return formatSecondsToDuration(value);
                            }
                        }
                    }
                },
                plugins: {
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                let label = context.dataset.label || '';
                                if (label) {
                                    label += ': ';
                                }
                                if (context.parsed.y !== null) {
                                    label += formatSecondsToDuration(context.parsed.y);
                                }
                                return label;
                            }
                        }
                    },
                    // --- AANGEPASTE DATALABELS CONFIGURATIE ---
                    datalabels: {
                        // Toon alleen labels voor de te trage rondes
                        display: function(context) {
                            const value = context.dataset.data[context.dataIndex];
                            return value > MAX_FAST_LAP_TIME_SECONDS;
                        },
                        // Veranker de labels aan de ONDERKANT van de grafiek
                        anchor: 'end',
                        // Lijn de labels uit aan de ONDERKANT van de grafiek
                        align: 'start',
                        // Bereken de verticale verschuiving (offset) in pixels
                        offset: function(context) {
                            // Haal de y-as schaal op uit de grafiek-instantie
                            const scale = context.chart.scales.y;
                            // Haal de pixelpositie van de onderkant van de grafiek op
                            const chartBottomPixel = scale.bottom;
                            // Haal de pixelpositie op die overeenkomt met ons doel (yMin + 2s)
                            const targetPixel = scale.getPixelForValue(labelTargetValue);
                            
                            // Het verschil is de offset die we nodig hebben om het label
                            // vanaf de onderkant omhoog te duwen naar de juiste positie.
                            // We gebruiken Math.max om te zorgen dat de offset niet negatief is.
                            return Math.max(0, chartBottomPixel - targetPixel);
                        },
                        color: '#333',
                        font: {
                            weight: 'bold',
                            size: 10
                        },
                        formatter: function(value, context) {
                            return formatSecondsToDuration(value);
                        },
                        rotation: 270
                    }
                }
            }
        });
    }

    // ... (rest van de fetchActivitiesBtn en andere event listeners blijven hetzelfde) ...
    // --- ZORG ERVOOR DAT DE REST VAN JE SCRIPT.JS HIERONDER KOMT ---

    fetchActivitiesBtn.addEventListener('click', async () => {
        resetUI();
        const transponder = transponderInput.value.trim();

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

        show(loadingDiv);

        try {
            let url = `${PROXY_BASE_URL}/userid/${transponder}`;
            let response = await fetch(url);

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || `Proxy error: ${response.status} ${response.statusText}`);
            }
            const userData = await response.json();
            const userID = userData.userId;

            url = `${PROXY_BASE_URL}/activities/${userID}`;
            response = await fetch(url);

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || `Proxy error: ${response.status} ${response.statusText}`);
            }
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
            errorDiv.textContent = `Error: ${error.message}. Please check the transponder number and ensure your Cloud Function proxy is running and accessible.`;
            show(errorDiv);
        }
    });

    fetchLapsBtn.addEventListener('click', async () => {
        hide(lapsDataDiv);
        lapsOutput.textContent = '';
        hide(errorDiv);
        hide(maxFastLapControls); // VERBORGEN totdat laps geladen zijn

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

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || `Proxy error: ${response.status} ${response.statusText}`);
            }
            const activitySessions = await response.json();

            currentLapData = [];
            if (activitySessions && activitySessions.sessions) {
                activitySessions.sessions.forEach(session => {
                    if (session.laps && Array.isArray(session.laps)) {
                        currentLapData = currentLapData.concat(session.laps);
                    }
                });
            }

            hide(loadingDiv);
            show(lapsDataDiv);

            if (currentLapData.length > 0) {
                let lapsText = 'Lap Number - Duration\n---------------------\n';
                currentLapData.forEach(lap => {
                    lapsText += `${String(lap.nr).padEnd(12)} - ${lap.duration}\n`;
                });
                lapsOutput.textContent = lapsText;

                // TOON DE SLIDER/INPUT NADAT LAPS DATA ZIJN GELADEN
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
            hide(maxFastLapControls); // VERBORGEN bij fout
            if (lapChart) {
                lapChart.destroy();
                lapChart = null;
            }
        }
    });
    
    // ... (de rest van je script.js)
    activitySelect.addEventListener('change', () => {
        hide(lapsDataDiv);
        lapsOutput.textContent = '';
        hide(errorDiv);
        hide(maxFastLapControls); // VERBORGEN als activiteit verandert
        fetchLapsBtn.disabled = !activitySelect.value;
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

        if (currentLapData.length > 0) {
            updateLapChart(currentLapData);
        }
    });

    maxFastLapInput.addEventListener('input', () => {
        const inputText = maxFastLapInput.value.trim();
        const parsedSeconds = parseDurationToSeconds(inputText);

        // Haal de min/max waarden direct van de slider voor validatie
        const sliderMin = parseFloat(maxFastLapSlider.min);
        const sliderMax = parseFloat(maxFastLapSlider.max);

        if (isNaN(parsedSeconds) || parsedSeconds < sliderMin || parsedSeconds > sliderMax) {
            maxFastLapValueError.textContent = `Invalid time format or out of range (${formatSecondsToDuration(sliderMin)} - ${formatSecondsToDuration(sliderMax)})`;
            show(maxFastLapValueError);
        } else {
            hide(maxFastLapValueError);
            MAX_FAST_LAP_TIME_SECONDS = parsedSeconds;
            maxFastLapSlider.value = parsedSeconds; // Synchroniseer de slider
            if (currentLapData.length > 0) {
                updateLapChart(currentLapData);
            }
        }
    });

    // Initialiseer de tekst van de input en slider-waarde bij het laden van de pagina
    maxFastLapSlider.value = parseFloat(maxFastLapSlider.value).toFixed(1); // Zorg voor juiste precisie
    maxFastLapInput.value = formatSecondsToDuration(MAX_FAST_LAP_TIME_SECONDS);

    resetUI(); // Roep resetUI aan om de slider controls standaard te verbergen
});