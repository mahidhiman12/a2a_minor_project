import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, SearchX, TriangleAlert } from 'lucide-react';
import { api } from '../api/client';
import { AppShell } from '../components/AppShell';
import { Empty, ListSkeleton, Status } from '../components/ui';
import { when } from '../lib/format';
import { useAsync, useInterval } from '../lib/hooks';
import { deptIcon, deptName } from '../lib/status';

const FILTERS = [{ v: '', label: 'All' }, { v: 'REGISTERED', label: 'Registered' }, { v: 'IN_PROGRESS', label: 'In progress' }, { v: 'RESOLVED', label: 'Resolved' }, { v: 'NOT_ROUTED', label: 'Not routed' }];

export default function AdminOverview() {
  const nav = useNavigate();
  const all = useAsync(api.allComplaints, []);
  const depts = useAsync(api.departments, []);
  const sla = useAsync(api.sla, []);
  useInterval(() => { all.reload(true); sla.reload(true); }, 15000);
  const slaOf = (key: string) => sla.data?.find(r => r.key === key);
  const overdueTotal = (sla.data ?? []).reduce((s, r) => s + (r.overdue ?? 0), 0);
  const [q, setQ] = useState('');
  const [f, setF] = useState('');
  const list = all.data ?? [];
  const n = (s: string) => list.filter(c => c.overall_status === s).length;
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return list.filter(c => (!f || c.overall_status === f) && (!s || [c.complaint_id, c.summary, c.location, c.citizen].some(x => String(x || '').toLowerCase().includes(s))));
  }, [list, q, f]);

  return (
    <AppShell crumbs={[{ label: 'Overview' }]} wide>
      <div className="page-head"><div><h1 className="ns-title">Overview</h1><p>Every complaint across every department agent, with the citizen who filed it.</p></div></div>
      <div className="stat-row">
        <div className="ns-stat"><span className="v tabnum">{all.data ? list.length : '–'}</span><span className="k">Complaints</span></div>
        <div className="ns-stat"><span className="v tabnum">{all.data ? n('REGISTERED') + n('IN_PROGRESS') : '–'}</span><span className="k">Open</span></div>
        <div className="ns-stat"><span className="v tabnum">{all.data ? n('RESOLVED') : '–'}</span><span className="k">Resolved</span></div>
        <div className="ns-stat"><span className="v tabnum" style={overdueTotal ? { color: 'var(--red-ink)' } : undefined}>{sla.data ? overdueTotal : '–'}</span><span className="k">Tickets past the deadline</span></div>
      </div>

      <div className="section">
        <div className="section-h"><h2>Departments</h2></div>
        <div className="quick" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
          {(depts.data ?? []).map(d => {
            const I = deptIcon(d.key);
            const s = slaOf(d.key);
            const line = s?.online ? [
              `${s.open ?? 0} open`,
              ...(s.overdue ? [`${s.overdue} past deadline`] : []),
              ...(s.due_soon ? [`${s.due_soon} due soon`] : []),
              s.on_time_pct != null ? `${s.on_time_pct}% fixed on time` : 'nothing fixed yet',
            ].join(' · ') : null;
            return (
              <a key={d.key} href={`/dept/${d.key}`} onClick={e => { e.preventDefault(); nav(`/dept/${d.key}`); }}>
                <I aria-hidden="true" /><div><b>{deptName(d.key, d.name?.replace(/ Agent$/, ''))}</b>
                  <span><Status tone={!d.online ? 'error' : s?.overdue ? 'error' : s?.due_soon ? 'pending' : 'done'}>{!d.online ? 'Agent offline' : s?.overdue ? 'Behind on deadlines' : s?.due_soon ? 'Deadlines coming up' : 'On track'}</Status></span>
                  {line && <span className="ns-footnote" style={{ display: 'block', marginTop: 4 }}>{line}</span>}
                  {!!s?.awaiting_confirmation && <span className="ns-footnote" style={{ display: 'block' }}>{s.awaiting_confirmation} waiting for citizens to confirm</span>}
                </div>
              </a>); })}
        </div>
      </div>

      <div className="section">
        <div className="section-h"><h2>All complaints</h2></div>
        <div className="toolbar">
          <label className="ns-input pill"><Search aria-hidden="true" /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Search ID, place, citizen" aria-label="Search complaints" /></label>
          <div className="chips" role="group" aria-label="Filter by status">{FILTERS.map(x => <button key={x.v} type="button" className={`ns-chip${f === x.v ? ' on' : ''}`} aria-pressed={f === x.v} onClick={() => setF(x.v)}>{x.label}</button>)}</div>
        </div>
        {all.loading && !all.data ? <ListSkeleton rows={5} />
          : all.error ? <Empty icon={TriangleAlert} title="Couldn’t load complaints" action={<button className="ns-btn ns-btn-secondary ns-btn-sm" onClick={() => all.reload()}>Try again</button>}>{all.error.message}</Empty>
          : !shown.length ? <Empty icon={SearchX} title={list.length ? 'No matches' : 'No complaints yet'}>{list.length ? 'Nothing matches these filters.' : 'Complaints appear here as citizens file them.'}</Empty>
          : <div style={{ overflowX: 'auto' }}><table className="table fade-in">
              <thead><tr><th>Complaint</th><th>Summary</th><th className="hide-m">Place</th><th className="hide-m">Citizen</th><th>Status</th><th className="hide-m">Filed</th></tr></thead>
              <tbody>{shown.map(c => (
                <tr key={c.complaint_id} className="click" tabIndex={0} onClick={() => nav(`/complaints/${c.complaint_id}`)} onKeyDown={e => { if (e.key === 'Enter') nav(`/complaints/${c.complaint_id}`); }}>
                  <td className="mono">{c.complaint_id}</td>
                  <td style={{ maxWidth: 360 }}><div className="ellipsis">{c.summary || '—'}</div>{c.composite && <span className="ns-caption">Multi-department</span>}</td>
                  <td className="hide-m">{c.location || '—'}</td><td className="hide-m">{c.citizen || <span className="faint">—</span>}</td>
                  <td><Status value={c.overall_status} /></td><td className="hide-m ns-footnote">{when(c.created_at)}</td>
                </tr>))}</tbody>
            </table></div>}
      </div>
    </AppShell>
  );
}
