import { Link } from 'react-router-dom';
import { Bot, FileText, List, Map as MapIcon, Plus, WifiOff } from 'lucide-react';
import { api } from '../api/client';
import { useAuth } from '../auth';
import { AppShell } from '../components/AppShell';
import { ComplaintRow } from '../components/Complaint';
import { Empty, ListSkeleton, Status } from '../components/ui';
import { useAsync, useInterval } from '../lib/hooks';
import { deptIcon, deptName } from '../lib/status';

const greeting = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; };

/** Citizen dashboard. */
export default function Home() {
  const { user } = useAuth();
  const mine = useAsync(api.myComplaints, []);
  const depts = useAsync(api.departments, []);
  useInterval(() => mine.reload(true), 20000);
  const list = mine.data ?? [];
  const count = (s: string) => list.filter(c => c.overall_status === s).length;
  const byDept = new Map<string, number>();
  list.forEach(c => c.departments.forEach(d => byDept.set(d.department, (byDept.get(d.department) ?? 0) + 1)));
  const max = Math.max(1, ...byDept.values());

  return (
    <AppShell crumbs={[{ label: 'Home' }]}>
      <div className="page-head">
        <div>
          <span className="ns-caption">{new Date().toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })}</span>
          <h1 className="ns-title">{greeting()}, {user?.display_name.split(' ')[0]}.</h1>
          <p>Report a problem, follow it across every department, and see exactly what the agents did.</p>
        </div>
      </div>

      <div className="stat-row" aria-busy={mine.loading}>
        <div className="ns-stat"><span className="v tabnum">{mine.data ? list.length : '–'}</span><span className="k">Complaints filed</span></div>
        <div className="ns-stat"><span className="v tabnum">{mine.data ? count('IN_PROGRESS') + count('REGISTERED') : '–'}</span><span className="k">Open — registered or in progress</span></div>
        <div className="ns-stat"><span className="v tabnum">{mine.data ? count('RESOLVED') : '–'}</span><span className="k">Resolved</span></div>
        <div className="ns-stat"><span className="v tabnum">{mine.data ? list.filter(c => c.composite).length : '–'}</span><span className="k">Needed two or more departments</span></div>
      </div>

      <div className="section">
        <div className="quick">
          <Link to="/file"><Plus aria-hidden="true" /><div><b>File a complaint</b><span>Describe it in your own words</span></div></Link>
          <Link to="/complaints"><List aria-hidden="true" /><div><b>My complaints</b><span>Search, filter and track</span></div></Link>
          <Link to="/agents"><Bot aria-hidden="true" /><div><b>How agents work</b><span>Agent Cards and skills</span></div></Link>
        </div>
      </div>

      <div className="two-col section">
        <section>
          <div className="section-h"><h2>Recent complaints</h2>{list.length > 5 && <Link className="link" to="/complaints">See all</Link>}</div>
          {mine.loading && !mine.data ? <ListSkeleton rows={3} />
            : mine.error ? <Empty icon={WifiOff} title="Couldn’t load your complaints" action={<button className="ns-btn ns-btn-secondary ns-btn-sm" onClick={() => mine.reload()}>Try again</button>}>{mine.error.message}</Empty>
            : !list.length ? <Empty icon={FileText} title="No complaints yet" action={<Link className="ns-btn ns-btn-primary ns-btn-sm" to="/file">File your first complaint</Link>}>Tell the Concierge what’s wrong — water, power, roads or garbage.</Empty>
            : <div className="ns-list inset">{list.slice(0, 5).map(c => <ComplaintRow key={c.complaint_id} u={c} to={`/complaints/${c.complaint_id}`} />)}</div>}
        </section>
        <section>
          <div className="section-h"><h2>Activity</h2><Link className="link" to="/map"><MapIcon width={14} height={14} aria-hidden="true" />Map</Link></div>
          <div className="ns-list inset" style={{ padding: '6px 16px' }}>
            {!byDept.size ? <p className="ns-footnote" style={{ padding: '12px 0' }}>Departments your complaints reach will appear here.</p>
              : [...byDept.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => {
                const I = deptIcon(k);
                return <div className="hot" key={k} style={{ gridTemplateColumns: '24px 1fr 1fr 24px', fontSize: 14 }}><I width={17} height={17} aria-hidden="true" /><span className="ellipsis">{deptName(k)}</span><div className="bar"><i style={{ width: `${(n / max) * 100}%` }} /></div><span>{n}</span></div>;
              })}
          </div>
          <h3 className="ns-footnote" style={{ margin: '24px 0 8px 4px' }}>Department agents</h3>
          <div className="ns-list inset">
            {(depts.data ?? []).map(d => { const I = deptIcon(d.key); return (
              <div className="ns-item" key={d.key}><span className="ic"><I aria-hidden="true" /></span><div className="t">{deptName(d.key, d.name?.replace(/ Agent$/, ''))}</div><Status tone={d.online ? 'done' : 'error'}>{d.online ? 'Online' : 'Offline'}</Status></div>); })}
            {depts.loading && !depts.data && <div className="ns-item"><span className="ns-footnote">Checking agents…</span></div>}
            {depts.data && !depts.data.length && <div className="ns-item"><span className="ns-footnote">No department agents are reachable right now.</span></div>}
          </div>
        </section>
      </div>
    </AppShell>
  );
}
