function isStoredTheme(pref) {
  return pref === 'dark' || pref === 'light';
}

function resolveThemeMode(pref, prefersDark) {
  if (isStoredTheme(pref)) return pref;
  return prefersDark ? 'dark' : 'light';
}

function ensureThemeColorMeta(mode) {
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

(function () {
  try {
    const pref = localStorage.getItem('theme');
    const hasMatchMedia = typeof window !== 'undefined' && 'matchMedia' in window;
    const prefersDark = hasMatchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    const mode = resolveThemeMode(pref, prefersDark);
    document.documentElement.classList.toggle('dark', mode === 'dark');
    document.documentElement.style.colorScheme = mode;
    if (!isStoredTheme(pref)) return;
    ensureThemeColorMeta(mode);
  } catch (err) {
    // Ignore theme bootstrap errors (e.g. blocked storage).
  }
})();
