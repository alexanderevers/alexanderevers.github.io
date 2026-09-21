/**
 * Live page: who is on the ice at a rink right now.
 * Every few seconds it asks for the newest activities of the rink (proxy ?live=1, kept only one second), loads the laps
 * of the riders that changed, and shows them as a list and as dots on the oblong track.
 * Depends on utils.js, api.js, replay-track.js, replay-model.js and live-model.js.
 */
document.addEventListener('DOMContentLoaded', () => {
    // The Dutch rinks (see ijsbanen_list.txt). A rink whose length MYLAPS does not know is taken as 400 m.
    const RINKS = [
        { id: 456, name: 'IJsbaan Twente (Enschede)', length: 400 },       // the first one is the default
        { id: 2497, name: 'Thialf (Heerenveen)', length: 400 },
        { id: 2040, name: 'Jaap Eden IJsbaan (Amsterdam)', length: 400 },
        { id: 205, name: 'Kunstijsbaan de Westfries (Hoorn)', length: 400 },
        { id: 3689, name: 'IJsbaan Hoorn X2', length: 400 },
        { id: 1052, name: 'Triavium Nijmegen', length: 312 },
        { id: 1061, name: 'De Vechtsebanen (Utrecht)', length: 400 },
        { id: 2033, name: 'Schaatsbaan Rotterdam', length: 400 },
        { id: 2052, name: 'IJsbaan De Scheg (Deventer)', length: 400 },
        { id: 2381, name: 'Elfstedenhal (Leeuwarden)', length: 400 },
        { id: 2392, name: 'De Uithof (Den Haag)', length: 400 },
        { id: 2409, name: 'De Meent Bauerfeind (Alkmaar)', length: 400 },
        { id: 2427, name: 'IJsbaan Kardinge (Groningen)', length: 400 },
        { id: 2482, name: 'LACO Glanerbrook (Geleen)', length: 400 },
        { id: 2822, name: 'IJsbaan Haarlem Scoreboard', length: 400 },
        { id: 2838, name: 'Ireen Wüst IJsbaan (Tilburg)', length: 400 },
        { id: 3111, name: 'Kunstijsbaan Breda X2', length: 400 },
        { id: 3279, name: 'IJssportcentrum Eindhoven', length: 400 },
        { id: 3930, name: 'Leiden IJshal de Vliet', length: 250 }
    ];
    const LAP_FETCH_CONCURRENCY = 5;
    const LABELLED_RIDERS = 10;             // the fastest riders get a colour and initials on the track, the others a small dot
    const LANE_STEP = 0.0075;
    const LANES = 5;
    const BAND_WIDTH = 0.045;
    const MARGIN = 0.05;

    const $ = id => document.getElementById(id);
    const rinkSelect = $('rinkSelect');
    const pollSelect = $('pollSelect');
    const sortSelect = $('sortSelect');
    const statusEl = $('liveStatus');
    const errorEl = $('liveError');
    const listEl = $('liveList');
    const canvas = $('liveTrack');
    const ctx = canvas.getContext('2d');
    const trackWrap = $('liveTrackWrap');
    const tooltip = $('liveTooltip');
    // The graph of the lap times of the selected rider (live-graph.js)
    const lapGraph = createLiveLapGraph({
        title: $('liveLapTitle'), readout: $('liveLapReadout'), empty: $('liveLapEmpty'), body: $('liveLapBody'),
        canvas: $('liveLapCanvas'), slider: $('liveLapMax'), sliderValue: $('liveLapMaxValue'), tooltip: $('liveLapTooltip')
    }, { getColors: () => colors, onChange: () => { dirty = true; } });

    // ---------- Settings: rink and refresh time come from the address, else from what was chosen last time ----------
    const params = new URLSearchParams(window.location.search);
    const rinkById = id => RINKS.find(rink => rink.id === Number(id));
    let rink = rinkById(params.get('rink')) || rinkById(loadSetting('liveRink', 0)) || RINKS[0];
    // ?poll=2 (seconds) is for tests and experiments (1 to 60); the list offers 1 second to 30 seconds
    const pollParam = Number(params.get('poll'));
    let pollSeconds = pollParam >= 1 && pollParam <= 60 ? pollParam : Number(loadSetting('livePoll', 10));
    if (![1, 2, 5, 10, 20, 30].includes(pollSeconds) && !(pollParam >= 1)) pollSeconds = 10;
    let sortMode = loadSetting('liveSort', 'best') === 'recent' ? 'recent' : 'best';

    rinkSelect.innerHTML = RINKS.map(r => `<option value="${r.id}">${escapeHtml(r.name)}</option>`).join('');
    rinkSelect.value = String(rink.id);
    if (![...pollSelect.options].some(o => Number(o.value) === pollSeconds)) {
        pollSelect.add(new Option(`every ${pollSeconds} s`, String(pollSeconds)));
    }
    pollSelect.value = String(pollSeconds);
    sortSelect.value = sortMode;

    // ---------- State ----------
    /** activity id -> { activity, laps (normalized or null), isPrivate, error, fetchedEnd, fetchedAt } */
    let riders = new Map();
    let lastPollAt = null;
    let pollError = null;
    let polling = false;
    let pollTimer = null;
    let selectedId = null;
    let compareId = null;             // the rider that is compared with the selected one in the lap graph
    let requestsThisMinute = [];              // moments of the requests of the last minute
    let states = [];                          // the live picture of every rider, refreshed about ten times a second
    let dirty = true;

    const countRequest = () => { requestsThisMinute.push(Date.now()); };

    // Click on a rider (in the list or on the track): the first rider is selected. Another rider is compared with him or her (his
    // lap times appear paler in the same graph, like Compare on the replay page); clicking that rider again makes him or her the
    // only selection. Clicking the selected rider lets go of everything.
    function selectRider(id) {
        if (id === selectedId || selectedId === null) {
            selectedId = id === selectedId ? null : id;
            compareId = null;
        } else if (id === compareId) {
            selectedId = id;
            compareId = null;
        } else {
            compareId = id;
        }
        lapGraph.resetMax();
        dirty = true;
    }

    // ---------- Fetching ----------
    // Not everybody every poll: a rider is asked when his next crossing is expected (see lapsFetchDue in live-model.js).
    function needsLaps(rider, nowMs) {
        if (rider.isPrivate) return false;
        if (!rider.laps) return nowMs - rider.fetchedAt >= 3000;             // never loaded, or the last try failed
        const state = riderLive(rider.activity, rider.laps, nowMs, rink.length);
        return lapsFetchDue(state, nowMs, rider.fetchedAt, rider.activity.endTime !== rider.fetchedEnd);
    }

    async function loadLapsOf(rider) {
        countRequest();
        try {
            const data = await fetchLiveLaps(rider.activity.id);
            if (data.private) rider.isPrivate = true;
            else { rider.laps = normalizeLaps(data); rider.error = null; }
        } catch (error) {
            rider.error = error.message || 'Laps unavailable';
        }
        rider.fetchedEnd = rider.activity.endTime;
        rider.fetchedAt = Date.now();
        dirty = true;
    }

    async function loadLapsQueue(list) {
        const queue = [...list];
        const worker = async () => { while (queue.length) await loadLapsOf(queue.shift()); };
        await Promise.all(Array.from({ length: Math.min(LAP_FETCH_CONCURRENCY, queue.length) }, worker));
    }

    async function poll() {
        if (polling) return;
        polling = true;
        clearTimeout(pollTimer);
        const rinkAtStart = rink;
        try {
            countRequest();
            const activities = await fetchLiveActivities(rink.id);
            if (rinkAtStart !== rink) return;                               // another rink was chosen while this one was loading
            const now = Date.now();
            const candidates = liveCandidates(activities, now);
            const keep = new Set(candidates.map(a => a.id));
            for (const id of [...riders.keys()]) if (!keep.has(id)) riders.delete(id);
            candidates.forEach(activity => {
                const known = riders.get(activity.id);
                if (known) known.activity = activity;
                else riders.set(activity.id, { activity, laps: null, isPrivate: false, error: null, fetchedEnd: undefined, fetchedAt: 0 });
            });
            lastPollAt = Date.now();
            pollError = null;
            dirty = true;
            refreshStates();
            renderAll();                                                    // show the list before the laps have all arrived
            await loadLapsQueue([...riders.values()].filter(rider => needsLaps(rider, now)));
        } catch (error) {
            pollError = error.message || 'The rink could not be loaded';
        } finally {
            polling = false;
            dirty = true;
            if (rinkAtStart === rink) schedulePoll();
            else poll();                                                    // the rink was changed meanwhile: now load the new one
        }
    }

    function schedulePoll() {
        clearTimeout(pollTimer);
        if (document.hidden) return;                                        // nobody is looking: do not ask
        pollTimer = setTimeout(poll, pollSeconds * 1000);
    }

    function changeRink(next) {
        rink = next;
        saveSetting('liveRink', rink.id);
        riders = new Map();
        states = [];
        selectedId = null;
        compareId = null;
        lastPollAt = null;
        pollError = null;
        dirty = true;
        renderAll();
        poll();
    }

    rinkSelect.addEventListener('change', () => changeRink(rinkById(rinkSelect.value) || rink));
    pollSelect.addEventListener('change', () => {
        pollSeconds = Number(pollSelect.value);
        saveSetting('livePoll', pollSeconds);
        schedulePoll();
    });
    sortSelect.addEventListener('change', () => {
        sortMode = sortSelect.value === 'recent' ? 'recent' : 'best';
        saveSetting('liveSort', sortMode);
        dirty = true;
    });
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) clearTimeout(pollTimer);
        else if (!polling) poll();                                          // back on the page: catch up at once
    });

    // ---------- The live picture ----------
    function refreshStates() {
        const now = Date.now();
        states = [...riders.values()].map(rider => ({
            ...riderLive(rider.activity, rider.laps, now, rink.length),
            isPrivate: rider.isPrivate,
            error: rider.error
        }));
    }

    const seconds = ms => (ms === null || ms === undefined ? '–' : formatSecondsToDuration(ms / 1000).replace(/^0/, ''));
    function sinceText(ms) {
        if (ms === null) return '–';
        const s = Math.round(ms / 1000);
        return s < 60 ? `${s} s` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    }

    const startText = ms => (ms === null || ms === undefined ? '–' : new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }));
    function durationText(ms) {
        if (ms === null || ms === undefined) return '–';
        const m = Math.floor(ms / 60000);
        return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
    }

    // ---------- Colours (from the CSS tokens, so light and dark both work) ----------
    let colors = {};
    function readColors() {
        const styles = getComputedStyle(document.documentElement);
        const token = name => styles.getPropertyValue(name).trim();
        colors = {
            ice: token('--surface-2'), edge: token('--axis'), grid: token('--grid'), surface: token('--surface'),
            text: token('--text'), muted: token('--text-muted'), accent: token('--accent'), slow: token('--series-muted'),
            series: Array.from({ length: LABELLED_RIDERS }, (_, i) => token(`--cat-${i + 1}`))
        };
    }
    readColors();
    document.addEventListener('themechange', () => { readColors(); dirty = true; });

    // The riders on the ice, in the order of the list; the first ten get their own colour.
    function onIceStates() {
        return sortLiveRiders(states.filter(s => (s.status === 'skating' || s.status === 'waiting') && !s.isPrivate), sortMode);   // a private rider has his own group
    }
    function colourSlots() {
        const slots = new Map();
        sortLiveRiders(states.filter(s => s.status === 'skating'), 'best').slice(0, LABELLED_RIDERS).forEach((s, i) => slots.set(s.id, i));
        return slots;
    }

    // ---------- The list ----------
    function rowHtml(state, slots) {
        const slot = slots.get(state.id);
        const dot = slot === undefined ? '' : `<i class="live-dot" style="background:${colors.series[slot] || colors.series[0]}"></i>`;
        const name = `${dot}${escapeHtml(state.label)}`;
        const chosen = state.id === selectedId ? ' selected' : state.id === compareId ? ' compared' : '';
        if (state.isPrivate) {
            return `<tr class="live-row private${chosen}" data-id="${state.id}"><td>${name}</td><td>${startText(state.startMs)}</td><td>${durationText(state.durationMs)}</td><td colspan="4" class="muted-note">results are private</td></tr>`;
        }
        if (state.status === 'waiting') {
            return `<tr class="live-row waiting${chosen}" data-id="${state.id}"><td>${name}</td><td>${startText(state.startMs)}</td><td>${durationText(state.durationMs)}</td><td colspan="4" class="muted-note">${state.error ? escapeHtml(state.error) : 'waiting for the first lap'}</td></tr>`;
        }
        return `<tr class="live-row ${state.status}${chosen}" data-id="${state.id}">
            <td>${name}</td><td>${startText(state.startMs)}</td><td>${durationText(state.durationMs)}</td><td class="laps">${state.lapCount}</td><td>${seconds(state.lastMs)}</td>
            <td class="best">${seconds(state.bestMs)}</td><td>${sinceText(state.sinceMs)}</td></tr>`;
    }

    function renderList() {
        const slots = colourSlots();
        const onIce = onIceStates();
        const resting = sortLiveRiders(states.filter(s => s.status === 'resting' && !s.isPrivate), 'recent');
        const isPrivate = states.filter(s => s.isPrivate);
        const head = '<thead><tr><th>Rider</th><th>Started</th><th>Duration</th><th>Laps</th><th>Last lap</th><th>Best lap</th><th>Since</th></tr></thead>';
        const group = (title, count, rows) => `<tr class="live-group"><th colspan="7">${title} <small>(${count})</small></th></tr>${rows}`;
        let body = '';
        if (onIce.length) body += group('On the ice', onIce.length, onIce.map(s => rowHtml(s, slots)).join(''));
        else body += `<tr class="live-empty"><td colspan="7">${lastPollAt ? 'Nobody has crossed the finish line in the last few minutes. This list refreshes by itself.' : 'Loading…'}</td></tr>`;
        if (resting.length) body += group('Recently on the ice', resting.length, resting.map(s => rowHtml(s, slots)).join(''));
        if (isPrivate.length) body += group('Results are private', isPrivate.length, isPrivate.map(s => rowHtml(s, slots)).join(''));
        const html = `<table class="laps-table live-table">${head}<tbody>${body}</tbody></table>`;
        if (html !== renderList.last) { listEl.innerHTML = html; renderList.last = html; }
    }

    listEl.addEventListener('click', event => {
        const row = event.target.closest('.live-row');
        if (!row) return;
        selectRider(Number(row.dataset.id));
    });

    // ---------- Status line ----------
    function renderStatus() {
        const now = Date.now();
        requestsThisMinute = requestsThisMinute.filter(t => now - t < 60000);
        const onIce = states.filter(s => s.status === 'skating').length;
        const waiting = states.filter(s => s.status === 'waiting' && !s.isPrivate).length;
        let text;
        if (!lastPollAt) text = pollError ? 'Could not load this rink yet' : 'Loading…';
        else {
            const age = Math.round((now - lastPollAt) / 1000);
            text = `${rink.name} · ${onIce} on the ice${waiting ? ` (+${waiting} just started)` : ''} · updated ${age} s ago`;
        }
        if (statusEl.textContent !== text) statusEl.textContent = text;
        $('liveBadge').classList.toggle('idle', !onIce);
        if (pollError) { errorEl.textContent = `${pollError}. Trying again in ${pollSeconds} s.`; show(errorEl); } else hide(errorEl);
    }

    // ---------- The track ----------
    let view = { w: 0, h: 0, scale: 1, dpr: 1 };
    function resize() {
        const b = trackBounds();
        const unitsW = b.maxX - b.minX + 2 * MARGIN;
        const unitsH = b.maxY - b.minY + 2 * MARGIN;
        const dpr = window.devicePixelRatio || 1;
        const aspect = unitsW / unitsH;
        const availableW = trackWrap.clientWidth;
        const availableH = trackWrap.clientHeight;
        const w = Math.max(1, Math.round(availableH > 0 ? Math.min(availableW, availableH * aspect) : availableW));
        const h = Math.round(w / aspect);
        canvas.style.width = `${w}px`;
        canvas.style.height = `${h}px`;
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
        view = { w, h, scale: w / unitsW, dpr };
        dirty = true;
    }
    window.addEventListener('resize', resize);
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(resize).observe(trackWrap);
    resize();

    const toPx = p => ({ x: view.w / 2 + p.x * view.scale, y: view.h / 2 + p.y * view.scale });
    function tracePath(offset, steps = 240) {
        for (let i = 0; i < steps; i++) {
            const p = toPx(pointOnTrack(i / steps, offset));
            if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
        }
        ctx.closePath();
    }
    function inkFor(hex) {
        const n = parseInt(String(hex).replace('#', ''), 16) || 0;
        const lin = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
        return 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255) > 0.4 ? '#0b0b0b' : '#ffffff';
    }

    let hitTargets = [];
    function drawTrack() {
        ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
        ctx.clearRect(0, 0, view.w, view.h);
        ctx.beginPath(); tracePath(BAND_WIDTH / 2); tracePath(-BAND_WIDTH / 2);
        ctx.fillStyle = colors.ice; ctx.fill('evenodd');
        ctx.strokeStyle = colors.edge; ctx.lineWidth = 1.5;
        ctx.beginPath(); tracePath(BAND_WIDTH / 2); ctx.stroke();
        ctx.beginPath(); tracePath(-BAND_WIDTH / 2); ctx.stroke();
        ctx.font = '11px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        for (let k = 0; k < 4; k++) {                                      // finish line at f = 0, then every quarter
            const a = toPx(pointOnTrack(k / 4, -BAND_WIDTH / 2));
            const b = toPx(pointOnTrack(k / 4, BAND_WIDTH / 2));
            ctx.strokeStyle = k === 0 ? colors.text : colors.edge; ctx.lineWidth = k === 0 ? 3 : 1;
            ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
            const label = toPx(pointOnTrack(k / 4, -BAND_WIDTH / 2 - 0.022));
            ctx.fillStyle = colors.muted;
            ctx.fillText(k === 0 ? 'Finish' : `${Math.round((k / 4) * rink.length)} m`, label.x, label.y);
        }
        ctx.fillStyle = colors.muted; ctx.font = '600 20px system-ui, sans-serif';
        ctx.fillText(new Date().toLocaleTimeString('en-GB'), view.w / 2, view.h / 2);

        hitTargets = [];
        const slots = colourSlots();
        const skating = states.filter(s => s.status === 'skating' && s.frac !== null)
            .sort((a, b) => Number(slots.has(a.id)) - Number(slots.has(b.id)));          // the coloured dots on top
        skating.forEach((state, index) => {
            const slot = slots.get(state.id);
            const lane = ((slot ?? index) % LANES) - Math.floor(LANES / 2);
            const p = toPx(pointOnTrack(state.frac, lane * LANE_STEP));
            const labelled = slot !== undefined;
            const radius = labelled ? 10 : 4;
            const fill = labelled ? colors.series[slot] : colors.series[0];
            ctx.beginPath(); ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
            ctx.fillStyle = fill; ctx.fill();
            ctx.lineWidth = state.id === selectedId ? 3 : 2;
            ctx.strokeStyle = state.id === selectedId ? colors.text : colors.surface; ctx.stroke();
            if (labelled) {
                ctx.fillStyle = inkFor(fill); ctx.font = '600 10px system-ui, sans-serif';
                ctx.fillText(liveInitials(state), p.x, p.y + 0.5);
            }
            hitTargets.push({ state, x: p.x, y: p.y, radius });
        });
    }

    canvas.addEventListener('mousemove', event => {
        const rect = canvas.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        const hit = [...hitTargets].reverse().find(t => Math.hypot(t.x - x, t.y - y) <= t.radius + 4);
        if (!hit) { hide(tooltip); return; }
        const s = hit.state;
        tooltip.innerHTML = `<strong>${escapeHtml(s.label)}</strong><br>${s.lapCount} laps · last ${seconds(s.lastMs)} · best ${seconds(s.bestMs)}`;
        tooltip.style.left = `${Math.min(x + 14, view.w - 200)}px`;
        tooltip.style.top = `${y + 14}px`;
        show(tooltip);
    });
    canvas.addEventListener('mouseleave', () => hide(tooltip));
    canvas.addEventListener('click', event => {
        const rect = canvas.getBoundingClientRect();
        const hit = [...hitTargets].reverse().find(t => Math.hypot(t.x - (event.clientX - rect.left), t.y - (event.clientY - rect.top)) <= t.radius + 4);
        if (hit) selectRider(hit.state.id);
        else if (selectedId !== null) selectRider(selectedId);         // a click beside the dots lets go of the rider
    });

    // ---------- The lap graph of the selected rider ----------
    function drawLapPanel() {
        if (selectedId !== null && !riders.has(selectedId)) { selectedId = compareId; compareId = null; }      // the rider is no longer in the list
        if (compareId !== null && !riders.has(compareId)) compareId = null;
        const rider = selectedId === null ? null : riders.get(selectedId);
        const state = selectedId === null ? null : states.find(s => s.id === selectedId);
        if (!rider || !state) { lapGraph.draw(null, {}); return; }
        const slots = colourSlots();
        const slot = slots.get(selectedId);
        const colour = colors.series[slot === undefined ? 0 : slot] || colors.series[0];
        let compare = null;
        const otherRider = compareId === null ? null : riders.get(compareId);
        const otherState = compareId === null ? null : states.find(s => s.id === compareId);
        if (otherRider && otherState && !otherRider.isPrivate && otherRider.laps) {
            // the colour of the compared rider; when that is the colour of the selected one (two small dots), the next colour
            const otherSlot = slots.get(compareId);
            let otherColour = colors.series[otherSlot === undefined ? 0 : otherSlot] || colors.series[0];
            if (otherColour === colour) otherColour = colors.series[((slot === undefined ? 0 : slot) + 1) % colors.series.length] || colors.series[1];
            compare = { label: otherState.label, laps: otherRider.laps, colour: otherColour };
        }
        lapGraph.draw({ label: state.label, laps: rider.laps, isPrivate: rider.isPrivate }, {
            trackLengthM: rink.length,
            colour,
            skating: state.status === 'skating',
            nowMs: Date.now()
        }, compare);
    }

    // ---------- Redraw ----------
    function renderAll() {
        refreshStates();
        renderList();
        renderStatus();
        drawTrack();
        drawLapPanel();
        // the number of riders on the ice in the title of the tab
        const onIce = states.filter(s => s.status === 'skating').length;
        const title = `${onIce ? `(${onIce}) ` : ''}Live · ${rink.name} · Icesights`;
        if (document.title !== title) document.title = title;
    }

    let lastSecond = 0;
    let lastFrame = 0;
    function frame(now) {
        const second = Math.floor(Date.now() / 1000);
        if (dirty || second !== lastSecond) { lastSecond = second; dirty = false; renderAll(); }
        else if (now - lastFrame > 100) { lastFrame = now; refreshStates(); drawTrack(); drawLapPanel(); }   // the dots keep moving between the seconds
        requestAnimationFrame(frame);
    }

    // ---------- Start ----------
    renderAll();
    poll();
    requestAnimationFrame(frame);

    // for the browser test: a way to see the state
    window.__live = { states: () => states, rink: () => rink, pollNow: poll, requests: () => requestsThisMinute.length, selected: () => selectedId, compared: () => compareId, lapGraph: () => lapGraph.info() };
});
