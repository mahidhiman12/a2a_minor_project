// Shapes returned by the Citizen Concierge REST API (agents/concierge/server.py).
export type Role = 'citizen' | 'officer' | 'admin';

export interface User {
  id: number;
  username: string;
  role: Role;
  department: string | null;
  display_name: string;
  home?: string;
}

/** `token` is this tab's own session (per-tab sign-in). */
export interface AuthResult { ok: boolean; user: User; redirect: string; token?: string }

export type Priority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export const PRIORITIES: Priority[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
/** REJECTED: not this department's job (with a reason). TRANSFERRED: handed to another department. */
export type TicketStatus = 'OPEN' | 'ASSIGNED' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED' | 'REJECTED' | 'TRANSFERRED';
export const TICKET_STATUSES: TicketStatus[] = ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'RESOLVED', 'CLOSED', 'REJECTED', 'TRANSFERRED'];
/** No work left on the ticket. */
export const DONE_STATUSES: string[] = ['RESOLVED', 'CLOSED', 'REJECTED', 'TRANSFERRED'];
/** The department fixed it. */
export const FIXED_STATUSES: string[] = ['RESOLVED', 'CLOSED'];

export interface DepartmentStatus {
  department: string;
  department_name?: string;
  agent?: string;
  issue_type?: string;
  issue_name?: string;
  ticket_id?: string;
  ticket_status?: string;
  a2a_task_state?: string;
  priority?: Priority;
  assigned_office?: string;
  crew?: string;
  eta?: string | null;
  a2a_task_id?: string | null;
  duplicate_of?: string | null;
  error?: string | null;
  /** When the department marked it fixed. */
  resolved_at?: string | null;
  /** While RESOLVED: when it closes by itself unless the citizen reopens it. */
  auto_close_at?: string | null;
  /** An officer asked the citizen a question and is waiting for the answer. */
  awaiting_citizen?: boolean;
  /** Set on a ticket that was handed to another department. */
  transferred_to?: string | null;
}

export interface UnifiedStatus {
  complaint_id: string;
  overall_status: string;
  highest_priority?: Priority;
  location?: string;
  summary?: string;
  composite?: boolean;
  departments: DepartmentStatus[];
  coordination_plan?: string[];
  all_subtasks_completed?: boolean;
  overall_eta?: string | null;
  updated_at?: string;
  created_at?: string;
  unroutable_issues?: { issue_type?: string; department?: string; description?: string }[];
}

export interface StructuredComplaint {
  summary?: string;
  location?: string;
  urgency?: string;
  nlu_mode?: string;
  issues?: { issue_type: string; department?: string; description?: string }[];
  /** pinned: the citizen marked the exact spot on the map */
  geo?: { name?: string; lat?: number; lng?: number; pinned?: boolean } | null;
  citizen_text?: string;
}

/** One entry in a ticket's history. `actor` is the officer's name (officer/admin views only). */
export type TicketEventKind = 'created' | 'status' | 'note' | 'linked' | 'confirmed' | 'reopened' | 'auto_closed'
  | 'edited' | 'question' | 'citizen_reply' | 'transferred';
export interface TicketEvent { ts: string; kind: TicketEventKind; status?: string | null; note?: string | null; actor?: string | null }

/** A ticket history entry as the citizen sees it on their complaint (no officer names). */
export interface ComplaintUpdate {
  department: string;
  department_name?: string;
  ticket_id: string;
  ts: string;
  kind: TicketEventKind;
  status?: string | null;
  note?: string | null;
}

export interface ComplaintDetail {
  unified: UnifiedStatus | null;
  structured: StructuredComplaint | null;
  live: boolean;
  updates?: ComplaintUpdate[];
}

export interface PublicOverview {
  agents_online: number;
  departments: { key: string; name?: string; online: boolean; skills: string[] }[];
  recent: { issue: string | null; location?: string; status?: string; departments: string[]; created_at?: string }[];
  hotspots: { locality: string; complaints: number }[];
}

export interface ChatReply {
  reply: string;
  state: string;
  structured?: StructuredComplaint;
  unified?: UnifiedStatus;
}

export type NluMode = 'rules' | 'ollama' | 'gemini';

