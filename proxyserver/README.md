# MYLAPS Proxy Server API

This document outlines the available API endpoints for the MYLAPS proxy server.

## Base URL

All API endpoints are relative to the proxy server's base URL.

## Endpoints

The following endpoints are available:

### Get User ID by Chip Code

- **Endpoint:** `/api/mylaps/userid/{chip_code}`
- **Description:** Retrieves the user account associated with a given transponder chip code.
- **Example:** `/api/mylaps/userid/1234567`

### Get User Activities

- **Endpoint:** `/api/mylaps/activities/{account_id}`
- **Description:** Fetches the training activities for a specific user account.
- **Example:** `/api/mylaps/activities/MYLAPS-GA-123456`

### Get Session Laps

- **Endpoint:** `/api/mylaps/laps/{activity_id}`
- **Description:** Gets the lap times for a specific training session.
- **Example:** `/api/mylaps/laps/987654`

### Get Account Profile

- **Endpoint:** `/api/mylaps/account/{account_id}`
- **Description:** Retrieves the profile information for a given account.
- **Example:** `/api/mylaps/account/MYLAPS-GA-123456`

### Get User Avatar

- **Endpoint:** `/api/mylaps/avatar/{image_id}`
- **Description:** Fetches the user's avatar image.
- **Example:** `/api/mylaps/avatar/abcdef123456`

### Get Location Activities

- **Endpoint:** `/api/mylaps/locations/{location_id}`
- **Description:** Retrieves activities for a specific location.
- **Example:** `/api/mylaps/locations/54`

### Get Activities by Chip Code

- **Endpoint:** `/api/mylaps/chips/{chip_code}`
- **Description:** Fetches all training activities associated with a specific chip code.
- **Example:** `/api/mylaps/chips/1234567`