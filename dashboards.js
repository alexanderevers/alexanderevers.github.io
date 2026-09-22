/**
 * Full-screen dashboards. Every ".dash" section fills the screen and the page snaps from one dashboard to the
 * next (CSS scroll-snap, see style.css): it does not scroll in between, it jumps to the next dashboard.
 * This script adds the numbered navigation on the right. It only lists the dashboards that are on screen
 * (a dashboard that is hidden with the "hidden" class, for example until laps are loaded, is left out).
 *
 *   Dashboards.goTo('dashSession')   scroll to a dashboard (smooth, unless the user prefers reduced motion)
 *   Dashboards.available()           the ids of the dashboards that are on screen, in page order
 *
 * The active dashboard's label (e.g. "04 Records") only shows while the page is actually scrolling or snapping
 * between dashboards, so it does not sit on top of the content while reading; once scrolling settles it slides
 * back out and only the coloured mark next to it stays.
 */
const Dashboards = (() => {
    let nav = null;
    let observer = null;
    let shownKey = '';
    let scheduled = false;
    let scrollIdleTimer = null;

    function markScrolling() {
        if (!nav) return;
        nav.classList.add('is-scrolling');
        clearTimeout(scrollIdleTimer);
        scrollIdleTimer = setTimeout(() => nav.classList.remove('is-scrolling'), 700);
    }

    const isShown = element => element.getClientRects().length > 0;
    const sections = () => [...document.querySelectorAll('.dash')].filter(isShown);
    const reducedMotion = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    function goTo(target) {
        const element = typeof target === 'string' ? document.getElementById(target) : target;
        if (!element || !isShown(element)) return;
        element.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
    }

    function setActive(id) {
        if (!nav) return;
        nav.querySelectorAll('.dash-dot').forEach(dot => dot.classList.toggle('active', dot.dataset.target === id));
    }

    function build() {
        nav = nav || document.getElementById('dashNav');
        if (!nav) return;
        const list = sections();
        const key = list.map(section => section.id).join('|');
        if (key === shownKey) return;                 // nothing came or went: leave the navigation alone
        shownKey = key;

        nav.innerHTML = '';
        list.forEach((section, index) => {
            const dot = document.createElement('button');
            dot.type = 'button';
            dot.className = 'dash-dot';
            dot.dataset.target = section.id;
            const title = section.dataset.title || section.id;
            dot.setAttribute('aria-label', title);
            dot.innerHTML = `<span class="dash-dot-label">${String(index + 1).padStart(2, '0')} <b></b></span><span class="dash-dot-mark"></span>`;
            dot.querySelector('b').textContent = title;
            dot.addEventListener('click', () => goTo(section));
            nav.appendChild(dot);
        });
        nav.classList.toggle('hidden', list.length < 2);   // one dashboard needs no navigation

        if (observer) observer.disconnect();
        observer = new IntersectionObserver(entries => {
            entries.forEach(entry => { if (entry.isIntersecting) setActive(entry.target.id); });
        }, { threshold: 0.55 });
        list.forEach(section => observer.observe(section));
    }

    // Dashboards come and go when the page shows or hides them (class "hidden"): rebuild the navigation then.
    function schedule() {
        if (scheduled) return;
        scheduled = true;
        requestAnimationFrame(() => { scheduled = false; build(); });
    }

    document.addEventListener('DOMContentLoaded', () => {
        build();
        new MutationObserver(schedule).observe(document.body, { attributes: true, attributeFilter: ['class'], subtree: true });
        window.addEventListener('resize', schedule);
        window.addEventListener('scroll', markScrolling, { passive: true });
    });

    return { goTo, available: () => sections().map(section => section.id), refresh: build };
})();
