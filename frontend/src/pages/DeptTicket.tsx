import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Clock, FileQuestion, Link2, MapPin, TriangleAlert, Users } from 'lucide-react';
import { api, ApiError, type TicketUpdate } from '../api/client';
import { DONE_STATUSES, PRIORITIES, TICKET_STATUSES, type Priority, type TicketDetail, type TicketEvent, type TicketStatus } from '../api/types';
import { useAuth } from '../auth';
import { AppShell } from '../components/AppShell';
import { TicketBlock } from '../components/Complaint';
import { PinMap } from '../components/PinMap';
import { useToast } from '../components/Overlays';
import { Empty, IdChip, PriorityTag, Skeleton, Status } from '../components/ui';
import { when } from '../lib/format';
import { useAsync, useInterval } from '../lib/hooks';
import { slaBadge } from '../lib/sla';
import { deptName, issueLabel, statusLabel } from '../lib/status';
import NotFound from './NotFound';

const FINAL = ['CLOSED', 'REJECTED', 'TRANSFERRED'];
/** Officer-facing names in the status menu. */
const OPTION_LABEL: Partial<Record<TicketStatus, string>> = { REJECTED: 'Reject (not ours, or not valid)' };

/** One ticket for its department's officer: details, actions (update, change details,
 *  transfer), history, and the other departments working on the same complaint. */
export default function DeptTicket() {
  const { dept = '', ticketId = '' } = useParams();
  const { user } = useAuth();
  if (user?.role === 'officer' && user.department !== dept) return <NotFound title="Not your department" text={`Your account can’t open ${deptName(dept)} tickets.`} />;
  return <TicketPage key={dept + ticketId} dept={dept} ticketId={ticketId} isAdmin={user?.role === 'admin'} />;
}

