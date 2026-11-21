import type { TrailEvent, UnifiedStatus } from '../api/types';
import { shortDept } from './status';

/** The Orchestrator's LangGraph run, as recorded in its audit trail. */
export const STEPS = [
  { key: 'discover', label: 'Discover', long: 'Discovered agents' },
  { key: 'decompose', label: 'Decompose', long: 'Split into tasks' },
  { key: 'dispatch', label: 'Dispatch', long: 'Dispatched' },
  { key: 'track', label: 'Track', long: 'Tracked tasks' },
  { key: 'aggregate', label: 'Aggregate', long: 'Combined status' },
] as const;
export type StepKey = typeof STEPS[number]['key'];
export type StepState = 'done' | 'now' | 'pending' | 'fail';
export type NodeState = 'done' | 'active' | 'idle' | 'error' | 'waiting';

export interface StepView { key: StepKey; label: string; long: string; state: StepState; at?: number; detail?: string }
export interface DeptNode { key: string; name: string; state: NodeState; sub: string; edge: 'done' | 'live' | 'idle' | 'fail' }
export interface RunView {
  steps: StepView[];
  concierge: NodeState;
  orchestrator: NodeState;
  depts: DeptNode[];
  orchSub: string;
  liveEdge: 'concierge' | 'orchestrator' | null;
}

const ms = (e: TrailEvent, t0: number) => new Date(e.ts).getTime() - t0;

/** Events of the original run (up to the first `aggregated`); later status refreshes come after. */
export function splitRun(events: TrailEvent[]) {
  const end = events.findIndex(e => e.event === 'aggregated');
  return end < 0 ? { run: events, later: [] as TrailEvent[] } : { run: events.slice(0, end + 1), later: events.slice(end + 1) };
}

/**
 * Node and step states after the first `upto` events of a run (for replay), or all of them.
 * Department nodes come from the unified status; their agent URLs and names are matched
 * against the `agents_discovered` event so JSON-RPC traffic can be attributed to them.
 */
