import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Clock, FileQuestion, Lock, MapPin, Pause, Play, RefreshCw, TriangleAlert } from 'lucide-react';
import { api, ApiError } from '../api/client';
import type { ComplaintUpdate, DepartmentStatus, TrailEvent } from '../api/types';
import { useAuth } from '../auth';
import { AppShell } from '../components/AppShell';
import { firstIssue, isOverdue, Progress, TicketBlock } from '../components/Complaint';
import { Drawer, useToast } from '../components/Overlays';
import { Empty, IdChip, PriorityTag, Segmented, Skeleton, Status } from '../components/ui';
import { Timeline, WorkflowGraph } from '../components/Workflow';
import { when } from '../lib/format';
import { useAsync, useInterval } from '../lib/hooks';
import { useTechView } from '../lib/prefs';
import { issueLabel, shortDept, statusLabel, toneOf } from '../lib/status';
import { agentNames, buildRun, describeEvent, offset, splitRun, type StepKey } from '../lib/trail';

type Tab = 'overview' | 'execution' | 'trail';

export default function ComplaintDetail() {
  const { id = '' } = useParams();
  const cid = id.toUpperCase();
  const { user } = useAuth();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const tab = (['overview', 'execution', 'trail'].includes(params.get('tab') || '') ? params.get('tab') : 'overview') as Tab;
  const setTab = (t: Tab) => setParams(t === 'overview' ? {} : { tab: t }, { replace: true });
  // Citizens get one plain view; the agent views appear once they ask for them (or always,
  // with "Show technical details" on in Settings, and for admins).
  const tech = useTechView();
  const showTabs = tech || tab !== 'overview';
  const { data, error, loading, reload } = useAsync(() => Promise.all([api.complaint(cid), api.trail(cid)]), [cid]);
  const [detail, events] = data ?? [null, null];
  const u = detail?.unified ?? null;
  const done = u?.overall_status === 'RESOLVED';
  useInterval(() => { if (!done) reload(true); }, 15000);
  const back = user?.role === 'admin' ? { label: 'Overview', to: '/admin' } : { label: 'My complaints', to: '/complaints' };

  if (error) {
    const st = error instanceof ApiError ? error.status : 0;
    return (
      <AppShell crumbs={[back, { label: cid }]}>
        {st === 403 ? <Empty icon={Lock} title="This complaint isn’t yours" action={<Link className="ns-btn ns-btn-secondary ns-btn-sm" to={back.to}>Back to {back.label.toLowerCase()}</Link>}>You can only open complaints filed from your account.</Empty>
          : st === 404 ? <Empty icon={FileQuestion} title={`No complaint ${cid}`} action={<Link className="ns-btn ns-btn-secondary ns-btn-sm" to={back.to}>Back</Link>}>Check the ID and try again.</Empty>
          : <Empty icon={TriangleAlert} title="Couldn’t load this complaint" action={<button className="ns-btn ns-btn-secondary ns-btn-sm" onClick={() => reload()}>Try again</button>}>{error.message}</Empty>}
      </AppShell>
    );
  }

  return (
    <AppShell crumbs={[back, { label: cid }]} wide={tab !== 'overview'}
      actions={<button className="icon-btn" type="button" aria-label="Refresh status" title="Refresh status" onClick={() => reload(true).then(() => toast('Status refreshed', tech ? 'Checked every department over A2A.' : 'Checked with every department.', 'ok'))}><RefreshCw /></button>}>
      <header className="cd-head">
        <span className="ns-caption"><IdChip id={cid} />{u?.location && ` · ${u.location}`}</span>
        {loading && !data ? <Skeleton h={34} w="60%" style={{ marginTop: 10 }} />
          : <h1>{u?.summary || (u && firstIssue(u)) || 'Complaint'}</h1>}
        {u && (
          <div className="cd-meta">
            <Status value={u.overall_status} live={!done} />
            <PriorityTag priority={u.highest_priority} />
            {u.overall_eta && <span style={isOverdue(u) ? { color: 'var(--red-ink)' } : undefined}><Clock aria-hidden="true" />{isOverdue(u) ? 'Overdue, was due' : 'Expected by'} {when(u.overall_eta)}</span>}
            {u.location && <span><MapPin aria-hidden="true" />{u.location}</span>}
            <span>{u.departments.length} department{u.departments.length === 1 ? '' : 's'}</span>
            {detail && !detail.live && <span title="A department didn't answer just now, so this is the last status we received">Last known status</span>}
          </div>
        )}
        {showTabs && <div style={{ marginTop: 28 }}>
          <Segmented label="Complaint views" value={tab} onChange={setTab} options={[
            { value: 'overview', label: 'Overview' }, { value: 'execution', label: 'Agent execution' }, { value: 'trail', label: 'Audit trail' }]} />
        </div>}
      </header>

      {loading && !data ? <div className="section"><Skeleton h={120} /><Skeleton h={180} style={{ marginTop: 16 }} /></div>
        : !u || !events ? null
        : tab === 'overview' ? <Overview u={u} structured={detail?.structured} events={events} updates={detail?.updates ?? []} tech={tech} canAnswer={user?.role === 'citizen'} onChanged={() => reload(true)} onRun={() => setTab('execution')} />
        : tab === 'execution' ? <Execution u={u} events={events} conciergeSub={(detail?.structured?.issues?.length ?? u.departments.length) + ' issues found'} />
        : <Trail events={events} />}
    </AppShell>
  );
}

