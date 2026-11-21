export type Theme = 'system' | 'light' | 'dark';
const KEY = 'nagrik-theme';

export function readTheme(): Theme {
  try {
    const t = localStorage.getItem(KEY);
    return t === 'light' || t === 'dark' ? t : 'system';
  } catch { return 'system'; }
}

export function setTheme(t: Theme) {
  try { localStorage.setItem(KEY, t); } catch { /* private mode: still apply for this visit */ }
  if (t === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
}
