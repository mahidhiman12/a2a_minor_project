import { useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ChevronDown, Inbox, Search, SearchX, TriangleAlert } from 'lucide-react';
import { api, ApiError } from '../api/client';
import { DONE_STATUSES, FIXED_STATUSES, TICKET_STATUSES, type Ticket, type TicketStatus } from '../api/types';
import { useAuth } from '../auth';
import { AppShell } from '../components/AppShell';
import { useChoice, useToast } from '../components/Overlays';
import { Empty, ListSkeleton, PriorityTag, Status } from '../components/ui';
import { isToday, timeNow, when } from '../lib/format';
import { useAsync, useInterval } from '../lib/hooks';
import { slaBadge, slaRank } from '../lib/sla';
import { deptName, statusLabel } from '../lib/status';
import NotFound from './NotFound';

export default function DeptQueue() {
  const { dept = '' } = useParams();
  const { user } = useAuth();
  if (user?.role === 'officer' && user.department !== dept) return <NotFound title="Not your department" text={`Your account can’t open the ${deptName(dept)} queue.`} />;
  return <Queue key={dept} dept={dept} isAdmin={user?.role === 'admin'} />;
}

function Queue({ dept, isAdmin }: { dept: string; isAdmin: boolean }) {
  const toast = useToast();
  const choose = useChoice();
  const nav = useNavigate();
  const ticketUrl = (id: string) => `/dept/${encodeURIComponent(dept)}/tickets/${encodeURIComponent(id)}`;
  const busy = useRef(false);
  const [updated, setUpdated] = useState('');
  const [f, setF] = useState({ q: '', status: 'active', prio: '', loc: '' });
  const { data, error, loading, reload } = useAsync(async () => { const d = await api.deptTickets(dept); setUpdated(timeNow()); return d; }, [dept]);
  useInterval(() => { if (!busy.current) reload(true); }, 10000);
  const tickets = data?.tickets ?? [];
  const v = useMemo(() => view(tickets, f), [tickets, f]);
  const org = data?.department.organisation || deptName(dept);

  async function change(t: Ticket) {
    const next = t.allowed_next ?? TICKET_STATUSES.filter(s => !['CLOSED', 'REJECTED', 'TRANSFERRED'].includes(s) && s !== t.ticket_status);
    if (!next.length) { nav(ticketUrl(t.ticket_id)); return; } // closed: nothing to change, notes on the page
    busy.current = true;
    const s = await choose<TicketStatus>({
      title: `Update ${t.ticket_id}`,
      message: t.ticket_status === 'RESOLVED'
        ? 'Waiting for the citizen to confirm the fix. Take it back only if the fix didn’t hold.'
        : 'The citizen sees the new status on their complaint. Resolving asks you to say what was done.',
      options: TICKET_STATUSES.filter(x => x === t.ticket_status || next.includes(x))
        .map(x => ({ label: statusLabel(x), value: x, current: x === t.ticket_status })),
    });
    if (s && s !== t.ticket_status && (s === 'RESOLVED' || s === 'REJECTED')) { // both need a note
      busy.current = false;
      nav(`${ticketUrl(t.ticket_id)}?status=${s}`); // needs a note: finish on the ticket page
      return;
    }
    if (s && s !== t.ticket_status) {
      try { await api.updateTicket(dept, t.ticket_id, { status: s }); toast('Status updated', `${t.ticket_id} is now ${statusLabel(s).toLowerCase()}.`, 'ok'); }
      catch (e) { if (!(e instanceof ApiError && e.status === 401)) toast('Update failed', (e as Error).message, 'bad'); }
      await reload(true);
    }
    busy.current = false;
  }

  if (error instanceof ApiError && error.status === 404) return <NotFound title="Unknown department" text={error.message} />;

  return (
    <AppShell crumbs={isAdmin ? [{ label: 'Overview', to: '/admin' }, { label: deptName(dept) }] : [{ label: 'Ticket queue' }]}>
      <div className="page-head">
        <div><span className="ns-caption">{deptName(dept)} department</span><h1 className="ns-title">{loading && !data ? 'Loading…' : org}</h1>
          <p>Tickets this department’s agent received from the Orchestrator over A2A. Updates reach the citizen’s combined status.</p></div>
        {updated && <span className="ns-footnote">Updated {updated}</span>}
      </div>
      <div className="stat-row">
        <div className="ns-stat"><span className="v tabnum">{data ? v.stats.open : '–'}</span><span className="k">Unresolved</span></div>
        <div className="ns-stat"><span className="v tabnum" style={v.stats.overdue ? { color: 'var(--red-ink)' } : undefined}>{data ? v.stats.overdue : '–'}</span><span className="k">Past the deadline{data && v.stats.soon ? ` · ${v.stats.soon} due soon` : ''}</span></div>
        <div className="ns-stat"><span className="v tabnum" style={v.stats.crit ? { color: 'var(--red-ink)' } : undefined}>{data ? v.stats.crit : '–'}</span><span className="k">Critical, unresolved</span></div>
        <div className="ns-stat"><span className="v tabnum">{data ? v.stats.res : '–'}</span><span className="k">Fixed today{data && v.stats.waiting ? ` · ${v.stats.waiting} awaiting citizen` : ''}</span></div>
      </div>
      <div className="section">
        <div className="toolbar">
          <label className="ns-input pill"><Search aria-hidden="true" /><input value={f.q} onChange={e => setF({ ...f, q: e.target.value })} placeholder="Search ticket, issue, place, crew" aria-label="Search tickets" /></label>
          <select className="select" value={f.status} onChange={e => setF({ ...f, status: e.target.value })} aria-label="Status">
            <option value="">All statuses</option><option value="active">Unresolved</option><option value="overdue">Past the deadline</option><option value="due_soon">Due soon</option>{TICKET_STATUSES.map(s => <option key={s} value={s}>{statusLabel(s)}</option>)}
          </select>
          <select className="select" value={f.prio} onChange={e => setF({ ...f, prio: e.target.value })} aria-label="Priority">
            <option value="">All priorities</option>{['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].map(p => <option key={p} value={p}>{statusLabel(p)}</option>)}
          </select>
          {v.localities.length > 1 && <select className="select" value={f.loc} onChange={e => setF({ ...f, loc: e.target.value })} aria-label="Locality">
            <option value="">All localities</option>{v.localities.map(l => <option key={l} value={l}>{l}</option>)}
          </select>}
        </div>
        {data && <p className="ns-footnote" style={{ margin: '0 4px 4px' }}>{v.shown.length} of {v.tops.length} tickets</p>}
        {loading && !data ? <ListSkeleton rows={4} />
          : error && !data ? <Empty icon={TriangleAlert} title="Couldn’t load tickets" action={<button className="ns-btn ns-btn-secondary ns-btn-sm" onClick={() => reload()}>Try again</button>}>{error.message}</Empty>
          : !tickets.length ? <Empty icon={Inbox} title="No tickets yet">Tickets appear here as soon as the Orchestrator routes a complaint to this department.</Empty>
          : !v.shown.length ? <Empty icon={SearchX} title="No matches" action={<button className="ns-btn ns-btn-secondary ns-btn-sm" onClick={() => setF({ q: '', status: '', prio: '', loc: '' })}>Clear filters</button>}>No tickets match these filters.</Empty>
          : <div className="tickets fade-in">{v.shown.map(t => (
              <article className="tk" key={t.ticket_id}>
                <div style={{ minWidth: 0 }}>
                  <h3><Link to={ticketUrl(t.ticket_id)} style={{ color: 'inherit' }}>{t.issue_name}</Link></h3>
                  <div className="m"><span className="mono" style={{ fontSize: 12 }}>{t.ticket_id}</span><PriorityTag priority={t.priority} />{(() => { const b = slaBadge(t.sla); return b && <Status tone={b.tone}>{b.label}</Status>; })()}<span>{t.locality || '—'}{t.crew && ` · ${t.crew}`}</span><span>Filed {when(t.created_at)}{t.eta && !DONE_STATUSES.includes(t.ticket_status) && ` · Due ${when(t.eta)}`}</span>
                    {t.complaint_ref && (isAdmin ? <Link className="link mono" style={{ fontSize: 12 }} to={`/complaints/${t.complaint_ref}`}>{t.complaint_ref}</Link> : <span className="mono" style={{ fontSize: 12 }}>{t.complaint_ref}</span>)}</div>
                  {t.description && <p className="d">{t.description.length > 180 ? <>{t.description.slice(0, 180)}… <Link className="link" to={ticketUrl(t.ticket_id)}>More</Link></> : t.description}</p>}
                  {!!t.related_departments?.length && <p className="ns-footnote" style={{ marginTop: 6 }}>Coordinate with {t.related_departments.map(r => deptName(r)).join(', ')}</p>}
                  {t.ticket_status === 'RESOLVED' && <p className="ns-footnote" style={{ marginTop: 6 }}>Waiting for the citizen to confirm the fix{t.auto_close_at ? ` · closes by itself ${when(t.auto_close_at)}` : ''}</p>}
                  {t.awaiting_citizen && <p className="ns-footnote" style={{ marginTop: 6 }}><Status tone="pending">Waiting for the citizen’s reply</Status></p>}
                  {!!v.kids[t.ticket_id]?.length && <p className="dups">{v.kids[t.ticket_id].length} duplicate report{v.kids[t.ticket_id].length === 1 ? '' : 's'} linked: {v.kids[t.ticket_id].map(k => k.ticket_id).join(', ')}</p>}
                </div>
                <button className="status-btn" type="button" aria-label={`Change status of ${t.ticket_id}, currently ${statusLabel(t.ticket_status)}`} onClick={() => change(t)}>
                  <Status value={t.ticket_status} /><ChevronDown aria-hidden="true" />
                </button>
              </article>))}</div>}
      </div>
    </AppShell>
  );
}

function view(tickets: Ticket[], f: { q: string; status: string; prio: string; loc: string }) {
  const parents = tickets.filter(t => !t.duplicate_of);
  const stats = {
    open: parents.filter(t => !DONE_STATUSES.includes(t.ticket_status)).length,
    overdue: parents.filter(t => t.sla?.state === 'overdue').length,
    soon: parents.filter(t => t.sla?.state === 'due_soon').length,
    res: parents.filter(t => FIXED_STATUSES.includes(t.ticket_status) && isToday(t.resolved_at || t.updated_at)).length,
    waiting: parents.filter(t => t.ticket_status === 'RESOLVED').length,
    crit: parents.filter(t => t.priority === 'CRITICAL' && !DONE_STATUSES.includes(t.ticket_status)).length,
  };
  const q = f.q.trim().toLowerCase();
  const byStatus = (t: Ticket) => !f.status
    || (f.status === 'active' ? !DONE_STATUSES.includes(t.ticket_status)
      : f.status === 'overdue' || f.status === 'due_soon' ? t.sla?.state === f.status
      : t.ticket_status === f.status);
  const match = (t: Ticket) => byStatus(t)
    && (!f.prio || t.priority === f.prio) && (!f.loc || t.locality === f.loc)
    && (!q || [t.ticket_id, t.issue_name, t.description, t.locality, t.crew, t.complaint_ref].some(x => String(x || '').toLowerCase().includes(q)));
  const ids = new Set(tickets.map(t => t.ticket_id));
  const kids: Record<string, Ticket[]> = {};
  tickets.filter(t => t.duplicate_of && ids.has(t.duplicate_of)).forEach(t => { (kids[t.duplicate_of!] ||= []).push(t); });
  const order: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
  const tops = tickets.filter(t => !t.duplicate_of || !ids.has(t.duplicate_of))
    // unresolved first; then past the deadline, due soon, on track; then priority; then earliest deadline
    .sort((a, b) => Number(DONE_STATUSES.includes(a.ticket_status)) - Number(DONE_STATUSES.includes(b.ticket_status))
      || slaRank(a.sla) - slaRank(b.sla)
      || (order[a.priority] ?? 9) - (order[b.priority] ?? 9)
      || String(a.eta || '').localeCompare(String(b.eta || '')));
  const shown = tops.filter(t => match(t) || (kids[t.ticket_id] || []).some(match));
  const localities = [...new Set(tickets.map(t => t.locality).filter((l): l is string => !!l))].sort();
  return { stats, kids, tops, shown, localities };
}
