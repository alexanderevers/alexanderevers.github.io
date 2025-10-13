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

    // Base URL for your proxy server
    const PROXY_BASE_URL = 'http://localhost:3000/api/mylaps'; // Adjust if your proxy is on a different host/port

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
                // If proxy sends an error, it should be in JSON format
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
                    // Format time for better readability
                    const startTime = new Date(activity.startTime).toLocaleString();
                    option.textContent = `ID: ${activity.id} - Time: ${startTime}, Name: ${activity.location.sport} - ${activity.location.name}`;
                    activitySelect.appendChild(option);
                });
                show(activitiesListDiv);
                // Only enable fetchLapsBtn if there are activities to select
                fetchLapsBtn.disabled = !activitySelect.value;
            } else {
                errorDiv.textContent = "No activities found for this transponder.";
                show(errorDiv);
            }

        } catch (error) {
            console.error("Error fetching activities via proxy:", error);
            hide(loadingDiv);
            errorDiv.textContent = `Error: ${error.message}. Please check the transponder number and ensure your proxy server is running.`;
            show(errorDiv);
        }
    });

    fetchLapsBtn.addEventListener('click', async () => {
        hide(lapsDataDiv);
        lapsOutput.textContent = '';
        hide(errorDiv); // Clear previous errors related to laps

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
                    // Format duration if needed (e.g., from seconds to HH:MM:SS.ms)
                    // For now, displaying as is, assuming it's already a string or number
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
            hide(lapsDataDiv); // Hide laps data if there was an error
        }
    });

    activitySelect.addEventListener('change', () => {
        // Clear lap data and hide laps section when activity selection changes
        hide(lapsDataDiv);
        lapsOutput.textContent = '';
        hide(errorDiv); // Clear any previous errors

        // Enable "Fetch Laps" button only if an activity is selected
        fetchLapsBtn.disabled = !activitySelect.value;
    });

    // Initial state setup
    resetUI();
});