function TicketPage({ dept, ticketId, isAdmin }: { dept: string; ticketId: string; isAdmin: boolean }) {
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const { data, error, loading, reload } = useAsync(() => api.deptTicket(dept, ticketId), [dept, ticketId]);
  // don't refresh underneath an officer who is typing in one of the forms
  const busyForms = useRef(new Set<string>());
  const onEditing = useCallback((form: string, v: boolean) => { if (v) busyForms.current.add(form); else busyForms.current.delete(form); }, []);
  useInterval(() => { if (!busyForms.current.size) reload(true); }, 15000);
  const queue = `/dept/${encodeURIComponent(dept)}`;
  const crumbs = [...(isAdmin ? [{ label: 'Overview', to: '/admin' }] : []), { label: isAdmin ? deptName(dept) : 'Ticket queue', to: queue }, { label: ticketId }];

  if (error) {
    const st = error instanceof ApiError ? error.status : 0;
    return (
      <AppShell crumbs={crumbs}>
        {st === 404 ? <Empty icon={FileQuestion} title={`No ticket ${ticketId}`} action={<Link className="ns-btn ns-btn-secondary ns-btn-sm" to={queue}>Back to the queue</Link>}>It may have been filed with another department.</Empty>
          : <Empty icon={TriangleAlert} title="Couldn’t load this ticket" action={<button className="ns-btn ns-btn-secondary ns-btn-sm" onClick={() => reload()}>Try again</button>}>{error.message}</Empty>}
      </AppShell>
    );
  }
  if (loading && !data) return <AppShell crumbs={crumbs}><Skeleton h={34} w="50%" /><Skeleton h={160} style={{ marginTop: 24 }} /><Skeleton h={220} style={{ marginTop: 16 }} /></AppShell>;
  if (!data) return null;

  const t = data.ticket;
  const c = data.complaint;
  const done = DONE_STATUSES.includes(t.ticket_status);
  const final = FINAL.includes(t.ticket_status);
  const badge = slaBadge(t.sla, { showOnTrack: true });
  const others = (c?.departments ?? []).filter(d => d.department !== dept);
  // an older department agent doesn't send allowed_next: offer the working statuses (it still checks)
  const allowed = t.allowed_next ?? TICKET_STATUSES.filter(s => !FINAL.includes(s) && s !== t.ticket_status);
  const wanted = params.get('status') as TicketStatus | null;
  const save = async (upd: TicketUpdate, message: string) => {
    await api.updateTicket(dept, t.ticket_id, upd);
    toast('Saved', message, 'ok');
    if (wanted) setParams({}, { replace: true });
    await reload(true);
  };

  return (
    <AppShell crumbs={crumbs} wide>
      <header className="cd-head">
        <span className="ns-caption">{data.department.organisation} · <IdChip id={t.ticket_id} /></span>
        <h1>{t.issue_name}</h1>
        <div className="cd-meta">
          <Status value={t.ticket_status} />
          <PriorityTag priority={t.priority} />
          {badge && <Status tone={badge.tone}>{badge.label}</Status>}
          {t.awaiting_citizen && <Status tone="pending">Waiting for the citizen’s reply</Status>}
          {t.eta && !final && <span><Clock aria-hidden="true" />{done ? 'Was due' : 'Due'} {when(t.eta)}</span>}
          {t.locality && <span><MapPin aria-hidden="true" />{t.locality}</span>}
          {t.crew && <span><Users aria-hidden="true" />{t.crew}</span>}
        </div>
      </header>

      <div className="two-col section">
        <section>
          <div className="section-h"><h2>Details</h2></div>
          <dl className="kvlist">
            <dt>Reported</dt><dd>{t.description || c?.summary || '—'}</dd>
            {c?.urgency && <><dt>Urgency</dt><dd>{statusLabel(c.urgency)}</dd></>}
            <dt>Office</dt><dd>{t.assigned_office || '—'}</dd>
            <dt>Crew</dt><dd>{t.crew || '—'}</dd>
            <dt>Filed</dt><dd>{when(t.created_at) || '—'}</dd>
            {t.sla_hours != null && <><dt>Target</dt><dd>Fix within {t.sla_hours} hours</dd></>}
          </dl>

          <div className="section-h" style={{ marginTop: 36 }}><h2>Post an update</h2></div>
          {t.ticket_status === 'RESOLVED' && <p className="banner">Waiting for the citizen to confirm the fix. {t.auto_close_at ? `It closes by itself ${when(t.auto_close_at)} unless they reopen it.` : ''} Take it back to In progress only if the fix didn’t hold.</p>}
          {t.ticket_status === 'CLOSED' && <p className="banner">This ticket is closed{t.events.some(e => e.kind === 'confirmed') ? ': the citizen confirmed the fix' : ''}. You can still add a note.</p>}
          {t.ticket_status === 'REJECTED' && <p className="banner">This ticket was rejected. You can still add a note.</p>}
          {t.ticket_status === 'TRANSFERRED' && <p className="banner">This ticket was handed to another department, which now has its own ticket. You can still add a note.</p>}
          {t.awaiting_citizen && <p className="banner">You asked the citizen a question. Their reply will appear in the activity below.</p>}
          <UpdateForm current={t.ticket_status} allowed={allowed} initial={wanted && allowed.includes(wanted) ? wanted : null}
            onEditing={v => onEditing('update', v)}
            onSave={upd => save(upd, upd.question ? 'Your question was sent to the citizen.'
              : upd.status ? `${t.ticket_id} is now ${statusLabel(upd.status).toLowerCase()}.` : 'The citizen can see your note.')} />

          {!final && <details className="act-sec">
            <summary>Change crew, priority or expected fix time</summary>
            <DetailsForm t={t} onEditing={v => onEditing('details', v)} onSave={upd => save(upd, 'Ticket details updated.')} />
          </details>}

          {!final && <details className="act-sec">
            <summary>Transfer to another department</summary>
            <TransferForm t={t} dept={dept} onEditing={v => onEditing('transfer', v)} onDone={async (to, newId) => {
              toast('Transferred', `Sent to ${deptName(to)}${newId ? ` as ${newId}` : ''}. The citizen sees the new ticket on their complaint.`, 'ok');
              await reload(true);
            }} />
          </details>}

          <div className="section-h" style={{ marginTop: 36 }}><h2>Activity</h2><span className="x">{t.events.length}</span></div>
          <History events={t.events} />
        </section>

        <section>
          <div className="section-h"><h2>Complaint</h2>{c && <Status value={c.overall_status} />}</div>
          {!t.complaint_ref ? <p className="ns-footnote">This ticket wasn’t filed through a citizen complaint.</p>
            : !c ? <p className="ns-footnote">Complaint <span className="mono">{t.complaint_ref}</span> couldn’t be loaded right now.</p>
            : <>
                <dl className="kvlist">
                  <dt>ID</dt><dd>{isAdmin ? <Link className="link mono" to={`/complaints/${c.complaint_id}`}>{c.complaint_id}</Link> : <span className="mono">{c.complaint_id}</span>}</dd>
                  {(c.citizen_text || c.summary) && <><dt>Citizen said</dt><dd style={{ whiteSpace: 'pre-wrap' }}>“{c.citizen_text || c.summary}”</dd></>}
                  {c.location && <><dt>Place</dt><dd>{c.location}</dd></>}
                  {c.issues.length > 0 && <><dt>Problems</dt><dd>{c.issues.map(i => <div key={i.issue_type}>{issueLabel(i.issue_type, c.departments)}{i.department && i.department !== dept ? <span className="ns-footnote"> · {deptName(i.department)}</span> : null}</div>)}</dd></>}
                </dl>
                {c.geo?.lat != null && c.geo?.lng != null && <div style={{ marginTop: 16 }}>
                  <PinMap lat={c.geo.lat} lng={c.geo.lng} height={180} label={`Where the problem is: ${c.location || 'map'}`} />
                  <p className="ns-footnote" style={{ marginTop: 6 }}>
                    {c.geo.pinned ? 'The citizen marked this exact spot.' : 'Approximate: the centre of the place the citizen named.'}{' '}
                    <a className="link" href={`https://www.openstreetmap.org/?mlat=${c.geo.lat}&mlon=${c.geo.lng}#map=18/${c.geo.lat}/${c.geo.lng}`} target="_blank" rel="noreferrer">Open in OpenStreetMap</a>
                  </p>
                </div>}
                <div className="section-h" style={{ marginTop: 32 }}><h2>Other departments</h2></div>
                {others.length ? others.map(d => <TicketBlock key={d.department + (d.ticket_id || '')} d={d} />)
                  : <p className="ns-footnote">Only your department is working on this complaint.</p>}
                {c.coordination_plan.length > 0 && <>
                  <div className="section-h" style={{ marginTop: 32 }}><h2>Coordination plan</h2></div>
                  <ol className="plan">{c.coordination_plan.map((l, i) => <li key={i}>{l.replace(/^Step \d+:\s*/, '')}</li>)}</ol>
                </>}
              </>}

          {t.duplicates.length > 0 && <>
            <div className="section-h" style={{ marginTop: 32 }}><h2>Linked reports</h2><span className="x">{t.duplicates.length}</span></div>
            <p className="ns-footnote" style={{ marginBottom: 10 }}>Other citizens reported the same problem nearby. They see every update you post here.</p>
            <div className="ns-list inset">{t.duplicates.map(x => (
              <div className="ns-item" key={x.ticket_id}><span className="ic"><Link2 aria-hidden="true" /></span>
                <div style={{ minWidth: 0 }}><div className="t mono" style={{ fontSize: 13 }}>{x.ticket_id}</div><div className="m">{[x.locality, when(x.created_at)].filter(Boolean).join(' · ')}</div></div></div>))}</div>
          </>}
        </section>
      </div>
    </AppShell>
  );
}

