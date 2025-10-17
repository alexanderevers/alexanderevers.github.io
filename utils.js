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

function formatTotalTrainingTime(durationString) {
    if (!durationString || typeof durationString !== 'string') return 'N/A';

    // The format can be HH:MM:SS.ms or MM:SS.ms
    const parts = durationString.split(':');
    let totalSeconds = 0;

    if (parts.length === 3) { // HH:MM:SS.ms
        totalSeconds = (+parts[0]) * 3600 + (+parts[1]) * 60 + parseFloat(parts[2]);
    } else if (parts.length === 2) { // MM:SS.ms
        totalSeconds = (+parts[0]) * 60 + parseFloat(parts[1]);
    } else {
        // If format is unexpected, return as is.
        return durationString;
    }

    if (isNaN(totalSeconds)) return durationString;

    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = Math.floor(totalSeconds % 60);

    const formattedHours = String(hours).padStart(2, '0');
    const formattedMinutes = String(minutes).padStart(2, '0');
    const formattedSeconds = String(seconds).padStart(2, '0');

    return `${formattedHours}:${formattedMinutes}:${formattedSeconds}`;
}

function isValidTransponderFormat(transponder) {
    return /^[A-Z]{2}-\d{5}$/.test(transponder);
}