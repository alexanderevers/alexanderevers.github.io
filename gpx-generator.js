/**
 * GPX Generation utility for MYLAPS Activity Viewer.
 * Depends on functions from utils.js
 */

let generatedGpxContent = null;

async function getMasterTrack() {
    try {
        const response = await fetch('tracks/1_jaapeden_master_track.gpx');
        if (!response.ok) throw new Error('tracks/1_jaapeden_master_track.gpx not found or could not be loaded.');
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
        return {
            points,
            masterDuration
        };
    } catch (error) {
        console.error("Error loading master track:", error);
        const errorDiv = document.getElementById('error');
        if (errorDiv) {
            errorDiv.textContent = "Could not load tracks/1_jaapeden_master_track.gpx. " + error.message;
            show(errorDiv);
        }
        return null;
    }
}

function generateGpxString(lapsData, masterTrack) {
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
  <trk><name>Jaap Edenbaan</name><trkseg>${allTrackpoints}
  </trkseg></trk>
</gpx>`;
}

async function generateAndPrepareGpxDownload(lapsData, downloadButton) {
    if (!lapsData || lapsData.length === 0) return;
    const masterTrack = await getMasterTrack();
    if (masterTrack) {
        generatedGpxContent = generateGpxString(lapsData, masterTrack);
        show(downloadButton);
    }
}

function handleGpxDownload() {
    if (!generatedGpxContent) return;
    const blob = new Blob([generatedGpxContent], {
        type: 'application/gpx+xml'
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'training_session.gpx';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
    }, 0);
}

function resetGpxState(downloadButton) {
    generatedGpxContent = null;
    hide(downloadButton);
}