/** Errors other than "signed out" (which sends the user to the login) are shown in the form. */
const formError = (e: unknown) => (e instanceof ApiError && e.status === 401 ? '' : (e as Error).message);

function UpdateForm({ current, allowed, initial, onSave, onEditing }: {
  current: TicketStatus; allowed: TicketStatus[]; initial: TicketStatus | null;
  onSave: (u: TicketUpdate) => Promise<void>; onEditing: (v: boolean) => void;
}) {
  const [status, setStatus] = useState<TicketStatus>(initial ?? current);
  const [note, setNote] = useState('');
  const [question, setQuestion] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (!busy) setStatus(initial ?? current); }, [current, initial]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (initial) area.current?.focus(); }, [initial]);
  useEffect(() => { onEditing(!!note.trim() || status !== current); }, [note, status, current, onEditing]);
  const changed = status !== current;
  const needsNote = question || (changed && (status === 'RESOLVED' || status === 'REJECTED'));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr('');
    if (needsNote && !note.trim()) {
      setErr(question ? 'Write your question.' : status === 'REJECTED' ? 'Say why. The citizen sees this reason.' : 'Say what was done. The citizen sees this note.');
      area.current?.focus(); return;
    }
    setBusy(true);
    try {
      await onSave({ ...(changed ? { status } : {}), ...(note.trim() ? { note: note.trim() } : {}), ...(question ? { question: true } : {}) });
      setNote(''); setQuestion(false);
    } catch (e2) { setErr(formError(e2)); } finally { setBusy(false); }
  }

  const label = question ? 'Question for the citizen'
    : changed && status === 'REJECTED' ? 'Reason for the citizen'
    : `Note for the citizen${needsNote ? '' : ' (optional)'}`;
  const placeholder = question ? 'e.g. Is the leak inside the society gate or on the main road?'
    : changed && status === 'REJECTED' ? 'e.g. This is a private pipeline inside the building; please contact the society.'
    : changed && status === 'RESOLVED' ? 'What was done? e.g. Burst section replaced, supply restored at 4 pm.'
    : 'e.g. Crew reached the site, repair starts tomorrow morning.';

  return (
    <form className="upd" onSubmit={submit} noValidate>
      {allowed.length > 0 && <div className="ns-field" style={{ marginTop: 0 }}>
        <label htmlFor="upd-status">Status</label>
        <select id="upd-status" className="select" value={status} onChange={e => { setStatus(e.target.value as TicketStatus); setErr(''); }}>
          {TICKET_STATUSES.filter(s => s === current || allowed.includes(s)).map(s => <option key={s} value={s}>{OPTION_LABEL[s] ?? statusLabel(s)}{s === current ? ' (current)' : ''}</option>)}
        </select>
      </div>}
      <div className="ns-field" style={allowed.length ? undefined : { marginTop: 0 }}>
        <label htmlFor="upd-note">{label}</label>
        <textarea id="upd-note" ref={area} rows={3} value={note} onChange={e => { setNote(e.target.value); setErr(''); }} aria-invalid={!!err} placeholder={placeholder} />
        <span className={`ns-help${err ? ' is-error' : ''}`} role={err ? 'alert' : undefined}>{err || (question ? 'The citizen is asked to reply on their complaint page.' : 'Shown on the citizen’s complaint, signed by your department.')}</span>
      </div>
      <label className="check"><input type="checkbox" checked={question} onChange={e => { setQuestion(e.target.checked); setErr(''); }} /> Ask the citizen this as a question (they’ll be asked to reply)</label>
      <button className="ns-btn ns-btn-primary" type="submit" disabled={busy || (!changed && !note.trim())}>
        {busy ? <span className="spin" aria-label="Saving" /> : changed ? (status === 'REJECTED' ? 'Reject ticket' : `Set to ${statusLabel(status).toLowerCase()}`) : question ? 'Send question' : 'Post note'}
      </button>
    </form>
  );
}

