/**
 * Geometry of an oblong (speed skating) track for the replay page.
 * Everything is in normalized units where the full lap length is 1:
 * two straights of 0.25 each, joined by two semicircles of 0.25 each.
 * Skaters move counter-clockwise. f = 0 is the finish line: the end of the bottom (home) straight,
 * right before the right-hand corner. A lap is then: corner (0 - 0.25), straight (0.25 - 0.5),
 * corner (0.5 - 0.75), straight (0.75 - 1), i.e. 100 m each on a 400 m track.
 * Screen coordinates: x to the right, y down.
 */

const TRACK_STRAIGHT = 0.25;                    // length of one straight
const TRACK_RADIUS = TRACK_STRAIGHT / Math.PI;   // semicircle length equals a straight

/**
 * @param {number} f       fraction of the lap, any real number (wrapped into [0, 1))
 * @param {number} offset  distance from the centre line, positive = towards the outside
 * @returns {{x: number, y: number, angle: number}} angle is the direction of travel
 */
function pointOnTrack(f, offset = 0) {
    // The path below starts in the middle of the bottom straight; move the start to the end of that straight.
    f = ((((f % 1) + 1) % 1) + 1 / 8) % 1;
    const L = TRACK_STRAIGHT;
    const r = TRACK_RADIUS + offset;

    if (f < 1 / 8) {                      // bottom straight, right half, heading east
        return { x: f, y: TRACK_RADIUS + offset, angle: 0 };
    }
    if (f < 3 / 8) {                      // right curve, bottom -> top
        const theta = Math.PI / 2 - ((f - 1 / 8) / 0.25) * Math.PI;
        return { x: L / 2 + r * Math.cos(theta), y: r * Math.sin(theta), angle: Math.atan2(-Math.cos(theta), Math.sin(theta)) };
    }
    if (f < 5 / 8) {                      // top straight, heading west
        return { x: L / 2 - (f - 3 / 8), y: -(TRACK_RADIUS + offset), angle: Math.PI };
    }
    if (f < 7 / 8) {                      // left curve, top -> bottom
        const theta = -Math.PI / 2 - ((f - 5 / 8) / 0.25) * Math.PI;
        return { x: -L / 2 + r * Math.cos(theta), y: r * Math.sin(theta), angle: Math.atan2(-Math.cos(theta), Math.sin(theta)) };
    }
    return { x: -L / 2 + (f - 7 / 8), y: TRACK_RADIUS + offset, angle: 0 };   // bottom straight, left half
}

/** Bounding box of the centre line, without any margin. */
function trackBounds() {
    return {
        minX: -(TRACK_STRAIGHT / 2 + TRACK_RADIUS),
        maxX: TRACK_STRAIGHT / 2 + TRACK_RADIUS,
        minY: -TRACK_RADIUS,
        maxY: TRACK_RADIUS
    };
}

/** Signed shortest distance a - b along the track, as a fraction in [-0.5, 0.5). */
function trackDelta(a, b) {
    return ((((a - b) % 1) + 1.5) % 1) - 0.5;
}

if (typeof module !== 'undefined') {
    module.exports = { pointOnTrack, trackBounds, trackDelta, TRACK_STRAIGHT, TRACK_RADIUS };
}
