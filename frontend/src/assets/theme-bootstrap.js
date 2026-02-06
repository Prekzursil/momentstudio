(function () {
  try {
    const pref = localStorage.getItem('theme');
    const hasMatchMedia = typeof window !== 'undefined' && 'matchMedia' in window;
    const prefersDark = hasMatchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    const mode = pref === 'dark' || pref === 'light' ? pref : prefersDark ? 'dark' : 'light';

    document.documentElement.classList.toggle('dark', mode === 'dark');
    document.documentElement.style.colorScheme = mode;

    if (pref === 'dark' || pref === 'light') {
      const color = mode === 'dark' ? '#0f172a' : '#f8fafc';
      const overrideId = 'theme-color-override';
      let meta = document.getElementById(overrideId);
      if (!meta) {
        meta = document.createElement('meta');
        meta.setAttribute('id', overrideId);
        meta.setAttribute('name', 'theme-color');
        document.head.appendChild(meta);
      }
      meta.setAttribute('content', color);
    }
  } catch (err) {
    // Ignore theme bootstrap errors (e.g. blocked storage).
  }
})();

