/**
 * Utility functions for the MYLAPS Activity Viewer.
 */

// --- Cookie Functies ---

function setCookie(name, value, days) {
    let expires = "";
    if (days) {
        const date = new Date();
        date.setTime(date.getTime() + (days * 24 * 60 * 60 * 1000));
        expires = "; expires=" + date.toUTCString();
    }
    document.cookie = name + "=" + (value || "") + expires + "; path=/; SameSite=Lax";
}

function getCookie(name) {
    const nameEQ = name + "=";
    const ca = document.cookie.split(';');
    for (let i = 0; i < ca.length; i++) {
        let c = ca[i];
        while (c.charAt(0) == ' ') c = c.substring(1, c.length);
        if (c.indexOf(nameEQ) == 0) return c.substring(nameEQ.length, c.length);
    }
    return null;
}

// TOEGEVOEGD: De ontbrekende functie om opgeslagen transponders te laden
function loadSavedTransponders(cookieKey, datalistElement) {
    const saved = getCookie(cookieKey);
    const transponders = saved ? saved.split(',') : [];
    datalistElement.innerHTML = '';
    transponders.forEach(transponder => {
        const option = document.createElement('option');
        option.value = transponder;
        datalistElement.appendChild(option);
    });
}

// TOEGEVOEGD: De ontbrekende functie om een transponder op te slaan
function saveTransponder(transponder, cookieKey) {
    const saved = getCookie(cookieKey);
    let transponders = saved ? saved.split(',') : [];
    if (!transponders.includes(transponder)) {
        transponders.push(transponder);
        setCookie(cookieKey, transponders.join(','), 365);
    }
}


// --- DOM & UI Functies ---

function show(element) {
    if (element) element.classList.remove('hidden');
}

function hide(element) {
    if (element) element.classList.add('hidden');
}

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
}


// --- Settings that are remembered between visits ---

const SETTINGS_PREFIX = 'mylaps.';

/** A remembered setting, or `fallback` when there is none (or the browser does not allow storage). */
function loadSetting(name, fallback) {
    try {
        const raw = localStorage.getItem(SETTINGS_PREFIX + name);
        return raw === null ? fallback : JSON.parse(raw);
    } catch {
        return fallback;
    }
}

function saveSetting(name, value) {
    try {
        localStorage.setItem(SETTINGS_PREFIX + name, JSON.stringify(value));
    } catch {
        // storage is not available (private window, blocked site data): the setting is just not remembered
    }
}


// --- Activities per year ---

function activityYear(activity) {
    return new Date(activity.startTime).getFullYear();
}

/** [{ year, count }] for the years that have activities, newest year first. */
function activityYearCounts(activities) {
    const counts = new Map();
    activities.forEach(activity => {
        const year = activityYear(activity);
        counts.set(year, (counts.get(year) || 0) + 1);
    });
    return [...counts].map(([year, count]) => ({ year, count })).sort((a, b) => b.year - a.year);
}

/** The activities of one year, or all of them for year === 'all'. */
function filterActivitiesByYear(activities, year) {
    return year === 'all' ? activities : activities.filter(activity => activityYear(activity) === Number(year));
}


// --- Formatting Functies ---

function formatDateTime(isoString) {
    const date = new Date(isoString);
    const options = {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    };
    const parts = date.toLocaleString('en-GB', options).split(', ');
    return `${parts[0]} - ${parts[1]}`;
}

function formatTime(isoString) {
    if (!isoString) return 'N/A';
    const date = new Date(isoString);
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    const milliseconds = String(date.getMilliseconds()).padStart(3, '0').slice(0, 2);
    return `${hours}:${minutes}:${seconds}.${milliseconds}`;
}

