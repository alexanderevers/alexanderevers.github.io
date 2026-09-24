/**
 * The "Records" dashboard of the main page: personal bests across every finished session that is remembered
 * locally for this transponder (history-store.js, records.js). Wired up the same way as
 * setupOverlappingSessionsEventListeners in fetch_overlapping_sessions.js: script.js calls setupRecordsEventListeners
 * once, and calls the two functions it gets back whenever the transponder's activities are (re)loaded, or a single
 * session's laps just came in.
 * Depends on utils.js, history-store.js, records.js, and (for the chart) chart-factory.js and Chart.js.
 */

/** A lap time as "36.500" or "1:05.230" (same convention as lapLabel in live-graph.js). */
function recordsLapLabel(durMs) {
    return formatSecondsToDuration(durMs / 1000).replace(/^0/, '');
}

function setupRecordsEventListeners(getChipCode) {
    const section = document.getElementById('dashRecords');
    const toolbarEl = document.querySelector('.records-toolbar');
    const loadHistoryBtn = document.getElementById('loadHistoryBtn');
    const progressEl = document.getElementById('recordsProgress');
    const mismatchEl = document.getElementById('recordsMismatch');
    const mismatchChipEl = document.getElementById('recordsMismatchChip');
    const changeOwnerBtn = document.getElementById('recordsChangeOwnerBtn');
    const emptyEl = document.getElementById('recordsEmpty');
    const bodyEl = document.getElementById('recordsBody');
    const summaryEl = document.getElementById('recordsSummary');
    const perSeasonEl = document.getElementById('recordsPerSeason');
    const sessionsEl = document.getElementById('recordsSessionsTable');
    const sessionsCountEl = document.getElementById('recordsSessionsCount');
    const chartCanvas = document.getElementById('recordsChart');
    const fastChartCanvas = document.getElementById('recordsFastChart');
    if (!section) return { refresh() {}, remember() {} };

    let recordsChart = null;
    let recordsFastChart = null;
    let allActivities = [];               // the full activity list of the transponder (for "Load full history")
    let expandedSessionId = null;          // which session's laps are shown for excluding one by one
    let openSeasonGroups = new Set();      // season labels the visitor expanded in "Stored sessions", kept open across re-renders

    /** The stored sessions list is grouped by ice-skating season (records.js: seasonOf), newest season first, so a
     *  long history opens one season at a time instead of dumping every session on screen. A session in the
     *  May-August off-season (no season of its own) goes in its own group at the point it falls chronologically. */
    function seasonGroupLabel(startTime) {
        const season = seasonOf(Date.parse(startTime));
        return season ? season.label : 'Off-season (May–Aug)';
    }

    function groupSessionsBySeason(sessions) {
        const groups = new Map();
        sessions.forEach(session => {
            const label = seasonGroupLabel(session.startTime);
            if (!groups.has(label)) groups.set(label, []);
            groups.get(label).push(session);
        });
        return groups;
    }

    function drawChart(timeline) {
        if (typeof Chart === 'undefined' || !chartCanvas) return;
        if (recordsChart) { recordsChart.destroy(); recordsChart = null; }
        // A chart that failed to build earlier (or was created some other way) can leave the canvas registered in
        // Chart.js without recordsChart knowing about it; without this a later chart on the same canvas throws
        // "Canvas is already in use".
        const orphan = Chart.getChart && Chart.getChart(chartCanvas);
        if (orphan) orphan.destroy();
        if (timeline.length < 2) return;                                  // a line needs at least two points
        const t = applyChartDefaults();
        // A plain category axis with ready-made labels: Chart.js's own "time" scale needs a date adapter that is not
        // loaded here (like the rest of the charts on this page, which use lap numbers instead of a time scale).
        const dateLabel = ms => new Date(ms).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' });
        const yearOf = point => new Date(Date.parse(point.startTime)).getFullYear();
        try {
            recordsChart = new Chart(chartCanvas, {
                type: 'line',
                data: {
                    // The full date (day, month, year) is still the label Chart.js shows in the tooltip; only the
                    // x-axis itself is decluttered below to just the year, and only where a new year starts.
                    labels: timeline.map(point => dateLabel(Date.parse(point.startTime))),
                    datasets: [{
                        label: 'Best lap', data: timeline.map(point => point.durMs / 1000),
                        borderColor: t.fast, backgroundColor: withAlpha(t.fast, 0.15), pointBackgroundColor: t.fast,
                        tension: 0.25, fill: true, pointRadius: 3
                    }]
                },
                options: {
                    responsive: true, maintainAspectRatio: false,
                    onClick: (evt, elements) => { const point = elements.length && timeline[elements[0].index]; if (point) goToSession(point.sessionId); },
                    onHover: (evt, elements) => { evt.native.target.style.cursor = elements.length ? 'pointer' : 'default'; },
                    plugins: { legend: { display: false }, tooltip: { callbacks: { label: item => recordsLapLabel(item.parsed.y * 1000) } } },
                    scales: {
                        x: {
                            grid: { color: t.grid }, border: { color: t.axis },
                            ticks: {
                                color: t.muted, minRotation: 40, maxRotation: 50,
                                // autoSkip stays on: afterBuildTicks below narrows the ticks down to one per year
                                // already, but on a narrow chart or with several years close together even those can
                                // still overlap once rotated, so autoSkip is left free to thin an early year out.
                                autoSkip: true,
                                // "value" here is the category index (what afterBuildTicks put in scale.ticks below),
                                // not the tick's position within this (already filtered) list of ticks - using the
                                // wrong one silently mislabels every tick after the first.
                                callback: value => { const point = timeline[value]; return point ? String(yearOf(point)) : ''; }
                            },
                            // Only one tick per year, placed at that year's first point: Chart.js's own autoSkip
                            // picks evenly-spaced ticks by index, not by what they mean, so it cannot be trusted to
                            // land exactly on every year's first point (and would still draw the rest unlabelled).
                            afterBuildTicks: scale => {
                                const ticks = [];
                                let lastYear = null;
                                timeline.forEach((point, index) => {
                                    const year = yearOf(point);
                                    if (year !== lastYear) { ticks.push({ value: index }); lastYear = year; }
                                });
                                scale.ticks = ticks;
                            }
                        },
                        y: timeAxis(t, 'left', { reverse: false, ticks: { color: t.muted, callback: value => recordsLapLabel(value * 1000) } })
                    }
                }
            });
        } catch (error) {
            // a broken chart must not break the rest of the Records dashboard (or poison the canvas for next time)
            recordsChart = null;
            const stuck = Chart.getChart && Chart.getChart(chartCanvas);
            if (stuck) stuck.destroy();
        }
    }

    /**
     * "Fast laps per season": a bar per season (how many of that season's laps beat the one shared pace bar,
     * records.js: fastLapThresholdMs) with a line of their average time (right-hand axis). The pace bar is fixed
     * across every season (not recomputed per season), so the bar heights genuinely say how much fast skating a
     * season had - a season with a lot more fast laps than another visibly shows it, instead of every season
     * always ending up at roughly the same share of its own laps.
     */
    function drawFastLapsChart(fastLapsPerSeason, fastLapThresholdMs) {
        if (typeof Chart === 'undefined' || !fastChartCanvas) return;
        if (recordsFastChart) { recordsFastChart.destroy(); recordsFastChart = null; }
        const orphan = Chart.getChart && Chart.getChart(fastChartCanvas);
        if (orphan) orphan.destroy();
        if (fastLapsPerSeason.length === 0) return;
        const t = applyChartDefaults();
        try {
            recordsFastChart = new Chart(fastChartCanvas, {
                data: {
                    labels: fastLapsPerSeason.map(season => season.season),
                    datasets: [
                        {
                            type: 'bar', label: 'Fast laps', data: fastLapsPerSeason.map(season => season.fastCount),
                            backgroundColor: withAlpha(t.fast, 0.35), yAxisID: 'count', maxBarThickness: 40
                        },
                        {
                            type: 'line', label: 'Average fast lap', data: fastLapsPerSeason.map(season => season.avgFastMs === null ? null : season.avgFastMs / 1000),
                            borderColor: t.avg, backgroundColor: t.avg, pointBackgroundColor: t.avg,
                            tension: 0.25, pointRadius: 3, yAxisID: 'time'
                        }
                    ]
                },
                options: {
                    responsive: true, maintainAspectRatio: false,
                    plugins: {
                        legend: { display: true, labels: { color: t.text, boxWidth: 14 } },
                        tooltip: {
                            callbacks: {
                                label: item => (item.dataset.yAxisID === 'time'
                                    ? `Average fast lap: ${recordsLapLabel(item.parsed.y * 1000)}`
                                    : `${item.parsed.y} fast lap${item.parsed.y === 1 ? '' : 's'} (of ${fastLapsPerSeason[item.dataIndex].totalLaps}), under ${recordsLapLabel(fastLapThresholdMs)}`)
                            }
                        }
                    },
                    scales: {
                        x: { grid: { color: t.grid }, border: { color: t.axis }, ticks: { color: t.muted } },
                        count: {
                            position: 'left', beginAtZero: true, grid: { color: t.grid }, border: { color: t.axis },
                            ticks: { color: t.muted, precision: 0 }
                        },
                        time: {
                            position: 'right', reverse: false, grid: { display: false }, border: { color: t.axis },
                            ticks: { color: t.muted, callback: value => recordsLapLabel(value * 1000) }
                        }
                    }
                }
            });
        } catch (error) {
            recordsFastChart = null;
            const stuck = Chart.getChart && Chart.getChart(fastChartCanvas);
            if (stuck) stuck.destroy();
        }
    }

    function sessionRowHtml(session, chipCode) {
        const excludedLaps = new Set(session.excludedLaps || []);
        const skatingCount = (session.laps || []).filter(lap => !excludedLaps.has(lap.nr) && recordsIsSkatingLap(lap, session.trackLengthM || 400)).length;
        const best = (session.laps || [])
            .filter(lap => !excludedLaps.has(lap.nr) && recordsIsSkatingLap(lap, session.trackLengthM || 400))
            .reduce((a, b) => (!a || b.durMs < a.durMs ? b : a), null);
        const expanded = expandedSessionId === session.id;
        const lapsGrid = expanded ? `<div class="records-lap-grid" data-session="${session.id}">${(session.laps || []).map(lap => `
            <button type="button" class="records-lap${excludedLaps.has(lap.nr) ? ' excluded' : ''}" data-session="${session.id}" data-lap="${lap.nr}"
                title="Lap ${lap.nr}: ${recordsLapLabel(lap.durMs)}${excludedLaps.has(lap.nr) ? ' (excluded)' : ''}">${lap.nr}</button>`).join('')}</div>` : '';
        return `<tr class="records-session-row${session.excluded ? ' excluded' : ''}" data-session="${session.id}">
                <td>${formatDateTimeWithDay(session.startTime)}</td>
                <td>${escapeHtml(session.locationName || '–')}</td>
                <td>${best ? recordsLapLabel(best.durMs) : '–'}</td>
                <td>${skatingCount} / ${(session.laps || []).length}</td>
                <td class="records-session-actions">
                    <button type="button" class="secondary-btn records-open" data-session="${session.id}" title="Fetch this session's laps and open it on the Session dashboard">Fetch laps</button>
                    <button type="button" class="secondary-btn records-edit-laps" data-session="${session.id}">${expanded ? 'Hide laps' : 'Edit laps'}</button>
                    <button type="button" class="secondary-btn records-delete" data-session="${session.id}"
                        title="${session.excluded ? 'Bring this session back into your records' : 'Leave this session out of your records: for example it was not really you, or the timing was wrong. Its data is kept, and this can be undone'}">${session.excluded ? 'Restore' : 'Delete'}</button>
                </td>
            </tr>
            ${expanded ? `<tr class="records-lap-row" data-session="${session.id}"><td colspan="5">${lapsGrid}</td></tr>` : ''}`;
    }

    function render() {
        const chipCode = getChipCode();
        if (!chipCode) { section.classList.add('hidden'); return; }
        section.classList.remove('hidden');

        // this device remembers one transponder's history at a time: a different one is not shown, and not touched
        const owner = historyOwner();
        const mismatch = owner && owner !== chipCode;
        mismatchEl.classList.toggle('hidden', !mismatch);
        toolbarEl.classList.toggle('hidden', mismatch);
        if (mismatch) {
            mismatchChipEl.textContent = owner;
            emptyEl.classList.add('hidden');
            bodyEl.classList.add('hidden');
            sessionsEl.innerHTML = '';
            if (recordsChart) { recordsChart.destroy(); recordsChart = null; }
            if (recordsFastChart) { recordsFastChart.destroy(); recordsFastChart = null; }
            return;
        }

        const sessions = historySessions(chipCode);
        progressEl.textContent = sessions.length ? `${sessions.length} session${sessions.length === 1 ? '' : 's'} stored` : '';
        if (sessions.length === 0) {
            emptyEl.classList.remove('hidden');
            bodyEl.classList.add('hidden');
            sessionsEl.innerHTML = '';                    // no stale rows left behind under the hidden body
            if (recordsChart) { recordsChart.destroy(); recordsChart = null; }
            if (recordsFastChart) { recordsFastChart.destroy(); recordsFastChart = null; }
            return;
        }
        emptyEl.classList.add('hidden');
        bodyEl.classList.remove('hidden');

        const records = computePersonalRecords(sessions);
        summaryEl.innerHTML = `
            <div class="stat-card"><span class="label">Best lap ever</span><span class="value">${records.best ? recordsLapLabel(records.best.durMs) : '–'}</span>
                ${records.best ? `<span class="sub-value">${formatDateTimeWithDay(records.best.startTime)}${records.best.locationName ? ' · ' + escapeHtml(records.best.locationName) : ''}</span>` : ''}</div>
            <div class="stat-card"><span class="label">Sessions remembered</span><span class="value">${records.sessionCount}</span></div>
            <div class="stat-card"><span class="label">Skating laps</span><span class="value">${records.skatingLapCount}</span></div>
            <div class="stat-card"><span class="label">Total distance</span><span class="value">${records.distanceKm.toFixed(1)}</span><span class="sub-value"> km</span></div>
            <div class="stat-card"><span class="label">Time skating</span><span class="value">${formatDurationShort(records.activeMs)}</span></div>`;

        perSeasonEl.innerHTML = records.perSeason.length
            ? `<table class="laps-table"><thead><tr><th>Season</th><th>Best lap</th><th>When</th></tr></thead><tbody>${records.perSeason.map(record => `
                <tr class="records-goto" data-session="${record.sessionId}" title="Go to this session in the stored sessions below"><td>${record.season}</td><td>${recordsLapLabel(record.durMs)}</td><td>${formatDateTimeWithDay(record.startTime)}</td></tr>`).join('')}</tbody></table>`
            : '<p class="muted-note">Not enough data yet.</p>';

        drawChart(records.timeline);
        drawFastLapsChart(records.fastLapsPerSeason, records.fastLapThresholdMs);
        sessionsCountEl.textContent = `(${sessions.length})`;
        const groups = groupSessionsBySeason(sessions);
        sessionsEl.innerHTML = [...groups.entries()].map(([label, group]) => `
            <details class="records-season-details" data-season-group="${escapeHtml(label)}"${openSeasonGroups.has(label) ? ' open' : ''}>
                <summary>${escapeHtml(label)} <span class="muted-note">(${group.length})</span></summary>
                <table class="laps-table records-sessions"><thead><tr><th>Session</th><th>Rink</th><th>Best lap</th><th>Skating laps</th><th></th></tr></thead>
                    <tbody>${group.map(session => sessionRowHtml(session, chipCode)).join('')}</tbody></table>
            </details>`).join('');
    }

    // Clicking a dot of "Best lap over time" or a row of "Best lap per season" opens the stored sessions (if they
    // were closed), opens that session's season group (if it was closed too), and scrolls to it, briefly highlighted.
    function goToSession(sessionId) {
        const details = document.getElementById('recordsSessionsDetails');
        if (details && !details.open) details.open = true;
        requestAnimationFrame(() => {
            // the row exists in the DOM even while its season group is closed (only hidden), so it can be found first
            const row = sessionsEl.querySelector(`.records-session-row[data-session="${sessionId}"]`);
            if (!row) return;
            const settle = () => {
                row.scrollIntoView({ behavior: 'smooth', block: 'center' });
                row.classList.add('flash');
                setTimeout(() => row.classList.remove('flash'), 1500);
            };
            const seasonDetails = row.closest('.records-season-details');
            if (seasonDetails && !seasonDetails.open) {
                seasonDetails.open = true;
                openSeasonGroups.add(seasonDetails.dataset.seasonGroup);
                requestAnimationFrame(settle);
            } else {
                settle();
            }
        });
    }

    // "Fetch laps" on a stored session: select it (across every year, not just the one the year filter shows) and
    // open it on the Session dashboard, once its laps (fetched by script.js's openActivityOnSessionDashboard) land.
    function openSession(sessionId) {
        const yearFilter = document.getElementById('yearFilter');
        if (yearFilter && yearFilter.value !== 'all') { yearFilter.value = 'all'; yearFilter.dispatchEvent(new Event('change')); }
        if (typeof window.openActivityOnSessionDashboard === 'function') window.openActivityOnSessionDashboard(sessionId);
    }

    perSeasonEl?.addEventListener('click', event => {
        const row = event.target.closest('.records-goto');
        if (row) goToSession(Number(row.dataset.session));
    });

    // A season group's own open/closed state has to be tracked separately, because the sessions table is rebuilt
    // (innerHTML) after every change and would otherwise forget which seasons the visitor had opened. "toggle" does
    // not bubble in every browser, so this listens on the capture phase instead, which always sees it either way.
    sessionsEl?.addEventListener('toggle', event => {
        const details = event.target;
        if (!details.classList || !details.classList.contains('records-season-details')) return;
        const label = details.dataset.seasonGroup;
        if (details.open) openSeasonGroups.add(label); else openSeasonGroups.delete(label);
    }, true);

    sessionsEl?.addEventListener('click', event => {
        const chipCode = getChipCode();
        if (!chipCode) return;
        const openBtn = event.target.closest('.records-open');
        if (openBtn) { openSession(Number(openBtn.dataset.session)); return; }
        const editBtn = event.target.closest('.records-edit-laps');
        if (editBtn) {
            const id = Number(editBtn.dataset.session);
            expandedSessionId = expandedSessionId === id ? null : id;
            render();
            return;
        }
        // "Delete" does not forget the session (its data is kept): it just leaves it out of the records, greyed out
        // in the list, the same as excluding it. Pressing it again on an already-excluded session restores it.
        const deleteBtn = event.target.closest('.records-delete');
        if (deleteBtn) {
            const id = Number(deleteBtn.dataset.session);
            const alreadyExcluded = deleteBtn.closest('.records-session-row').classList.contains('excluded');
            setSessionExcluded(chipCode, id, !alreadyExcluded);
            render();
            return;
        }
        const lapBtn = event.target.closest('.records-lap');
        if (lapBtn) {
            const excluded = lapBtn.classList.contains('excluded');
            setLapExcluded(chipCode, Number(lapBtn.dataset.session), Number(lapBtn.dataset.lap), !excluded);
            render();
        }
    });

    changeOwnerBtn?.addEventListener('click', () => {
        const chipCode = getChipCode();
        if (!chipCode) return;
        const owner = historyOwner();
        if (!owner || owner === chipCode) return;
        const kb = historyStorageKB();
        const count = historySessions(owner).length;
        if (window.confirm(`Forget the ${count} stored session${count === 1 ? '' : 's'} of ${owner} (${kb} KB) and remember ${chipCode} instead? This cannot be undone.`)) {
            changeOwner(chipCode);
            expandedSessionId = null;
            openSeasonGroups = new Set();
            render();
        }
    });

    loadHistoryBtn?.addEventListener('click', async () => {
        const chipCode = getChipCode();
        if (!chipCode || !allActivities.length) return;
        loadHistoryBtn.disabled = true;
        const known = new Set(historySessions(chipCode).map(session => session.id));
        const todo = allActivities.filter(activity => !known.has(activity.id) && isFinishedActivity(activity.startTime, activity.endTime));
        if (todo.length === 0) { progressEl.textContent = 'Nothing new to load: every finished session is already stored.'; loadHistoryBtn.disabled = false; return; }
        let done = 0;
        const queue = [...todo];
        const worker = async () => {
            while (queue.length) {
                const activity = queue.shift();
                try {
                    const laps = normalizeLaps(await fetchLaps(activity.id, activity.endTime, activity.startTime));
                    rememberSession(chipCode, activity, laps);
                } catch (error) {
                    // one session that could not be fetched (private, or a network hiccup) does not stop the rest
                }
                done++;
                progressEl.textContent = `Loading your history… ${done} of ${todo.length}`;
                if (done % 5 === 0 || done === todo.length) render();
            }
        };
        await Promise.all(Array.from({ length: 5 }, worker));
        loadHistoryBtn.disabled = false;
        render();
    });

    return {
        /** Call after a transponder's activities are (re)loaded: shows the dashboard and what is already stored. */
        refresh(activities) {
            allActivities = activities || [];
            expandedSessionId = null;
            openSeasonGroups = new Set();
            render();
        },
        /** Call after a single activity's laps were just fetched, so it is remembered without needing "Load full history". */
        remember(activity, normalizedLaps) {
            const chipCode = getChipCode();
            if (!chipCode) return;
            rememberSession(chipCode, activity, normalizedLaps);
            render();
        }
    };
}
