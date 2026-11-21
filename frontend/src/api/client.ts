import type {
  AdminComplaint, AgentCard, AppConfig, AuthResult, ChatReply, ComplaintDetail, Department, DeptTickets,
  Heatmap, PublicOverview, NluMode, Ticket, TicketStatus, TrailEvent, UnifiedStatus, User,
} from './types';

/** Error thrown for any non-2xx answer; `status` is the HTTP status (0 = network failure). */
export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

type Listener = () => void;
const unauthorizedListeners = new Set<Listener>();
/** Called whenever the backend answers 401 (session expired / logged out). */
export function onUnauthorized(fn: Listener) { unauthorizedListeners.add(fn); return () => { unauthorizedListeners.delete(fn); }; }

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch('/api' + path, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? { Accept: 'application/json' } : { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError('Could not reach the server. Is the Concierge running?', 0);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const isAuthCall = path === '/login' || path === '/register';
    if (res.status === 401 && !isAuthCall) unauthorizedListeners.forEach(fn => fn());
    const detail = (data as { detail?: unknown }).detail;
    throw new ApiError(typeof detail === 'string' ? detail : res.statusText || 'Request failed', res.status);
  }
  return data as T;
}

const enc = encodeURIComponent;

export const api = {
  // auth
  me: () => request<User>('GET', '/me'),
  login: (username: string, password: string) => request<AuthResult>('POST', '/login', { username, password }),
  register: (username: string, password: string, display_name?: string) =>
    request<AuthResult>('POST', '/register', { username, password, display_name }),
  logout: () => request<{ ok: boolean }>('POST', '/logout'),

  // citizen
  chat: (message: string, session_id: string, mode?: NluMode) => request<ChatReply>('POST', '/chat', { message, session_id, mode }),
  myComplaints: () => request<UnifiedStatus[]>('GET', '/my-complaints'),
  trail: (cid: string) => request<TrailEvent[]>('GET', `/trail/${enc(cid)}`),
  complaint: (cid: string) => request<ComplaintDetail>('GET', `/complaints/${enc(cid)}`),

  // public (no login)
  publicOverview: () => request<PublicOverview>('GET', '/public/overview'),

  // shared
  config: () => request<AppConfig>('GET', '/config'),
  agents: () => request<AgentCard[]>('GET', '/agents'),
  departments: () => request<Department[]>('GET', '/departments'),
  heatmap: () => request<Heatmap>('GET', '/heatmap'),

  // officers & admin
  deptTickets: (dept: string) => request<DeptTickets>('GET', `/dept/${enc(dept)}/tickets`),
  updateTicket: (dept: string, ticketId: string, status: TicketStatus, note?: string) =>
    request<Ticket>('PATCH', `/dept/${enc(dept)}/tickets/${enc(ticketId)}`, { status, note }),
  allComplaints: () => request<AdminComplaint[]>('GET', '/complaints'),
};
