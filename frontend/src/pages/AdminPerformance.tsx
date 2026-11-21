import { Link } from 'react-router-dom';
import { TriangleAlert } from 'lucide-react';
import { api } from '../api/client';
import type { DeptPerformance } from '../api/types';
import { AppShell } from '../components/AppShell';
import { Empty, ListSkeleton, Status } from '../components/ui';
import { when } from '../lib/format';
import { useAsync, useInterval } from '../lib/hooks';
import { duration } from '../lib/sla';
import { deptIcon, deptName } from '../lib/status';

const pct = (v?: number | null) => (v == null ? '—' : `${v}%`);
const hrs = (v?: number | null) => (v == null ? '—' : duration(v));

/** Weighted by how many tickets each department fixed, so a small department doesn't skew it. */
function weighted(rows: DeptPerformance[], key: 'on_time_pct' | 'avg_fix_hours') {
  const xs = rows.filter(r => r[key] != null && (r.fixed ?? 0) > 0);
  const n = xs.reduce((s, r) => s + (r.fixed ?? 0), 0);
  return n ? xs.reduce((s, r) => s + (r[key] as number) * (r.fixed ?? 0), 0) / n : null;
}

/** Admin: how each department and each officer is doing. */
export default function AdminPerformance() {
  const { data, error, loading, reload } = useAsync(api.performance, []);
  useInterval(() => reload(true), 30000);
  const depts = (data?.departments ?? []).filter(d => d.online);
  const sum = (k: keyof DeptPerformance) => depts.reduce((s, d) => s + (Number(d[k]) || 0), 0);
  const onTime = weighted(depts, 'on_time_pct');
  const avgFix = weighted(depts, 'avg_fix_hours');

  return (
    <AppShell crumbs={[{ label: 'Overview', to: '/admin' }, { label: 'Performance' }]} wide>
      <div className="page-head"><div><h1 className="ns-title">Performance</h1><p>How quickly each department fixes problems, how often it meets its deadlines, and what each officer has done. Linked duplicate reports count once.</p></div></div>
      {loading && !data ? <ListSkeleton rows={5} />
        : error ? <Empty icon={TriangleAlert} title="Couldn’t load performance" action={<button className="ns-btn ns-btn-secondary ns-btn-sm" onClick={() => reload()}>Try again</button>}>{error.message}</Empty>
        : data && <>
          <div className="stat-row">
            <div className="ns-stat"><span className="v tabnum">{sum('open')}</span><span className="k">Tickets open across {depts.length} department{depts.length === 1 ? '' : 's'}</span></div>
            <div className="ns-stat"><span className="v tabnum" style={sum('overdue') ? { color: 'var(--red-ink)' } : undefined}>{sum('overdue')}</span><span className="k">Past the deadline</span></div>
            <div className="ns-stat"><span className="v tabnum">{onTime == null ? '—' : `${Math.round(onTime)}%`}</span><span className="k">Fixed on time</span></div>
            <div className="ns-stat"><span className="v tabnum">{avgFix == null ? '—' : duration(avgFix)}</span><span className="k">Average time to fix</span></div>
          </div>

          <div className="section">
            <div className="section-h"><h2>Departments</h2><span className="x">{data.complaints.total} complaints · {data.complaints.multi_department} needed more than one department</span></div>
            <div style={{ overflowX: 'auto' }}><table className="table">
              <thead><tr><th>Department</th><th>Open</th><th>Past deadline</th><th>Fixed</th><th>On time</th><th>Avg time to fix</th><th>Reopened</th><th className="hide-m">Confirmed · auto-closed</th><th className="hide-m">Waiting for citizen</th></tr></thead>
              <tbody>{(data.departments).map(d => { const I = deptIcon(d.key); return (
                <tr key={d.key}>
                  <td><Link className="row link" style={{ gap: 8, color: 'inherit' }} to={`/dept/${d.key}`}><I width={16} height={16} aria-hidden="true" />{deptName(d.key, d.name)}</Link>{!d.online && <div><Status tone="error">Agent offline</Status></div>}</td>
                  <td className="tabnum">{d.online ? d.open : '—'}</td>
                  <td className="tabnum" style={d.overdue ? { color: 'var(--red-ink)', fontWeight: 600 } : undefined}>{d.online ? d.overdue : '—'}</td>
                  <td className="tabnum">{d.online ? d.fixed : '—'}</td>
                  <td className="tabnum">{pct(d.on_time_pct)}</td>
                  <td className="tabnum">{hrs(d.avg_fix_hours)}</td>
                  <td className="tabnum">{d.online ? `${d.reopened ?? 0}${d.reopen_pct != null ? ` (${d.reopen_pct}%)` : ''}` : '—'}</td>
                  <td className="tabnum hide-m">{d.online ? `${d.confirmed ?? 0} · ${d.auto_closed ?? 0}` : '—'}</td>
                  <td className="tabnum hide-m">{d.online ? d.awaiting_citizen : '—'}</td>
                </tr>); })}</tbody>
            </table></div>
            <p className="ns-footnote" style={{ marginTop: 10 }}>On time: fixed before the deadline. Reopened: the citizen said a fix didn’t work (share of tickets ever marked fixed). Confirmed: the citizen said it’s fixed; auto-closed: no reply within the waiting period.</p>
          </div>

          <div className="section">
            <div className="section-h"><h2>Officers</h2><Link className="link" to="/admin/people">Manage accounts</Link></div>
            {!data.officers.length ? <p className="ns-footnote">No officer has updated a ticket yet.</p>
              : <div style={{ overflowX: 'auto' }}><table className="table">
                <thead><tr><th>Officer</th><th>Department</th><th>Updates</th><th>Resolved</th><th className="hide-m">Rejected</th><th className="hide-m">Transferred</th><th className="hide-m">Questions</th><th>Last active</th></tr></thead>
                <tbody>{data.officers.map(o => (
                  <tr key={o.department + o.name}>
                    <td>{o.name}{o.username && <div className="ns-footnote mono">@{o.username}{o.active === false ? ' · switched off' : ''}</div>}</td>
                    <td>{deptName(o.department)}</td>
                    <td className="tabnum">{o.updates}</td>
                    <td className="tabnum">{o.resolved}</td>
                    <td className="tabnum hide-m">{o.rejected}</td>
                    <td className="tabnum hide-m">{o.transferred}</td>
                    <td className="tabnum hide-m">{o.questions}</td>
                    <td className="ns-footnote">{when(o.last_active) || '—'}</td>
                  </tr>))}</tbody>
              </table></div>}
            <p className="ns-footnote" style={{ marginTop: 10 }}>Counted from each ticket’s history, by the name shown on the update. Give every officer their own account so this stays accurate.</p>
          </div>
        </>}
    </AppShell>
  );
}