function parseDurationToSeconds(durationString) {
    if (typeof durationString !== 'string') return NaN;
    const parts = durationString.split(':');
    let totalSeconds = 0;
    if (parts.length === 1) {
        totalSeconds = parseFloat(parts[0]);
    } else if (parts.length === 2) {
        totalSeconds = (parseInt(parts[0], 10) * 60) + parseFloat(parts[1]);
    } else {
        return NaN;
    }
    return totalSeconds;
}

function formatSecondsToDuration(totalSeconds) {
    if (isNaN(totalSeconds) || totalSeconds < 0) return '';
    const minutes = Math.floor(totalSeconds / 60);
    const remainingSeconds = totalSeconds % 60;
    const secondsPart = remainingSeconds.toFixed(3);
    const [sec, ms] = secondsPart.split('.');
    const formattedSec = String(sec).padStart(2, '0');
    const formattedMs = ms || '000';
    if (minutes > 0) {
        return `${String(minutes).padStart(1, '0')}:${formattedSec}.${formattedMs}`;
    } else {
        return `${formattedSec}.${formattedMs}`;
    }
}

/** Milliseconds as a short label: "<1 min", "12 min", "1 h 05 min". null -> "N/A". */
function formatDurationShort(ms) {
    if (ms === null || ms === undefined || isNaN(ms)) return 'N/A';
    if (ms <= 0) return '0 min';
    const minutes = Math.round(ms / 60000);
    if (minutes < 1) return '<1 min';
    if (minutes < 60) return `${minutes} min`;
    return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')} min`;
}

/** "HH:MM:SS.ms" or "MM:SS.ms" as seconds; NaN for any other shape. */
function parseTrainingTimeToSeconds(text) {
    if (typeof text !== 'string') return NaN;
    const parts = text.split(':');
    if (parts.length === 3) return (+parts[0]) * 3600 + (+parts[1]) * 60 + parseFloat(parts[2]);
    if (parts.length === 2) return (+parts[0]) * 60 + parseFloat(parts[1]);
    return NaN;
}

function formatTotalTrainingTime(durationString) {
    if (!durationString || typeof durationString !== 'string') return 'N/A';

    // The format can be HH:MM:SS.ms or MM:SS.ms; anything else is returned as is.
    const totalSeconds = parseTrainingTimeToSeconds(durationString);
    if (isNaN(totalSeconds)) return durationString;

    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = Math.floor(totalSeconds % 60);

    const formattedHours = String(hours).padStart(2, '0');
    const formattedMinutes = String(minutes).padStart(2, '0');
    const formattedSeconds = String(seconds).padStart(2, '0');

    return `${formattedHours}:${formattedMinutes}:${formattedSeconds}`;
}

/**
 * A transponder number while it is typed: always XX-12345 (two capital letters, a dash, five digits).
 * Anything else is left out: typed dashes and spaces (the dash is added by itself), digits before the two
 * letters are complete, letters after them, and more than five digits.
 * @param {string} raw
 * @param {{trailingDash?: boolean}} [options] trailingDash: add the dash as soon as the two letters are there
 *        (turned off while deleting, otherwise the dash could never be removed)
 */
function formatTransponderInput(raw, { trailingDash = true } = {}) {
    let letters = '';
    let digits = '';
    for (const character of String(raw ?? '').toUpperCase()) {
        if (letters.length < 2) {
            if (/[A-Z]/.test(character)) letters += character;
        } else if (/[0-9]/.test(character) && digits.length < 5) {
            digits += character;
        }
    }
    const dash = letters.length === 2 && (digits.length > 0 || trailingDash) ? '-' : '';
    return letters + dash + digits;
}

/** A complete transponder number inside pasted text ("Transponder: pz - 28583"), as XX-12345, or null. */
function findTransponderInText(text) {
    const match = /([A-Za-z]{2})[\s-]*(\d{5})/.exec(String(text ?? ''));
    return match ? `${match[1].toUpperCase()}-${match[2]}` : null;
}

function isValidTransponderFormat(transponder) {
    return /^[A-Z]{2}-\d{5}$/.test(transponder);
}