/** "Is it fixed?" for one department's RESOLVED ticket: confirm closes it, reopen sends it back. */
/** A department asked the citizen something; the answer goes back onto its ticket. */
function ReplyBox({ cid, d, question, onDone }: { cid: string; d: DepartmentStatus; question?: string | null; onDone: () => void }) {
  const toast = useToast();
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const name = shortDept(d.department, d.department_name);
  async function send() {
    if (!note.trim()) { setErr('Write your answer.'); return; }
    setBusy(true); setErr('');
    try {
      await api.ticketFeedback(cid, d.ticket_id!, 'reply', note.trim());
      toast('Reply sent', `${name} can see your answer.`, 'ok');
      setNote('');
      onDone();
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 401)) setErr((e as Error).message);
    } finally { setBusy(false); }
  }
  return (
    <div className="fixcheck" role="group" aria-label={`${name} has a question for you`}>
      <b>{name} has a question for you</b>
      {question && <p style={{ margin: '6px 0 0', fontSize: 15, whiteSpace: 'pre-wrap' }}>“{question}”</p>}
      <textarea rows={3} value={note} onChange={e => { setNote(e.target.value); setErr(''); }} aria-label="Your answer" aria-invalid={!!err} placeholder="Your answer" />
      {err && <p className="ns-help is-error" role="alert">{err}</p>}
      <div className="row" style={{ gap: 8, marginTop: 10 }}>
        <button className="ns-btn ns-btn-primary ns-btn-sm" type="button" disabled={busy} onClick={send}>Send reply</button>
      </div>
    </div>
  );
}

