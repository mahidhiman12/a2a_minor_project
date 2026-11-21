import type {
  AdminComplaint, AdminUser, AgentCard, AppConfig, AuthResult, ChatReply, ComplaintDetail, Department, DeptTicket, DeptTickets,
  Heatmap, Performance, PublicOverview, NluMode, Priority, SlaRow, Ticket, TicketStatus, TrailEvent, UnifiedStatus, User,
} from './types';

/** Error thrown for any non-2xx answer; `status` is the HTTP status (0 = network failure). */
export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

type Listener = () => void;
const unauthorizedListeners = new Set<Listener>();
/** Called whenever the backend answers 401 (session expired / logged out). */
export function onUnauthorized(fn: Listener) { unauthorizedListeners.add(fn); return () => { unauthorizedListeners.delete(fn); }; }

/*
 * Per-tab sign-in. Each tab keeps its own session token in sessionStorage (which belongs to
 * one tab) and sends it as a Bearer header, so a citizen and an officer can be signed in side
 * by side in the same browser. A tab without a token uses the shared cookie, and pins itself
 * to that account on load (see /api/me), so a sign-in in another tab can't take it over.
 */
const TAB_KEY = 'nagrik-tab-session';
/** Sent after "Sign out" in this tab, so the tab stays signed out instead of falling back to
 *  the shared cookie (which may belong to the account signed in in another tab). */
const SIGNED_OUT = 'signed-out';
let tabMemory: string | null = null; // when sessionStorage is unavailable
export const tabSession = {
  signOut() { this.set(SIGNED_OUT); },
  get(): string | null {
    try { return sessionStorage.getItem(TAB_KEY); } catch { return tabMemory; }
  },
  set(token: string | null | undefined) {
    tabMemory = token ?? null;
    try { if (token) sessionStorage.setItem(TAB_KEY, token); else sessionStorage.removeItem(TAB_KEY); } catch { /* memory only */ }
  },
};

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const token = tabSession.get();
  if (token) headers.Authorization = `Bearer ${token}`;
  let res: Response;
  try {
    res = await fetch('/api' + path, {
      method,
      credentials: 'same-origin',
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError('Could not reach the server. Is the Concierge running?', 0);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const isAuthCall = path === '/login' || path === '/register';
    if (res.status === 401 && !isAuthCall) {
      if (token && token !== SIGNED_OUT) tabSession.set(null); // this tab's session expired
      unauthorizedListeners.forEach(fn => fn());
    }
    const detail = (data as { detail?: unknown }).detail;
    throw new ApiError(typeof detail === 'string' ? detail : res.statusText || 'Request failed', res.status);
  }
  return data as T;
}

const enc = encodeURIComponent;

/** Everything an officer can change in one update. */
export interface TicketUpdate {
  status?: TicketStatus;
  note?: string;
  /** The note is a question; the citizen is asked to reply. */
  question?: boolean;
  crew?: string;
  priority?: Priority;
  /** New expected fix time (ISO 8601). Needs a note. */
  eta?: string;
}

export const api = {
  // auth
  me: () => request<User & { token?: string }>('GET', '/me'),
  login: (username: string, password: string) => request<AuthResult>('POST', '/login', { username, password }),
  register: (username: string, password: string, display_name?: string) =>
    request<AuthResult>('POST', '/register', { username, password, display_name }),
  logout: () => request<{ ok: boolean }>('POST', '/logout'),

  // citizen
  chat: (message: string, session_id: string, mode?: NluMode) => request<ChatReply>('POST', '/chat', { message, session_id, mode }),
  /** File the complaint the Concierge just summarised (optionally at the exact map pin), or drop it. */
  confirmComplaint: (session_id: string, action: 'file' | 'cancel', pin?: { lat: number; lng: number } | null) =>
    request<ChatReply>('POST', '/chat/confirm', { session_id, action, ...(pin ?? {}) }),
  myComplaints: () => request<UnifiedStatus[]>('GET', '/my-complaints'),
  trail: (cid: string) => request<TrailEvent[]>('GET', `/trail/${enc(cid)}`),
  complaint: (cid: string) => request<ComplaintDetail>('GET', `/complaints/${enc(cid)}`),
  /** Confirm or reopen a RESOLVED ticket, or reply to an officer's question. Reopen and reply need a note. */
  ticketFeedback: (cid: string, ticketId: string, action: 'confirm' | 'reopen' | 'reply', note?: string) =>
    request<Ticket>('POST', `/complaints/${enc(cid)}/tickets/${enc(ticketId)}/feedback`, { action, note }),

  // public (no login)
  publicOverview: () => request<PublicOverview>('GET', '/public/overview'),

  // shared
  config: () => request<AppConfig>('GET', '/config'),
  agents: () => request<AgentCard[]>('GET', '/agents'),
  departments: () => request<Department[]>('GET', '/departments'),
  heatmap: () => request<Heatmap>('GET', '/heatmap'),

  // officers & admin
  deptTickets: (dept: string) => request<DeptTickets>('GET', `/dept/${enc(dept)}/tickets`),
  deptTicket: (dept: string, ticketId: string) => request<DeptTicket>('GET', `/dept/${enc(dept)}/tickets/${enc(ticketId)}`),
  /** Status, note or question, crew, priority, expected fix time: any combination. */
  updateTicket: (dept: string, ticketId: string, upd: TicketUpdate) =>
    request<Ticket>('PATCH', `/dept/${enc(dept)}/tickets/${enc(ticketId)}`, upd),
  /** "Not ours": the Orchestrator files a ticket with the other department over A2A. */
  transferTicket: (dept: string, ticketId: string, to_department: string, note: string, issue_type?: string) =>
    request<{ ticket: Ticket; new_ticket_id?: string | null; to_department: string }>(
      'POST', `/dept/${enc(dept)}/tickets/${enc(ticketId)}/transfer`, { to_department, note, issue_type }),
  allComplaints: () => request<AdminComplaint[]>('GET', '/complaints'),
  sla: () => request<SlaRow[]>('GET', '/sla'),
  performance: () => request<Performance>('GET', '/admin/performance'),
  users: () => request<AdminUser[]>('GET', '/admin/users'),
  createOfficer: (o: { username: string; display_name: string; department: string; password: string }) =>
    request<AdminUser>('POST', '/admin/users', o),
  /** Switch an account on or off, and/or set a new password for it. */
  updateUser: (id: number, upd: { active?: boolean; password?: string }) => request<AdminUser>('PATCH', `/admin/users/${id}`, upd),

  // everyone
  changePassword: (current: string, next: string) => request<{ ok: boolean }>('POST', '/me/password', { current, new: next }),
};
