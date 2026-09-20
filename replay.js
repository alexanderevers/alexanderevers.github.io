/**
 * Race replay page: draws the selected riders on an oblong track, driven by their real lap times.
 * Depends on utils.js, api.js, replay-track.js and replay-model.js.
 */
document.addEventListener('DOMContentLoaded', async () => {
    const MAX_RIDERS = 200;             // safety limit on how many riders are shown at once
    const LABELLED_RIDERS = 10;         // the first riders get a coloured dot with initials, the rest are small blue dots
    const REPLAY_STORAGE_KEY = 'replayData';
    const LANE_STEP = 0.0075;           // sideways spacing between riders so overlapping dots stay visible
    const LANES = 5;
    const BAND_WIDTH = 0.045;           // drawn width of the ice band, in track units
    const MARGIN = 0.05;                // space around the track inside the canvas, in track units

    const $ = id => document.getElementById(id);
    const canvas = $('trackCanvas');
    const ctx = canvas.getContext('2d');
    const trackWrap = $('trackWrap');
    const tooltip = $('trackTooltip');
    const playBtn = $('playBtn');
    const speedSelect = $('speedSelect');
    const clockLabel = $('clockLabel');
    const riderList = $('riderList');
    const riderCount = $('riderCount');
    const statusEl = $('replayStatus');
    const lapCanvas = $('lapCanvas');
    const lapCtx = lapCanvas.getContext('2d');
    const followSelect = $('followSelect');
    const lapReadout = $('lapReadout');
    const lapMaxSlider = $('lapMaxSlider');
    const lapMaxInput = $('lapMaxInput');
    const lapMaxError = $('lapMaxError');
    const compareReadout = $('compareReadout');

    // The replay speed is remembered between visits (only when it is one of the speeds in the list).
    const savedSpeed = String(loadSetting('replaySpeed', ''));
    if ([...speedSelect.options].some(option => option.value === savedSpeed)) speedSelect.value = savedSpeed;
    speedSelect.addEventListener('change', () => saveSetting('replaySpeed', speedSelect.value));

    // ---------- Data ----------
    function loadPayload() {
        try {
            const payload = JSON.parse(localStorage.getItem(REPLAY_STORAGE_KEY));
            const wanted = new URLSearchParams(window.location.search).get('activity');
            if (!payload || !payload.reference || !Array.isArray(payload.riders)) return null;
            if (wanted && String(payload.reference.id) !== wanted) return null;
            const chip = (new URLSearchParams(window.location.search).get('transponder') || '').toUpperCase();
            if (chip && payload.reference.chipCode && payload.reference.chipCode.toUpperCase() !== chip) return null;
            return payload;
        } catch {
            return null;
        }
    }

    /**
     * The replay of somebody else's link, or in a browser that never opened it from the main page: everything
     * is rebuilt from the address (transponder and activity) with the same search as the main page.
     */
    async function rebuildPayload() {
        const params = new URLSearchParams(window.location.search);
        const transponder = (params.get('transponder') || '').trim().toUpperCase();
        const activityId = params.get('activity');
        if (!isValidTransponderFormat(transponder) || !/^\d{1,15}$/.test(activityId || '')) return null;

        const loading = $('replayLoading');
        show(loading);
        loading.textContent = 'Loading the replay…';
        const { activities, account, userId } = await fetchActivities(transponder);
        const reference = activities.find(activity => String(activity.id) === activityId);
        if (!reference) throw new Error(`Activity ${activityId} was not found for transponder ${transponder}.`);
        const sessions = await loadOverlappingRiders(reference, text => { loading.textContent = text; });
        const referenceRider = { name: riderDisplayName({ chipLabel: transponder, account }), chipCode: transponder, accountId: userId };
        const wanted = parseReplayRiders(params.get('riders'));
        const known = new Set(sessions.map(session => session.id));
        const selected = wanted ? wanted.filter(id => known.has(id)) : sessions.filter(session => session.togetherMs > 0).map(session => session.id);
        return buildReplayPayload(reference, referenceRider, sessions, selected);
    }

    let payload;
    try {
        payload = loadPayload() || await rebuildPayload();
    } catch (error) {
        console.warn('Could not load the replay', error);
        hide($('replayLoading'));
        $('replayError').textContent = `Could not load the replay: ${error.message}`;
        show($('replayError'));
        return;
    }
    hide($('replayLoading'));
    if (!payload) {
        show($('replayEmpty'));
        return;
    }
    // The riders in the address (when there are any) decide who is shown first.
    const wantedRiders = parseReplayRiders(new URLSearchParams(window.location.search).get('riders'));
    if (wantedRiders) payload.selected = wantedRiders;
    show($('replayApp'));

    const trackLengthM = payload.trackLengthM || 400;
    $('replaySubtitle').textContent = `${payload.location.sport} · ${payload.location.name} · ${formatDateTime(payload.riders[0].startTime)}`;
    $('backLink').href = `index.html?transponder=${encodeURIComponent(payload.reference.chipCode || '')}&activity=${encodeURIComponent(payload.reference.id)}`;

    // Riders who were not on the ice at the same time as you (0 min together) are left out of the replay.
    const riders = payload.riders.filter(r => r.isReference || r.togetherMs !== 0).map((r, index) => ({
        ...r, index, laps: null, loading: false, error: null, selected: false, selectedAt: 0, slot: null, hover: false, forceLabel: false, forceSmall: false, labelledAt: 0
    }));

    // ---------- Theme colours (read from the CSS tokens) ----------
    let colors = {};
    function readColors() {
        const styles = getComputedStyle(document.documentElement);
        const token = name => styles.getPropertyValue(name).trim();
        colors = {
            ice: token('--surface-2'), edge: token('--axis'), grid: token('--grid'),
            surface: token('--surface'), text: token('--text'), muted: token('--text-muted'),
            secondary: token('--text-secondary'), slow: token('--series-muted'),
            series: Array.from({ length: LABELLED_RIDERS }, (_, i) => token(`--cat-${i + 1}`))
        };
    }
    readColors();
    document.addEventListener('themechange', readColors);
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', readColors);

    // A labelled rider has a palette slot; every other rider is drawn as a small dot in the first (blue) colour.
    const colorOf = rider => colors.series[rider.slot ?? 0];

    // Pick black or white text for the initials, whichever reads better on the rider's colour.
    function inkFor(hex) {
        const n = parseInt(hex.replace('#', ''), 16);
        const lin = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
        const luminance = 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
        return luminance > 0.4 ? '#0b0b0b' : '#ffffff';
    }
    const initials = name => name.split(/[\s-]+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('') || '?';

    // ---------- Selection ----------
    const selectedRiders = () => riders.filter(r => r.selected);

    // The rider whose lap times are drawn next to the followed rider's in the lap graph (one at a time).
    let compareRider = null;
    function toggleCompare(rider) {
        compareRider = compareRider === rider ? null : rider;
        if (compareRider && !rider.selected) setSelected(rider, true);   // a hidden rider is shown so the laps load
        else updateRows();
    }

    // The reference rider, then the riders the user gave a colour (by clicking their dot in the list), then the
    // riders that were shown first are labelled (colour + initials); a rider keeps its colour while shown.
    // When a labelled rider is hidden, the earliest shown small dot takes over.
    let selectionCounter = 0;
    function refreshLabelled() {
        const rank = r => (r.isReference ? 0 : r.forceLabel ? 1 : 2);
        const ordered = selectedRiders()
            .filter(r => r.isReference || !r.forceSmall)
            .sort((a, b) => (rank(a) - rank(b)) || (rank(a) === 1 ? a.labelledAt - b.labelledAt : a.selectedAt - b.selectedAt));
        const labelled = ordered.slice(0, LABELLED_RIDERS);
        const used = new Set();
        riders.forEach(r => {
            if (!labelled.includes(r)) r.slot = null;
            else if (r.slot !== null) used.add(r.slot);
        });
        labelled.forEach(r => {
            if (r.slot !== null) return;
            let slot = r.isReference && !used.has(0) ? 0 : -1;
            for (let i = 0; slot < 0 && i < LABELLED_RIDERS; i++) if (!used.has(i)) slot = i;
            r.slot = slot;
            used.add(slot);
        });
    }

    // Laps are fetched a few at a time so that showing many riders at once does not flood the API.
    const LAP_FETCH_CONCURRENCY = 5;
    let activeLapFetches = 0;
    const lapFetchQueue = [];

    function requestLaps(rider) {
        rider.loading = true;
        rider.error = null;
        lapFetchQueue.push(rider);
        pumpLapQueue();
    }

    function pumpLapQueue() {
        while (activeLapFetches < LAP_FETCH_CONCURRENCY && lapFetchQueue.length) {
            const rider = lapFetchQueue.shift();
            if (!rider.selected) { rider.loading = false; continue; }   // hidden again before its turn
            activeLapFetches++;
            loadLaps(rider).finally(() => { activeLapFetches--; pumpLapQueue(); });
        }
    }

    async function loadLaps(rider) {
        try {
            rider.laps = normalizeLaps(await fetchLaps(rider.id, rider.endTime));
            if (rider.laps.length === 0) rider.error = 'No lap data';
        } catch (error) {
            rider.error = error.message || 'Laps unavailable';
        } finally {
            rider.loading = false;
            updateTimeline();
            updateRows();
        }
    }

    // Click on the dot in front of a rider: give the rider a colour, or make it a small dot again.
    let labelCounter = 0;
    function toggleLabel(rider) {
        if (rider.isReference) return;   // you always have a colour
        if (!rider.selected || rider.slot === null) {
            rider.forceSmall = false;
            rider.forceLabel = true;
            rider.labelledAt = ++labelCounter;
            // All colours taken by riders the user picked: the one picked longest ago gives its colour up.
            const picked = selectedRiders().filter(r => r.forceLabel && !r.isReference && r !== rider).sort((a, b) => a.labelledAt - b.labelledAt);
            if (picked.length >= LABELLED_RIDERS - 1) picked[0].forceLabel = false;
            if (!rider.selected) { setSelected(rider, true); return; }
        } else {
            rider.forceLabel = false;
            rider.forceSmall = true;
        }
        refreshLabelled();
        updateRows();
    }

    function setSelected(rider, selected) {
        if (selected && !rider.selected && selectedRiders().length >= MAX_RIDERS) return;
        if (selected && !rider.selected) rider.selectedAt = ++selectionCounter;
        rider.selected = selected;
        if (!selected) { rider.forceLabel = false; rider.forceSmall = false; }
        if (!selected && compareRider === rider) compareRider = null;
        refreshLabelled();
        if (selected && !rider.laps && !rider.loading) requestLaps(rider);
        updateTimeline();
        updateRows();
    }

    // ---------- Timeline ----------
    let tMin = 0;
    let tMax = 0;
    let t = 0;
    let timelineReady = false;
    let startMs = null;   // when the rider of the chosen activity entered the ice
    let startApplied = false;

    function updateTimeline() {
        const extents = selectedRiders().map(r => lapExtent(r.laps)).filter(Boolean);
        if (extents.length === 0) {
            timelineReady = false;
            playBtn.disabled = true;
            setPlaying(false);
            statusEl.textContent = selectedRiders().some(r => r.loading) ? 'Loading laps…' : 'Select at least one rider below.';
            return;
        }
        tMin = Math.min(...extents.map(e => e.startMs));
        tMax = Math.max(...extents.map(e => e.endMs));
        // Always start when the reference rider entered the ice, whichever rider's laps arrive first.
        const reference = riders.find(r => r.isReference && r.laps?.length);
        if (reference) startMs = lapExtent(reference.laps).startMs;
        if (!startApplied) {
            if (startMs !== null) { t = startMs; startApplied = true; }
            else if (!timelineReady) t = tMin;
        }
        t = Math.min(Math.max(t, tMin), tMax);
        timelineReady = true;
        playBtn.disabled = false;
        statusEl.textContent = selectedRiders().some(r => r.loading) ? 'Loading laps…' : '';
    }

    // ---------- Link to this replay ----------
    // The address always holds what is needed to open the same replay anywhere: transponder, activity, riders shown.
    let lastAddress = null;
    function updateAddress() {
        const chip = payload.reference.chipCode;
        if (!chip) return;
        const address = replayAddress(chip, payload.reference.id, riders.filter(r => r.selected && !r.isReference).map(r => r.id));
        if (address === lastAddress) return;
        lastAddress = address;
        try {
            window.history.replaceState({}, '', address);
        } catch {
            // some browsers refuse this (for example on a file:// page): the address is then just not updated
        }
    }

    // The share button (top right) copies the address of this replay: transponder, activity and the riders shown.
    let shareNoteTimer = null;
    $('shareBtn').addEventListener('click', async () => {
        const link = lastAddress ? new URL(lastAddress, window.location.href).href : window.location.href;
        let copied = false;
        try {
            await navigator.clipboard.writeText(link);
            copied = true;
        } catch {
            const box = document.createElement('textarea');   // older browsers and pages without clipboard access
            box.value = link;
            box.style.position = 'fixed';
            box.style.opacity = '0';
            document.body.appendChild(box);
            box.select();
            try { copied = document.execCommand('copy'); } catch { copied = false; }
            box.remove();
        }
        const note = $('shareNote');
        note.textContent = copied ? 'Link copied' : 'Copy the link from the address bar';
        note.classList.add('show');
        clearTimeout(shareNoteTimer);
        shareNoteTimer = setTimeout(() => { note.classList.remove('show'); note.textContent = ''; }, 2500);
    });

    // ---------- Rider list ----------
    const rows = new Map();
    function buildRows() {
        riders.forEach(rider => {
            const row = document.createElement('label');
            row.className = 'rider-row';
            const avatar = rider.accountId ? `${PROXY_BASE_URL}/avatar/${encodeURIComponent(rider.accountId)}` : '';
            const session = `${formatTime(rider.startTime).slice(0, 5)}${rider.endTime ? '–' + formatTime(rider.endTime).slice(0, 5) : ''}`;
            const hasTimes = !rider.isReference && rider.togetherMs !== null && rider.togetherMs !== undefined;
            const together = hasTimes ? `together ${formatDurationShort(rider.togetherMs)}` : null;
            const inGroup = hasTimes && rider.groupMs !== null && rider.groupMs !== undefined
                ? `in your group ~${formatDurationShort(rider.groupMs)}` : null;
            const meta = [rider.chipCode, session, together, inGroup, rider.fastestTime ? `best ${rider.fastestTime}` : null, rider.lapCount ? `${rider.lapCount} laps` : null]
                .filter(Boolean).join(' · ');
            row.innerHTML = `
                <input type="checkbox" aria-label="Show ${escapeHtml(rider.name)}">
                <span class="rider-swatch"></span>
                ${avatar ? `<img class="rider-avatar" src="${avatar}" alt="" onerror="this.style.display='none'">` : ''}
                <span class="rider-info">
                    <span class="rider-name">${escapeHtml(rider.name)}${rider.isReference ? ' <em>(you)</em>' : ''}</span>
                    <small>${escapeHtml(meta)}</small>
                </span>
                <button type="button" class="rider-compare secondary-btn" title="Draw this rider's lap times in the graph, to compare lap by lap">Compare</button>
                <span class="rider-live"></span>`;
            const checkbox = row.querySelector('input');
            checkbox.addEventListener('change', () => setSelected(rider, checkbox.checked));
            row.querySelector('.rider-compare').addEventListener('click', event => {
                event.preventDefault();    // the row is a label: do not toggle the checkbox
                event.stopPropagation();
                toggleCompare(rider);
            });
            row.addEventListener('mouseenter', () => { rider.hover = true; });
            row.addEventListener('mouseleave', () => { rider.hover = false; });
            const dot = row.querySelector('.rider-swatch');
            dot.addEventListener('click', event => {
                event.preventDefault();    // the row is a label: do not toggle the checkbox
                event.stopPropagation();
                toggleLabel(rider);
            });
            riderList.appendChild(row);
            rows.set(rider, { row, checkbox, swatch: row.querySelector('.rider-swatch'), live: row.querySelector('.rider-live'), compare: row.querySelector('.rider-compare') });
        });
    }

    function updateRows() {
        const full = selectedRiders().length >= MAX_RIDERS;
        const shownCount = selectedRiders().length;
        riderCount.textContent = `(${shownCount} shown${shownCount > LABELLED_RIDERS ? `, first ${LABELLED_RIDERS} labelled` : ''})`;
        riders.forEach(rider => {
            const { row, checkbox, swatch } = rows.get(rider);
            checkbox.checked = rider.selected;
            checkbox.disabled = full && !rider.selected;
            row.classList.toggle('selected', rider.selected);
            const labelled = rider.selected && rider.slot !== null;
            const small = rider.selected && rider.slot === null;
            swatch.classList.toggle('small', small);
            swatch.style.background = labelled ? colorOf(rider) : (small ? '' : 'transparent');
            swatch.style.setProperty('--dot', colors.series[0]);
            swatch.title = rider.isReference ? 'You always have a colour'
                : labelled ? 'Click to make this rider a small dot'
                : rider.selected ? 'Click to give this rider a colour'
                : 'Click to show this rider with a colour';
        });
        updateFollowOptions();
        updateAddress();
        riders.forEach(rider => {
            const { compare } = rows.get(rider);
            const comparing = compareRider === rider;
            compare.classList.toggle('hidden', rider === followRider);   // comparing a rider with himself says nothing
            compare.classList.toggle('active', comparing);
            compare.textContent = comparing ? 'Stop comparing' : 'Compare';
        });
    }

    let lastLiveUpdate = 0;
    function updateLive(now) {
        if (now - lastLiveUpdate < 100) return;
        lastLiveUpdate = now;
        const reference = riders.find(r => r.isReference && r.selected);
        const refState = reference ? riderStateAt(reference.laps, t, trackLengthM) : null;
        riders.forEach(rider => {
            const { live } = rows.get(rider);
            if (!rider.selected) { live.textContent = ''; return; }
            if (rider.loading) { live.textContent = 'loading…'; return; }
            if (rider.error) { live.textContent = rider.error; return; }
            const state = riderStateAt(rider.laps, t, trackLengthM);
            if (!state) { live.textContent = 'off the ice'; return; }
            let text = `Lap ${state.lap.nr} · ${(state.lap.durMs / 1000).toFixed(1)}s · ${state.speedKph.toFixed(1)} km/h`;
            if (refState && rider !== reference) {
                const gap = trackDelta(state.frac, refState.frac) * trackLengthM;
                text += ` · ${gap >= 0 ? '+' : '−'}${Math.abs(gap).toFixed(0)} m`;
            }
            live.textContent = text;
        });
    }

    // ---------- Canvas ----------
    let view = { w: 0, h: 0, scale: 1, dpr: 1 };
    let lapView = { w: 0, h: 0, dpr: 1 };
    function resize() {
        const b = trackBounds();
        const unitsW = b.maxX - b.minX + 2 * MARGIN;
        const unitsH = b.maxY - b.minY + 2 * MARGIN;
        const dpr = window.devicePixelRatio || 1;
        const w = trackWrap.clientWidth;
        const h = Math.round(w * unitsH / unitsW);
        canvas.style.height = `${h}px`;
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
        view = { w, h, scale: w / unitsW, dpr };

        lapView = { w: lapCanvas.clientWidth, h: lapCanvas.clientHeight, dpr };
        lapCanvas.width = Math.round(lapView.w * dpr);
        lapCanvas.height = Math.round(lapView.h * dpr);
    }
    window.addEventListener('resize', resize);
    resize();

    const toPx = p => ({ x: view.w / 2 + p.x * view.scale, y: view.h / 2 + p.y * view.scale });

    function tracePath(offset, steps = 240) {
        for (let i = 0; i < steps; i++) {
            const p = toPx(pointOnTrack(i / steps, offset));
            if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
        }
        ctx.closePath();
    }

    function drawTrack() {
        ctx.beginPath();
        tracePath(BAND_WIDTH / 2);
        tracePath(-BAND_WIDTH / 2);
        ctx.fillStyle = colors.ice;
        ctx.fill('evenodd');
        ctx.strokeStyle = colors.edge;
        ctx.lineWidth = 1.5;
        ctx.beginPath(); tracePath(BAND_WIDTH / 2); ctx.stroke();
        ctx.beginPath(); tracePath(-BAND_WIDTH / 2); ctx.stroke();

        // Centre line, hairline
        ctx.strokeStyle = colors.grid;
        ctx.lineWidth = 1;
        ctx.beginPath(); tracePath(0); ctx.stroke();

        // Distance marks every quarter, finish line at f = 0
        ctx.font = '11px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        for (let k = 0; k < 4; k++) {
            const f = k / 4;
            const a = toPx(pointOnTrack(f, -BAND_WIDTH / 2));
            const b = toPx(pointOnTrack(f, BAND_WIDTH / 2));
            ctx.strokeStyle = k === 0 ? colors.text : colors.edge;
            ctx.lineWidth = k === 0 ? 3 : 1;
            ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
            const label = toPx(pointOnTrack(f, -BAND_WIDTH / 2 - 0.022));
            ctx.fillStyle = colors.muted;
            ctx.fillText(k === 0 ? 'Finish' : `${Math.round(f * trackLengthM)} m`, label.x, label.y);
        }

        // Clock in the infield
        if (timelineReady) {
            ctx.fillStyle = colors.secondary;
            ctx.font = '600 22px system-ui, sans-serif';
            ctx.fillText(new Date(t).toLocaleTimeString('en-GB'), view.w / 2, view.h / 2);
        }
    }

    let hitTargets = [];
    function drawRiders() {
        hitTargets = [];
        const shown = selectedRiders().filter(r => r.laps?.length);
        // Small dots first, labelled dots on top of them, the reference rider on top of all.
        shown.sort((a, b) => (Number(a.slot !== null) - Number(b.slot !== null)) || (Number(a.isReference) - Number(b.isReference)));
        shown.forEach(rider => {
            const state = riderStateAt(rider.laps, t, trackLengthM);
            if (!state) return;
            const labelled = rider.slot !== null;
            const lane = ((labelled ? rider.slot : rider.index) % LANES) - Math.floor(LANES / 2);
            const p = toPx(pointOnTrack(state.frac, lane * LANE_STEP));
            const radius = labelled ? (rider.hover ? 13 : 10) : (rider.hover ? 7 : 4);
            const fill = colorOf(rider);
            ctx.beginPath();
            ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
            ctx.fillStyle = fill;
            ctx.fill();
            ctx.lineWidth = labelled ? 2 : 1.5;
            ctx.strokeStyle = colors.surface;
            ctx.stroke();
            if (labelled) {
                ctx.fillStyle = inkFor(fill);
                ctx.font = '600 10px system-ui, sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(initials(rider.name), p.x, p.y + 0.5);
            }
            hitTargets.push({ rider, state, x: p.x, y: p.y, radius });
        });
    }

    function draw() {
        ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
        ctx.clearRect(0, 0, view.w, view.h);
        drawTrack();
        drawRiders();
    }

    // Tooltip on the nearest rider dot
    canvas.addEventListener('mousemove', event => {
        const rect = canvas.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        // The dot drawn last is on top, so it wins.
        const hit = [...hitTargets].reverse().find(h => Math.hypot(h.x - x, h.y - y) <= h.radius + 4);
        if (!hit) { hide(tooltip); return; }
        tooltip.innerHTML = `<strong>${escapeHtml(hit.rider.name)}</strong><br>Lap ${hit.state.lap.nr} · ${(hit.state.lap.durMs / 1000).toFixed(2)}s · ${hit.state.speedKph.toFixed(1)} km/h`;
        tooltip.style.left = `${Math.min(x + 14, view.w - 190)}px`;
        tooltip.style.top = `${y + 14}px`;
        show(tooltip);
    });
    canvas.addEventListener('mouseleave', () => hide(tooltip));

    // ---------- Lap time graph of the followed rider ----------
    const LAP_PAD = { l: 50, r: 16, t: 16, b: 28 };
    const COMPARE_ALPHA = 0.55;        // the compared rider's laps are drawn paler than the followed rider's
    let followRider = null;
    let followPickedByUser = false;   // until the user picks someone, the graph follows the reference rider
    // ... or the rider that was followed last time (remembered by transponder, so it works in other sessions too)
    const rememberedFollowChip = loadSetting('followChip', null);

    const isSkatingLap = lap => (trackLengthM / (lap.durMs / 1000)) * 3.6 >= MIN_SKATING_KPH;

    // Max lap time: laps at or above it are greyed out and pinned to the top edge of the graph.
    let lapMaxSeconds = parseFloat(lapMaxSlider.value);
    const isFastLap = lap => isSkatingLap(lap) && lap.durMs / 1000 < lapMaxSeconds;

    function setLapMax(seconds) {
        const min = parseFloat(lapMaxSlider.min);
        const max = parseFloat(lapMaxSlider.max);
        lapMaxSeconds = Math.min(Math.max(seconds, min), max);
        lapMaxSlider.value = lapMaxSeconds;
        lapMaxInput.value = formatSecondsToDuration(lapMaxSeconds);
        hide(lapMaxError);
    }

    /** Shows every skating lap of the rider: just above their slowest one. */
    function showAllLapsMax(rider) {
        const seconds = rider.laps.filter(isSkatingLap).map(l => l.durMs / 1000);
        return seconds.length ? Math.ceil(Math.max(...seconds)) + 1 : 60;
    }

    lapMaxSlider.addEventListener('input', () => setLapMax(parseFloat(lapMaxSlider.value)));
    lapMaxInput.addEventListener('input', () => {
        const parsed = parseDurationToSeconds(lapMaxInput.value.trim());
        const min = parseFloat(lapMaxSlider.min);
        const max = parseFloat(lapMaxSlider.max);
        if (isNaN(parsed) || parsed < min || parsed > max) {
            lapMaxError.textContent = `Enter a time between ${formatSecondsToDuration(min)} and ${formatSecondsToDuration(max)}`;
            show(lapMaxError);
            return;
        }
        hide(lapMaxError);
        lapMaxSeconds = parsed;
        lapMaxSlider.value = parsed;
    });
    setLapMax(lapMaxSeconds);

    function updateFollowOptions() {
        const candidates = selectedRiders().filter(r => r.laps?.length);
        const previous = followRider;
        followSelect.innerHTML = candidates.map(r => `<option value="${r.id}">${escapeHtml(r.name)}${r.isReference ? ' (you)' : ''}</option>`).join('');
        const reference = candidates.find(r => r.isReference);
        const kept = candidates.find(r => r === previous);
        const remembered = !followPickedByUser && rememberedFollowChip ? candidates.find(r => r.chipCode === rememberedFollowChip) : null;
        followRider = (followPickedByUser && kept) || remembered || reference || kept || candidates[0] || null;
        if (compareRider === followRider) compareRider = null;
        if (followRider) followSelect.value = String(followRider.id);
        followSelect.disabled = candidates.length < 2;
        // A different rider starts fully in view; the slider then zooms in from there.
        if (followRider && followRider !== previous) setLapMax(showAllLapsMax(followRider));
    }
    followSelect.addEventListener('change', () => {
        followRider = riders.find(r => String(r.id) === followSelect.value) || followRider;
        followPickedByUser = true;
        saveSetting('followChip', followRider.chipCode);
        setLapMax(showAllLapsMax(followRider));
        updateRows();   // the compare buttons follow who is followed
    });
    const trimZeros = text => text.replace(/\.?0+$/, '');
    const secondsLabel = seconds => trimZeros(formatSecondsToDuration(seconds));

    /** Round tick values (seconds) that cover [min, max] with about 4-5 gridlines. */
    function niceTicks(min, max) {
        const steps = [0.5, 1, 2, 5, 10, 15, 20, 30, 60, 120, 300];
        const step = steps.find(s => (max - min) / s <= 5) || 300;
        const first = Math.max(0, Math.floor(min / step) * step);
        const last = Math.max(first + step, Math.ceil(max / step) * step);
        const ticks = [];
        for (let v = first; v <= last + 1e-9; v += step) ticks.push(v);
        return ticks;
    }

    // Time <-> pixel mapping of the graph; the x axis is the followed rider's own session.
    function lapChartScale() {
        if (!followRider) return null;
        const extent = lapExtent(followRider.laps);
        if (!extent || !followRider.laps.some(isSkatingLap)) return null;
        // The window runs from the fastest lap in view up to the max lap time.
        const inView = followRider.laps.filter(isFastLap).map(l => l.durMs / 1000);
        // the compared rider's laps must fit in the window as well
        const compared = (compareRider?.laps || []).filter(l => isFastLap(l) && l.startMs + l.durMs >= extent.startMs && l.startMs <= extent.endMs).map(l => l.durMs / 1000);
        const shown = [...inView, ...compared];
        const low = shown.length ? Math.min(...shown) : Math.max(0, lapMaxSeconds - 10);
        const ticks = niceTicks(low, lapMaxSeconds);
        const yMin = ticks[0];
        const yMax = ticks[ticks.length - 1];
        const plotW = lapView.w - LAP_PAD.l - LAP_PAD.r;
        const plotH = lapView.h - LAP_PAD.t - LAP_PAD.b;
        return {
            extent, yMin, yMax, ticks, plotW, plotH,
            x: ms => LAP_PAD.l + ((ms - extent.startMs) / (extent.endMs - extent.startMs)) * plotW,
            y: sec => LAP_PAD.t + (1 - (sec - yMin) / (yMax - yMin)) * plotH,
            timeAt: px => extent.startMs + ((px - LAP_PAD.l) / plotW) * (extent.endMs - extent.startMs)
        };
    }

    function drawLapChart() {
        const ctx2 = lapCtx;
        ctx2.setTransform(lapView.dpr, 0, 0, lapView.dpr, 0, 0);
        ctx2.clearRect(0, 0, lapView.w, lapView.h);
        const scale = lapChartScale();
        if (!scale) {
            ctx2.fillStyle = colors.muted;
            ctx2.font = '13px system-ui, sans-serif';
            ctx2.textAlign = 'center';
            ctx2.textBaseline = 'middle';
            ctx2.fillText(selectedRiders().some(r => r.loading) ? 'Loading laps…' : 'Show a rider to see the lap times', lapView.w / 2, lapView.h / 2);
            lapReadout.textContent = '';
            compareReadout.textContent = '';
            return;
        }
        const { extent, ticks, plotW, plotH, x, y } = scale;
        const seriesColor = colorOf(followRider);
        const laps = followRider.laps;

        // Grid and axis labels
        ctx2.font = '11px system-ui, sans-serif';
        ctx2.lineWidth = 1;
        ctx2.strokeStyle = colors.grid;
        ctx2.fillStyle = colors.muted;
        ctx2.textAlign = 'right';
        ctx2.textBaseline = 'middle';
        for (const sec of ticks) {
            const py = Math.round(y(sec)) + 0.5;
            ctx2.beginPath(); ctx2.moveTo(LAP_PAD.l, py); ctx2.lineTo(LAP_PAD.l + plotW, py); ctx2.stroke();
            ctx2.fillText(secondsLabel(sec), LAP_PAD.l - 8, py);
        }
        ctx2.textAlign = 'center';
        ctx2.textBaseline = 'top';
        const xTicks = Math.max(2, Math.min(6, Math.floor(plotW / 110)));
        for (let i = 0; i <= xTicks; i++) {
            const ms = extent.startMs + ((extent.endMs - extent.startMs) * i) / xTicks;
            ctx2.fillText(new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }), x(ms), LAP_PAD.t + plotH + 8);
        }
        ctx2.strokeStyle = colors.edge;
        ctx2.beginPath(); ctx2.moveTo(LAP_PAD.l, LAP_PAD.t + plotH + 0.5); ctx2.lineTo(LAP_PAD.l + plotW, LAP_PAD.t + plotH + 0.5); ctx2.stroke();

        // The lap the replay is in right now, shaded
        const state = riderStateAt(laps, t, trackLengthM);
        if (state) {
            const x0 = x(state.lap.startMs);
            const x1 = x(state.lap.startMs + state.lap.durMs);
            ctx2.fillStyle = seriesColor;
            ctx2.globalAlpha = 0.14;
            ctx2.fillRect(x0, LAP_PAD.t, Math.max(x1 - x0, 2), plotH);
            ctx2.globalAlpha = 1;
        }

        // Greyed-out laps (slower than the max lap time, or a break) are pinned to the top edge when they
        // do not fit, so no lap disappears from the graph. Drawn first, under the line.
        const yTop = LAP_PAD.t;
        const yOf = lap => Math.max(y(lap.durMs / 1000), yTop);
        const slowDot = laps.length <= 120 ? 3 : 2;
        ctx2.fillStyle = colors.slow;
        laps.forEach(lap => {
            if (isFastLap(lap)) return;
            ctx2.beginPath();
            ctx2.arc(x(lap.startMs + lap.durMs), isSkatingLap(lap) ? yOf(lap) : yTop, slowDot, 0, Math.PI * 2);
            ctx2.fill();
        });

        // Lap times in view as a line. A greyed-out lap or a stretch without any recorded laps
        // interrupts the line, so it never draws across time the rider was not skating fast.
        const drawSeries = (seriesLaps, color, alpha) => {
            ctx2.globalAlpha = alpha;
            ctx2.strokeStyle = color;
            ctx2.lineWidth = 2;
            ctx2.lineJoin = 'round';
            ctx2.lineCap = 'round';
            ctx2.beginPath();
            let connected = false;
            let previousEnd = null;
            seriesLaps.forEach(lap => {
                const px = x(lap.startMs + lap.durMs);
                if (previousEnd !== null && lap.startMs - previousEnd > LAP_GAP_TOLERANCE_MS) connected = false;
                previousEnd = lap.startMs + lap.durMs;
                if (!isFastLap(lap)) { connected = false; return; }
                const py = y(lap.durMs / 1000);
                if (connected) ctx2.lineTo(px, py); else ctx2.moveTo(px, py);
                connected = true;
            });
            ctx2.stroke();
            if (seriesLaps.length <= 120) {
                ctx2.fillStyle = color;
                seriesLaps.forEach(lap => {
                    if (!isFastLap(lap)) return;
                    ctx2.beginPath();
                    ctx2.arc(x(lap.startMs + lap.durMs), y(lap.durMs / 1000), 3, 0, Math.PI * 2);
                    ctx2.fill();
                });
            }
            ctx2.globalAlpha = 1;
        };

        // The compared rider: paler and in another colour, drawn under the followed rider, at the moments
        // he really crossed the line, so the laps of riders skating together line up.
        let compareColor = null;
        if (compareRider?.laps?.length) {
            compareColor = [colors.series[1], colors.series[0]].find(color => color !== seriesColor);
            ctx2.save();
            ctx2.beginPath();
            ctx2.rect(LAP_PAD.l, LAP_PAD.t - 2, plotW, plotH + 4);
            ctx2.clip();
            drawSeries(compareRider.laps, compareColor, COMPARE_ALPHA);
            ctx2.restore();
        }
        drawSeries(laps, seriesColor, 1);

        // The current lap's point, ringed (grey when the lap is beyond the max lap time)
        if (state) {
            const px = x(state.lap.startMs + state.lap.durMs);
            const py = isFastLap(state.lap) ? y(state.lap.durMs / 1000) : yOf(state.lap);
            ctx2.beginPath();
            ctx2.arc(px, py, 6, 0, Math.PI * 2);
            ctx2.fillStyle = isFastLap(state.lap) ? seriesColor : colors.slow;
            ctx2.fill();
            ctx2.lineWidth = 2;
            ctx2.strokeStyle = isFastLap(state.lap) ? colors.surface : colors.muted;
            ctx2.stroke();
        }

        // Vertical line that moves with the replay time
        if (t >= extent.startMs && t <= extent.endMs) {
            const px = Math.round(x(t)) + 0.5;
            ctx2.strokeStyle = colors.text;
            ctx2.lineWidth = 2;
            ctx2.beginPath(); ctx2.moveTo(px, LAP_PAD.t - 6); ctx2.lineTo(px, LAP_PAD.t + plotH); ctx2.stroke();
        }

        const readout = state
            ? `Lap ${state.lap.nr} · ${(state.lap.durMs / 1000).toFixed(1)}s · ${state.speedKph.toFixed(1)} km/h`
            : 'Off the ice';
        if (lapReadout.textContent !== readout) lapReadout.textContent = readout;

        // The compared rider's lap at this moment and how much slower (+) or faster (−) it is than yours
        let compareText = '';
        if (compareRider?.laps?.length) {
            const other = riderStateAt(compareRider.laps, t, trackLengthM);
            if (!other) compareText = `${compareRider.name}: off the ice`;
            else {
                const diff = state ? (other.lap.durMs - state.lap.durMs) / 1000 : null;
                const diffText = diff === null ? '' : ` (${diff >= 0 ? '+' : '−'}${Math.abs(diff).toFixed(2)}s)`;
                compareText = `${compareRider.name}: Lap ${other.lap.nr} · ${(other.lap.durMs / 1000).toFixed(2)}s${diffText}`;
            }
            compareReadout.style.setProperty('--compare', compareColor);
        }
        if (compareReadout.textContent !== compareText) compareReadout.textContent = compareText;
    }

    // Click or drag on the graph to jump to that moment.
    let draggingLapChart = false;
    function seekFromLapChart(event) {
        const scale = lapChartScale();
        if (!scale || !timelineReady) return;
        const px = event.clientX - lapCanvas.getBoundingClientRect().left;
        const clamped = Math.min(Math.max(px, LAP_PAD.l), LAP_PAD.l + scale.plotW);
        t = Math.min(Math.max(scale.timeAt(clamped), tMin), tMax);
    }
    lapCanvas.addEventListener('pointerdown', event => {
        draggingLapChart = true;
        lapCanvas.setPointerCapture(event.pointerId);
        seekFromLapChart(event);
    });
    lapCanvas.addEventListener('pointermove', event => { if (draggingLapChart) seekFromLapChart(event); });
    lapCanvas.addEventListener('pointerup', () => { draggingLapChart = false; });
    lapCanvas.addEventListener('pointercancel', () => { draggingLapChart = false; });

    // ---------- Playback ----------
    let playing = false;
    let lastFrame = null;

    function setPlaying(value) {
        playing = value && timelineReady;
        playBtn.textContent = playing ? 'Pause' : 'Play';
    }

    playBtn.addEventListener('click', () => {
        // After the end was reached, replay from the reference rider's ice entry again.
        if (!playing && t >= tMax) t = Math.min(Math.max(startMs ?? tMin, tMin), tMax);
        setPlaying(!playing);
    });
    document.addEventListener('keydown', event => {
        if (event.code === 'Space' && !['INPUT', 'SELECT', 'BUTTON'].includes(document.activeElement?.tagName)) {
            event.preventDefault();
            if (!playBtn.disabled) playBtn.click();
        }
    });

    function frame(now) {
        if (playing && lastFrame !== null) {
            t += (now - lastFrame) * Number(speedSelect.value);
            if (t >= tMax) { t = tMax; setPlaying(false); }
        }
        lastFrame = now;
        if (timelineReady) {
            clockLabel.textContent = new Date(t).toLocaleTimeString('en-GB');
        }
        draw();
        drawLapChart();
        updateLive(now);
        requestAnimationFrame(frame);
    }

    // "Show all" only shows riders who really skated with you (more than 0 min together). If none of the
    // riders could be measured, it falls back to everyone.
    const anyMeasured = riders.some(r => !r.isReference && r.togetherMs !== null && r.togetherMs !== undefined);
    const skatedTogether = r => r.isReference || !anyMeasured || r.togetherMs > 0;
    $('showAllBtn').addEventListener('click', () => riders.forEach(r => { if (!r.selected && skatedTogether(r)) setSelected(r, true); }));
    $('hideAllBtn').addEventListener('click', () => riders.forEach(r => { if (r.selected && !r.isReference) setSelected(r, false); }));

    // ---------- Start ----------
    buildRows();
    const initiallySelected = new Set([riders[0].id, ...(payload.selected || [])]);
    riders.filter(r => initiallySelected.has(r.id)).slice(0, MAX_RIDERS).forEach(r => setSelected(r, true));
    updateTimeline();
    updateRows();
    requestAnimationFrame(frame);
});