export function buildRun(events: TrailEvent[], unified: UnifiedStatus | null, upto = events.length): RunView {
  const ev = events.slice(0, upto);
  const t0 = events.length ? new Date(events[0].ts).getTime() : 0;
  const has = (name: string) => ev.find(e => e.event === name);
  const deps = unified?.departments ?? [];
  const nameToKey = new Map<string, string>();
  deps.forEach(d => { if (d.agent) nameToKey.set(d.agent, d.department); });
  const urlToKey = new Map<string, string>();
  const disc = events.find(e => e.event === 'agents_discovered');
  for (const a of (disc?.detail.agents ?? []) as { name?: string; url?: string }[]) {
    const k = a.name && nameToKey.get(a.name);
    if (k && a.url) urlToKey.set(a.url.replace(/\/$/, ''), k);
  }
  const keyOf = (e: TrailEvent) => {
    if (nameToKey.has(e.actor)) return nameToKey.get(e.actor);
    const url = String(e.event === 'jsonrpc_request' ? e.detail.to : e.actor || '').replace(/\/$/, '');
    return urlToKey.get(url);
  };

  const discovered = has('agents_discovered');
  const decomposed = has('decomposed');
  const sends = ev.filter(e => e.event === 'jsonrpc_request' && e.detail.method === 'message/send');
  const gets = ev.filter(e => e.event === 'jsonrpc_request' && e.detail.method === 'tasks/get');
  const failed = ev.find(e => e.event === 'dispatch_failed' || e.event === 'task_timeout');
  const aggregated = has('aggregated');
  const nSub = (decomposed?.detail.subtasks as unknown[] | undefined)?.length ?? deps.length;

  const stepAt = (e?: TrailEvent) => (e ? ms(e, t0) : undefined);
  const steps: StepView[] = STEPS.map(s => ({ ...s, state: 'pending' as StepState }));
  const mark = (i: number, state: StepState, e?: TrailEvent, detail?: string) => { steps[i] = { ...steps[i], state, at: stepAt(e), detail }; };
  if (discovered) mark(0, 'done', discovered, `${(discovered.detail.agents as unknown[] | undefined)?.length ?? 0} Agent Cards read`);
  else if (ev.length) mark(0, 'now');
  if (decomposed) mark(1, 'done', decomposed, `${nSub} task${nSub === 1 ? '' : 's'}`);
  else if (discovered) mark(1, 'now');
  if (decomposed) {
    if (sends.length >= nSub || gets.length || aggregated) mark(2, failed && !aggregated ? 'fail' : 'done', sends[sends.length - 1] ?? decomposed, `message/send × ${sends.length}`);
    else mark(2, 'now', sends[0], sends.length ? `message/send × ${sends.length}` : undefined);
  }
  if (steps[2].state === 'done' || steps[2].state === 'fail') {
    if (aggregated) mark(3, 'done', ev.filter(e => e.event.startsWith('task_')).pop() ?? aggregated, `tasks/get × ${gets.length}`);
    else mark(3, 'now', gets[gets.length - 1], `tasks/get × ${gets.length}`);
  }
  if (aggregated) mark(4, 'done', aggregated, String(aggregated.detail.overall_status ?? '').toLowerCase().replace('_', ' '));

  // departments
  const dnodes: DeptNode[] = deps.map(d => {
    const mine = ev.filter(e => keyOf(e) === d.department);
    const last = [...mine].reverse().find(e => e.event.startsWith('task_') || e.event === 'dispatch_failed' || e.event === 'task_timeout');
    const reached = mine.length > 0;
    let state: NodeState = reached ? 'active' : 'waiting';
    let edge: DeptNode['edge'] = reached ? 'live' : 'idle';
    let sub = reached ? 'working' : 'waiting';
    if (last) {
      const st = last.event === 'dispatch_failed' || last.event === 'task_timeout' ? 'failed' : last.event.slice(5);
      if (st === 'completed') { state = 'done'; edge = 'done'; sub = d.ticket_id || 'completed'; }
      else if (['failed', 'rejected', 'canceled'].includes(st)) { state = 'error'; edge = 'fail'; sub = st; }
      else sub = st;
    }
    if (aggregated && state === 'active') { state = 'done'; edge = 'done'; }
    return { key: d.department, name: shortDept(d.department, d.department_name || d.agent), state, sub, edge };
  });

  const orchestrator: NodeState = aggregated ? 'done' : ev.length ? 'active' : 'waiting';
  const orchSub = aggregated ? `${deps.length} ticket${deps.length === 1 ? '' : 's'} combined`
    : steps.find(s => s.state === 'now')?.long.toLowerCase() ?? 'starting';
  const liveEdge = !ev.length ? 'concierge' : !aggregated && !sends.length ? 'orchestrator' : null;
  return { steps, concierge: 'done', orchestrator, depts: dnodes, orchSub, liveEdge };
}

/** Human description of one trail event for the audit list. */
export function describeEvent(e: TrailEvent, names: Map<string, string>) {
  const who = (s: string) => names.get(String(s).replace(/\/$/, '')) || String(s).replace(/^https?:\/\//, '');
  switch (e.event) {
    case 'complaint_received': return { who: 'Orchestrator', what: 'complaint received', state: '' };
    case 'agents_discovered': return { who: 'Orchestrator', what: 'agents discovered', state: '' };
    case 'decomposed': return { who: 'Orchestrator', what: 'decomposed', state: '' };
    case 'jsonrpc_request': return { who: `Orchestrator → ${who(e.detail.to)}`, what: String(e.detail.method), state: '' };
    case 'jsonrpc_response': return { who: `${who(e.actor)} → Orchestrator`, what: 'response', state: String(e.detail.state || '') };
    case 'aggregated': return { who: 'Orchestrator', what: 'aggregated', state: String(e.detail.overall_status || '') };
    case 'status_refreshed': return { who: 'Orchestrator', what: 'status refreshed', state: String(e.detail.overall_status || '') };
    default:
      if (e.event.startsWith('task_')) return { who: e.actor, what: 'task state', state: e.event.slice(5) };
      return { who: who(e.actor), what: e.event.replace(/_/g, ' '), state: '' };
  }
}

/** url -> agent name, from the run's discovery event. */
export function agentNames(events: TrailEvent[]) {
  const m = new Map<string, string>();
  const disc = events.find(e => e.event === 'agents_discovered');
  for (const a of (disc?.detail.agents ?? []) as { name?: string; url?: string }[]) if (a.url && a.name) m.set(a.url.replace(/\/$/, ''), a.name);
  return m;
}

export const offset = (e: TrailEvent, t0: number) => `+${(ms(e, t0) / 1000).toFixed(2)}s`;
export const secs = (n?: number) => (n === undefined ? '—' : `${(n / 1000).toFixed(2)}s`);
