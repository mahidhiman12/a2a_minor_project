import { useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import {
  BarChart3, Bot, ChevronRight, House, Inbox, LayoutGrid, Landmark, List, LogOut, Map as MapIcon, Plus, Settings, Users,
} from 'lucide-react';
import { api } from '../api/client';
import type { Department } from '../api/types';
import { useAuth } from '../auth';
import { useTechView } from '../lib/prefs';
import { deptIcon, deptName } from '../lib/status';
import { Avatar } from './ui';

export interface Crumb { label: string; to?: string }
interface Item { to: string; label: string; icon: typeof House; end?: boolean }

let deptCache: Department[] | null = null;
function useDepartments() {
  const [d, setD] = useState<Department[] | null>(deptCache);
  useEffect(() => { api.departments().then(x => { deptCache = x; setD(x); }).catch(() => setD(deptCache ?? [])); }, []);
  return d;
}

export function AppShell({ crumbs = [], children, wide, bare, actions }: { crumbs?: Crumb[]; children: ReactNode; wide?: boolean; bare?: boolean; actions?: ReactNode }) {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const depts = useDepartments();
  const tech = useTechView();
  if (!user) return null;
  const role = user.role;
  const main: Item[] = role === 'citizen'
    ? [{ to: '/home', label: 'Home', icon: House }, { to: '/file', label: 'File a complaint', icon: Plus },
       { to: '/complaints', label: 'My complaints', icon: List }]
    : role === 'admin'
      ? [{ to: '/admin', label: 'Overview', icon: LayoutGrid, end: true }, { to: '/admin/performance', label: 'Performance', icon: BarChart3 },
         { to: '/admin/people', label: 'People', icon: Users }]
      : [{ to: `/dept/${user.department}`, label: 'Ticket queue', icon: Inbox }];
  // Citizens see the Agent Card directory only with "Show technical details" on.
  const more: Item[] = [...(tech ? [{ to: '/agents', label: 'Agents', icon: Bot }] : []), { to: '/map', label: 'Hotspot map', icon: MapIcon }];
  const tabs: Item[] = [...main.slice(0, 3), more[0], { to: '/settings', label: 'Settings', icon: Settings }];
  const online = depts?.filter(d => d.online).length;

  return (
    <div className="shell">
      <aside aria-label="Sidebar">
        <Link className="brand" to="/"><Landmark aria-hidden="true" />Nagrik Sahayak</Link>
        {main.map(i => <SideLink key={i.to} {...i} />)}
        {role === 'admin' && !!depts?.length && <>
          <div className="grp" style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-tertiary)', padding: '16px 10px 6px' }}>Departments</div>
          {depts.map(d => { const I = deptIcon(d.key); return (
            <NavLink key={d.key} to={`/dept/${d.key}`} className={({ isActive }) => `ns-nav${isActive ? ' on' : ''}`}>
              <I aria-hidden="true" />{deptName(d.key, d.name?.replace(/ Agent$/, ''))}<span className={`ns-status ${d.online ? 'done' : 'error'}`} aria-label={d.online ? 'online' : 'offline'} />
            </NavLink>); })}
        </>}
        <div className="grp" style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink-tertiary)', padding: '16px 10px 6px' }}>{tech ? 'System' : 'More'}</div>
        {more.map(i => <SideLink key={i.to} {...i} />)}
        <SideLink to="/settings" label="Settings" icon={Settings} />
        <div className="side-foot">
          {tech && <span className={`ns-status ${online === undefined ? 'idle' : online ? 'done' : 'error'}`} style={{ fontSize: 12 }}>
            {online === undefined ? 'Checking agents…' : `${online} department agent${online === 1 ? '' : 's'} online`}
          </span>}
          <div className="me">
            <Avatar name={user.display_name} />
            <div className="grow"><div className="n ellipsis">{user.display_name}</div>
              <div className="r">{role === 'officer' ? `${deptName(user.department)} officer` : role === 'admin' ? 'Administrator' : 'Citizen'}</div></div>
            <button type="button" className="icon-btn" aria-label="Sign out" title="Sign out" onClick={async () => { await logout(); nav('/'); }}><LogOut /></button>
          </div>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <Link className="phone-brand" to="/"><Landmark aria-hidden="true" />Nagrik Sahayak</Link>
          <nav className="crumbs" aria-label="Breadcrumb">
            {crumbs.map((c, i) => (
              <span key={i} className="row" style={{ gap: 6 }}>
                {i > 0 && <ChevronRight aria-hidden="true" />}
                {c.to && i < crumbs.length - 1 ? <Link to={c.to}>{c.label}</Link> : <b>{c.label}</b>}
              </span>
            ))}
          </nav>
          <div className="right">
            {actions}
            {role === 'citizen' && <Link to="/file" className="ns-btn ns-btn-primary ns-btn-sm"><Plus aria-hidden="true" />New complaint</Link>}
          </div>
        </header>
        {bare ? children : <div className={`content page-enter${wide ? ' wide' : ''}`}>{children}</div>}
      </div>
      <nav className="tabbar" aria-label="Sections">
        {tabs.map(t => <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => (isActive ? 'on' : '')}><t.icon aria-hidden="true" /><span>{t.label.replace('File a complaint', 'File').replace('My complaints', 'Complaints')}</span></NavLink>)}
      </nav>
    </div>
  );
}

function SideLink({ to, label, icon: I, end }: Item) {
  return <NavLink to={to} end={end} className={({ isActive }) => `ns-nav${isActive ? ' on' : ''}`}><I aria-hidden="true" />{label}</NavLink>;
}
