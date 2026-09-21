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
    }

    els.slider.addEventListener('input', () => {
        auto = false;
        maxSeconds = parseFloat(els.slider.value);
        if (hooks.onChange) hooks.onChange();
    });

    /**
     * @param {object|null} rider  { label, laps (normalized or null), isPrivate } of the selected rider, or null
     * @param {object} options     { trackLengthM, colour, skating, nowMs }
     */
    function draw(rider, options) {
        if (!rider) return setMessage('Select a rider in the list or on the track to see his or her lap times.');
        if (rider.isPrivate) return setMessage(`${rider.label} keeps the results private: there are no lap times to show.`);
        if (!rider.laps || rider.laps.length === 0) return setMessage(`${rider.label}: waiting for the first lap…`);

        els.empty.classList.add('hidden');
        els.body.classList.remove('hidden');
        const { trackLengthM, colour, skating, nowMs } = options;
        const colors = hooks.getColors();
        const laps = rider.laps;

        if (auto) maxSeconds = Math.min(180, Math.max(5, liveShowAllMax(laps, trackLengthM)));
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

        const view = liveLapWindow(laps, maxSeconds, trackLengthM);
        shown = { fast: view.fast.length, slow: view.slow.length };
        const first = laps[0].startMs;
        const last = laps[laps.length - 1];
        const lastEnd = last.startMs + last.durMs;
        const right = Math.max(skating ? nowMs : lastEnd, first + 60000);
        const plotW = w - PAD.l - PAD.r;
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

        // laps that are not in view: grey dots, pinned to the top edge when they do not fit
        ctx.fillStyle = colors.slow;
        view.slow.forEach(lap => {
            const py = isSkatingLapMs(lap, trackLengthM) ? Math.max(y(lap.durMs / 1000), yTop) : yTop;
            ctx.beginPath(); ctx.arc(endX(lap), py, laps.length <= 120 ? 3 : 2, 0, Math.PI * 2); ctx.fill();
            hits.push({ x: endX(lap), y: py, lap, greyed: true });
        });

        // the laps in view as a line; a greyed-out lap or a gap in the laps interrupts it
        ctx.strokeStyle = colour;
        ctx.lineWidth = 2;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.beginPath();
        let connected = false;
        let previousEnd = null;
        laps.forEach(lap => {
            if (previousEnd !== null && lap.startMs - previousEnd > LAP_GAP_TOLERANCE_MS) connected = false;
            previousEnd = lap.startMs + lap.durMs;
            if (!view.fast.includes(lap)) { connected = false; return; }
            if (connected) ctx.lineTo(endX(lap), y(lap.durMs / 1000)); else ctx.moveTo(endX(lap), y(lap.durMs / 1000));
            connected = true;
        });
        ctx.stroke();
        ctx.fillStyle = colour;
        view.fast.forEach(lap => {
            ctx.beginPath(); ctx.arc(endX(lap), y(lap.durMs / 1000), laps.length <= 120 ? 3 : 2, 0, Math.PI * 2); ctx.fill();
            hits.push({ x: endX(lap), y: y(lap.durMs / 1000), lap, greyed: false });
        });

        // the newest lap, ringed
        const newest = hits.find(hit => hit.lap === last);
        newestPoint = newest ? { x: newest.x, y: newest.y } : null;
        if (newest) {
            ctx.beginPath(); ctx.arc(newest.x, newest.y, 6, 0, Math.PI * 2);
            ctx.fillStyle = newest.greyed ? colors.slow : colour; ctx.fill();
            ctx.lineWidth = 2; ctx.strokeStyle = colors.surface; ctx.stroke();
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
        els.title.textContent = `Lap times · ${rider.label}`;
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
        els.tooltip.innerHTML = `<strong>Lap ${lap.nr}${near.greyed ? ' (not in view)' : ''}</strong><br>${lapLabel(lap.durMs / 1000)} · ${time(lap.startMs + lap.durMs, true)}`;
        els.tooltip.style.left = `${Math.min(near.x + 12, els.canvas.clientWidth - 150)}px`;
        els.tooltip.style.top = `${Math.max(near.y - 40, 0)}px`;
        els.tooltip.classList.remove('hidden');
    });
    els.canvas.addEventListener('mouseleave', () => els.tooltip.classList.add('hidden'));

    return {
        draw,
        resetMax() { auto = true; },
        info: () => ({ maxSeconds, auto, drawn: hits.length, inView: shown.fast, greyed: shown.slow, newest: newestPoint })
    };
}
