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

    // Base URL for your proxy server (Google Cloud Function)
    const PROXY_BASE_URL = 'https://us-central1-proxyapi-475018.cloudfunctions.net/mylapsProxyFunction/api/mylaps';

    let userActivities = []; // To store fetched activities

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
    }

    // Function to format date to DD/MM/YYYY - HH:MM
    function formatDateTime(isoString) {
        const date = new Date(isoString);
        // Using toLocaleString for potentially better timezone handling and less manual formatting,
        // but explicitly setting options to match DD/MM/YYYY - HH:MM
        const options = {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false // Use 24-hour format
        };
        // For consistent output like "DD/MM/YYYY - HH:MM", we might need to do some string manipulation
        // as toLocaleString's separator can vary by locale.
        const parts = date.toLocaleString('en-GB', options).split(', '); // Example: "01/01/2023, 14:30"
        return `${parts[0]} - ${parts[1]}`;
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
            // Step 1: Get User ID via your proxy
            let url = `${PROXY_BASE_URL}/userid/${transponder}`;
            let response = await fetch(url);

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || `Proxy error: ${response.status} ${response.statusText}`);
            }
            const userData = await response.json();
            const userID = userData.userId;

            // Step 2: Get Activities via your proxy
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
                    // Format the start time using the new function
                    const formattedTime = formatDateTime(activity.startTime);
                    option.textContent = `${formattedTime} - ${activity.location.sport} - ${activity.location.name}`;
                    activitySelect.appendChild(option);
                });
                show(activitiesListDiv);
                // Only enable fetchLapsBtn if there are activities to select AND one is selected
                fetchLapsBtn.disabled = !activitySelect.value;
            } else {
                errorDiv.textContent = "No activities found for this transponder.";
                show(errorDiv);
            }

        } catch (error) {
            console.error("Error fetching activities via proxy:", error);
            hide(loadingDiv);
            // Updated error message to mention the Cloud Function specifically
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
            // Step 3: Get Laps for Selected Activity via your proxy
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
                specificActivityData.forEach(lap => {
                    lapsText += `${String(lap.nr).padEnd(12)} - ${lap.duration}\n`;
                });
                lapsOutput.textContent = lapsText;
            } else {
                lapsOutput.textContent = "No lap data found for the selected activity.";
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
        lapsOutput.textContent = '';
        hide(errorDiv);
        fetchLapsBtn.disabled = !activitySelect.value;
    });

    // Initial state setup
    resetUI();
});