/** ISO -> the value a datetime-local input shows (in the officer's own time zone). */
const toLocalInput = (iso?: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};

function DetailsForm({ t, onSave, onEditing }: { t: TicketDetail; onSave: (u: TicketUpdate) => Promise<void>; onEditing: (v: boolean) => void }) {
  const [crew, setCrew] = useState(t.crew || '');
  const [priority, setPriority] = useState<Priority>(t.priority);
  const [eta, setEta] = useState(toLocalInput(t.eta));
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const etaChanged = !!eta && eta !== toLocalInput(t.eta);
  const changes: TicketUpdate = {
    ...(crew.trim() && crew.trim() !== (t.crew || '') ? { crew: crew.trim() } : {}),
    ...(priority !== t.priority ? { priority } : {}),
    ...(etaChanged ? { eta: new Date(eta).toISOString() } : {}),
  };
  const dirty = Object.keys(changes).length > 0;
  useEffect(() => { onEditing(dirty || !!note.trim()); }, [dirty, note, onEditing]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr('');
    if (etaChanged && !note.trim()) { setErr('Say why the expected fix time is changing. The citizen sees it.'); return; }
    setBusy(true);
    try { await onSave({ ...changes, ...(note.trim() ? { note: note.trim() } : {}) }); setNote(''); }
    catch (e2) { setErr(formError(e2)); } finally { setBusy(false); }
  }

  return (
    <form className="upd" onSubmit={submit} noValidate>
      <div className="grid2">
        <div className="ns-field" style={{ marginTop: 0 }}>
          <label htmlFor="det-crew">Crew</label>
          <input id="det-crew" className="text" value={crew} onChange={e => setCrew(e.target.value)} placeholder="e.g. Crew B4" />
        </div>
        <div className="ns-field" style={{ marginTop: 0 }}>
          <label htmlFor="det-prio">Priority</label>
          <select id="det-prio" className="select" value={priority} onChange={e => setPriority(e.target.value as Priority)}>
            {PRIORITIES.map(p => <option key={p} value={p}>{statusLabel(p)}</option>)}
          </select>
        </div>
      </div>
      <div className="ns-field">
        <label htmlFor="det-eta">Expected fix time</label>
        <input id="det-eta" className="text" type="datetime-local" value={eta} onChange={e => { setEta(e.target.value); setErr(''); }} />
        <span className="ns-help">Moving it changes the deadline the citizen sees.</span>
      </div>
      <div className="ns-field">
        <label htmlFor="det-note">Reason{etaChanged ? '' : ' (optional)'}</label>
        <textarea id="det-note" rows={2} value={note} onChange={e => { setNote(e.target.value); setErr(''); }} aria-invalid={!!err}
          placeholder={etaChanged ? 'e.g. Replacement valve arrives tomorrow morning.' : 'e.g. Crew B4 is closer to the site.'} />
        {err && <span className="ns-help is-error" role="alert">{err}</span>}
      </div>
      <button className="ns-btn ns-btn-primary" type="submit" disabled={busy || !dirty}>{busy ? <span className="spin" aria-label="Saving" /> : 'Save changes'}</button>
    </form>
  );
}

