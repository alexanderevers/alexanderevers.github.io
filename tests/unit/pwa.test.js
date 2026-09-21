const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { PROJECT_ROOT, loadBrowserScripts } = require('../helpers/browser-scripts');

const read = file => fs.readFileSync(path.join(PROJECT_ROOT, file), 'utf8');
const manifest = JSON.parse(read('manifest.webmanifest'));
const PAGES = ['index.html', 'replay.html', 'search_user.html', 'live.html'];

/** Width and height of a PNG file, read from its header. */
function pngSize(file) {
    const bytes = fs.readFileSync(path.join(PROJECT_ROOT, file));
    assert.equal(bytes.subarray(1, 4).toString('latin1'), 'PNG', `${file} is not a PNG file`);
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

// The service worker file, run against stand-ins, to read its list of files and cache names
const worker = vm.createContext({
    self: { addEventListener() {}, location: { origin: 'https://example.test' }, skipWaiting() {}, clients: { claim() {} } },
    caches: {}, URL, Request: class {}, Response: class {}, fetch() {}
});
vm.runInContext(read('sw.js'), worker, { filename: 'sw.js' });
const SHELL = vm.runInContext('SHELL', worker);

describe('the web app manifest (what Chrome needs to offer "Install app")', () => {
    it('names the app Icesights and starts in its own window', () => {
        assert.equal(manifest.name, 'Icesights');
        assert.equal(manifest.short_name, 'Icesights');
        assert.equal(manifest.display, 'standalone');
        assert.ok(manifest.short_name.length <= 12, 'the name under the icon must be short');
    });
    it('starts on a page that exists, inside its own scope', () => {
        assert.ok(fs.existsSync(path.join(PROJECT_ROOT, manifest.start_url)), `${manifest.start_url} does not exist`);
        assert.ok(new URL(manifest.start_url, 'https://example.test/').pathname.startsWith(new URL(manifest.scope, 'https://example.test/').pathname));
    });
    it('has colours as hex values', () => {
        assert.match(manifest.theme_color, /^#[0-9a-f]{6}$/i);
        assert.match(manifest.background_color, /^#[0-9a-f]{6}$/i);
    });
    it('has a 192 and a 512 icon for any use and a maskable 512 icon, all real PNG files of that size', () => {
        const find = (size, purpose) => manifest.icons.find(icon => icon.sizes === `${size}x${size}` && icon.purpose === purpose);
        for (const [size, purpose] of [[192, 'any'], [512, 'any'], [512, 'maskable']]) {
            const icon = find(size, purpose);
            assert.ok(icon, `no ${size} icon for ${purpose}`);
            assert.equal(icon.type, 'image/png');
            assert.deepEqual(pngSize(icon.src), { width: size, height: size }, icon.src);
        }
    });
    it('the iOS home screen icon is 180 x 180', () => {
        assert.deepEqual(pngSize('icons/apple-touch-icon.png'), { width: 180, height: 180 });
    });
});

describe('every page is ready to be installed', () => {
    for (const page of PAGES) {
        it(`${page}: links the manifest, the icons and the theme colour, loads pwa.js and is called Icesights`, () => {
            const html = read(page);
            assert.match(html, /<link rel="manifest" href="manifest\.webmanifest">/);
            assert.match(html, /<link rel="apple-touch-icon" href="icons\/apple-touch-icon\.png">/);
            assert.match(html, /<meta name="theme-color" content="#[0-9a-f]{6}"/i);
            assert.match(html, /viewport-fit=cover/);
            assert.match(html, /<script src="pwa\.js"><\/script>/);
            assert.match(html, /<title>[^<]*Icesights[^<]*<\/title>/);
        });
    }
});

describe('the service worker keeps the app shell', () => {
    it('lists only files that exist', () => {
        for (const file of SHELL) {
            if (file === './') continue;
            assert.ok(fs.existsSync(path.join(PROJECT_ROOT, file)), `${file} is in the cache list of sw.js but does not exist`);
        }
    });
    it('lists every script, stylesheet and icon the pages load, so the app opens without a connection', () => {
        const missing = [];
        for (const page of PAGES) {
            const html = read(page);
            const wanted = [...html.matchAll(/(?:src|href)="([^"#?]+)"/g)].map(match => match[1]).filter(file => !/^(https?:)?\/\//.test(file) && !file.endsWith('.html'));
            for (const file of [...wanted, page]) if (!SHELL.includes(file)) missing.push(`${page} needs ${file}`);
        }
        assert.deepEqual(missing, []);
    });
    it('has a version in the names of its caches, so old caches can be removed', () => {
        assert.match(vm.runInContext('SHELL_CACHE', worker), /^icesights-shell-v\d+$/);
        assert.match(vm.runInContext('CDN_CACHE', worker), /^icesights-cdn-v\d+$/);
    });
    it('never stores the data of the MYLAPS proxy (only this site and the Chart.js CDN are handled)', () => {
        const code = read('sw.js');
        assert.ok(!/workers\.dev/.test(code), 'sw.js must not touch the proxy');
        assert.match(code, /cdn\.jsdelivr\.net/);
    });
});

describe('one app per transponder: the manifest made for a transponder', () => {
    const { transponderManifest } = loadBrowserScripts(['pwa.js'], {
        location: { protocol: 'https:', hostname: 'example.test', search: '', href: 'https://example.test/' },
        navigator: {},
        addEventListener() {},                                     // (the sandbox is the window)
        document: { querySelector: () => null, getElementById: () => null, addEventListener() {} }
    }).sandbox;
    const BASE = 'https://alexanderevers.github.io/';
    const made = transponder => JSON.parse(JSON.stringify(transponderManifest(transponder, BASE)));

    it('starts on that transponder, so it is filled in when the app opens', () => {
        const manifest = made('PZ-28583');
        assert.equal(manifest.start_url, 'https://alexanderevers.github.io/index.html?transponder=PZ-28583');
        assert.equal(new URL(manifest.start_url).searchParams.get('transponder'), 'PZ-28583');
    });
    it('has its own identity, so Chrome installs a separate app per transponder', () => {
        const [a, b] = [made('PZ-28583'), made('AB-12345')];
        assert.notEqual(a.id, b.id);
        assert.match(a.id, /PZ-28583$/);
        assert.notEqual(a.id, manifest.id);                       // and it is not the general app
    });
    it('is named after the transponder, with a short name for under the icon', () => {
        const manifest = made('PZ-28583');
        assert.equal(manifest.name, 'Icesights PZ-28583');
        assert.equal(manifest.short_name, 'PZ-28583');
    });
    it('stays inside the site and looks like the general app', () => {
        const general = manifest;
        const own = made('PZ-28583');
        assert.equal(own.scope, BASE);
        assert.ok(own.start_url.startsWith(own.scope));
        for (const key of ['display', 'background_color', 'theme_color', 'orientation']) assert.equal(own[key], general[key], key);
    });
    it('uses the same icons, with full addresses (a manifest made in the browser cannot use short ones)', () => {
        const own = made('PZ-28583');
        assert.deepEqual(own.icons.map(icon => [icon.sizes, icon.purpose]), manifest.icons.map(icon => [icon.sizes, icon.purpose]));
        for (const icon of own.icons) {
            assert.ok(icon.src.startsWith(BASE), icon.src);
            assert.ok(fs.existsSync(path.join(PROJECT_ROOT, icon.src.slice(BASE.length))), `${icon.src} does not exist`);
        }
    });
});
