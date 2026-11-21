import { Bot, Building2, Construction, Droplet, Trash2, Zap, type LucideIcon } from 'lucide-react';
import { titleCase } from './format';

/** The only colours in the UI: green done, blue active, orange pending, red error, grey idle. */
export type Tone = 'done' | 'active' | 'pending' | 'error' | 'idle';

const TONES: Record<string, Tone> = {
  // complaint (citizen-facing)
  REGISTERED: 'pending', IN_PROGRESS: 'active', RESOLVED: 'done', NOT_ROUTED: 'error', REJECTED: 'error', TRANSFERRED: 'idle',
  // ticket
  OPEN: 'pending', ASSIGNED: 'active', CLOSED: 'done',
  // A2A task
  submitted: 'pending', working: 'active', 'input-required': 'pending', completed: 'done',
  failed: 'error', canceled: 'error', rejected: 'error',
  // priority
  CRITICAL: 'error',
};

export const toneOf = (value?: string | null): Tone => (value && TONES[value]) || 'idle';

/** "IN_PROGRESS" -> "In progress" (citizen views). Operator views show the raw value in mono. */
export const statusLabel = (value?: string | null) => {
  if (!value) return 'Unknown';
  if (value === 'NOT_ROUTED') return 'Not routed';
  if (value === 'REJECTED') return 'Not accepted';
  const s = String(value).toLowerCase().replace(/[_-]/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
};

/** Complaint progress: Registered -> In progress -> Resolved. */
export function progressIndex(overall?: string | null) {
  return overall === 'RESOLVED' ? 2 : overall === 'IN_PROGRESS' ? 1 : 0;
}

/** Departments are told apart by icon and name, never colour. Unknown keys get a generic icon. */
const ICONS: Record<string, LucideIcon> = { water: Droplet, electricity: Zap, roads: Construction, sanitation: Trash2 };
export const deptIcon = (key?: string | null): LucideIcon => ICONS[String(key || '')] ?? Building2;
export const agentIcon = (key?: string | null): LucideIcon => ICONS[String(key || '')] ?? Bot;

const NAMES: Record<string, string> = { water: 'Water Board', electricity: 'Electricity', roads: 'Municipal Roads', sanitation: 'Sanitation' };
const CODES: Record<string, string> = { water: 'DJB', electricity: 'ELC', roads: 'MCD', sanitation: 'SAN' };
export const deptName = (key?: string | null, fallback?: string | null) => fallback || NAMES[String(key || '')] || titleCase(key);
/** Short everyday name ("Water Board"), falling back to the agent's own name for unknown departments. */
export const shortDept = (key?: string | null, fallback?: string | null) => NAMES[String(key || '')] || fallback || titleCase(key);
export const deptCode = (key?: string | null) => CODES[String(key || '')] || String(key || '').slice(0, 3).toUpperCase();

/** "power_outage" -> the department's own name for it ("Power outage"), else readable text. */
export const issueLabel = (type?: string | null, departments?: { issue_type?: string; issue_name?: string }[]) => {
  const named = departments?.find(d => d.issue_type === type && d.issue_name)?.issue_name;
  if (named) return named;
  const s = String(type || '').replace(/_/g, ' ').toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
};

export const COMPLAINT_ID_RX = /\bCMP-\d{8}-\d{4}\b/i;
export const normaliseId = (raw: string) => {
  const digits = raw.toUpperCase().replace(/[^0-9]/g, '');
  return digits.length === 12 ? `CMP-${digits.slice(0, 8)}-${digits.slice(8)}` : raw.trim().toUpperCase();
};
