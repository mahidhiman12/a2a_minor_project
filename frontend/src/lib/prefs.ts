import { useEffect, useState } from 'react';
import type { NluMode } from '../api/types';
import { useAuth } from '../auth';

const NLU_KEY = 'nagrik-nlu';
const TECH_KEY = 'nagrik-tech';

/**
 * "Show technical details": the agent graph, audit trail, JSON-RPC inspector and language-engine
 * choice. Off by default for citizens, who see plain language. Officers and admins always see them.
 */
let techMemory: boolean | null = null; // used when localStorage is unavailable
const techListeners = new Set<() => void>();
function readTech(): boolean {
  try { return localStorage.getItem(TECH_KEY) === '1'; } catch { return techMemory ?? false; }
}
export function writeTech(on: boolean) {
  techMemory = on;
  try { localStorage.setItem(TECH_KEY, on ? '1' : '0'); } catch { /* private mode: this visit only */ }
  techListeners.forEach(fn => fn());
}
/** The citizen's own preference (Settings toggle). */
export function useTechPref(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(readTech);
  useEffect(() => {
    const fn = () => setOn(readTech());
    techListeners.add(fn);
    return () => { techListeners.delete(fn); };
  }, []);
  return [on, writeTech];
}
/** Whether the current user should see technical details. */
export function useTechView(): boolean {
  const { user } = useAuth();
  const [pref] = useTechPref();
  return !!user && (user.role !== 'citizen' || pref);
}

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
