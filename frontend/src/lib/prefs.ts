import type { NluMode } from '../api/types';

const NLU_KEY = 'nagrik-nlu';

/** The citizen's chosen language engine; null = use the server default from /api/config. */
export function readNlu(): NluMode | null {
  try {
    const v = localStorage.getItem(NLU_KEY);
    return v === 'rules' || v === 'ollama' || v === 'gemini' ? v : null;
  } catch { return null; }
}
export function writeNlu(m: NluMode) {
  try { localStorage.setItem(NLU_KEY, m); } catch { /* private mode: applies to this visit only */ }
}

/** One Concierge conversation per browser tab, so a follow-up answer reaches the same session. */
export function chatSessionId() {
  try {
    let id = sessionStorage.getItem('nagrik-chat');
    if (!id) { id = 's-' + Math.random().toString(36).slice(2, 10); sessionStorage.setItem('nagrik-chat', id); }
    return id;
  } catch { return 's-' + Math.random().toString(36).slice(2, 10); }
}