function TransferForm({ t, dept, onDone, onEditing }: { t: TicketDetail; dept: string; onDone: (to: string, newId?: string | null) => Promise<void>; onEditing: (v: boolean) => void }) {
  const agents = useAsync(api.agents, []);
  const targets = useMemo(() => (agents.data ?? []).filter(a => a.key !== dept && !a._offline && a.skills?.length), [agents.data, dept]);
  const [to, setTo] = useState('');
  const [issue, setIssue] = useState('');
  const [note, setNote] = useState('');
  const [sure, setSure] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const target = targets.find(a => a.key === to);
  useEffect(() => { onEditing(!!to || !!note.trim()); }, [to, note, onEditing]);
  useEffect(() => { setIssue(target?.skills?.[0]?.id ?? ''); setSure(false); }, [target]);

  const blocked = t.duplicate_of ? `This report is linked to ${t.duplicate_of}. Transfer that ticket instead.`
    : t.duplicates.length ? 'Other reports are linked to this ticket, so it can’t be transferred. Reject it with a reason instead.'
    : !t.complaint_ref ? 'Only tickets from a citizen complaint can be transferred.' : '';
  if (blocked) return <p className="ns-footnote" style={{ padding: '4px 2px 12px' }}>{blocked}</p>;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr('');
    if (!to) { setErr('Pick the department it belongs to.'); return; }
    if (!note.trim()) { setErr('Say why it belongs to them. The citizen and the other department see it.'); return; }
    if (!sure) { setSure(true); return; }
    setBusy(true);
    try {
      const r = await api.transferTicket(dept, t.ticket_id, to, note.trim(), issue || undefined);
      setNote(''); setTo('');
      await onDone(r.to_department, r.new_ticket_id);
    } catch (e2) { setErr(formError(e2)); setSure(false); } finally { setBusy(false); }
  }

  return (
    <form className="upd" onSubmit={submit} noValidate>
      <p className="ns-footnote" style={{ marginTop: 0 }}>The other department’s agent registers its own ticket over A2A. Yours is then marked as transferred. If they can’t take it, nothing changes.</p>
      <div className="grid2">
        <div className="ns-field">
          <label htmlFor="tr-dept">Department</label>
          <select id="tr-dept" className="select" value={to} onChange={e => { setTo(e.target.value); setErr(''); }}>
            <option value="">{agents.loading && !agents.data ? 'Loading…' : 'Choose…'}</option>
            {targets.map(a => <option key={a.key} value={a.key}>{deptName(a.key, a.name?.replace(/ Agent$/, ''))}</option>)}
          </select>
        </div>
        <div className="ns-field">
          <label htmlFor="tr-issue">Problem type there</label>
          <select id="tr-issue" className="select" value={issue} onChange={e => setIssue(e.target.value)} disabled={!target}>
            {(target?.skills ?? []).map(s => <option key={s.id} value={s.id}>{s.name || issueLabel(s.id)}</option>)}
          </select>
        </div>
      </div>
      <div className="ns-field">
        <label htmlFor="tr-note">Why it belongs to them</label>
        <textarea id="tr-note" rows={2} value={note} onChange={e => { setNote(e.target.value); setErr(''); setSure(false); }} aria-invalid={!!err}
          placeholder="e.g. The pipe is fine; the road surface has caved in." />
        {err && <span className="ns-help is-error" role="alert">{err}</span>}
      </div>
      {sure && target && <p className="banner" style={{ marginTop: 12 }}>Send this to <b>{deptName(target.key, target.name?.replace(/ Agent$/, ''))}</b>? Your ticket will be closed as transferred.</p>}
      <div className="row" style={{ gap: 8 }}>
        <button className="ns-btn ns-btn-primary" type="submit" disabled={busy}>{busy ? <span className="spin" aria-label="Transferring" /> : sure ? 'Yes, transfer it' : 'Transfer'}</button>
        {sure && <button className="ns-btn ns-btn-plain" type="button" style={{ marginTop: 16 }} onClick={() => setSure(false)}>Cancel</button>}
      </div>
    </form>
  );
}

