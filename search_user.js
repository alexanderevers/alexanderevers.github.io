document.addEventListener('DOMContentLoaded', () => {
    const searchButton = document.getElementById('searchButton');
    const searchInput = document.getElementById('searchInput');
    const resultsContainer = document.getElementById('resultsContainer');
    const prevButton = document.getElementById('prevButton');
    const nextButton = document.getElementById('nextButton');
    const pageInfo = document.getElementById('pageInfo');

    const PROXY_BASE_URL = 'https://us-central1-proxyapi-475018.cloudfunctions.net/mylapsProxyFunction/api/mylaps';
    let currentPage = 1;
    const count = 25;

    const fetchLastActivity = async (userId) => {
        if (!userId) return null;
        try {
            const response = await fetch(`${PROXY_BASE_URL}/activities/${userId}?count=1&order=desc`);
            if (!response.ok) return null;
            const data = await response.json();
            if (data && data.activities && data.activities.length > 0) {
                return data.activities[0];
            }
            return null;
        } catch (error) {
            console.error(`Error fetching activity for user ${userId}:`, error);
            return null;
        }
    };

    const performSearch = async () => {
        const searchTerm = searchInput.value;
        if (!searchTerm) {
            resultsContainer.innerHTML = '<p>Please enter a search term.</p>';
            return;
        }

        resultsContainer.innerHTML = '<p>Loading...</p>';
        const offset = (currentPage - 1) * count;

        try {
            const response = await fetch(`${PROXY_BASE_URL}/search?term=${encodeURIComponent(searchTerm)}&count=${count}&offset=${offset}`);
            if (!response.ok) {
                throw new Error('Network response was not ok');
            }
            const data = await response.json();

            if (data && data.length > 0) {
                resultsContainer.innerHTML = '';
                data.forEach(async user => {
                    const card = document.createElement('div');
                    card.className = 'session-card';

                    const avatarUrl = user.entityId ? `${PROXY_BASE_URL}/avatar/${user.entityId}` : 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

                    let displayName;
                    if (user.name && user.nickName) {
                        displayName = `${user.name} - ${user.nickName}`;
                    } else {
                        displayName = user.name || user.nickName || 'Unknown User';
                    }

                    const lastActivity = await fetchLastActivity(user.entityId);

                    let activityInfo = '<p>No recent activity found.</p>';
                    if (lastActivity) {
                        const transponderLink = `index.html?transponder=${lastActivity.chipCode}`;
                        activityInfo = `
                            <div class="session-stat">
                                <span class="label">Transponder</span>
                                <span class="value"><a href="${transponderLink}" target="_blank">${lastActivity.chipCode || 'N/A'}</a></span>
                            </div>
                            <div class="session-stat">
                                <span class="label">Last Session</span>
                                <span class="value">${formatDateTime(lastActivity.startTime)}</span>
                            </div>
                            <div class="session-stat">
                                <span class="label">Location</span>
                                <span class="value">${lastActivity.location.name || 'N/A'}</span>
                            </div>
                        `;
                    }

                    card.innerHTML = `
                        <img src="${avatarUrl}" class="session-card-avatar" alt="User Avatar" onerror="this.style.display='none'">
                        <div class="session-card-main">
                            <div class="session-card-header">
                                <span class="session-card-name">${displayName}</span>
                            </div>
                            <div class="session-card-stats">
                                ${activityInfo}
                            </div>
                        </div>
                    `;
                    resultsContainer.appendChild(card);
                });

                pageInfo.textContent = `Page ${currentPage}`;
                prevButton.disabled = currentPage === 1;
                nextButton.disabled = data.length < count;
            } else {
                resultsContainer.innerHTML = '<p>No users found.</p>';
                prevButton.disabled = true;
                nextButton.disabled = true;
            }
        } catch (error) {
            console.error('Error fetching search results:', error);
            resultsContainer.innerHTML = '<p>No users found.</p>';
            prevButton.disabled = true;
            nextButton.disabled = true;
        }
    };

    searchButton.addEventListener('click', () => {
        currentPage = 1;
        performSearch();
    });

    prevButton.addEventListener('click', () => {
        if (currentPage > 1) {
            currentPage--;
            performSearch();
        }
    });

    nextButton.addEventListener('click', () => {
        currentPage++;
        performSearch();
    });
});