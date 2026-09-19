const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadBrowserScripts, hostCopy, PROJECT_ROOT } = require('../helpers/browser-scripts');

const app = loadBrowserScripts(['utils.js', 'gpx-generator.js']);
const { findMasterTrack, generateGpxString } = app.sandbox;
const MASTER_TRACKS = app.get('MASTER_TRACKS');
const TRACKS_DIR = path.join(PROJECT_ROOT, 'tracks');

const EARTH = 6371000;
const rad = degrees => (degrees * Math.PI) / 180;
function distance(a, b) {
    const dLat = rad(b.lat - a.lat);
    const dLon = rad(b.lon - a.lon);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
    return 2 * EARTH * Math.asin(Math.sqrt(h));
}
/** Trackpoints of a GPX file (attribute order in the file does not matter). */
function readPoints(file) {
    const xml = fs.readFileSync(file, 'utf8');
    return [...xml.matchAll(/<trkpt([^>]*)>([\s\S]*?)<\/trkpt>/g)].map(m => ({
        lat: Number(/lat="([^"]+)"/.exec(m[1])[1]),
        lon: Number(/lon="([^"]+)"/.exec(m[1])[1]),
        time: Date.parse((m[2].match(/<time>([^<]+)<\/time>/) || [])[1])
    }));
}

describe('findMasterTrack: which rink gets which track file', () => {
    const fileFor = location => (findMasterTrack(location) || {}).file;

    it('matches by MYLAPS location id', () => {
        assert.match(fileFor({ id: 2040, name: '?' }), /1_jaapeden_amsterdam/);
        assert.match(fileFor({ id: 205, name: '?' }), /2_westfries_hoorn/);
        assert.match(fileFor({ id: 3689, name: '?' }), /2_westfries_hoorn/);   // the second Hoorn location
        assert.match(fileFor({ id: 3111, name: '?' }), /3_breda/);
        assert.match(fileFor({ id: 2838, name: '?' }), /4_ireenwustijsbaan_tilburg/);
        assert.match(fileFor({ id: 2822, name: '?' }), /5_kennemerland_haarlem/);
    });
    it('falls back to the rink name when the id is not known', () => {
        assert.match(fileFor({ id: 1, name: 'Jaap Eden Ijsbaan' }), /1_jaapeden_amsterdam/);
        assert.match(fileFor({ id: 1, name: 'IJsbaan Hoorn X2' }), /2_westfries_hoorn/);
        assert.match(fileFor({ id: 1, name: 'Kunstijsbaan Breda X2' }), /3_breda/);
        assert.match(fileFor({ id: 1, name: 'Ireen Wüst IJsbaan Tilburg' }), /4_ireenwustijsbaan_tilburg/);
        assert.match(fileFor({ id: 1, name: 'Ireen Wust ijsbaan' }), /4_ireenwustijsbaan_tilburg/);
        assert.match(fileFor({ id: 1, name: 'IJsbaan Haarlem Scoreboard' }), /5_kennemerland_haarlem/);
    });
    it('gives nothing for a rink without a track file', () => {
        assert.equal(findMasterTrack({ id: 456, name: 'IJsbaan Twente (Enschede)' }), undefined);
        assert.equal(findMasterTrack({ id: 4677, name: 'IJsclub Baambrugge' }), undefined);
        assert.equal(findMasterTrack(null), undefined);
        assert.equal(findMasterTrack(undefined), undefined);
    });
});

describe('the master track files', () => {
    it('every file in /tracks is registered in MASTER_TRACKS, and every entry has its file', () => {
        const onDisk = fs.readdirSync(TRACKS_DIR).filter(name => name.endsWith('.gpx')).sort();
        const registered = hostCopy(MASTER_TRACKS.map(track => path.basename(track.file))).sort();
        assert.deepEqual(registered, onDisk);
    });

    for (const track of MASTER_TRACKS) {
        describe(path.basename(track.file), () => {
            const points = readPoints(path.join(PROJECT_ROOT, track.file));

            it('is one closed lap of about 400 m', () => {
                let length = 0;
                for (let i = 1; i < points.length; i++) length += distance(points[i - 1], points[i]);
                assert.ok(length > 380 && length < 420, `path length ${length.toFixed(0)} m`);
                assert.ok(distance(points[0], points[points.length - 1]) < 5, 'start and end are far apart');
            });
            it('has timestamps that only go forward, from a start time before the end time', () => {
                assert.ok(points.length >= 20, `only ${points.length} points`);
                for (let i = 1; i < points.length; i++) assert.ok(points[i].time >= points[i - 1].time, `point ${i}`);
                assert.ok(points[points.length - 1].time > points[0].time);
            });
        });
    }
});

describe('generateGpxString', () => {
    // A tiny master track: three points spread over one lap.
    const master = { points: [{ lat: '52.1', lon: '4.1', timeRatio: 0 }, { lat: '52.2', lon: '4.2', timeRatio: 0.5 }, { lat: '52.3', lon: '4.3', timeRatio: 1 }], masterDuration: 60 };
    const start = Date.parse('2026-03-01T10:00:00Z');
    const lapList = [
        { dateTimeStart: new Date(start).toISOString(), duration: '40.000' },
        { dateTimeStart: new Date(start + 40000).toISOString(), duration: '30.000' }
    ];
    const times = gpx => [...gpx.matchAll(/<time>([^<]+)<\/time>/g)].map(m => Date.parse(m[1]));

    it('spreads the master track over every lap and does not repeat the finish line between two laps', () => {
        const gpx = generateGpxString(lapList, master, 'Test rink');
        // Lap 1: 0 s, 20 s, 40 s. Lap 2 starts at 40 s (same moment as the end of lap 1, skipped): 55 s, 70 s.
        assert.deepEqual(times(gpx).map(t => (t - start) / 1000), [0, 20, 40, 55, 70]);
    });
    it('keeps the timestamps strictly increasing', () => {
        const values = times(generateGpxString(lapList, master, 'Test rink'));
        for (let i = 1; i < values.length; i++) assert.ok(values[i] > values[i - 1]);
    });
    it('uses the coordinates of the master track', () => {
        const gpx = generateGpxString(lapList, master, 'Test rink');
        assert.match(gpx, /<trkpt lat="52.1" lon="4.1">/);
        assert.match(gpx, /<trkpt lat="52.3" lon="4.3">/);
    });
    it('skips laps without a usable duration', () => {
        const gpx = generateGpxString([{ dateTimeStart: new Date(start).toISOString(), duration: 'oops' }], master, 'Test rink');
        assert.equal(times(gpx).length, 0);
    });
    it('escapes the rink name in the file', () => {
        assert.match(generateGpxString(lapList, master, 'Ireen <Wüst> & co'), /<name>Ireen &lt;Wüst&gt; &amp; co<\/name>/);
    });
    it('is a GPX 1.1 document', () => {
        const gpx = generateGpxString(lapList, master, 'Test rink');
        assert.match(gpx, /^<\?xml version="1.0"/);
        assert.match(gpx, /<gpx version="1.1"/);
        assert.match(gpx, /<\/gpx>$/);
    });
});
