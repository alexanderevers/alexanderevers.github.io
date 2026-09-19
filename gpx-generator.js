/**
 * GPX Generation utility for MYLAPS Activity Viewer.
 * Depends on functions from utils.js
 */

let generatedGpxContent = null;

/**
 * One master track per ice rink: a single lap of the rink, recorded as a GPX file in /tracks. The generator
 * spreads its points over every lap of a session, so Strava shows the session on the real rink.
 * To support another rink: add its GPX file to /tracks and add an entry here.
 *  - locationIds:  MYLAPS location ids of the rink (a rink can have more than one)
 *  - namePattern:  fallback when the id is not listed, matched against the MYLAPS location name
 */
const MASTER_TRACKS = [
    { file: 'tracks/1_jaapeden_amsterdam_master_track.gpx', locationIds: [2040], namePattern: /jaap\s*eden/i },
    { file: 'tracks/2_westfries_hoorn_master_track.gpx', locationIds: [205, 3689], namePattern: /westfries|hoorn/i },
    { file: 'tracks/3_breda_master_track.gpx', locationIds: [3111], namePattern: /breda/i },
    { file: 'tracks/4_ireenwustijsbaan_tilburg_master_track.gpx', locationIds: [2838], namePattern: /tilburg|ireen\s*w/i },
    { file: 'tracks/5_kennemerland_haarlem_master_track.gpx', locationIds: [], namePattern: /haarlem|kennemerland/i }
];

/** The master track entry for an activity's location, or undefined when the rink has no track file yet. */
function findMasterTrack(location) {
    if (!location) return undefined;
    return MASTER_TRACKS.find(track => track.locationIds.includes(location.id))
        || MASTER_TRACKS.find(track => track.namePattern.test(location.name || ''));
}

const masterTrackCache = new Map();

async function getMasterTrack(file) {
    if (masterTrackCache.has(file)) return masterTrackCache.get(file);
    try {
        const response = await fetch(file);
        if (!response.ok) throw new Error(`${file} not found or could not be loaded.`);

        const gpxText = await response.text();

        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(gpxText, "text/xml");

        const points = [];
        const trackpoints = xmlDoc.getElementsByTagName('trkpt');
        if (trackpoints.length === 0) throw new Error('No trackpoints found in the master GPX file.');

        const startTime = new Date(trackpoints[0].getElementsByTagName('time')[0].textContent);
        const endTime = new Date(trackpoints[trackpoints.length - 1].getElementsByTagName('time')[0].textContent);
        const masterDuration = (endTime - startTime) / 1000.0;

        if (masterDuration <= 0) throw new Error('Master track has an invalid duration.');

        for (let i = 0; i < trackpoints.length; i++) {
            const pt = trackpoints[i];
            const time = new Date(pt.getElementsByTagName('time')[0].textContent);
            points.push({
                lat: pt.getAttribute('lat'),
                lon: pt.getAttribute('lon'),
                timeRatio: (time - startTime) / (masterDuration * 1000.0)
            });
        }
        const masterTrack = { points, masterDuration };
        masterTrackCache.set(file, masterTrack);
        return masterTrack;
    } catch (error) {
        console.error("Error loading master track:", error);
        const errorDiv = document.getElementById('error');
        if (errorDiv) {
            errorDiv.textContent = `Could not load ${file}. ` + error.message;
            show(errorDiv);
        }
        return null;
    }
}

function generateGpxString(lapsData, masterTrack, trackName = 'Ice rink') {
    let allTrackpoints = '';
    let lastLapEndTime = null;

    lapsData.forEach(lap => {
        const lapStartTime = new Date(lap.dateTimeStart);
        const lapDurationSeconds = parseDurationToSeconds(lap.duration);

        if (isNaN(lapDurationSeconds)) return;

        masterTrack.points.forEach(point => {
            const timeOffset = lapDurationSeconds * point.timeRatio;
            const pointTime = new Date(lapStartTime.getTime() + timeOffset * 1000);

            if (lastLapEndTime && pointTime <= lastLapEndTime) {
                return;
            }

            allTrackpoints += `
        <trkpt lat="${point.lat}" lon="${point.lon}"><time>${pointTime.toISOString()}</time></trkpt>`;
            lastLapEndTime = pointTime;
        });
    });

    return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="MYLAPS Activity Viewer" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>Training Session</name></metadata>
  <trk><name>${escapeHtml(trackName)}</name><trkseg>${allTrackpoints}
  </trkseg></trk>
</gpx>`;
}

// Bumped whenever the GPX state is reset, so a slow download of an earlier activity cannot show up late.
let gpxRequestCounter = 0;

/**
 * Prepares the GPX download for the laps of one activity. The button only appears when the activity's rink
 * has a master track (see MASTER_TRACKS).
 * @param {object} [location] the activity's MYLAPS location ({ id, name, ... })
 */
async function generateAndPrepareGpxDownload(lapsData, downloadButton, location) {
    if (!lapsData || lapsData.length === 0) return;

    const requestId = ++gpxRequestCounter;
    const trackConfig = findMasterTrack(location);
    if (!trackConfig) {
        hide(downloadButton);
        console.info(`No master track for location "${location && location.name}" (${location && location.id}); GPX download is not available there.`);
        return;
    }

    const masterTrack = await getMasterTrack(trackConfig.file);
    if (requestId !== gpxRequestCounter) return;   // another activity was selected in the meantime
    if (masterTrack) {
        generatedGpxContent = generateGpxString(lapsData, masterTrack, (location && location.name) || undefined);
        show(downloadButton);
    }
}

function handleGpxDownload(filename) {
    if (!generatedGpxContent) return;

    const blob = new Blob([generatedGpxContent], { type: 'application/gpx+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');

    a.href = url;
    // Gebruik de meegegeven bestandsnaam, met een fallback
    a.download = filename || 'training_session.gpx';
    document.body.appendChild(a);
    a.click();

    setTimeout(() => {
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
    }, 0);
}

function resetGpxState(downloadButton) {
    gpxRequestCounter++;
    generatedGpxContent = null;
    hide(downloadButton);
}
