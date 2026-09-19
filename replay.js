/**
 * Race replay page: draws the selected riders on an oblong track, driven by their real lap times.
 * Depends on utils.js, api.js, replay-track.js and replay-model.js.
 */
document.addEventListener('DOMContentLoaded', () => {
    const MAX_RIDERS = 8;               // the categorical palette is validated for 8 slots
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
    const timeSlider = $('timeSlider');
    const clockLabel = $('clockLabel');
    const riderList = $('riderList');
    const riderCount = $('riderCount');
    const statusEl = $('replayStatus');
    const lapCanvas = $('lapCanvas');
    const lapCtx = lapCanvas.getContext('2d');
    const followSelect = $('followSelect');
    const lapReadout = $('lapReadout');

    // ---------- Data ----------
    function loadPayload() {
        try {
            const payload = JSON.parse(localStorage.getItem(REPLAY_STORAGE_KEY));
            const wanted = new URLSearchParams(window.location.search).get('activity');
            if (!payload || !payload.reference || !Array.isArray(payload.riders)) return null;
            if (wanted && String(payload.reference.id) !== wanted) return null;
            return payload;
        } catch {
            return null;
        }
    }

    const payload = loadPayload();
    if (!payload) {
        show($('replayEmpty'));
        return;
    }
    show($('replayApp'));

    const trackLengthM = payload.trackLengthM || 400;
    $('replaySubtitle').textContent = `${payload.location.sport} · ${payload.location.name} · ${formatDateTime(payload.riders[0].startTime)}`;
    $('backLink').href = `index.html?transponder=${encodeURIComponent(payload.reference.chipCode || '')}`;

    const riders = payload.riders.map(r => ({
        ...r, laps: null, loading: false, error: null, selected: false, slot: null, hover: false
    }));

    // ---------- Theme colours (read from the CSS tokens) ----------
    let colors = {};
    function readColors() {
        const styles = getComputedStyle(document.documentElement);
        const token = name => styles.getPropertyValue(name).trim();
        colors = {
            ice: token('--surface-2'), edge: token('--axis'), grid: token('--grid'),
            surface: token('--surface'), text: token('--text'), muted: token('--text-muted'),
            secondary: token('--text-secondary'),
            series: Array.from({ length: MAX_RIDERS }, (_, i) => token(`--cat-${i + 1}`))
        };
    }
    readColors();
    document.addEventListener('themechange', readColors);
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', readColors);

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

    function assignSlot(rider) {
        const used = new Set(selectedRiders().filter(r => r !== rider && r.slot !== null).map(r => r.slot));
        let slot = rider.isReference && !used.has(0) ? 0 : -1;
        for (let i = 0; slot < 0 && i < MAX_RIDERS; i++) if (!used.has(i)) slot = i;
        rider.slot = slot;
    }

    async function loadLaps(rider) {
        rider.loading = true;
        rider.error = null;
        updateRows();
        try {
            rider.laps = normalizeLaps(await fetchLaps(rider.id));
            if (rider.laps.length === 0) rider.error = 'No lap data';
        } catch (error) {
            rider.error = error.message || 'Laps unavailable';
        } finally {
            rider.loading = false;
            updateTimeline();
            updateRows();
        }
    }

    function setSelected(rider, selected) {
        if (selected && selectedRiders().length >= MAX_RIDERS) return;
        rider.selected = selected;
        if (selected) {
            assignSlot(rider);
            if (!rider.laps && !rider.loading) loadLaps(rider);
        } else {
            rider.slot = null;
        }
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
            timeSlider.disabled = true;
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
        timeSlider.max = Math.ceil((tMax - tMin) / 1000);
        timeSlider.disabled = false;
        playBtn.disabled = false;
        statusEl.textContent = selectedRiders().some(r => r.loading) ? 'Loading laps…' : '';
    }

    // ---------- Rider list ----------
    const rows = new Map();
    function buildRows() {
        riders.forEach(rider => {
            const row = document.createElement('label');
            row.className = 'rider-row';
            const avatar = rider.accountId ? `${PROXY_BASE_URL}/avatar/${encodeURIComponent(rider.accountId)}` : '';
            const session = `${formatTime(rider.startTime).slice(0, 5)}${rider.endTime ? '–' + formatTime(rider.endTime).slice(0, 5) : ''}`;
            const together = !rider.isReference && rider.togetherMs !== null && rider.togetherMs !== undefined
                ? `together ${formatDurationShort(rider.togetherMs)}` : null;
            const meta = [rider.chipCode, session, together, rider.fastestTime ? `best ${rider.fastestTime}` : null, rider.lapCount ? `${rider.lapCount} laps` : null]
                .filter(Boolean).join(' · ');
            row.innerHTML = `
                <input type="checkbox" aria-label="Show ${escapeHtml(rider.name)}">
                <span class="rider-swatch"></span>
                ${avatar ? `<img class="rider-avatar" src="${avatar}" alt="" onerror="this.style.display='none'">` : ''}
                <span class="rider-info">
                    <span class="rider-name">${escapeHtml(rider.name)}${rider.isReference ? ' <em>(you)</em>' : ''}</span>
                    <small>${escapeHtml(meta)}</small>
                </span>
                <span class="rider-live"></span>`;
            const checkbox = row.querySelector('input');
            checkbox.addEventListener('change', () => setSelected(rider, checkbox.checked));
            row.addEventListener('mouseenter', () => { rider.hover = true; });
            row.addEventListener('mouseleave', () => { rider.hover = false; });
            riderList.appendChild(row);
            rows.set(rider, { row, checkbox, swatch: row.querySelector('.rider-swatch'), live: row.querySelector('.rider-live') });
        });
    }

    function updateRows() {
        const full = selectedRiders().length >= MAX_RIDERS;
        riderCount.textContent = `(${selectedRiders().length} shown, max ${MAX_RIDERS})`;
        riders.forEach(rider => {
            const { row, checkbox, swatch } = rows.get(rider);
            checkbox.checked = rider.selected;
            checkbox.disabled = full && !rider.selected;
            row.classList.toggle('selected', rider.selected);
            swatch.style.background = rider.selected ? colors.series[rider.slot] : 'transparent';
        });
        updateFollowOptions();
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
        // The reference rider is drawn last so it stays on top.
        shown.sort((a, b) => Number(a.isReference) - Number(b.isReference));
        shown.forEach(rider => {
            const state = riderStateAt(rider.laps, t, trackLengthM);
            if (!state) return;
            const lane = (rider.slot % LANES) - Math.floor(LANES / 2);
            const p = toPx(pointOnTrack(state.frac, lane * LANE_STEP));
            const radius = rider.hover ? 13 : 10;
            const fill = colors.series[rider.slot];
            ctx.beginPath();
            ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
            ctx.fillStyle = fill;
            ctx.fill();
            ctx.lineWidth = 2;
            ctx.strokeStyle = colors.surface;
            ctx.stroke();
            ctx.fillStyle = inkFor(fill);
            ctx.font = '600 10px system-ui, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(initials(rider.name), p.x, p.y + 0.5);
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
        const hit = hitTargets.find(h => Math.hypot(h.x - x, h.y - y) <= h.radius + 4);
        if (!hit) { hide(tooltip); return; }
        tooltip.innerHTML = `<strong>${escapeHtml(hit.rider.name)}</strong><br>Lap ${hit.state.lap.nr} · ${(hit.state.lap.durMs / 1000).toFixed(2)}s · ${hit.state.speedKph.toFixed(1)} km/h`;
        tooltip.style.left = `${Math.min(x + 14, view.w - 190)}px`;
        tooltip.style.top = `${y + 14}px`;
        show(tooltip);
    });
    canvas.addEventListener('mouseleave', () => hide(tooltip));

    // ---------- Lap time graph of the followed rider ----------
    const LAP_PAD = { l: 50, r: 16, t: 16, b: 28 };
    let followRider = null;
    let followPickedByUser = false;   // until the user picks someone, the graph follows the reference rider

    function updateFollowOptions() {
        const candidates = selectedRiders().filter(r => r.laps?.length);
        const previous = followRider;
        followSelect.innerHTML = candidates.map(r => `<option value="${r.id}">${escapeHtml(r.name)}${r.isReference ? ' (you)' : ''}</option>`).join('');
        const reference = candidates.find(r => r.isReference);
        const kept = candidates.find(r => r === previous);
        followRider = (followPickedByUser && kept) || reference || kept || candidates[0] || null;
        if (followRider) followSelect.value = String(followRider.id);
        followSelect.disabled = candidates.length < 2;
    }
    followSelect.addEventListener('change', () => {
        followRider = riders.find(r => String(r.id) === followSelect.value) || followRider;
        followPickedByUser = true;
    });

    const isSkatingLap = lap => (trackLengthM / (lap.durMs / 1000)) * 3.6 >= MIN_SKATING_KPH;
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
        const skating = followRider.laps.filter(isSkatingLap);
        if (!extent || skating.length === 0) return null;
        const seconds = skating.map(l => l.durMs / 1000);
        const ticks = niceTicks(Math.min(...seconds), Math.max(...seconds));
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
            return;
        }
        const { extent, ticks, plotW, plotH, x, y } = scale;
        const seriesColor = colors.series[followRider.slot];
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

        // Lap times as a line. A break (very slow "lap", marked at the top) or a stretch without any
        // recorded laps interrupts the line, so it never draws across time the rider was not skating.
        ctx2.strokeStyle = seriesColor;
        ctx2.lineWidth = 2;
        ctx2.lineJoin = 'round';
        ctx2.lineCap = 'round';
        ctx2.beginPath();
        let connected = false;
        let previousEnd = null;
        laps.forEach(lap => {
            const px = x(lap.startMs + lap.durMs / 2);
            if (previousEnd !== null && lap.startMs - previousEnd > LAP_GAP_TOLERANCE_MS) connected = false;
            previousEnd = lap.startMs + lap.durMs;
            if (!isSkatingLap(lap)) { connected = false; return; }
            const py = y(lap.durMs / 1000);
            if (connected) ctx2.lineTo(px, py); else ctx2.moveTo(px, py);
            connected = true;
        });
        ctx2.stroke();
        if (laps.length <= 120) {
            ctx2.fillStyle = seriesColor;
            laps.forEach(lap => {
                if (!isSkatingLap(lap)) return;
                ctx2.beginPath();
                ctx2.arc(x(lap.startMs + lap.durMs / 2), y(lap.durMs / 1000), 3, 0, Math.PI * 2);
                ctx2.fill();
            });
        }
        ctx2.strokeStyle = colors.muted;
        ctx2.lineWidth = 2;
        laps.forEach(lap => {
            if (isSkatingLap(lap)) return;
            const px = x(lap.startMs + lap.durMs / 2);
            ctx2.beginPath(); ctx2.moveTo(px, LAP_PAD.t); ctx2.lineTo(px, LAP_PAD.t + 8); ctx2.stroke();
        });

        // The current lap's point, ringed
        if (state) {
            const px = x(state.lap.startMs + state.lap.durMs / 2);
            const py = y(state.lap.durMs / 1000);
            ctx2.beginPath();
            ctx2.arc(px, py, 6, 0, Math.PI * 2);
            ctx2.fillStyle = seriesColor;
            ctx2.fill();
            ctx2.lineWidth = 2;
            ctx2.strokeStyle = colors.surface;
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
    timeSlider.addEventListener('input', () => { t = tMin + Number(timeSlider.value) * 1000; });
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
            timeSlider.value = Math.round((t - tMin) / 1000);
        }
        draw();
        drawLapChart();
        updateLive(now);
        requestAnimationFrame(frame);
    }

    // ---------- Start ----------
    buildRows();
    const initiallySelected = new Set([riders[0].id, ...(payload.selected || [])]);
    riders.filter(r => initiallySelected.has(r.id)).slice(0, MAX_RIDERS).forEach(r => setSelected(r, true));
    updateTimeline();
    updateRows();
    requestAnimationFrame(frame);
});
