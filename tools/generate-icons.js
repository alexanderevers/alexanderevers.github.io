/**
 * Draws the Icesights app icons (icons/*.png) with the headless browser of the tests, so no image tools are needed.
 * The icon is a slanted "i" (ice + insights) with a red slanted dot, on the dark surface of the site.
 *
 *   node tools/generate-icons.js
 *
 * icon-192.png / icon-512.png       rounded square, for "any" use
 * icon-maskable-512.png             full square with the mark inside the safe zone; Android cuts it to its own shape
 * apple-touch-icon.png              180 x 180, full square (iOS rounds it itself)
 */
const fs = require('node:fs');
const path = require('node:path');
const { findBrowser, launchBrowser } = require('../tests/e2e/browser');

const OUT = path.join(__dirname, '..', 'icons');
const ICONS = [
    { file: 'icon-192.png', size: 192, rounded: true, glyph: 0.62 },
    { file: 'icon-512.png', size: 512, rounded: true, glyph: 0.62 },
    { file: 'icon-maskable-512.png', size: 512, rounded: false, glyph: 0.5 },   // inside the 80% safe circle
    { file: 'apple-touch-icon.png', size: 180, rounded: false, glyph: 0.6 }
];

// Runs in the page: draws one icon and returns it as a PNG data URL.
function drawIcon({ size, rounded, glyph }) {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    const BACKGROUND = '#12121a';
    const RED = '#e8281f';

    ctx.fillStyle = BACKGROUND;
    if (rounded) {
        const r = size * 0.22;
        ctx.beginPath();
        ctx.moveTo(r, 0); ctx.arcTo(size, 0, size, size, r); ctx.arcTo(size, size, 0, size, r);
        ctx.arcTo(0, size, 0, 0, r); ctx.arcTo(0, 0, size, 0, r); ctx.closePath();
        ctx.fill();
    } else {
        ctx.fillRect(0, 0, size, size);
    }

    // the "i": a stem and a dot, both leaning to the right like the italic headings of the site
    const height = size * glyph;                     // total height of the glyph
    const stemWidth = height * 0.2;
    const gap = height * 0.09;
    const dotHeight = height * 0.2;
    const stemHeight = height - dotHeight - gap;
    ctx.save();
    ctx.translate(size / 2, size / 2);
    ctx.transform(1, 0, -Math.tan((18 * Math.PI) / 180), 1, 0, 0);
    const top = -height / 2;
    ctx.fillStyle = RED;
    ctx.fillRect(-stemWidth / 2, top, stemWidth, dotHeight);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(-stemWidth / 2, top + dotHeight + gap, stemWidth, stemHeight);
    ctx.restore();
    return canvas.toDataURL('image/png');
}

(async () => {
    const browserPath = findBrowser();
    if (!browserPath) throw new Error('No Chrome, Chromium or Edge found (set CHROME_PATH).');
    fs.mkdirSync(OUT, { recursive: true });
    const page = await launchBrowser(browserPath);
    try {
        for (const icon of ICONS) {
            const dataUrl = await page.evaluate(`(${drawIcon.toString()})(${JSON.stringify(icon)})`);
            fs.writeFileSync(path.join(OUT, icon.file), Buffer.from(dataUrl.split(',')[1], 'base64'));
            console.log(`wrote icons/${icon.file} (${icon.size} x ${icon.size})`);
        }
    } finally {
        await page.close();
    }
    process.exit(0);
})().catch(error => { console.error(error); process.exit(1); });