const eventTitle = (e: TicketEvent) =>
  e.kind === 'created' ? 'Ticket registered'
    : e.kind === 'linked' ? 'Report linked'
    : e.kind === 'note' ? 'Note'
    : e.kind === 'edited' ? 'Details changed'
    : e.kind === 'question' ? 'Question to the citizen'
    : e.kind === 'citizen_reply' ? 'Citizen replied'
    : e.kind === 'transferred' ? 'Transferred'
    : e.kind === 'confirmed' ? 'Citizen confirmed the fix'
    : e.kind === 'reopened' ? 'Citizen says it isn’t fixed: reopened'
    : e.kind === 'auto_closed' ? 'Closed automatically'
    : e.status === 'REJECTED' ? 'Rejected'
    : `Status set to ${statusLabel(e.status).toLowerCase()}`;
const eventTone = (e: TicketEvent) =>
  e.kind === 'reopened' ? 'error' as const
    : e.kind === 'confirmed' || e.kind === 'auto_closed' ? 'done' as const
    : e.kind === 'question' || e.kind === 'citizen_reply' ? 'pending' as const
    : undefined;

/** Newest first. */
function History({ events }: { events: TicketEvent[] }) {
  return (
    <ol className="hist">
      {[...events].reverse().map((e, i) => (
        <li key={i}>
          <div className="between" style={{ alignItems: 'baseline' }}>
            {e.kind === 'status' ? <Status value={e.status}>{eventTitle(e)}</Status>
              : eventTone(e) ? <Status tone={eventTone(e)}>{eventTitle(e)}</Status> : <b>{eventTitle(e)}</b>}
            <span className="ns-footnote tabnum" style={{ whiteSpace: 'nowrap' }}>{when(e.ts)}</span>
          </div>
          {e.note && <p>{e.note}</p>}
          {e.actor && e.actor !== 'system' && <span className="ns-footnote">by {e.actor === 'citizen' ? 'the citizen' : e.actor}</span>}
        </li>))}
    </ol>
  );
}
