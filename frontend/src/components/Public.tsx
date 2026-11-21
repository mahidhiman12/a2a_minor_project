import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Landmark, Menu, X } from 'lucide-react';
import { homeFor, useAuth } from '../auth';

export function PublicNav({ links = true }: { links?: boolean }) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const nav = useNavigate();
  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = 'hidden';
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', k);
    return () => { document.body.style.overflow = ''; window.removeEventListener('keydown', k); };
  }, [open]);
  const go = (to: string) => { setOpen(false); if (to.startsWith('/#')) { nav('/'); setTimeout(() => document.getElementById(to.slice(2))?.scrollIntoView({ behavior: 'smooth' }), 60); } else nav(to); };
  const fileTo = user ? (user.role === 'citizen' ? '/file' : homeFor(user)) : '/login?next=/file';

  return (
    <>
      <header className="pb-nav"><div className="wrap">
        <Link className="pb-logo" to="/"><Landmark aria-hidden="true" />Nagrik Sahayak</Link>
        {links && <nav className="pb-links" aria-label="Main">
          <a href="/#how" onClick={e => { e.preventDefault(); go('/#how'); }}>How it works</a>
          <a href="/#departments" onClick={e => { e.preventDefault(); go('/#departments'); }}>Departments</a>
          <a href="/#track" onClick={e => { e.preventDefault(); go('/#track'); }}>Track a complaint</a>
          <a href="/#agents" onClick={e => { e.preventDefault(); go('/#agents'); }}>About</a>
        </nav>}
        <div className="right" style={links ? undefined : { marginLeft: 'auto' }}>
          {user
            ? <Link className="ns-btn ns-btn-primary ns-btn-sm" to={homeFor(user)}>Open app</Link>
            : <><Link className="txt" to="/login">Sign in</Link><Link className="ns-btn ns-btn-primary ns-btn-sm" to={fileTo}>File a complaint</Link></>}
        </div>
        <button type="button" className="icon-btn pb-menu" aria-label="Open menu" aria-expanded={open} onClick={() => setOpen(true)}><Menu /></button>
      </div></header>
      {open && (
        <div className="pb-sheet" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="hd"><span className="pb-logo"><Landmark aria-hidden="true" />Nagrik Sahayak</span>
            <button type="button" className="icon-btn" aria-label="Close menu" onClick={() => setOpen(false)}><X /></button></div>
          <nav>
            <a href="/#how" onClick={e => { e.preventDefault(); go('/#how'); }}>How it works</a>
            <a href="/#departments" onClick={e => { e.preventDefault(); go('/#departments'); }}>Departments</a>
            <a href="/#track" onClick={e => { e.preventDefault(); go('/#track'); }}>Track a complaint</a>
            <a href="/#agents" onClick={e => { e.preventDefault(); go('/#agents'); }}>About</a>
          </nav>
          <div className="sub">For department officers<a href="/login" onClick={e => { e.preventDefault(); go('/login'); }}>Sign in to the workspace</a></div>
          <div className="ft">
            {user
              ? <button type="button" className="ns-btn ns-btn-primary ns-btn-lg" onClick={() => go(homeFor(user))}>Open app</button>
              : <><button type="button" className="ns-btn ns-btn-primary ns-btn-lg" onClick={() => go(fileTo)}>File a complaint</button>
                <button type="button" className="ns-btn ns-btn-secondary ns-btn-lg" onClick={() => go('/login')}>Sign in</button></>}
          </div>
        </div>
      )}
    </>
  );
}

export function PublicFooter() {
  return (
    <footer className="pb-foot"><div className="wrap">
      <div className="note">Department agents, tickets and crews are simulated for demonstration. Activity shown on this page is anonymised: issue type, locality and status only.</div>
      <div className="grid">
        <div><h5>Nagrik Sahayak</h5><ul><li>A multi-department civic grievance system built on the Agent2Agent protocol.</li></ul></div>
        <div><h5>Citizens</h5><ul><li><Link to="/login?next=/file">File a complaint</Link></li><li><a href="/#track">Track a complaint</a></li><li><a href="/#how">How it works</a></li></ul></div>
        <div><h5>Departments</h5><ul><li><Link to="/login">Officer sign-in</Link></li><li><a href="/#agents">How agents work</a></li><li><a href="/docs">API reference</a></li></ul></div>
        <div><h5>Project</h5><ul><li><a href="/#stats">Evaluation</a></li><li><a href="https://github.com/mahidhiman12/a2a_minor_project" target="_blank" rel="noreferrer">Source code</a></li></ul></div>
      </div>
      <div className="base"><span>B.Tech IT minor project · ADGIPS, GGSIPU</span><span>Delhi, India</span></div>
    </div></footer>
  );
}

export function PublicPage({ children, links }: { children: ReactNode; links?: boolean }) {
  return <div className="pb"><PublicNav links={links} />{children}</div>;
}