export interface AppConfig {
  nlu_mode: string;
  ollama_model: string;
  gemini_model: string;
  gemini_key_set: boolean;
  orchestrator: string;
}

export interface Department { key: string; name: string; organisation: string; online: boolean }

export interface AgentSkill { id: string; name?: string; description?: string; tags?: string[] }
export interface AgentCard {
  key: string;
  name: string;
  description?: string;
  url?: string;
  protocolVersion?: string;
  preferredTransport?: string;
  provider?: { organization?: string };
  skills?: AgentSkill[];
  _base: string;
  _offline?: boolean;
  _dashboard?: string;
}

export interface TrailEvent { ts: string; actor: string; event: string; detail: Record<string, any> }

export interface Ticket {
  ticket_id: string;
  issue_name: string;
  description?: string;
  locality?: string;
  crew?: string;
  priority: Priority;
  ticket_status: TicketStatus;
  related_departments?: string[];
  created_at?: string;
  updated_at?: string;
  eta?: string;
  complaint_ref?: string;
  duplicate_of?: string | null;
  resolved_at?: string | null;
  auto_close_at?: string | null;
  sla?: Sla;
  /** An officer asked the citizen something and is waiting for the reply. */
  awaiting_citizen?: boolean;
  /** Statuses an officer may set next (never CLOSED: the citizen or the clock closes it). */
  allowed_next?: TicketStatus[];
}

/** Deadline state: on_track / due_soon / overdue while open; met / missed once fixed. */
export type SlaState = 'on_track' | 'due_soon' | 'overdue' | 'met' | 'missed';
export interface Sla { state: SlaState | null; due_at: string | null; hours_left: number | null }

/** Admin: one department's deadline performance. */
export interface SlaRow {
  key: string;
  name?: string;
  online: boolean;
  open?: number;
  overdue?: number;
  due_soon?: number;
  awaiting_confirmation?: number;
  fixed?: number;
  on_time_pct?: number | null;
}

export interface TicketDetail extends Ticket {
  assigned_office?: string;
  sla_hours?: number | null;
  notes?: string | null;
  events: TicketEvent[];
  duplicates: { ticket_id: string; locality?: string; created_at?: string; complaint_ref?: string | null }[];
}

/** The complaint a ticket came from, with every department's ticket on it. */
export interface TicketComplaint {
  complaint_id: string;
  summary?: string;
  location?: string;
  urgency?: string;
  geo?: { name?: string; lat?: number; lng?: number; pinned?: boolean } | null;
  /** What the citizen wrote, in their own words */
  citizen_text?: string;
  created_at?: string;
  overall_status?: string;
  issues: { issue_type: string; department?: string; description?: string }[];
  coordination_plan: string[];
  departments: DepartmentStatus[];
}

export interface DeptTicket {
  department: { key: string; name: string; organisation: string };
  ticket: TicketDetail;
  complaint: TicketComplaint | null;
}

export interface DeptTickets {
  department: { key: string; name: string; organisation: string };
  tickets: Ticket[];
}

export interface AdminComplaint extends UnifiedStatus { citizen?: string | null }

export interface HeatTicket { department: string; priority: Priority; status: string }
export interface HeatPoint { locality: string; lat: number; lng: number; complaints: number; tickets: HeatTicket[] }
export interface Heatmap { points: HeatPoint[]; unmapped?: number }

/** Admin: one account (never includes the password). */
export interface AdminUser extends User { active: boolean; created_at?: string }

export interface OfficerStats {
  name: string;
  department: string;
  username?: string | null;
  active?: boolean | null;
  updates: number;
  resolved: number;
  rejected: number;
  transferred: number;
  questions: number;
  last_active?: string | null;
}

export interface DeptPerformance {
  key: string;
  name?: string;
  online: boolean;
  tickets?: number;
  by_status?: Record<string, number>;
  open?: number;
  overdue?: number;
  due_soon?: number;
  fixed?: number;
  on_time_pct?: number | null;
  avg_fix_hours?: number | null;
  reopened?: number;
  reopen_pct?: number | null;
  confirmed?: number;
  auto_closed?: number;
  awaiting_citizen?: number;
}

export interface Performance {
  departments: DeptPerformance[];
  officers: OfficerStats[];
  complaints: { total: number; by_status: Record<string, number>; multi_department: number };
}
