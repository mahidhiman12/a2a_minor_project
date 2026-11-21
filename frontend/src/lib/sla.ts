import type { Sla } from '../api/types';
import type { Tone } from './status';

/** 0.4 -> "25 min", 5.2 -> "5 h", 50 -> "2 days". */
export function duration(hours: number) {
  const h = Math.abs(hours);
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min`;
  if (h < 48) return `${Math.round(h)} h`;
  return `${Math.round(h / 24)} days`;
}

/** Badge text and colour for a ticket's deadline, or null when there is nothing to say. */
export function slaBadge(sla?: Sla | null, opts: { showOnTrack?: boolean } = {}): { label: string; tone: Tone } | null {
  if (!sla?.state) return null;
  switch (sla.state) {
    case 'overdue': return { label: `Overdue by ${duration(sla.hours_left ?? 0)}`, tone: 'error' };
    case 'due_soon': return { label: `Due in ${duration(sla.hours_left ?? 0)}`, tone: 'pending' };
    case 'on_track': return opts.showOnTrack ? { label: `Due in ${duration(sla.hours_left ?? 0)}`, tone: 'idle' } : null;
    case 'met': return { label: 'Fixed on time', tone: 'done' };
    case 'missed': return { label: 'Fixed late', tone: 'pending' };
  }
}

/** Most urgent first: overdue, due soon, on track, then fixed. */
export const slaRank = (sla?: Sla | null) =>
  ({ overdue: 0, due_soon: 1, on_track: 2, missed: 3, met: 3 } as Record<string, number>)[sla?.state ?? ''] ?? 2;
