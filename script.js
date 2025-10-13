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

    const MYLAPS_std_header = {
        "Accept": "application/json",
        "Origin": "https://speedhive.mylaps.com",
        "Referer": "https://speedhive.mylaps.com/",
    };

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
            // Step 1: Get User ID
            let url = `https://usersandproducts-api.speedhive.com/api/v2/products/chips/code/${transponder}/account`;
            let response = await fetch(url, { headers: MYLAPS_std_header });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Failed to fetch User ID: ${response.status} ${response.statusText} - ${errorText}`);
            }
            const userData = await response.json();
            const userID = userData.userId;

            // Step 2: Get Activities
            url = `https://practice-api.speedhive.com/api/v1/accounts/${userID}/training/activities?count=100`;
            response = await fetch(url, { headers: MYLAPS_std_header });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Failed to fetch activities: ${response.status} ${response.statusText} - ${errorText}`);
            }
            const activitiesResponse = await response.json();
            userActivities = activitiesResponse.activities || [];

            hide(loadingDiv);

            if (userActivities.length > 0) {
                userActivities.forEach(activity => {
                    const option = document.createElement('option');
                    option.value = activity.id;
                    option.textContent = `ID: ${activity.id} - Time: ${new Date(activity.startTime).toLocaleString()}, Name: ${activity.location.sport} - ${activity.location.name}`;
                    activitySelect.appendChild(option);
                });
                show(activitiesListDiv);
                fetchLapsBtn.disabled = false; // Enable if activities are found
            } else {
                errorDiv.textContent = "No activities found for this transponder.";
                show(errorDiv);
            }

        } catch (error) {
            console.error("Error fetching activities:", error);
            hide(loadingDiv);
            errorDiv.textContent = `Error: ${error.message}. Please check the transponder number and ensure the API is accessible.`;
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
            // Step 3: Get Laps for Selected Activity
            const url = `https://practice-api.speedhive.com/api/v1/training/activities/${selectedActivityId}/sessions`;
            const response = await fetch(url, { headers: MYLAPS_std_header });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Failed to fetch lap data: ${response.status} ${response.statusText} - ${errorText}`);
            }
            const activitySessions = await response.json();
            const specificActivityData = activitySessions.sessions[0]?.laps || [];

            hide(loadingDiv);
            show(lapsDataDiv);

            if (specificActivityData.length > 0) {
                let lapsText = '';
                specificActivityData.forEach(lap => {
                    lapsText += `${lap.nr} - \t\t ${lap.duration}\n`;
                });
                lapsOutput.textContent = lapsText;
            } else {
                lapsOutput.textContent = "No lap data found for the selected activity.";
            }

        } catch (error) {
            console.error("Error fetching laps:", error);
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
        if (activitySelect.value) {
            fetchLapsBtn.disabled = false;
        } else {
            fetchLapsBtn.disabled = true;
        }
    });

    // Initial state setup
    resetUI();
});
