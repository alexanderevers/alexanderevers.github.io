/**
 * Light/dark theme switch. Without a saved choice the OS setting applies (see style.css).
 * Load this in <head> so the saved theme is applied before the first paint.
 */
(function () {
    const STORAGE_KEY = 'theme';

    function savedTheme() {
        try { return localStorage.getItem(STORAGE_KEY); } catch { return null; }
    }

    function currentTheme() {
        return savedTheme() || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    }

    const saved = savedTheme();
    if (saved) document.documentElement.setAttribute('data-theme', saved);

    document.addEventListener('DOMContentLoaded', () => {
        const toggle = document.getElementById('themeToggle');
        if (!toggle) return;
        toggle.checked = currentTheme() === 'dark';
        toggle.addEventListener('change', () => {
            const theme = toggle.checked ? 'dark' : 'light';
            document.documentElement.setAttribute('data-theme', theme);
            try { localStorage.setItem(STORAGE_KEY, theme); } catch { /* storage unavailable */ }
            document.dispatchEvent(new CustomEvent('themechange', { detail: theme }));
        });
    });
})();
