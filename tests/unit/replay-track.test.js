const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadBrowserScripts } = require('../helpers/browser-scripts');

const app = loadBrowserScripts(['replay-track.js']);
const { pointOnTrack, trackBounds, trackDelta } = app.sandbox;
const L2 = app.get('TRACK_STRAIGHT') / 2;      // half a straight
const R = app.get('TRACK_RADIUS');              // radius of the corners
const near = (a, b, tolerance = 1e-9) => Math.abs(a - b) < tolerance;

describe('pointOnTrack: the oblong', () => {
    it('is one lap long (length 1) and has no jumps', () => {
        let length = 0;
        let maxStep = 0;
        let previous = pointOnTrack(0);
        const steps = 20000;
        for (let i = 1; i <= steps; i++) {
            const p = pointOnTrack(i / steps);
            const step = Math.hypot(p.x - previous.x, p.y - previous.y);
            length += step;
            maxStep = Math.max(maxStep, step);
            previous = p;
        }
        assert.ok(near(length, 1, 1e-3), `length ${length}`);
        assert.ok(maxStep < 2e-4, `largest step ${maxStep}`);
    });

    it('starts at the finish: the end of the bottom straight, right before the right-hand corner', () => {
        const p = pointOnTrack(0);
        assert.ok(near(p.x, L2) && near(p.y, R) && near(p.angle, 0), JSON.stringify(p));
    });

    it('is corner, straight, corner, straight of a quarter each', () => {
        const at100 = pointOnTrack(0.25);   // end of the right corner = start of the top straight
        assert.ok(near(at100.x, L2) && near(at100.y, -R) && near(Math.abs(at100.angle), Math.PI));
        const at200 = pointOnTrack(0.5);    // end of the top straight = start of the left corner
        assert.ok(near(at200.x, -L2) && near(at200.y, -R));
        const at300 = pointOnTrack(0.75);   // end of the left corner = start of the bottom straight
        assert.ok(near(at300.x, -L2) && near(at300.y, R) && near(at300.angle, 0));
    });

    it('puts the middle of each part where you expect it', () => {
        assert.ok(near(pointOnTrack(0.125).x, L2 + R) && near(pointOnTrack(0.125).y, 0));   // far right of the right corner
        assert.ok(near(pointOnTrack(0.375).x, 0) && near(pointOnTrack(0.375).y, -R));       // middle of the top straight
        assert.ok(near(pointOnTrack(0.875).x, 0) && near(pointOnTrack(0.875).y, R));        // middle of the bottom straight
    });

    it('wraps around', () => {
        assert.ok(near(pointOnTrack(1.25).x, pointOnTrack(0.25).x));
        assert.ok(near(pointOnTrack(-0.75).x, pointOnTrack(0.25).x));
    });

    it('points in the direction of travel (counter-clockwise on screen)', () => {
        for (let i = 0; i < 400; i++) {
            const f = i / 400;
            const p = pointOnTrack(f);
            const q = pointOnTrack(f + 1e-5);
            const movement = Math.atan2(q.y - p.y, q.x - p.x);
            const difference = Math.atan2(Math.sin(movement - p.angle), Math.cos(movement - p.angle));
            assert.ok(Math.abs(difference) < 1e-2, `at f=${f}`);
        }
    });

    it('a positive offset is towards the outside', () => {
        const centre = { x: L2, y: 0 };   // centre of the right corner
        const distance = p => Math.hypot(p.x - centre.x, p.y - centre.y);
        assert.ok(distance(pointOnTrack(0.125, 0.02)) > distance(pointOnTrack(0.125)));
    });
});

describe('trackBounds', () => {
    it('wraps the centre line', () => {
        const b = trackBounds();
        assert.ok(near(b.maxX - b.minX, 2 * (L2 + R)));
        assert.ok(near(b.maxY - b.minY, 2 * R));
    });
});

describe('trackDelta', () => {
    it('is the signed shortest distance along the track', () => {
        assert.ok(near(trackDelta(0.1, 0.9), 0.2));    // 0.1 is a fifth of a lap ahead of 0.9
        assert.ok(near(trackDelta(0.9, 0.1), -0.2));
        assert.ok(near(trackDelta(0.3, 0.3), 0));
    });
    it('never exceeds half a lap', () => {
        for (let a = 0; a < 1; a += 0.07) {
            for (let b = 0; b < 1; b += 0.11) {
                const d = trackDelta(a, b);
                assert.ok(d >= -0.5 && d < 0.5, `${a} ${b} -> ${d}`);
            }
        }
    });
});
