/**
 * The "Season" dashboard of the main page: how one ice-skating season built up, session by session (distance,
 * fastest lap, fast lap count, lap time distribution), with the option to overlay one other season for
 * comparison. Wired up the same way as setupRecordsEventListeners in records-ui.js: script.js calls
 * setupSeasonEventListeners once, and calls the two functions it gets back whenever the transponder's
 * activities are (re)loaded, or a single session's laps just came in.
 * Depends on utils.js, history-store.js, records.js, and (for the charts) chart-factory.js and Chart.js.
 */

function setupSeasonEventListeners(getChipCode) {
    const section = document.getElementById('dashSeason');
    const emptyEl = document.getElementById('seasonEmpty');
    const bodyEl = document.getElementById('seasonBody');
    const compareSelect = document.getElementById('seasonCompareSelect');
    const metricSelect = document.getElementById('seasonFastLapMetricSelect');
    const distributionModeSelect = document.getElementById('seasonDistributionModeSelect');
    const distanceCanvas = document.getElementById('seasonDistanceChart');
    const fastLapsCanvas = document.getElementById('seasonFastLapsChart');
    const distributionCanvas = document.getElementById('seasonDistributionChart');
    if (!section) return { refresh() {}, remember() {} };

    // The metric list itself never changes, unlike the compare dropdown's seasons: filled in once, up front.
    if (metricSelect) {
        metricSelect.innerHTML = LAP_TIME_METRICS.map(metric => `<option value="${metric.key}">${metric.label}</option>`).join('');
        metricSelect.value = 'fastest-1';
    }

    let distanceChart = null;
    let fastLapsChart = null;
    let distributionChart = null;
    let otherSeasons = [];                 // seasons offered in the compare dropdown, besides the current one

    function destroyCharts() {
        if (distanceChart) { distanceChart.destroy(); distanceChart = null; }
        if (fastLapsChart) { fastLapsChart.destroy(); fastLapsChart = null; }
        if (distributionChart) { distributionChart.destroy(); distributionChart = null; }
    }

    function drawCharts(current, compare, currentLabel, compareLabel, startYear, fastLapThresholdMs, currentTimes, compareTimes) {
        if (typeof Chart === 'undefined') return;
        destroyCharts();
        // A chart that failed to build earlier can leave a canvas registered in Chart.js without our own handle
        // knowing about it; without this a later chart on the same canvas throws "Canvas is already in use"
        // (the same guard records-ui.js's drawChart/drawFastLapsChart use).
        [distanceCanvas, fastLapsCanvas, distributionCanvas].forEach(canvas => {
            const orphan = canvas && Chart.getChart && Chart.getChart(canvas);
            if (orphan) orphan.destroy();
        });
        if (!distanceCanvas || !fastLapsCanvas || !distributionCanvas) return;
        const metric = LAP_TIME_METRICS.find(m => m.key === metricSelect?.value) || LAP_TIME_METRICS[1];
        const withMetric = points => points.map(p => ({ ...p, lineMs: lapTimeStat(p.lapDurationsMs, metric.n) }));
        try {
            distanceChart = new Chart(distanceCanvas, buildSeasonDistanceChartConfig(current, compare, currentLabel, compareLabel, startYear));
            fastLapsChart = new Chart(fastLapsCanvas, buildSeasonFastLapsChartConfig(
                withMetric(current), compare ? withMetric(compare) : null, currentLabel, compareLabel, fastLapThresholdMs, startYear, metric.label
            ));
            if (currentTimes.length > 0) {
                distributionChart = new Chart(distributionCanvas, buildSeasonDistributionChartConfig(
                    currentTimes, compareTimes, currentLabel, compareLabel, distributionModeSelect?.value
                ));
            }
        } catch (error) {
            // a broken chart must not break the rest of the Season dashboard
            destroyCharts();
        }
    }

    function render() {
        const chipCode = getChipCode();
        if (!chipCode) { section.classList.add('hidden'); return; }
        section.classList.remove('hidden');

        const owner = historyOwner();
        if (owner && owner !== chipCode) {
            emptyEl.classList.add('hidden');
            bodyEl.classList.add('hidden');
            destroyCharts();
            return;
        }

        const sessions = historySessions(chipCode);
        const seasons = seasonsPresent(sessions);
        if (seasons.length === 0) {
            emptyEl.classList.remove('hidden');
            bodyEl.classList.add('hidden');
            destroyCharts();
            return;
        }
        emptyEl.classList.add('hidden');
        bodyEl.classList.remove('hidden');

        const current = seasons[0];
        const rest = seasons.slice(1);
        // The dropdown is only rebuilt when the list of other seasons actually changed, so a chosen comparison
        // survives a re-render (a new session coming in) the same way Records keeps its open season groups.
        const restKey = rest.map(season => season.label).join('|');
        if (restKey !== otherSeasons.map(season => season.label).join('|')) {
            otherSeasons = rest;
            const previous = compareSelect.value;
            compareSelect.innerHTML = '<option value="">None</option>' + rest.map(season => `<option value="${season.label}">${season.label}</option>`).join('');
            compareSelect.value = rest.some(season => season.label === previous) ? previous : '';
        }

        const { fastLapThresholdMs } = computePersonalRecords(sessions);
        const currentData = seasonBreakdown(sessions, current.startYear, fastLapThresholdMs);
        const currentTimes = seasonLapTimes(sessions, current.startYear);
        const compareSeason = otherSeasons.find(season => season.label === compareSelect.value) || null;
        const compareData = compareSeason ? seasonBreakdown(sessions, compareSeason.startYear, fastLapThresholdMs) : null;
        const compareTimes = compareSeason ? seasonLapTimes(sessions, compareSeason.startYear) : null;

        drawCharts(currentData, compareData, current.label, compareSeason ? compareSeason.label : '', current.startYear, fastLapThresholdMs, currentTimes, compareTimes);
    }

    compareSelect?.addEventListener('change', render);
    metricSelect?.addEventListener('change', render);
    distributionModeSelect?.addEventListener('change', render);

    return {
        /** Call after a transponder's activities are (re)loaded: shows the dashboard and what is already stored. */
        refresh() {
            render();
        },
        /** Call after a single activity's laps were just fetched, so the season it belongs to updates too. */
        remember() {
            render();
        }
    };
}
