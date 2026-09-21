/**
 * The lap time graph of the live page: the history of the lap times of the selected rider, like the graph of the replay
 * page. Laps slower than the "max lap time" (and breaks) are greyed out and pinned to the top of the graph, so no lap is lost.
 * The horizontal axis is the time of day; while the rider is on the ice it runs up to "now" and grows with every lap.
 * Depends on utils.js, replay-model.js (LAP_GAP_TOLERANCE_MS) and live-model.js.
 *
 * @param {object} els   panel, title, readout, empty, body, canvas, slider, sliderValue, tooltip (DOM elements)
 * @param {object} hooks getColors() -> { grid, edge, text, muted, surface, slow }, onChange() after the user moved the slider
 */
function createLiveLapGraph(els, hooks) {
    const ctx = els.canvas.getContext('2d');
    const PAD = { l: 46, r: 14, t: 12, b: 26 };
    let maxSeconds = 60;
    let auto = true;                     // until the slider is moved, every lap of the rider is in view
    let hits = [];                       // where the laps were drawn, for the tooltip
    let shown = { fast: 0, slow: 0 };
    let newestPoint = null;              // where the newest lap is drawn (for the tests)
    let hasMarks = false;                // the flags of the start and the finish are drawn (for the tests)
    let zoomed = false;                  // the graph is zoomed in on the flags (for the tests)
    let placeByEnd = new Map();          // the place of the rider at the end of a lap (second of the crossing), for the tooltip and the tests

    const time = (ms, withSeconds) => new Date(ms).toLocaleTimeString('en-GB', withSeconds ? undefined : { hour: '2-digit', minute: '2-digit' });
    const lapLabel = seconds => formatSecondsToDuration(seconds).replace(/^0/, '').replace(/\.?0+$/, '');

    function setMessage(text) {
        els.empty.textContent = text;
        els.empty.classList.remove('hidden');
        els.body.classList.add('hidden');
        els.title.textContent = 'Lap times';
        els.readout.textContent = '';
        hits = [];
        shown = { fast: 0, slow: 0 };
        newestPoint = null;
        hasMarks = false;
        zoomed = false;
        placeByEnd = new Map();
    }

    els.slider.addEventListener('input', () => {
        auto = false;
        maxSeconds = parseFloat(els.slider.value);
        if (hooks.onChange) hooks.onChange();
    });

    /**
     * @param {object|null} rider  { label (the name of the rider), code (his transponder number, optional: NAME, XX-11111), place (position in the list, optional), laps (normalized or null),
     *                             isPrivate } of the selected rider, or null
     * @param {object} options     { trackLengthM, colour, skating, nowMs, marks (optional: { startMs, finishMs }, real times of the start
     *                             lap and the finish lap of the marathon list, drawn as a start and a finish flag), zoom (false: while the
     *                             start is being moved the whole activity is shown, to see where the start line goes), places (optional:
     *                             [{ endMs, place }] the place of the selected rider in the list of every lap: drawn as a second line on
     *                             its own axis on the right, place 1 at the top) }
     * @param {object} [compare]   { label, laps, colour } of a second rider, drawn paler in the same graph
     */
    function draw(rider, options, compare) {
        if (!rider) return setMessage('Select a rider in the list or on the track to see his or her lap times.');
        if (rider.isPrivate) return setMessage(`${rider.label} keeps the results private: there are no lap times to show.`);
        if (!rider.laps || rider.laps.length === 0) return setMessage(`${rider.label}: waiting for the first lap…`);

        els.empty.classList.add('hidden');
        els.body.classList.remove('hidden');
        const { trackLengthM, colour, skating, nowMs } = options;
        const colors = hooks.getColors();
        // With the flags of a marathon list the graph is zoomed in: the start lap at the left, the finish lap at the right; only the laps
        // in between are drawn
        const marks = options.marks || null;
        hasMarks = !!marks;
        zoomed = !!marks && options.zoom !== false;
        const inRange = lap => !zoomed || (lap.startMs + lap.durMs >= marks.startMs - 1000 && lap.startMs + lap.durMs <= marks.finishMs + 1000);
        const laps = rider.laps.filter(inRange);
        const otherLaps = compare && compare.laps ? compare.laps.filter(inRange) : [];
        if (laps.length === 0) return setMessage(`${rider.label}: no laps between the start and the finish.`);

        if (auto) maxSeconds = Math.min(180, Math.max(5, liveShowAllMax(laps.concat(otherLaps), trackLengthM)));
        els.slider.value = String(maxSeconds);
        els.sliderValue.textContent = lapLabel(maxSeconds);

        // canvas size (CSS decides it; the pixels follow)
        const dpr = window.devicePixelRatio || 1;
        const w = els.canvas.clientWidth;
        const h = els.canvas.clientHeight;
        if (els.canvas.width !== Math.round(w * dpr) || els.canvas.height !== Math.round(h * dpr)) {
            els.canvas.width = Math.round(w * dpr);
            els.canvas.height = Math.round(h * dpr);
        }
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);
        if (w < 80 || h < 60) return;

        // the laps of the rider that is compared with (drawn paler, in his own colour) share the axes
        const other = compare && compare.laps && compare.laps.length ? compare : null;
        const view = liveLapWindow(other ? laps.concat(otherLaps) : laps, maxSeconds, trackLengthM);
        const isMine = lap => laps.includes(lap);
        shown = { fast: view.fast.filter(isMine).length, slow: view.slow.filter(isMine).length };
        const first = zoomed ? marks.startMs : Math.min(laps[0].startMs, other ? otherLaps[0].startMs : Infinity, marks ? marks.startMs : Infinity);
        const last = laps[laps.length - 1];
        const lastEnd = last.startMs + last.durMs;
        const otherEnd = other ? otherLaps[otherLaps.length - 1].startMs + otherLaps[otherLaps.length - 1].durMs : 0;
        const right = zoomed ? Math.max(marks.finishMs, first + 10000) : Math.max(skating ? nowMs : lastEnd, otherEnd, marks ? marks.finishMs : 0, first + 60000);
        const padRight = options.places && options.places.length ? PAD.r + 26 : PAD.r;      // room for the axis of the places
        const plotW = w - PAD.l - padRight;
        const plotH = h - PAD.t - PAD.b;
        const x = ms => PAD.l + ((ms - first) / (right - first)) * plotW;
        const y = seconds => PAD.t + (1 - (seconds - view.yMin) / (view.yMax - view.yMin)) * plotH;
        const yTop = PAD.t;

        // grid, and the labels of both axes
        ctx.font = '11px system-ui, sans-serif';
        ctx.lineWidth = 1;
        ctx.strokeStyle = colors.grid;
        ctx.fillStyle = colors.muted;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        view.ticks.forEach(seconds => {
            const py = Math.round(y(seconds)) + 0.5;
            ctx.beginPath(); ctx.moveTo(PAD.l, py); ctx.lineTo(PAD.l + plotW, py); ctx.stroke();
            ctx.fillText(lapLabel(seconds), PAD.l - 8, py);
        });
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        const xTicks = Math.max(2, Math.min(5, Math.floor(plotW / 110)));
        for (let i = 0; i <= xTicks; i++) {
            const ms = first + ((right - first) * i) / xTicks;
            ctx.fillText(time(ms, false), Math.min(Math.max(x(ms), PAD.l + 14), PAD.l + plotW - 14), PAD.t + plotH + 8);
        }
        ctx.strokeStyle = colors.edge;
        ctx.beginPath(); ctx.moveTo(PAD.l, PAD.t + plotH + 0.5); ctx.lineTo(PAD.l + plotW, PAD.t + plotH + 0.5); ctx.stroke();

        hits = [];
        const endX = lap => x(lap.startMs + lap.durMs);

        // one rider: the laps that are not in view as grey dots (pinned to the top edge when they do not fit), the laps in
        // view as a line (a greyed-out lap or a gap in the laps interrupts it) with dots
        const plot = (list, lineColour, alpha, label) => {
            const radius = list.length <= 120 ? 3 : 2;
            ctx.globalAlpha = alpha;
            ctx.fillStyle = colors.slow;
            view.slow.filter(lap => list.includes(lap)).forEach(lap => {
                const py = isSkatingLapMs(lap, trackLengthM) ? Math.max(y(lap.durMs / 1000), yTop) : yTop;
                ctx.beginPath(); ctx.arc(endX(lap), py, radius, 0, Math.PI * 2); ctx.fill();
                hits.push({ x: endX(lap), y: py, lap, greyed: true, label });
            });
            ctx.strokeStyle = lineColour;
            ctx.lineWidth = 2;
            ctx.lineJoin = 'round';
            ctx.lineCap = 'round';
            ctx.beginPath();
            let connected = false;
            let previousEnd = null;
            list.forEach(lap => {
                if (previousEnd !== null && lap.startMs - previousEnd > LAP_GAP_TOLERANCE_MS) connected = false;
                previousEnd = lap.startMs + lap.durMs;
                if (!view.fast.includes(lap)) { connected = false; return; }
                if (connected) ctx.lineTo(endX(lap), y(lap.durMs / 1000)); else ctx.moveTo(endX(lap), y(lap.durMs / 1000));
                connected = true;
            });
            ctx.stroke();
            ctx.fillStyle = lineColour;
            view.fast.filter(lap => list.includes(lap)).forEach(lap => {
                ctx.beginPath(); ctx.arc(endX(lap), y(lap.durMs / 1000), radius, 0, Math.PI * 2); ctx.fill();
                hits.push({ x: endX(lap), y: y(lap.durMs / 1000), lap, greyed: false, label });
            });
            ctx.globalAlpha = 1;
        };
        if (other) plot(otherLaps, other.colour, 0.45, other.label);      // paler, like the compared rider of the replay
        plot(laps, colour, 1, null);

        // the newest lap of the selected rider, ringed
        const newest = hits.find(hit => hit.lap === last);
        newestPoint = newest ? { x: newest.x, y: newest.y } : null;
        if (newest) {
            ctx.beginPath(); ctx.arc(newest.x, newest.y, 6, 0, Math.PI * 2);
            ctx.fillStyle = newest.greyed ? colors.slow : colour; ctx.fill();
            ctx.lineWidth = 2; ctx.strokeStyle = colors.surface; ctx.stroke();
        }

        // the place of the rider in the list of every lap: a dashed line on an axis of its own (right), place 1 at the top
        placeByEnd = new Map();
        const places = (options.places || []).filter(p => p.endMs >= first - 1000 && p.endMs <= right + 1000);
        if (places.length) {
            const maxPlace = Math.max(2, ...places.map(p => p.place));
            const yPlace = place => PAD.t + ((place - 1) / (maxPlace - 1)) * plotH;
            const step = Math.max(1, Math.ceil((maxPlace - 1) / 4));
            ctx.font = '11px system-ui, sans-serif';
            ctx.fillStyle = colors.muted;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            for (let p = 1; p <= maxPlace; p += step) ctx.fillText(String(p), PAD.l + plotW + 6, yPlace(p));
            ctx.fillText('place', PAD.l + plotW + 6, PAD.t + plotH + 10);
            ctx.strokeStyle = colors.text;
            ctx.globalAlpha = 0.75;
            ctx.lineWidth = 1.5;
            ctx.setLineDash([4, 3]);
            ctx.beginPath();
            places.forEach((p, i) => { const px = x(p.endMs); if (i === 0) ctx.moveTo(px, yPlace(p.place)); else ctx.lineTo(px, yPlace(p.place)); });
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.fillStyle = colors.text;
            places.forEach(p => { ctx.fillRect(x(p.endMs) - 2.5, yPlace(p.place) - 2.5, 5, 5); placeByEnd.set(Math.round(p.endMs / 1000), p.place); });
            ctx.globalAlpha = 1;
        }

        // the start and the finish of the marathon list: the same real time for every rider
        if (marks) {
            ctx.setLineDash([]);
            [['\u25B6', marks.startMs], ['\uD83C\uDFC1', marks.finishMs]].forEach(([symbol, ms]) => {
                const mx = Math.round(x(ms)) + 0.5;
                ctx.strokeStyle = colors.text;
                ctx.lineWidth = 1;
                ctx.beginPath(); ctx.moveTo(mx, PAD.t + 12); ctx.lineTo(mx, PAD.t + plotH); ctx.stroke();
                ctx.fillStyle = colors.text;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'top';
                ctx.font = '12px system-ui, sans-serif';
                ctx.fillText(symbol, mx, PAD.t);
            });
        }

        // "now": the edge of the graph while the rider is on the ice
        if (skating) {
            ctx.strokeStyle = colors.text;
            ctx.lineWidth = 1;
            ctx.setLineDash([3, 3]);
            ctx.beginPath(); ctx.moveTo(x(nowMs) + 0.5, PAD.t); ctx.lineTo(x(nowMs) + 0.5, PAD.t + plotH); ctx.stroke();
            ctx.setLineDash([]);
        }

        // title and the numbers of the rider
        const skatingLaps = laps.filter(lap => isSkatingLapMs(lap, trackLengthM));
        const best = skatingLaps.reduce((a, b) => (!a || b.durMs < a.durMs ? b : a), null);
        const average = skatingLaps.length ? skatingLaps.reduce((sum, lap) => sum + lap.durMs, 0) / skatingLaps.length : null;
        // NAME, XX-11111 · position (the place in the list is there on the marathon page)
        const who = `${rider.label}${rider.code && rider.code !== rider.label ? `, ${rider.code}` : ''}${rider.place ? ` · position ${rider.place}` : ''}`;
        els.title.textContent = otherLaps.length ? `Lap times · ${who} and ${compare.label}` : `Lap times · ${who}`;
        const readout = `${skatingLaps.length} laps · last ${lapLabel(last.durMs / 1000)}${best ? ` · best ${lapLabel(best.durMs / 1000)}` : ''}${average ? ` · average ${lapLabel(average / 1000)}` : ''}`;
        if (els.readout.textContent !== readout) els.readout.textContent = readout;
    }

    // A tooltip on the nearest lap
    els.canvas.addEventListener('mousemove', event => {
        const rect = els.canvas.getBoundingClientRect();
        const px = event.clientX - rect.left;
        const py = event.clientY - rect.top;
        const near = hits.filter(hit => Math.abs(hit.x - px) <= 10)
            .sort((a, b) => Math.hypot(a.x - px, a.y - py) - Math.hypot(b.x - px, b.y - py))[0];
        if (!near) { els.tooltip.classList.add('hidden'); return; }
        const lap = near.lap;
        els.tooltip.innerHTML = `<strong>${near.label ? near.label + ' · ' : ''}Lap ${lap.nr}${near.greyed ? ' (not in view)' : ''}</strong><br>${lapLabel(lap.durMs / 1000)} · ${time(lap.startMs + lap.durMs, true)}${placeByEnd.has(Math.round((lap.startMs + lap.durMs) / 1000)) && !near.label ? ` · place ${placeByEnd.get(Math.round((lap.startMs + lap.durMs) / 1000))}` : ''}`;
        els.tooltip.style.left = `${Math.min(near.x + 12, els.canvas.clientWidth - 150)}px`;
        els.tooltip.style.top = `${Math.max(near.y - 40, 0)}px`;
        els.tooltip.classList.remove('hidden');
    });
    els.canvas.addEventListener('mouseleave', () => els.tooltip.classList.add('hidden'));

    return {
        draw,
        resetMax() { auto = true; },
        info: () => ({ maxSeconds, auto, drawn: hits.length, inView: shown.fast, greyed: shown.slow, newest: newestPoint, marks: hasMarks, zoomed, places: placeByEnd.size })
    };
}
