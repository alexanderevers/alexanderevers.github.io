/**
 * The manifest of the app for one transponder: the same app, but with its own identity (`id`) and a start address
 * with the transponder in it, so every transponder can be installed as a separate app that opens on its own
 * activities. A manifest made in the browser can only point to files with full addresses.
 * @param {string} transponder  XX-12345
 * @param {string} baseUrl      the folder of the site, ending with "/" (for example https://alexanderevers.github.io/)
 */
function transponderManifest(transponder, baseUrl) {
    return {
        id: `${baseUrl}?transponder=${transponder}`,
        name: `Icesights ${transponder}`,
        short_name: transponder,
        description: `Icesights for transponder ${transponder}: lap times, speed laps, who skated with you, and a race replay.`,
        lang: 'en',
        start_url: `${baseUrl}index.html?transponder=${transponder}`,
        scope: baseUrl,
        display: 'standalone',
        orientation: 'any',
        background_color: '#12121a',
        theme_color: '#12121a',
        icons: [
            { src: `${baseUrl}icons/icon-192.png`, sizes: '192x192', type: 'image/png', purpose: 'any' },
            { src: `${baseUrl}icons/icon-512.png`, sizes: '512x512', type: 'image/png', purpose: 'any' },
            { src: `${baseUrl}icons/icon-maskable-512.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
    };
}

/**
 * Makes the site an installable app (Chrome on Android, desktop Chrome and Edge): registers the service worker,
 * gives every transponder its own app, and shows the "Install" button in the top bar when the browser offers the
 * install. Used by every page. Needs a secure address (https, or localhost); on other addresses it does nothing.
 *
 * One app per transponder: while a transponder is loaded (in the address, or typed in on the main page), the page's
 * manifest is swapped for that transponder's own manifest, and "Install" installs an app that opens on that
 * transponder. Without a transponder it is the general app. The swap is made only after Chrome has made its first
 * offer (or, if it makes none, a few seconds after the page has loaded): Chrome does not offer the install for a
 * manifest that is swapped in earlier, but it offers it again for one swapped in later.
 */
(function () {
    const secure = location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';

    if ('serviceWorker' in navigator && secure) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('sw.js').catch(error => console.warn('The service worker could not be registered:', error));
        });
    }

    const manifestLink = () => document.querySelector('link[rel="manifest"]');
    const generalManifest = manifestLink() ? manifestLink().getAttribute('href') : null;
    const normalize = value => (/^[A-Za-z]{2}-\d{5}$/.test(value || '') ? value.toUpperCase() : null);

    let wantedTransponder = normalize(new URLSearchParams(location.search).get('transponder'));   // what the page is about
    let appliedTransponder = null;                                                                 // what the manifest is about
    let manifestBlobUrl = null;
    let offered = false;                                                                           // Chrome has made its first offer
    let installEvent = null;

    const installButton = () => document.getElementById('installBtn');

    function labelInstallButton() {
        const button = installButton();
        if (!button) return;
        button.textContent = wantedTransponder ? `Install ${wantedTransponder}` : 'Install app';
        button.title = wantedTransponder
            ? `Install Icesights as a separate app that opens on transponder ${wantedTransponder}`
            : 'Install Icesights as an app on this device';
    }

    /** Points the page's manifest at the app of the wanted transponder (or the general app). */
    function applyManifest() {
        const link = manifestLink();
        if (!link || !generalManifest || wantedTransponder === appliedTransponder) return;
        appliedTransponder = wantedTransponder;
        installEvent = null;                                    // an offer for the old manifest is no longer the right one
        if (installButton()) installButton().classList.add('hidden');
        if (manifestBlobUrl) { URL.revokeObjectURL(manifestBlobUrl); manifestBlobUrl = null; }
        if (wantedTransponder) {
            const folder = new URL('./', location.href).href;
            const blob = new Blob([JSON.stringify(transponderManifest(wantedTransponder, folder))], { type: 'application/manifest+json' });
            manifestBlobUrl = URL.createObjectURL(blob);
            link.href = manifestBlobUrl;
        } else {
            link.setAttribute('href', generalManifest);
        }
    }

    /** Tells the page which transponder is loaded (null or an invalid value: none). */
    function useTransponder(value) {
        wantedTransponder = normalize(value);
        labelInstallButton();
        if (offered) applyManifest();
    }
    window.Pwa = { useTransponder, currentTransponder: () => appliedTransponder };

    window.addEventListener('load', () => {
        setTimeout(() => { offered = true; applyManifest(); }, 3000);   // no offer came: still make the manifest the right one
    });

    // Chrome fires this when the app can be installed. Keep the event, show the button, and use the event when it is clicked.
    window.addEventListener('beforeinstallprompt', event => {
        event.preventDefault();
        offered = true;
        if (wantedTransponder !== appliedTransponder) { applyManifest(); return; }   // an offer for the other app; the right one follows
        installEvent = event;
        if (installButton()) installButton().classList.remove('hidden');
    });
    window.addEventListener('appinstalled', () => {
        installEvent = null;
        if (installButton()) installButton().classList.add('hidden');
    });
    document.addEventListener('DOMContentLoaded', () => {
        const button = installButton();
        if (!button) return;
        labelInstallButton();
        if (installEvent) button.classList.remove('hidden');   // the browser was faster than the page
        button.addEventListener('click', async () => {
            if (!installEvent) return;
            const chosen = installEvent;
            installEvent = null;
            button.classList.add('hidden');
            try {
                await chosen.prompt();
            } catch {
                // the prompt can only be used once; the browser offers a new event when it is possible again
            }
        });
    });
})();
