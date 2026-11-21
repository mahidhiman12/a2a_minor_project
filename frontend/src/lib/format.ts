export const titleCase = (s?: string | null) =>
  String(s ?? '').toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

export const initials = (n?: string | null) =>
  (String(n || '?').trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2) || '?').toUpperCase();

export function when(iso?: string | null) {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : d.toLocaleString([], { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export const isToday = (iso?: string | null) => !!iso && new Date(iso).toDateString() === new Date().toDateString();

export const timeNow = (withSeconds = false) =>
  new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', ...(withSeconds ? { second: '2-digit' } : {}) });

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

/** The agents answer with a tiny Markdown subset: **bold** and `code`. Escapes everything else. */
export const miniMarkdown = (s: string) =>
  escapeHtml(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`(.+?)`/g, '<code>$1</code>');