function FixCheck({ cid, d, onDone }: { cid: string; d: DepartmentStatus; onDone: () => void }) {
  const toast = useToast();
  const [reopening, setReopening] = useState(false);
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const name = shortDept(d.department, d.department_name);
  async function send(action: 'confirm' | 'reopen') {
    if (action === 'reopen' && !note.trim()) { setErr('Tell them what’s still wrong.'); return; }
    setBusy(true); setErr('');
    try {
      await api.ticketFeedback(cid, d.ticket_id!, action, action === 'reopen' ? note.trim() : undefined);
      toast(action === 'confirm' ? 'Thanks for confirming' : 'Sent back to the department',
        action === 'confirm' ? `${name}’s ticket is now closed.` : `${name} will look at it again.`, 'ok');
      onDone();
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 401)) setErr((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <div className="fixcheck" role="group" aria-label={`Is ${name}'s fix working?`}>
      <b>{name} says this is fixed. Is it?</b>
      <p className="ns-footnote">{d.auto_close_at ? `If we don’t hear from you, it closes by itself ${when(d.auto_close_at)}.` : 'Let them know if the problem is still there.'}</p>
      {reopening ? <>
        <textarea rows={3} value={note} autoFocus onChange={e => { setNote(e.target.value); setErr(''); }} aria-label="What is still wrong?"
          aria-invalid={!!err} placeholder="What’s still wrong? e.g. Water is still leaking near the gate." />
        {err && <p className="ns-help is-error" role="alert">{err}</p>}
        <div className="row" style={{ gap: 8, marginTop: 10 }}>
          <button className="ns-btn ns-btn-primary ns-btn-sm" type="button" disabled={busy} onClick={() => send('reopen')}>Send back to {name}</button>
          <button className="ns-btn ns-btn-plain ns-btn-sm" type="button" disabled={busy} onClick={() => { setReopening(false); setErr(''); }}>Cancel</button>
        </div>
      </> : <>
        {err && <p className="ns-help is-error" role="alert">{err}</p>}
        <div className="row" style={{ gap: 8, marginTop: 10 }}>
          <button className="ns-btn ns-btn-primary ns-btn-sm" type="button" disabled={busy} onClick={() => send('confirm')}>Yes, it’s fixed</button>
          <button className="ns-btn ns-btn-secondary ns-btn-sm" type="button" disabled={busy} onClick={() => setReopening(true)}>No, still a problem</button>
        </div>
      </>}
    </div>
  );
}

function Overview({ u, structured, events, updates, tech, canAnswer, onChanged, onRun }: { u: NonNullable<Awaited<ReturnType<typeof api.complaint>>['unified']>; structured?: Awaited<ReturnType<typeof api.complaint>>['structured']; events: TrailEvent[]; updates: ComplaintUpdate[]; tech: boolean; canAnswer: boolean; onChanged: () => void; onRun: () => void }) {
  const run = useMemo(() => buildRun(splitRun(events).run, u), [events, u]);
  const issues = structured?.issues ?? [];
  return (
    <div className="fade-in">
      <Progress overall={u.overall_status} />
      <div className="two-col section">
        <section>
          <div className="section-h"><h2>Departments</h2><span className="x">{u.all_subtasks_completed ? 'All departments have responded' : 'Waiting to hear from some departments'}</span></div>
          {u.departments.length ? u.departments.map(d => (
            <Fragment key={d.department + (d.ticket_id || '')}>
              <TicketBlock d={d} />
              {canAnswer && d.awaiting_citizen && d.ticket_id && <ReplyBox cid={u.complaint_id} d={d} onDone={onChanged}
                question={[...updates].reverse().find(e => e.ticket_id === d.ticket_id && e.kind === 'question')?.note} />}
              {canAnswer && d.ticket_status === 'RESOLVED' && d.ticket_id && <FixCheck cid={u.complaint_id} d={d} onDone={onChanged} />}
            </Fragment>))
            : <Empty icon={FileQuestion} title="No department took this complaint">We couldn’t match it to a department that handles this kind of problem.</Empty>}
          {!!u.unroutable_issues?.length && <p className="ns-footnote" style={{ marginTop: 12 }}><Status tone="pending">Not routed</Status> {u.unroutable_issues.map(x => issueLabel(x.issue_type)).join(', ')}: no department here handles this yet.</p>}
          {!!u.coordination_plan?.length && <>
            <div className="section-h" style={{ marginTop: 36 }}><h2>{tech ? 'Plan' : 'What happens next'}</h2></div>
            <ol className="plan">{u.coordination_plan.map((l, i) => <li key={i}>{l.replace(/^Step \d+:\s*/, '')}</li>)}</ol>
          </>}
        </section>
        <section>
          <div className="section-h"><h2>{tech ? 'What the Concierge understood' : 'Your report'}</h2></div>
          <dl className="kvlist">
            <dt>Place</dt><dd>{structured?.location || u.location || '—'}</dd>
            <dt>{issues.length > 1 ? 'Problems' : 'Problem'}</dt><dd>{issues.length
              ? issues.map(i => tech
                ? <div key={i.issue_type} className="mono" style={{ fontSize: 12 }}>{i.issue_type}</div>
                : <div key={i.issue_type}>{issueLabel(i.issue_type, u.departments)}</div>)
              : (firstIssue(u) || '—')}</dd>
            <dt>Urgency</dt><dd>{structured?.urgency ? statusLabel(structured.urgency) : '—'}</dd>
            {tech && <><dt>Engine</dt><dd>{structured?.nlu_mode ? statusLabel(structured.nlu_mode) : '—'}</dd></>}
            {u.created_at && <><dt>Filed</dt><dd>{when(u.created_at)}</dd></>}
            {u.updated_at && <><dt>Last update</dt><dd>{when(u.updated_at)}</dd></>}
          </dl>
          <div className="section-h" style={{ marginTop: 36 }}><h2>What’s happened</h2></div>
          <Milestones u={u} events={events} updates={updates} />
          {tech ? <>
            <div className="section-h" style={{ marginTop: 36 }}><h2>Agent activity</h2><button className="link" type="button" onClick={onRun}>Open<ChevronRight aria-hidden="true" /></button></div>
            <Timeline steps={run.steps} />
          </> : <button className="link" type="button" style={{ marginTop: 20 }} onClick={onRun}>See how the agents handled this<ChevronRight aria-hidden="true" /></button>}
        </section>
      </div>
    </div>
  );
}

type Tone4 = 'done' | 'active' | 'pending' | 'error';
interface Row { text: string; at?: string; tone: Tone4; note?: string | null }

/** What a department's status change means to the citizen. */
function statusRow(name: string, status: string | null | undefined, crew?: string): { text: string; tone: Tone4 } {
  switch (status) {
    case 'RESOLVED': return { text: `${name} fixed the problem`, tone: 'done' };
    case 'CLOSED': return { text: `${name} closed its ticket`, tone: 'done' };
    case 'IN_PROGRESS': return { text: `${name} started work${crew ? ` (${crew})` : ''}`, tone: 'active' };
    case 'ASSIGNED': return { text: `${name} assigned ${crew || 'a crew'}`, tone: 'pending' };
    case 'OPEN': return { text: `${name} reopened its ticket`, tone: 'pending' };
    case 'REJECTED': return { text: `${name} couldn’t take this on`, tone: 'error' };
    case 'TRANSFERRED': return { text: `${name} passed it to another department`, tone: 'done' };
    default: return { text: `${name} updated its ticket`, tone: 'pending' };
  }
}

/**
 * Plain-language history for citizens, oldest first: received, sent to the departments, then
 * every department's real updates (status changes and notes). A department whose history
 * could not be loaded falls back to a line built from its current status.
 */
function Milestones({ u, events, updates }: { u: NonNullable<Awaited<ReturnType<typeof api.complaint>>['unified']>; events: TrailEvent[]; updates: ComplaintUpdate[] }) {
  const sent = events.find(e => e.event === 'jsonrpc_request' && e.detail.method === 'message/send');
  const rows: Row[] = [{ text: 'We received your complaint', at: u.created_at || events[0]?.ts, tone: 'done' }];
  if (u.departments.length) rows.push({ text: `Sent to ${u.departments.map(d => shortDept(d.department, d.department_name)).join(' and ')}`, at: sent?.ts, tone: 'done' });
  const crewOf = new Map(u.departments.map(d => [d.ticket_id, d.crew]));
  for (const e of updates) {
    const name = shortDept(e.department, e.department_name);
    if (e.kind === 'created') rows.push({ text: `${name} registered it as ${e.ticket_id}`, at: e.ts, tone: 'done' });
    else if (e.kind === 'status') rows.push({ ...statusRow(name, e.status, crewOf.get(e.ticket_id)), at: e.ts, note: e.note });
    else if (e.kind === 'note') rows.push({ text: `Update from ${name}`, at: e.ts, tone: 'active', note: e.note });
    else if (e.kind === 'linked') rows.push({ text: `Someone else reported the same problem to ${name}`, at: e.ts, tone: 'done' });
    else if (e.kind === 'confirmed') rows.push({ text: `Fix confirmed. ${name}’s ticket is closed`, at: e.ts, tone: 'done', note: e.note });
    else if (e.kind === 'reopened') rows.push({ text: `Reported as not fixed. Back with ${name}`, at: e.ts, tone: 'error', note: e.note });
    else if (e.kind === 'auto_closed') rows.push({ text: `${name}’s ticket closed automatically`, at: e.ts, tone: 'done' });
    else if (e.kind === 'edited') rows.push({ text: `${name} updated the details`, at: e.ts, tone: 'active', note: e.note });
    else if (e.kind === 'question') rows.push({ text: `${name} asked you a question`, at: e.ts, tone: 'pending', note: e.note });
    else if (e.kind === 'citizen_reply') rows.push({ text: 'You replied', at: e.ts, tone: 'done', note: e.note });
    else if (e.kind === 'transferred') rows.push({ text: `${name} passed it to the right department`, at: e.ts, tone: 'done', note: e.note });
  }
  const withHistory = new Set(updates.map(e => e.ticket_id));
  for (const d of u.departments) {
    if (d.ticket_id && withHistory.has(d.ticket_id)) continue;
    const name = shortDept(d.department, d.department_name);
    const failed = d.a2a_task_state && d.a2a_task_state !== 'completed';
    rows.push(failed ? { text: `${name} couldn’t register it`, tone: 'error' }
      : d.ticket_status === 'OPEN' || d.ticket_status === 'ASSIGNED' ? { text: `${name} registered it${d.ticket_id ? ` as ${d.ticket_id}` : ''}`, tone: 'pending' }
      : statusRow(name, d.ticket_status, d.crew));
  }
  if (u.overall_status === 'RESOLVED') rows.push({ text: 'Your complaint is resolved', at: u.updated_at, tone: 'done' });
  return (
    <ol className="ns-list inset" style={{ listStyle: 'none', margin: 0, padding: '4px 16px' }}>
      {rows.map((r, i) => (
        <li key={i} style={{ padding: '10px 0', borderTop: i ? '0.5px solid var(--separator)' : undefined }}>
          <div className="between" style={{ gap: 12, alignItems: 'baseline' }}>
            <Status tone={r.tone}>{r.text}</Status>
            {r.at && <span className="ns-footnote tabnum" style={{ whiteSpace: 'nowrap' }}>{when(r.at)}</span>}
          </div>
          {r.note && <p style={{ margin: '6px 0 0 16px', fontSize: 15, color: 'var(--ink-secondary)', whiteSpace: 'pre-wrap' }}>“{r.note}”</p>}
        </li>))}
    </ol>
  );
}

function Execution({ u, events, conciergeSub }: { u: NonNullable<Awaited<ReturnType<typeof api.complaint>>['unified']>; events: TrailEvent[]; conciergeSub: string }) {
  const { run } = useMemo(() => splitRun(events), [events]);
  const [cursor, setCursor] = useState(run.length);
  const [playing, setPlaying] = useState(false);
  const [focus, setFocus] = useState<{ kind: 'node' | 'step'; key: string } | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const timer = useRef<number>();
  useEffect(() => { setCursor(run.length); }, [run.length]);
  useEffect(() => {
    if (!playing) return;
    timer.current = window.setInterval(() => setCursor(c => {
      if (c >= run.length) { setPlaying(false); return c; }
      return c + 1;
    }), 260);
    return () => window.clearInterval(timer.current);
  }, [playing, run.length]);
  const view = useMemo(() => buildRun(run, u, cursor), [run, u, cursor]);
  const names = useMemo(() => agentNames(events), [events]);
  const t0 = run.length ? new Date(run[0].ts).getTime() : 0;
  const deptOfName = new Map(u.departments.map(d => [d.agent, d.department]));
  const urlOfDept = new Map([...names.entries()].map(([url, name]) => [deptOfName.get(name), url]));
  const STEP_EVENTS: Record<StepKey, (e: TrailEvent) => boolean> = {
    discover: e => e.event === 'complaint_received' || e.event === 'agents_discovered',
    decompose: e => e.event === 'decomposed',
    dispatch: e => (e.event === 'jsonrpc_request' && e.detail.method === 'message/send') || e.event === 'dispatch_failed',
    track: e => (e.event === 'jsonrpc_request' && e.detail.method === 'tasks/get') || e.event === 'jsonrpc_response' || e.event.startsWith('task_'),
    aggregate: e => e.event === 'aggregated',
  };
  const shown = run.slice(0, cursor).map((e, i) => ({ e, i })).filter(({ e }) => {
    if (!focus) return true;
    if (focus.kind === 'step') return STEP_EVENTS[focus.key as StepKey](e);
    if (focus.key === 'orchestrator') return e.actor === 'orchestrator';
    if (focus.key === 'concierge') return e.event === 'complaint_received';
    const url = urlOfDept.get(focus.key)?.replace(/\/$/, '');
    const name = u.departments.find(d => d.department === focus.key)?.agent;
    return e.actor === name || String(e.actor).replace(/\/$/, '') === url || String(e.detail.to || '').replace(/\/$/, '') === url;
  });

  return (
    <div className="fade-in section" style={{ marginTop: 32 }}>
      <div className="between" style={{ marginBottom: 16, flexWrap: 'wrap' }}>
        <p className="ns-footnote">The Orchestrator’s run for this complaint, rebuilt from its audit trail ({run.length} events, {run.length ? ((new Date(run[run.length - 1].ts).getTime() - t0) / 1000).toFixed(2) : '0'}s).</p>
        <div className="row">
          <button className="ns-btn ns-btn-secondary ns-btn-sm" type="button" onClick={() => { if (playing) setPlaying(false); else { setCursor(c => (c >= run.length ? 0 : c)); setPlaying(true); } }}>
            {playing ? <><Pause aria-hidden="true" />Pause</> : <><Play aria-hidden="true" />{cursor >= run.length ? 'Replay run' : 'Resume'}</>}
          </button>
          <input type="range" min={0} max={run.length} value={cursor} onChange={e => { setPlaying(false); setCursor(+e.target.value); }} aria-label="Run position" style={{ width: 160, accentColor: 'var(--ink)' }} />
          <span className="ns-caption tabnum" style={{ width: 54 }}>{cursor}/{run.length}</span>
        </div>
      </div>
      <WorkflowGraph run={view} citizenSub={u.location || 'citizen'} conciergeSub={conciergeSub}
        onNode={k => setFocus(f => (f?.kind === 'node' && f.key === k ? null : { kind: 'node', key: k }))}
        label={`Agent workflow for ${u.complaint_id}`} />
      <div className="two-col section">
        <section>
          <div className="section-h"><h2>Execution timeline</h2></div>
          <Timeline steps={view.steps} onStep={s => setFocus(f => (f?.kind === 'step' && f.key === s.key ? null : { kind: 'step', key: s.key }))} />
          <p className="ns-footnote">Select a step or an agent to filter the messages.</p>
        </section>
        <section>
          <div className="section-h"><h2>Agent messages</h2>{focus ? <button className="link" type="button" onClick={() => setFocus(null)}>Show all</button> : <span className="x">{shown.length}</span>}</div>
          {focus && <p className="ns-footnote" style={{ marginBottom: 8 }}>Filtered to {focus.kind === 'step' ? `the ${focus.key} step` : focus.key === 'orchestrator' || focus.key === 'concierge' ? `the ${focus.key}` : `the ${u.departments.find(d => d.department === focus.key)?.department_name || focus.key} agent`}.</p>}
          <div>{shown.map(({ e, i }) => <EventRow key={i} e={e} t0={t0} names={names} onOpen={() => setOpen(i)} />)}
            {!shown.length && <p className="ns-footnote" style={{ padding: '12px 4px' }}>No messages for this selection yet.</p>}</div>
        </section>
      </div>
      {open !== null && <Inspector events={run} index={open} t0={t0} names={names} onMove={setOpen} onClose={() => setOpen(null)} />}
    </div>
  );
}

function EventRow({ e, t0, names, onOpen }: { e: TrailEvent; t0: number; names: Map<string, string>; onOpen: () => void }) {
  const d = describeEvent(e, names);
  return (
    <button type="button" className="ev" onClick={onOpen}>
      <span className="t">{offset(e, t0)}</span>
      <span style={{ minWidth: 0 }}><span className="who">{d.who}</span><span className="ns-code">{d.what}</span></span>
      <span className="st">{d.state && <Status value={d.state} tone={toneOf(d.state)} raw />}</span>
    </button>
  );
}

function Inspector({ events, index, t0, names, onMove, onClose }: { events: TrailEvent[]; index: number; t0: number; names: Map<string, string>; onMove: (i: number) => void; onClose: () => void }) {
  const e = events[index];
  const d = describeEvent(e, names);
  const toast = useToast();
  return (
    <Drawer onClose={onClose}
      title={<div><div style={{ fontSize: 15, fontWeight: 600 }}>{d.who}</div><div className="ns-footnote"><span className="mono">{d.what}</span> · {offset(e, t0)} · {new Date(e.ts).toLocaleTimeString()}</div></div>}
      actions={<>
        <button className="icon-btn" type="button" aria-label="Previous message" disabled={index === 0} onClick={() => onMove(index - 1)}><ChevronLeft /></button>
        <button className="icon-btn" type="button" aria-label="Next message" disabled={index === events.length - 1} onClick={() => onMove(index + 1)}><ChevronRight /></button>
      </>}>
      {d.state && <p style={{ marginBottom: 14 }}><Status value={d.state} tone={toneOf(d.state)} raw /></p>}
      <pre>{JSON.stringify(e.detail, null, 2)}</pre>
      <button className="ns-btn ns-btn-secondary ns-btn-sm" style={{ marginTop: 14 }} type="button"
        onClick={() => navigator.clipboard?.writeText(JSON.stringify(e.detail, null, 2)).then(() => toast('Copied', 'JSON-RPC payload copied.', 'ok'))}>Copy JSON</button>
    </Drawer>
  );
}

const TRAIL_FILTERS = [
  { v: '', label: 'All' }, { v: 'rpc', label: 'JSON-RPC' }, { v: 'state', label: 'Task states' }, { v: 'err', label: 'Errors' },
];

function Trail({ events }: { events: TrailEvent[] }) {
  const [f, setF] = useState('');
  const [open, setOpen] = useState<number | null>(null);
  const names = useMemo(() => agentNames(events), [events]);
  const t0 = events.length ? new Date(events[0].ts).getTime() : 0;
  const match = (e: TrailEvent) => !f || (f === 'rpc' ? e.event.startsWith('jsonrpc') : f === 'state' ? e.event.startsWith('task_') : /fail|timeout|error/.test(e.event) || ['failed', 'rejected'].includes(String(e.detail.state)));
  const rows = events.map((e, i) => ({ e, i })).filter(({ e }) => match(e));
  return (
    <div className="fade-in section" style={{ marginTop: 32 }}>
      <div className="toolbar">
        <div className="chips" role="group" aria-label="Filter events">{TRAIL_FILTERS.map(x => <button key={x.v} type="button" className={`ns-chip${f === x.v ? ' on' : ''}`} aria-pressed={f === x.v} onClick={() => setF(x.v)}>{x.label}</button>)}</div>
        <span className="ns-footnote" style={{ marginLeft: 'auto' }}>{rows.length} of {events.length} events · select one to inspect its JSON-RPC</span>
      </div>
      {rows.map(({ e, i }) => <EventRow key={i} e={e} t0={t0} names={names} onOpen={() => setOpen(i)} />)}
      {!rows.length && <Empty icon={FileQuestion} title="No events match">Try another filter.</Empty>}
      {open !== null && <Inspector events={events} index={open} t0={t0} names={names} onMove={setOpen} onClose={() => setOpen(null)} />}
    </div>
  );
}
