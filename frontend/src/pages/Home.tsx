import { Link } from 'react-router-dom';
import { Bot, ChevronRight, FileText, List, Map as MapIcon, Plus, WifiOff } from 'lucide-react';
import { api } from '../api/client';
import { useAuth } from '../auth';
import { AppShell } from '../components/AppShell';
import { awaitsConfirmation, awaitsReply, ComplaintRow, isOverdue } from '../components/Complaint';
import { Empty, ListSkeleton, Status } from '../components/ui';
import { useAsync, useInterval } from '../lib/hooks';
import { useTechView } from '../lib/prefs';
import { deptIcon, deptName } from '../lib/status';

const greeting = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; };

/** Citizen dashboard. */
export default function Home() {
  const { user } = useAuth();
  const tech = useTechView();
  const mine = useAsync(api.myComplaints, []);
  const depts = useAsync(api.departments, []);
  useInterval(() => mine.reload(true), 20000);
  const list = mine.data ?? [];
  const open = list.filter(c => c.overall_status === 'REGISTERED' || c.overall_status === 'IN_PROGRESS');
  const overdue = list.filter(isOverdue);
  const resolved = list.filter(c => c.overall_status === 'RESOLVED').length;
  // Overdue first, then still open, then the rest; newest update first within each group.
  const toCheck = list.filter(awaitsConfirmation);
  const toAnswer = list.filter(awaitsReply);
  const rank = (c: typeof list[number]) => (awaitsReply(c) || awaitsConfirmation(c) ? -1 : isOverdue(c) ? 0 : c.overall_status === 'RESOLVED' ? 2 : 1);
  const recent = [...list].sort((a, b) => rank(a) - rank(b) || String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
  const byDept = new Map<string, number>();
  list.forEach(c => c.departments.forEach(d => byDept.set(d.department, (byDept.get(d.department) ?? 0) + 1)));
  const max = Math.max(1, ...byDept.values());
  const v = (n: number) => (mine.data ? n : '–');

  return (
    <AppShell crumbs={[{ label: 'Home' }]}>
      <div className="page-head">
        <div>
          <span className="ns-caption">{new Date().toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })}</span>
          <h1 className="ns-title">{greeting()}, {user?.display_name.split(' ')[0]}.</h1>
          <p>Report a problem once. We send it to every department involved and keep you updated on one complaint ID.</p>
        </div>
      </div>

      {toAnswer.length > 0 && (
        <Link className="banner banner-link" to={`/complaints/${toAnswer[0].complaint_id}`}>
          <b>{toAnswer.length === 1 ? 'A department has a question for you.' : `${toAnswer.length} complaints have questions for you.`}</b>
          {' '}Your answer helps the crew fix it faster.<ChevronRight aria-hidden="true" />
        </Link>)}
      {toCheck.length > 0 && (
        <Link className="banner banner-link" to={`/complaints/${toCheck[0].complaint_id}`}>
          <b>{toCheck.length === 1 ? 'A department says your problem is fixed.' : `${toCheck.length} complaints have fixes waiting for you.`}</b>
          {' '}Is it? Let them know, or it closes by itself in a few days.<ChevronRight aria-hidden="true" />
        </Link>)}

      <div className="stat-row" aria-busy={mine.loading}>
        <div className="ns-stat"><span className="v tabnum">{v(list.length)}</span><span className="k">Complaints filed</span></div>
        <div className="ns-stat"><span className="v tabnum">{v(open.length)}</span><span className="k">Being worked on</span></div>
        <div className="ns-stat"><span className="v tabnum" style={overdue.length ? { color: 'var(--red-ink)' } : undefined}>{v(overdue.length)}</span><span className="k">Past the promised date</span></div>
        <div className="ns-stat"><span className="v tabnum">{v(resolved)}</span><span className="k">Resolved</span></div>
      </div>

      <div className="section">
        <div className="quick">
          <Link to="/file"><Plus aria-hidden="true" /><div><b>File a complaint</b><span>Describe it in your own words</span></div></Link>
          <Link to="/complaints"><List aria-hidden="true" /><div><b>My complaints</b><span>Search, filter and track</span></div></Link>
          {tech
            ? <Link to="/agents"><Bot aria-hidden="true" /><div><b>How agents work</b><span>Agent Cards and skills</span></div></Link>
            : <Link to="/map"><MapIcon aria-hidden="true" /><div><b>Problem hotspots</b><span>Where complaints are piling up</span></div></Link>}
        </div>
      </div>

      <div className="two-col section">
        <section>
          <div className="section-h"><h2>Your complaints</h2>{list.length > 5 && <Link className="link" to="/complaints">See all</Link>}</div>
          {mine.loading && !mine.data ? <ListSkeleton rows={3} />
            : mine.error ? <Empty icon={WifiOff} title="Couldn’t load your complaints" action={<button className="ns-btn ns-btn-secondary ns-btn-sm" onClick={() => mine.reload()}>Try again</button>}>{mine.error.message}</Empty>
            : !list.length ? <Empty icon={FileText} title="No complaints yet" action={<Link className="ns-btn ns-btn-primary ns-btn-sm" to="/file">File your first complaint</Link>}>Tell us what’s wrong: water, power, roads or garbage.</Empty>
            : <div className="ns-list inset">{recent.slice(0, 5).map(c => <ComplaintRow key={c.complaint_id} u={c} to={`/complaints/${c.complaint_id}`} />)}</div>}
        </section>
        <section>
          <div className="section-h"><h2>Departments handling them</h2><Link className="link" to="/map"><MapIcon width={14} height={14} aria-hidden="true" />Map</Link></div>
          <div className="ns-list inset" style={{ padding: '6px 16px' }}>
            {!byDept.size ? <p className="ns-footnote" style={{ padding: '12px 0' }}>The departments working on your complaints will appear here.</p>
              : [...byDept.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => {
                const I = deptIcon(k);
                return <div className="hot" key={k} style={{ gridTemplateColumns: '24px 1fr 1fr 24px', fontSize: 14 }}><I width={17} height={17} aria-hidden="true" /><span className="ellipsis">{deptName(k)}</span><div className="bar"><i style={{ width: `${(n / max) * 100}%` }} /></div><span>{n}</span></div>;
              })}
          </div>
          {tech && <>
            <h3 className="ns-footnote" style={{ margin: '24px 0 8px 4px' }}>Department agents</h3>
            <div className="ns-list inset">
              {(depts.data ?? []).map(d => { const I = deptIcon(d.key); return (
                <div className="ns-item" key={d.key}><span className="ic"><I aria-hidden="true" /></span><div className="t">{deptName(d.key, d.name?.replace(/ Agent$/, ''))}</div><Status tone={d.online ? 'done' : 'error'}>{d.online ? 'Online' : 'Offline'}</Status></div>); })}
              {depts.loading && !depts.data && <div className="ns-item"><span className="ns-footnote">Checking agents…</span></div>}
              {depts.data && !depts.data.length && <div className="ns-item"><span className="ns-footnote">No department agents are reachable right now.</span></div>}
            </div>
          </>}
        </section>
      </div>
    </AppShell>
  );
}
