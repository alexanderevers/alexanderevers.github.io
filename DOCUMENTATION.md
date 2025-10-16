# MYLAPS Activity Viewer Documentation

This document provides an overview of the project structure, focusing on the Google Cloud Function proxy server and its interaction with the frontend application.

## Project Overview

The MYLAPS Activity Viewer is a web application that fetches and displays training activity data from the MYLAPS Speedhive platform. It consists of a static frontend (HTML, CSS, JavaScript) and a serverless proxy backend running on Google Cloud Functions.

## Proxy Server (Google Cloud Function)

The proxy server is essential for this application to work. The MYLAPS Speedhive API does not allow direct requests from a web browser due to CORS (Cross-Origin Resource Sharing) restrictions. The proxy server acts as a middleman, receiving requests from the frontend, forwarding them to the MYLAPS API with the correct headers, and then relaying the response back to the frontend.

### Key Details

-   **Location:** The code for the proxy is located in the `/proxyserver` directory.
-   **Entry Point File:** The main file for the Cloud Function is `index.js`.
-   **Entry Point Function:** The function that Google Cloud executes is named `mylapsProxy`. This must match the "Entry point" setting in your Google Cloud Function configuration.

### Deployment

To deploy or redeploy the proxy server, use the `gcloud` CLI from the root of the workspace:

```bash
gcloud run deploy mylapsproxyfunction --source alexanderevers.github.io/proxyserver --region us-central1 --allow-unauthenticated
```

*(Note: While the command uses `gcloud run deploy`, this is the modern way to deploy function-based services, and it correctly deploys to the Cloud Functions environment when configured as such.)*

### Endpoints

The proxy exposes several endpoints that map to the underlying MYLAPS API:

-   `/api/mylaps/userid/:transponder`: Fetches the `userId` for a given transponder number.
-   `/api/mylaps/activities/:userId`: Fetches a list of activities for a user.
-   `/api/mylaps/laps/:activityId`: Fetches lap data for a specific activity.
-   `/api/mylaps/account/:userId`: Fetches a user's profile information (name, etc.).
-   `/api/mylaps/avatar/:userId`: Fetches a user's profile image.

## Frontend Application

The frontend is a single-page application that handles user input, makes requests to the proxy server, and visualizes the data.

### Key Files

-   **`index.html`**: The main HTML file containing the structure of the page.
-   **`script.js`**: The core JavaScript file that contains the application logic for fetching data, handling user interactions, and updating the UI.
-   **`api.js`**: This file contains the functions responsible for making `fetch` requests to the proxy server. The `PROXY_BASE_URL` constant in this file must point to your deployed Google Cloud Function URL.
-   **`style.css`**: Contains all the styles for the application.

### Data Flow

1.  A user enters a transponder number and clicks "Fetch Activities".
2.  `script.js` calls the `fetchActivities` function in `api.js`.
3.  `api.js` makes a request to the proxy's `/userid/:transponder` endpoint to get the `userId`.
4.  `api.js` then makes parallel requests to the `/activities/:userId` and `/account/:userId` endpoints.
5.  When the data is returned, `script.js` calls `displayProfileInfo` to show the user's name and avatar, and populates the activities dropdown.