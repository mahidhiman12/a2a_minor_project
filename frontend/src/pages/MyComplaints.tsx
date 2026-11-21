import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { FileText, Search, SearchX, WifiOff } from 'lucide-react';
import { api } from '../api/client';
import { AppShell } from '../components/AppShell';
import { ComplaintRow, deptsOf, firstIssue } from '../components/Complaint';
import { Empty, ListSkeleton } from '../components/ui';
import { useAsync, useInterval } from '../lib/hooks';
import { deptName } from '../lib/status';

const FILTERS = [
  { v: '', label: 'All' }, { v: 'open', label: 'Open' }, { v: 'IN_PROGRESS', label: 'In progress' },
  { v: 'RESOLVED', label: 'Resolved' }, { v: 'multi', label: 'Multi-department' },
];

export default function MyComplaints() {
  const { data, error, loading, reload } = useAsync(api.myComplaints, []);
  useInterval(() => reload(true), 20000);
  const [q, setQ] = useState('');
  const [f, setF] = useState('');
  const [dept, setDept] = useState('');
  const list = data ?? [];
  const depts = useMemo(() => [...new Set(list.flatMap(c => c.departments.map(d => d.department)))].sort(), [list]);
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return list.filter(c =>
      (!f || (f === 'open' ? ['REGISTERED', 'IN_PROGRESS'].includes(c.overall_status) : f === 'multi' ? c.composite : c.overall_status === f))
      && (!dept || c.departments.some(d => d.department === dept))
      && (!s || [c.complaint_id, c.summary, c.location, firstIssue(c), deptsOf(c), ...c.departments.map(d => d.ticket_id)].some(x => String(x || '').toLowerCase().includes(s))));
  }, [list, q, f, dept]);

  return (
    <AppShell crumbs={[{ label: 'Home', to: '/home' }, { label: 'My complaints' }]}>
      <div className="page-head">
        <div><h1 className="ns-title">My complaints</h1><p>Every complaint you’ve filed, with its live status from each department.</p></div>
        <div className="acts"><Link className="ns-btn ns-btn-primary" to="/file">File a complaint</Link></div>
      </div>
      <div className="toolbar">
        <label className="ns-input pill"><Search aria-hidden="true" /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Search ID, place, issue or ticket" aria-label="Search complaints" /></label>
        <div className="chips" role="group" aria-label="Filter by status">
          {FILTERS.map(x => <button key={x.v} type="button" className={`ns-chip${f === x.v ? ' on' : ''}`} aria-pressed={f === x.v} onClick={() => setF(x.v)}>{x.label}</button>)}
        </div>
        {depts.length > 1 && <select className="select" value={dept} onChange={e => setDept(e.target.value)} aria-label="Filter by department">
          <option value="">All departments</option>{depts.map(d => <option key={d} value={d}>{deptName(d)}</option>)}
        </select>}
      </div>
      {data && <p className="ns-footnote" style={{ margin: '0 4px 10px' }}>{shown.length === list.length ? `${list.length} complaint${list.length === 1 ? '' : 's'}` : `${shown.length} of ${list.length}`}</p>}
      {loading && !data ? <ListSkeleton rows={4} />
        : error && !data ? <Empty icon={WifiOff} title="Couldn’t load your complaints" action={<button className="ns-btn ns-btn-secondary ns-btn-sm" onClick={() => reload()}>Try again</button>}>{error.message}</Empty>
        : !list.length ? <Empty icon={FileText} title="No complaints yet" action={<Link className="ns-btn ns-btn-primary ns-btn-sm" to="/file">File a complaint</Link>}>Complaints you file appear here with their live status.</Empty>
        : !shown.length ? <Empty icon={SearchX} title="No matches" action={<button className="ns-btn ns-btn-secondary ns-btn-sm" onClick={() => { setQ(''); setF(''); setDept(''); }}>Clear filters</button>}>Nothing matches these filters.</Empty>
        : <div className="ns-list inset fade-in">{shown.map(c => <ComplaintRow key={c.complaint_id} u={c} to={`/complaints/${c.complaint_id}`} />)}</div>}
    </AppShell>
  );
}
