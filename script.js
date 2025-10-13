document.addEventListener('DOMContentLoaded', () => {
    const transponderInput = document.getElementById('transponderInput');
    const fetchActivitiesBtn = document.getElementById('fetchActivitiesBtn');
    const loadingDiv = document.getElementById('loading');
    const errorDiv = document.getElementById('error');
    const activitiesListDiv = document.getElementById('activitiesList');
    const activitySelect = document.getElementById('activitySelect');
    const fetchLapsBtn = document.getElementById('fetchLapsBtn');
    const lapsDataDiv = document.getElementById('lapsData');
    const lapsOutput = document.getElementById('lapsOutput');
    const lapTimeChartCanvas = document.getElementById('lapTimeChart');

    const PROXY_BASE_URL = 'https://us-central1-proxyapi-475018.cloudfunctions.net/mylapsProxyFunction/api/mylaps';

    let userActivities = [];
    let lapChart = null;

    // Define the threshold for "fast" laps (e.g., 1 minute = 60 seconds)
    const MAX_FAST_LAP_TIME_SECONDS = 60; // 1 minute

    // Register the datalabels plugin globally once
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
        errorDiv.textContent = '';
        activitySelect.innerHTML = '<option value="">Select an activity</option>';
        fetchLapsBtn.disabled = true;
        lapsOutput.textContent = '';
        userActivities = [];

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
        if (parts.length === 1) {
            totalSeconds = parseFloat(parts[0]);
        } else if (parts.length === 2) {
            const minutes = parseInt(parts[0], 10);
            const seconds = parseFloat(parts[1]);
            totalSeconds = (minutes * 60) + seconds;
        } else if (parts.length === 3) {
            const hours = parseInt(parts[0], 10);
            const minutes = parseInt(parts[1], 10);
            const seconds = parseFloat(parts[2]);
            totalSeconds = (hours * 3600) + (minutes * 60) + seconds;
        }
        return totalSeconds;
    }

    function formatSecondsToDuration(totalSeconds) {
        if (isNaN(totalSeconds) || totalSeconds < 0) return '';

        const minutes = Math.floor(totalSeconds / 60);
        const remainingSeconds = totalSeconds % 60;

        // Ensure milliseconds are always 3 digits
        const secondsPart = remainingSeconds.toFixed(3);
        const [sec, ms] = secondsPart.split('.');

        const formattedSec = String(sec).padStart(2, '0');
        const formattedMs = ms || '000';

        if (minutes > 0) {
            const formattedMin = String(minutes).padStart(1, '0'); // Minutes don't need padding if < 10
            return `${formattedMin}:${formattedSec}.${formattedMs}`;
        } else {
            return `${formattedSec}.${formattedMs}`;
        }
    }


    fetchActivitiesBtn.addEventListener('click', async () => {
        resetUI();
        const transponder = transponderInput.value.trim();

        if (!transponder) {
            errorDiv.textContent = "Please enter a transponder number.";
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
            const specificActivityData = activitySessions.sessions[0]?.laps || [];

            hide(loadingDiv);
            show(lapsDataDiv);

            if (specificActivityData.length > 0) {
                let lapsText = 'Lap Number - Duration\n---------------------\n';
                const lapNumbers = [];
                const lapTimesInSeconds = [];
                const backgroundColors = [];
                const borderColors = [];

                specificActivityData.forEach(lap => {
                    lapsText += `${String(lap.nr).padEnd(12)} - ${lap.duration}\n`;
                    lapNumbers.push(`Lap ${lap.nr}`);
                    const lapTime = parseDurationToSeconds(lap.duration);
                    lapTimesInSeconds.push(lapTime);

                    // Determine color based on lap time
                    if (lapTime <= MAX_FAST_LAP_TIME_SECONDS) {
                        // Fast lap (e.g., <= 60 seconds) - darker blue
                        backgroundColors.push('rgba(0, 123, 255, 0.8)');
                        borderColors.push('rgba(0, 123, 255, 1)');
                    } else {
                        // Slower lap (> 60 seconds) - lighter, desaturated color
                        backgroundColors.push('rgba(173, 216, 230, 0.6)'); // Light blue, more transparent
                        borderColors.push('rgba(173, 216, 230, 0.8)');
                    }
                });
                lapsOutput.textContent = lapsText;

                // --- Chart.js Integration ---
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
                            backgroundColor: backgroundColors, // Use array of colors
                            borderColor: borderColors,       // Use array of colors
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
                            datalabels: { // Configuration for chartjs-plugin-datalabels
                                display: true,
                                color: function(context) {
                                    // Make text dark for light bars, light for dark bars
                                    const value = context.dataset.data[context.dataIndex];
                                    return value <= MAX_FAST_LAP_TIME_SECONDS ? '#fff' : '#333';
                                },
                                anchor: 'center', // Position the label in the center of the bar
                                align: 'center',
                                font: {
                                    weight: 'bold',
                                    size: 10
                                },
                                formatter: function(value, context) {
                                    // Format the label to MM:SS.ms or SS.ms
                                    return formatSecondsToDuration(value);
                                }
                            }
                        }
                    }
                });

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
            if (lapChart) {
                lapChart.destroy();
                lapChart = null;
            }
        }
    });

    activitySelect.addEventListener('change', () => {
        hide(lapsDataDiv);
        lapsOutput.textContent = '';
        hide(errorDiv);
        fetchLapsBtn.disabled = !activitySelect.value;
        if (lapChart) {
            lapChart.destroy();
            lapChart = null;
        }
    });

    resetUI();
});