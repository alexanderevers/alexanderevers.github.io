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
    const LABELLED_RIDERS = 10;             // up to ten riders have a colour and initials on the track (the ones that were pressed), the others a small dot
    const MARATHON_SELECTED_RIDERS = 5;     // marathon mode: the same idea, but capped at five (the "Selected" group in the list)
    const MAX_SELECTED_SHOWN = 5;           // the "Selected" group of the list (both pages) shows at most this many rows, even with more coloured
    const LANE_STEP = 0.0075;
    const LANES = 5;
    const BAND_WIDTH = 0.045;
    const MARGIN = 0.05;

    const $ = id => document.getElementById(id);
    const $m = id => document.getElementById(id) || document.createElement('div');       // (marathon controls: not on live.html)
    const rinkSelect = $('rinkSelect');
    const pollSelect = $('pollSelect');
    const sortSelect = $('sortSelect');
    const marathonLapsInput = $m('marathonLaps');
    const marathonStartInput = $m('marathonStart');
    const marathonStartTime = $m('marathonStartTime');
    const replayInput = $m('replayActivity');
    const marathonFinishInput = $m('marathonFinish');
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
    // Marathon mode (marathon.html only): a list per lap for a race of a group. ?laps=25 in the address wins over what was set last time.
    // marathon.html is this page in marathon mode; live.html has no marathon controls at all (they are looked up with $m: a missing one is an
    // element that is not in the page)
    const MARATHON_PAGE = document.body.dataset.page === 'marathon';
    const marathon = MARATHON_PAGE;
    const lapsParam = Number(params.get('laps'));
    let raceLaps = lapsParam >= 1 ? Math.floor(lapsParam) : (Number(loadSetting('liveRaceLaps', 0)) || null);
    let marathonStart = null;                 // the start time of the race (absolute, ms); null = the program chooses it
    let marathonDay = Date.now();             // a moment of the day of the race (for the time field)
    let marathonFinish = null;                // the finish lap of the list; null = the slider is at its last position: the newest lap
    let marathonResult = null;
    // Replay of a marathon of an earlier day (by an activity number): the page then shows the rink as it was at replay.at instead of now.
    let replay = null;                        // { activityId, startMs, endMs, at, playing, speed, tick, loading, message }
    const clock = () => (replay && !replay.loading ? replay.at : Date.now());
    // the laps of a rider as far as they are known at the moment of the clock
    const lapsAt = (laps, at) => (laps ? laps.filter(lap => lap.startMs + lap.durMs <= at) : laps);

    rinkSelect.innerHTML = RINKS.map(r => `<option value="${r.id}">${escapeHtml(r.name)}</option>`).join('');
    rinkSelect.value = String(rink.id);
    if (![...pollSelect.options].some(o => Number(o.value) === pollSeconds)) {
        pollSelect.add(new Option(`every ${pollSeconds} s`, String(pollSeconds)));
    }
    pollSelect.value = String(pollSeconds);
    sortSelect.value = sortMode;
    marathonLapsInput.value = raceLaps ? String(raceLaps) : '';
    function showMarathonControls() {
        $m('marathonLapsLabel').classList.toggle('hidden', !marathon);
        $m('replayLabel').classList.toggle('hidden', !marathon || !!replay);
        $m('replayBar').classList.toggle('hidden', !replay);
        $m('marathonLapLabel').classList.toggle('hidden', !marathon);
        $('sortLabel').classList.toggle('hidden', marathon);
    }
    showMarathonControls();

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
    // The real name of a rider (given name and surname of his account) is shown instead of the transponder name; the transponder name and
    // number are only shown for the selected rider (the title of the lap graph). Names are looked up from the account of the rider (the
    // proxy keeps them for a day) a few at a time, and kept for the visit; a rider without a readable profile stays under his transponder name.
    const nameOfUser = new Map();           // user id (gaUId, else the transponder) -> 'Given Surname', or '' when there is none
    const namesAsked = new Set();
    const userKey = activity => activity.gaUId || activity.chipCode;
    const transponderName = activity => (activity.chipLabel || '').trim() || activity.chipCode;
    const nameOf = activity => nameOfUser.get(userKey(activity)) || transponderName(activity);
    let namesRunning = 0;
    async function ensureNames() {
        const todo = [...riders.values()].map(r => r.activity).filter(a => !namesAsked.has(userKey(a)));
        for (const activity of todo) namesAsked.add(userKey(activity));
        const queue = todo.filter((a, i) => todo.findIndex(b => userKey(b) === userKey(a)) === i);
        const worker = async () => {
            while (queue.length) {
                const activity = queue.shift();
                const account = activity.gaUId ? await fetchAccountByUserId(activity.gaUId) : await fetchAccountDetails(activity.chipCode);
                nameOfUser.set(userKey(activity), accountFullName(account));
                dirty = true;
            }
        };
        if (namesRunning >= 4) return;                                      // a run is going on already: it takes the new riders too, next time
        namesRunning++;
        try { await Promise.all(Array.from({ length: Math.min(4, queue.length) }, worker)); } finally { namesRunning--; }
    }
    function selectRider(id) {
        const letGo = id === selectedId;                                     // (pressing the selected rider again)
        if (id === selectedId || selectedId === null) {
            selectedId = id === selectedId ? null : id;
            compareId = null;
        } else if (id === compareId) {
            selectedId = id;
            compareId = null;
        } else {
            compareId = id;
        }
        // Colours: every rider is a small dot until his name is pressed; then he gets a colour and initials. Up to LABELLED_RIDERS have one on the
        // live page (MARATHON_SELECTED_RIDERS in marathon mode, its "Selected" group): pressing one more than that takes the colour of the rider
        // who was pressed first. Letting go of the selected rider takes his colour. This is the same mechanism in both modes; only the cap differs.
        pinnedId = letGo ? null : id;                                       // the last name pressed is on top of the list
        if (letGo) dropColour(id);
        else if (!colourSlot.has(id)) addColour(id);
        lapGraph.resetMax();
        dirty = true;
    }
    let pinnedId = null;                    // the rider on top of the list (live page)
    const colourSlot = new Map();           // rider id -> the number of his colour, in the order in which the names were pressed
    function dropColour(id) { colourSlot.delete(id); }
    function addColour(id) {
        const cap = marathon ? MARATHON_SELECTED_RIDERS : LABELLED_RIDERS;
        if (colourSlot.size >= cap) colourSlot.delete(colourSlot.keys().next().value);      // the first pressed loses his colour
        const used = new Set(colourSlot.values());
        let slot = 0;
        while (used.has(slot)) slot++;
        colourSlot.set(id, slot);
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
        await Promise.all(Array.from({ length: Math.min(marathon ? LAP_FETCH_CONCURRENCY * 2 : LAP_FETCH_CONCURRENCY, queue.length) }, worker));
    }

    async function poll() {
        if (polling || replay) return;
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
            ensureNames();                                                  // (the names come in a little later)
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
        if (document.hidden || replay) return;                              // nobody is looking, or a marathon of the past is shown: do not ask
        pollTimer = setTimeout(poll, pollSeconds * 1000);
    }

    function changeRink(next) {
        replayRun++;
        replay = null;
        showMarathonControls();
        rink = next;
        saveSetting('liveRink', rink.id);
        riders = new Map();
        states = [];
        shown.clear();
        selectedId = null;
        compareId = null;
        colourSlot.clear();
        pinnedId = null;
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
    // ---------- Replay of a marathon by activity number ----------
    // The replay starts at the real time of the chosen start lap (lap 1: the start of the race), not at the moment the first rider started
    // his activity. It is worked out from the whole race, so it does not depend on the moment of the clock.
    function replayFrom() {
        if (!replay || replay.loading) return 0;
        const whole = marathonStandings(marathonEntries(), { nowMs: replay.endMs, raceLaps, trackLengthM: rink.length, startMs: marathonStart ?? undefined });
        return whole ? whole.startMs : replay.startMs;
    }
    function syncReplayBar() {
        if (!replay || replay.loading) return;
        $m('replayPlay').innerHTML = replay.playing ? '&#10074;&#10074; Pause' : '&#9654; Play';
        $m('replayTime').max = String(Math.max(1, Math.round((replay.endMs - replay.fromMs) / 1000)));
        $m('replayTime').value = String(Math.max(0, Math.round((replay.at - replay.fromMs) / 1000)));
        $m('replayClock').textContent = timeOfDay(replay.at);
    }

    let replayRun = 0;                        // every start or stop of a replay gets a number: an older one that is still loading gives up
    async function startReplay(activityId) {
        const id = String(activityId).replace(/[^0-9]/g, '');
        if (!id) return;
        const run = ++replayRun;
        const current = () => run === replayRun;
        replay = { activityId: id, loading: true, message: 'Loading the marathon…', playing: false, speed: Number($m('replaySpeed').value), startMs: 0, endMs: 0, at: 0, tick: 0 };
        clearTimeout(pollTimer);
        riders = new Map();
        states = [];
        marathonStart = null;
        marathonFinish = null;
        selectedId = null;
        compareId = null;
        pinnedId = null;
        showMarathonControls();
        dirty = true;
        const fail = message => { replay = { ...replay, loading: true, error: message, message: 'Could not load the marathon' }; dirty = true; };
        try {
            // the laps of the activity give the day and the time of the marathon
            const own = normalizeLaps(await fetchLaps(id));
            if (!current()) return;
            if (!own.length) return fail(`Activity ${id} has no laps.`);
            const from = own[0].startMs;
            const to = own[own.length - 1].startMs + own[own.length - 1].durMs;
            // The rink of an activity is not in its laps: the chosen rink first, then the other rinks, until the activity is in the list
            // of a rink on that day. Everybody who skated at the same time as the activity is the group of the marathon.
            const candidates = [rink, ...RINKS.filter(r => r.id !== rink.id)];
            let found = null;
            for (let i = 0; i < candidates.length && !found; i++) {
                replay.message = i === 0 ? `Loading the riders of ${candidates[i].name} of that day…` : `Looking for activity ${id} at ${candidates[i].name} (${i + 1} of ${candidates.length})…`;
                dirty = true;
                let all = [];
                try { all = await fetchAllActivitiesFromLocation(candidates[i].id, new Date(from).getFullYear(), 'IceSkating', new Date(from).toISOString()); } catch (error) { all = []; }
                if (!current()) return;
                const group = all.filter(activity => Date.parse(activity.startTime) < to && Date.parse(activity.endTime) > from);
                if (group.some(activity => String(activity.id) === id)) found = { rink: candidates[i], group };
            }
            if (!found) return fail(`Activity ${id} was not found at any of the rinks of this page on ${new Date(from).toLocaleDateString('en-GB')}.`);
            if (found.rink !== rink) { rink = found.rink; rinkSelect.value = String(rink.id); }
            found.group.forEach(activity => riders.set(activity.id, { activity, laps: null, isPrivate: false, error: null, fetchedEnd: undefined, fetchedAt: 0 }));
            ensureNames();                                                     // the names of the riders come in while the laps load
            let done = 0;
            const queue = [...found.group];
            const worker = async () => {
                while (queue.length && current()) {
                    const activity = queue.shift();
                    const rider = riders.get(activity.id);
                    try { rider.laps = normalizeLaps(await fetchLaps(activity.id, activity.endTime, activity.startTime)); } catch (error) { rider.error = error.message; rider.isPrivate = /401|403|private/i.test(error.message); }
                    replay.message = `Loading the ${found.group.length} riders of that day… ${++done} of ${found.group.length}`;
                    dirty = true;
                }
            };
            await Promise.all(Array.from({ length: 10 }, worker));
            if (!current()) return;
            // the marathon is the time of the activity: what happened before or after it (other races of the same evening) is not part of it
            replay = { activityId: id, loading: false, playing: false, speed: Number($m('replaySpeed').value), startMs: from - 60000, endMs: to + 2 * 60 * 1000, at: 0, tick: performance.now() };
            replay.at = replay.endMs;                  // it opens on the final result
            // the start lap of the whole race is kept during the replay, so the moment of the clock does not change it
            marathonStart = (marathonStandings(marathonEntries(), { nowMs: replay.endMs, raceLaps, trackLengthM: rink.length }) || {}).startMs || null;
            replay.fromMs = replayFrom();
            replayInput.value = id;
            syncReplayBar();
            showMarathonControls();
            renderList.last = null;
            dirty = true;
        } catch (error) {
            if (current()) fail(error.message || 'The marathon could not be loaded');
        }
    }

    function stopReplay() {
        if (recorder) stopExport();
        replayRun++;
        replay = null;
        riders = new Map();
        states = [];
        shown.clear();
        lastPollAt = null;
        renderList.last = null;
        showMarathonControls();
        dirty = true;
        poll();
    }

    // ---------- Export the replay as a video ----------
    // Records the track (the canvas the riders move on) while the replay plays, from the chosen start to the end, and downloads
    // it as a .webm file. Uses canvas.captureStream + MediaRecorder, both built into the browser: nothing is uploaded anywhere.
    let recorder = null;                      // the MediaRecorder while a recording is running, else null
    let lastExportBlob = null;                // the most recent recording (for the test: a real download cannot be observed headless)
    const recordingSupported = () => typeof canvas.captureStream === 'function' && typeof window.MediaRecorder === 'function';
    function chooseVideoMimeType() {
        const candidates = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
        return candidates.find(type => window.MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(type)) || 'video/webm';
    }
    function stopExport() {
        if (recorder && recorder.state !== 'inactive') recorder.stop();      // the rest happens in recorder.onstop
    }
    function startExport() {
        if (!replay || replay.loading || recorder) return;
        if (!recordingSupported()) {
            window.alert('Recording a video is not supported in this browser. Chrome, Edge and Firefox can; Safari may not.');
            return;
        }
        const mimeType = chooseVideoMimeType();
        const stream = canvas.captureStream(30);
        try {
            recorder = new MediaRecorder(stream, { mimeType });
        } catch (error) {
            recorder = null;
            window.alert('Recording a video failed to start: ' + error.message);
            return;
        }
        const chunks = [];
        recorder.ondataavailable = event => { if (event.data && event.data.size) chunks.push(event.data); };
        recorder.onstop = () => {
            stream.getTracks().forEach(track => track.stop());
            recorder = null;
            $m('replayExport').textContent = 'Export video';
            if (!chunks.length) return;
            const blob = new Blob(chunks, { type: mimeType.split(';')[0] });
            lastExportBlob = blob;                     // for the test: a real download is not observable in a headless browser
            const url = URL.createObjectURL(blob);
            const day = new Date(replay.startMs).toISOString().slice(0, 10);
            const link = document.createElement('a');
            link.href = url;
            link.download = `marathon-${rink.name.replace(/[^A-Za-z0-9]+/g, '-')}-${day}.webm`;
            document.body.appendChild(link);
            link.click();
            link.remove();
            setTimeout(() => URL.revokeObjectURL(url), 10000);
        };
        replay.at = replay.fromMs;                    // record from the chosen start, not from wherever the clock happens to be
        replay.playing = true;
        replay.tick = performance.now();
        syncReplayBar();
        dirty = true;
        recorder.start(250);                          // a chunk every 250 ms, so stopping early still keeps what was recorded
        $m('replayExport').textContent = 'Recording… (stop)';
    }
    $m('replayExport').addEventListener('click', () => (recorder ? stopExport() : startExport()));

    $m('replayLoad').addEventListener('click', () => startReplay(replayInput.value));
    replayInput.addEventListener('keydown', event => { if (event.key === 'Enter') startReplay(replayInput.value); });
    $m('replayLive').addEventListener('click', stopReplay);
    $m('replayPlay').addEventListener('click', () => {
        if (!replay || replay.loading) return;
        if (!replay.playing && replay.at >= replay.endMs - 1000) replay.at = replay.fromMs;       // at the end: play again from the chosen start
        replay.playing = !replay.playing;
        replay.tick = performance.now();
        syncReplayBar();
        dirty = true;
    });
    $m('replaySpeed').addEventListener('change', () => { if (replay) replay.speed = Number($m('replaySpeed').value); });
    $m('replayTime').addEventListener('input', () => {
        if (!replay || replay.loading) return;
        replay.at = replay.fromMs + Number($m('replayTime').value) * 1000;
        syncReplayBar();
        dirty = true;
    });

    marathonLapsInput.addEventListener('change', () => {
        const value = Math.floor(Number(marathonLapsInput.value));
        raceLaps = value >= 1 ? value : null;
        marathonLapsInput.value = raceLaps ? String(raceLaps) : '';
        saveSetting('liveRaceLaps', raceLaps || 0);
        dirty = true;
    });
    // While the start slider is being moved the graph shows the whole activity, so it is easy to see where the start line goes; when it is
    // let go the graph zooms in on the start and the finish again.
    let movingStart = false;
    const moving = on => () => { movingStart = on; dirty = true; };
    for (const name of ['pointerdown', 'touchstart']) marathonStartInput.addEventListener(name, moving(true), { passive: true });
    for (const name of ['pointerup', 'pointercancel', 'touchend', 'touchcancel', 'change', 'blur']) marathonStartInput.addEventListener(name, moving(false));
    marathonStartInput.addEventListener('keydown', moving(true));
    marathonStartInput.addEventListener('keyup', moving(false));
    // the start time typed as a time of day (on the day of the race)
    marathonStartTime.addEventListener('change', () => {
        const [h, m, sec] = marathonStartTime.value.split(':').map(Number);
        if (!Number.isFinite(h) || !Number.isFinite(m)) return;
        const day = new Date(marathonDay);
        day.setHours(h, m, Number.isFinite(sec) ? sec : 0, 0);
        marathonStart = day.getTime();
        shown.clear();
        if (replay && !replay.loading) {
            replay.fromMs = replayFrom();
            replay.at = replay.fromMs;
            syncReplayBar();
        }
        dirty = true;
    });
    marathonStartInput.addEventListener('input', () => {
        marathonStart = Number(marathonStartInput.value) * 1000;          // chosen: from now on it stays where it is put
        shown.clear();                                                    // the dots begin again at the finish line
        marathonStartTime.value = clockText(marathonStart);
        if (replay && !replay.loading) {
            // a replay always starts at the chosen start: the clock goes there, and the slider of the time runs from there
            replay.fromMs = replayFrom();
            replay.at = replay.fromMs;
            syncReplayBar();
        }
        dirty = true;
    });
    marathonFinishInput.addEventListener('input', () => {
        const value = Number(marathonFinishInput.value);
        marathonFinish = value >= Number(marathonFinishInput.max) ? null : value;    // on the last position: follows the race
        dirty = true;
    });
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) clearTimeout(pollTimer);
        else if (!polling && !replay) poll();                               // back on the page: catch up at once
    });

    // ---------- The live picture ----------
    // In marathon mode everybody begins at the start time: the position of a rider on the track is reset to the finish line at that time
    const trackLaps = (laps, now) => (marathon && marathonResult ? marathonTrackLaps(laps, marathonResult.startMs, now) : laps);
    function refreshStates() {
        const now = clock();
        const list = [...riders.values()];
        if (replay) {
            // the rink as it was at that moment: only the laps that had ended, and only the riders who had started
            states = list.filter(rider => Date.parse(rider.activity.startTime) <= now).map(rider => {
                const state = {
                    ...riderLive({ ...rider.activity, endTime: Date.parse(rider.activity.endTime) <= now ? rider.activity.endTime : null }, trackLaps(lapsAt(rider.laps, now), now), now, rink.length, marathon ? MARATHON_ESTIMATE_OPTIONS : {}),
                    label: nameOf(rider.activity),
                    isPrivate: rider.isPrivate,
                    error: rider.error
                };
                // In a replay the whole activity is known: the lap he is in has a real time, so his place on the track is worked out from it
                // and not predicted from his pace (only for a rider who is skating, from his first crossing since the start).
                if (state.status === 'skating') {
                    const known = knownFraction(trackLaps(rider.laps, now), now, rink.length);
                    if (known !== null) state.exactFrac = known;
                }
                return state;
            });
            return;
        }
        states = list.map(rider => ({
            ...riderLive(rider.activity, trackLaps(rider.laps, now), now, rink.length, marathon ? MARATHON_ESTIMATE_OPTIONS : {}),
            label: nameOf(rider.activity),
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
    // A dot in the colour the rider has on the track (marathon list)
    function dotOf(id) {
        const slot = colourSlots().get(id);
        return slot === undefined ? '' : `<i class="live-dot" style="background:${colors.series[slot] || colors.series[0]}"></i>`;
    }
    // The same rider selection drives the colours in both modes (not the riders' position, which used to give the leading group in a marathon a
    // colour automatically, whether they were pressed or not).
    function colourSlots() {
        const slots = new Map();
        colourSlot.forEach((slot, id) => slots.set(id, slot));
        return slots;
    }
    // The ids to show under "Selected" (both pages): every currently coloured rider, most recently pressed first, capped at MAX_SELECTED_SHOWN.
    function selectedIdsShown() {
        const ids = [...colourSlot.keys()].reverse();
        if (pinnedId !== null && colourSlot.has(pinnedId)) ids.unshift(...ids.splice(ids.indexOf(pinnedId), 1));
        return ids.slice(0, MAX_SELECTED_SHOWN);
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

    // ---------- Marathon mode: the list of a lap (see marathonStandings in live-model.js) ----------
    const gapText = ms => (ms <= 0 ? 'first' : `+${(ms / 1000).toFixed(ms < 10000 ? 2 : 1)} s`);
    const distanceText = (ms, metres) => (ms <= 0 ? '' : metres < 1 ? '< 1 m' : `${Math.round(metres)} m`);
    const timeOfDay = ms => new Date(ms).toLocaleTimeString('en-GB');

    // The sliders of the start lap and the finish lap. As long as the finish slider is at its last position it follows the race: the list moves
    // on to every new lap.
    // The start time is an absolute time: from 20 seconds before it all riders are selected and the lap they are in is their first lap
    // (the waiting for the start and the warming up before it are not part of the race). The finish slider counts the laps of the race from
    // there.
    const clockText = ms => new Date(ms).toLocaleTimeString('en-GB');
    function syncMarathonSliders(result) {
        // in a replay the sliders are those of the whole race, not of the moment of the clock
        const whole = replay && !replay.loading ? marathonStandings(marathonEntries(), { nowMs: replay.endMs, raceLaps, trackLengthM: rink.length, startMs: marathonStart ?? undefined }) : result;
        const laps = Math.max(1, whole ? whole.leaderCount : 1);
        const finish = marathonFinish === null ? laps : Math.min(marathonFinish, laps);
        if (marathonFinish !== null && finish >= laps) marathonFinish = null;
        marathonFinishInput.max = String(laps);
        marathonFinishInput.value = String(finish);
        if (whole && !movingStart) {
            // the start time can be chosen from a minute before the first crossing to the last crossing (never in the middle of a move)
            marathonDay = whole.firstMs;
            marathonStartInput.min = String(Math.floor((whole.firstMs - 60000) / 1000));
            marathonStartInput.max = String(Math.ceil(whole.lastMs / 1000));
            marathonStartInput.value = String(Math.round(whole.startMs / 1000));
            if (document.activeElement !== marathonStartTime) marathonStartTime.value = clockText(whole.startMs);
        }
    }
    const raceTimeText = ms => {
        const s = ms / 1000;
        const h = Math.floor(s / 3600);
        const m = Math.floor((s % 3600) / 60);
        const rest = (s % 60).toFixed(1).padStart(4, '0');
        return h ? `${h}:${String(m).padStart(2, '0')}:${rest}` : `${m}:${rest}`;
    };

    const marathonEntries = () => [...riders.values()].filter(r => !r.isPrivate && r.laps && r.laps.length)
        .map(r => ({ id: r.activity.id, label: nameOf(r.activity), laps: r.laps }));

    function marathonHtml() {
        const entries = marathonEntries();
        const now = clock();
        const newest = marathonStandings(entries, { startMs: marathonStart ?? undefined, raceLaps, trackLengthM: rink.length, nowMs: now });
        syncMarathonSliders(newest);
        const result = marathonStandings(entries, { lapNr: marathonFinish, startMs: marathonStart ?? undefined, raceLaps, trackLengthM: rink.length, nowMs: now });
        marathonResult = result;
        if (result) {
            $m('marathonStartValue').textContent = `${timeOfDay(result.startMs)}${marathonStart === null ? ' (auto)' : ''}`;
            $m('marathonFinishValue').textContent = `${result.lapNr}${marathonFinish === null ? ' (follows)' : ''} · ${timeOfDay(result.finishMs)}`;
        }
        const head = '<thead><tr><th>Place</th><th>Rider</th><th>Laps</th><th>Crossed</th><th>Gap</th><th>Distance</th><th>Lap time</th><th>Time</th></tr></thead>';
        if (!result) {
            const text = lastPollAt ? 'Nobody has crossed the finish line yet in this race. This list refreshes by itself.' : 'Loading…';
            return `<table class="laps-table live-table">${head}<tbody><tr class="live-empty"><td colspan="8">${text}</td></tr></tbody></table>`;
        }
        const mark = id => (id === selectedId ? ' selected' : id === compareId ? ' compared' : '');
        if (!result.first) {
            return `<table class="laps-table live-table">${head}<tbody><tr class="live-group"><th colspan="8">Lap ${result.lapNr}</th></tr><tr class="live-empty"><td colspan="8">Nobody was registered at the finish line in this lap (the timing mat missed the riders).</td></tr></tbody></table>`;
        }
        const title = `Lap ${result.lapNr}${raceLaps ? ` of ${raceLaps}` : ''} · first rider: ${escapeHtml(result.first.label)}${result.finished && result.latest ? ' · finished' : ''}`;
        const rowOf = (row, cls) => `<tr class="live-row marathon-row${cls}" data-id="${row.id}">
            <td>${row.place}</td><td>${dotOf(row.id)}${escapeHtml(row.label)}</td><td class="laps">${row.laps}</td><td>${timeOfDay(row.endMs)}</td>
            <td class="gap">${gapText(row.gapMs)}</td><td class="gap">${distanceText(row.gapMs, row.distanceM)}</td><td>${seconds(row.lapMs)}</td><td class="gap">${raceTimeText(row.segmentMs)}</td></tr>`;
        const pendingOf = (p, cls) => `<tr class="live-row marathon-row waiting${cls}" data-id="${p.id}"><td>–</td><td>${dotOf(p.id)}${escapeHtml(p.label)}</td><td class="laps">${p.laps}</td>
                <td colspan="5" class="muted-note">${p.status === 'coming' ? 'on the way' : `${p.behind} lap${p.behind === 1 ? '' : 's'} behind`}</td></tr>`;
        let body = '';
        // Every selected rider (colourSlot, up to MARATHON_SELECTED_RIDERS) is on top of the list, with his place - the most recently pressed
        // one first (pinnedId), then the rest in the order they were added - and left out of the lists below, so he is not shown twice.
        const selectedIds = selectedIdsShown();
        const selectedSet = new Set(selectedIds);
        if (selectedIds.length) {
            body += `<tr class="live-group"><th colspan="8">Selected</th></tr>`;
            body += selectedIds.map(id => {
                const inRows = result.rows.find(r => r.id === id);
                const inPending = result.pending.find(p => p.id === id);
                const known = entries.find(e => e.id === id);
                if (inRows) return rowOf(inRows, ` pinned${mark(id)}`);
                if (inPending) return pendingOf(inPending, ` pinned${mark(id)}`);
                if (known) return `<tr class="live-row marathon-row waiting pinned${mark(id)}" data-id="${known.id}"><td>–</td><td>${dotOf(known.id)}${escapeHtml(known.label)}</td><td colspan="6" class="muted-note">not in the list of this lap</td></tr>`;
                return '';
            }).join('');
        }
        const visibleRows = result.rows.filter(row => !selectedSet.has(row.id));
        const visiblePending = result.pending.filter(p => !selectedSet.has(p.id));
        body += `<tr class="live-group"><th colspan="8">${title} <small>(${visibleRows.length})</small></th></tr>`;
        body += visibleRows.map(row => rowOf(row, `${row.place === 1 ? ' first' : ''}${mark(row.id)}`)).join('');
        if (visiblePending.length) {
            body += `<tr class="live-group"><th colspan="8">Still to cross the line <small>(${visiblePending.length})</small></th></tr>`;
            body += visiblePending.map(p => pendingOf(p, mark(p.id))).join('');
        }
        return `<table class="laps-table live-table">${head}<tbody>${body}</tbody></table>`;
    }

    function renderList() {
        if (marathon) {
            const html = marathonHtml();
            if (html !== renderList.last) { listEl.innerHTML = html; renderList.last = html; }
            return;
        }
        const slots = colourSlots();
        // Every currently coloured rider stays on top of the list, in its own group (up to MAX_SELECTED_SHOWN, most recently pressed first); the
        // others are sorted below as usual.
        const selected = selectedIdsShown().map(id => states.find(s => s.id === id)).filter(Boolean);
        const selectedSet = new Set(selected.map(s => s.id));
        const onIce = onIceStates().filter(s => !selectedSet.has(s.id));
        const resting = sortLiveRiders(states.filter(s => s.status === 'resting' && !s.isPrivate), 'recent').filter(s => !selectedSet.has(s.id));
        const isPrivate = states.filter(s => s.isPrivate).filter(s => !selectedSet.has(s.id));
        const head = '<thead><tr><th>Rider</th><th>Started</th><th>Duration</th><th>Laps</th><th>Last lap</th><th>Best lap</th><th>Since</th></tr></thead>';
        const group = (title, count, rows) => `<tr class="live-group"><th colspan="7">${title} <small>(${count})</small></th></tr>${rows}`;
        let body = '';
        if (selected.length) body += group('Selected', selected.length, selected.map(s => rowHtml(s, slots)).join(''));
        if (onIce.length) body += group('On the ice', onIce.length, onIce.map(s => rowHtml(s, slots)).join(''));
        else if (!selected.length) body += `<tr class="live-empty"><td colspan="7">${lastPollAt ? 'Nobody has crossed the finish line in the last few minutes. This list refreshes by itself.' : 'Loading…'}</td></tr>`;
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
        if (replay) text = replay.loading ? replay.message : `Replay · ${rink.name} · ${timeOfDay(replay.at)} · ${onIce} on the ice`;
        else if (!lastPollAt) text = pollError ? 'Could not load this rink yet' : 'Loading…';
        else {
            const age = Math.round((now - lastPollAt) / 1000);
            text = `${rink.name} · ${onIce} on the ice${waiting ? ` (+${waiting} just started)` : ''} · updated ${age} s ago`;
        }
        if (statusEl.textContent !== text) statusEl.textContent = text;
        $('liveBadge').classList.toggle('idle', !onIce);
        if (replay && replay.error) { errorEl.textContent = replay.error; show(errorEl); }
        else if (pollError && !replay) { errorEl.textContent = `${pollError}. Trying again in ${pollSeconds} s.`; show(errorEl); } else hide(errorEl);
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
    // The dots are moved by the page, not put where the model says: a dot never stands still and never jumps. Every rider has a
    // shown position (in laps, going up all the time). It runs at his usual speed, a little faster or slower to close in on the
    // position the model estimates (target = state.progress): a difference, for example when a real lap arrives, is worked away
    // during the coming lap. The speed stays between 40 % and 200 % of the usual one, so the dot cannot stop at the finish line.
    const shown = new Map();
    let shownAt = performance.now();
    function shownFraction(state, dtS) {
        const target = state.progress;
        let entry = shown.get(state.id);
        if (!entry || Math.abs(target - entry.pos) > 1.5) entry = { pos: target };   // new, or far off (a hidden tab): put it in place
        entry.pos = liveShownStep(entry.pos, target, state.paceMs, dtS, marathon ? MARATHON_SHOWN_OPTIONS : {});
        shown.set(state.id, entry);
        return ((entry.pos % 1) + 1) % 1;
    }

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
        ctx.fillText(new Date(clock()).toLocaleTimeString('en-GB'), view.w / 2, view.h / 2);

        hitTargets = [];
        const nowAt = performance.now();
        let dtS = Math.min((nowAt - shownAt) / 1000, 1);
        shownAt = nowAt;
        if (replay) {
            if (replay.playing) dtS *= replay.speed;                 // the dots follow the clock of the replay
            else shown.clear();                                       // paused or moved by hand: the dots are where they are
        }
        const slots = colourSlots();
        const skating = states.filter(s => s.status === 'skating' && s.progress !== null)
            .sort((a, b) => Number(slots.has(a.id)) - Number(slots.has(b.id)));          // the coloured dots on top
        skating.forEach((state, index) => {
            const slot = slots.get(state.id);
            const lane = ((slot ?? index) % LANES) - Math.floor(LANES / 2);
            const p = toPx(pointOnTrack(state.exactFrac !== undefined ? state.exactFrac : shownFraction(state, dtS), lane * LANE_STEP));       // (replay: the real lap time is known)
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
            compare = { label: otherState.label, laps: lapsAt(otherRider.laps, clock()), colour: otherColour };
        }
        const place = marathon && marathonResult ? (marathonResult.rows.find(r => r.id === selectedId) || {}).place : undefined;
        lapGraph.draw({ label: state.label, code: state.chipCode, place, laps: lapsAt(rider.laps, clock()), isPrivate: rider.isPrivate }, {
            trackLengthM: rink.length,
            colour,
            skating: state.status === 'skating',
            nowMs: clock(),
            marks: marathon && marathonResult ? { startMs: marathonResult.startMs, finishMs: marathonResult.finishMs, endMs: Math.max(marathonResult.finishMs, ...marathonResult.rows.map(r => r.endMs)) } : null,
            zoom: !movingStart,                      // while the start is being moved the whole activity is shown
            places: marathon && marathonResult && marathonResult.placesOf ? marathonResult.placesOf(selectedId) : null       // the place in the list of every lap
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
        const title = `${onIce ? `(${onIce}) ` : ''}${MARATHON_PAGE ? 'Marathon' : 'Live'} · ${rink.name} · Icesights`;
        if (document.title !== title) document.title = title;
    }

    let lastSecond = 0;
    let lastFrame = 0;
    function frame(now) {
        if (replay && !replay.loading && replay.playing) {
            replay.at = Math.min(replay.endMs, replay.at + (now - replay.tick) * replay.speed);
            if (replay.at >= replay.endMs) { replay.playing = false; syncReplayBar(); if (recorder) stopExport(); }
            $m('replayTime').value = String(Math.round((replay.at - replay.fromMs) / 1000));
        }
        if (replay) replay.tick = now;
        const second = Math.floor(clock() / (replay ? 250 : 1000));         // a replay redraws four times per second
        if (dirty || second !== lastSecond) { lastSecond = second; dirty = false; renderAll(); }
        else if (now - lastFrame > 100) { lastFrame = now; refreshStates(); drawTrack(); drawLapPanel(); }   // the dots keep moving between the seconds
        requestAnimationFrame(frame);
    }

    // ---------- Start ----------
    renderAll();
    // ?activity=7522190945 opens the replay of that marathon at once (marathon.html, on the rink of the address)
    if (MARATHON_PAGE && /^[0-9]+$/.test(params.get('activity') || '')) {
        showMarathonControls();
        startReplay(params.get('activity'));
    } else poll();
    requestAnimationFrame(frame);

    // for the browser test: a way to see the state
    window.__live = { states: () => states, rink: () => rink, pollNow: poll, requests: () => requestsThisMinute.length, namesPending: () => [...riders.values()].filter(r => !nameOfUser.has(userKey(r.activity))).length, selected: () => selectedId, colours: () => Object.fromEntries(colourSlot), colourTest: () => { for (let id = 1; id <= 11; id++) { colourSlot.delete(id); addColour(id); } }, compared: () => compareId, marathon: () => marathonResult, replay: () => replay, startReplay, lapGraph: () => lapGraph.info(), recording: () => !!recorder, lastExportSize: () => (lastExportBlob ? lastExportBlob.size : null), lastExportType: () => (lastExportBlob ? lastExportBlob.type : null) };
});
