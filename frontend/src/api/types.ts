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

export interface AuthResult { ok: boolean; user: User; redirect: string }

export type Priority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type TicketStatus = 'OPEN' | 'ASSIGNED' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED';
export const TICKET_STATUSES: TicketStatus[] = ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'];
export const DONE_STATUSES: string[] = ['RESOLVED', 'CLOSED'];

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
  geo?: { name?: string; lat?: number; lng?: number } | null;
}

export interface ComplaintDetail { unified: UnifiedStatus | null; structured: StructuredComplaint | null; live: boolean }

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
}

export interface DeptTickets {
  department: { key: string; name: string; organisation: string };
  tickets: Ticket[];
}

export interface AdminComplaint extends UnifiedStatus { citizen?: string | null }

export interface HeatTicket { department: string; priority: Priority; status: string }
export interface HeatPoint { locality: string; lat: number; lng: number; complaints: number; tickets: HeatTicket[] }
export interface Heatmap { points: HeatPoint[]; unmapped?: number }
