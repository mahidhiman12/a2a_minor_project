import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { ApiError } from '../api/client';
import { homeFor, Splash, useAuth } from '../auth';
import { PublicPage } from '../components/Public';
import { Segmented } from '../components/ui';

const DEMO = ['citizen1', 'water_officer', 'roads_officer', 'electricity_officer', 'admin'];

/** Only same-site paths are allowed as a post-login destination. */
const safeNext = (n: string | null) => (n && n.startsWith('/') && !n.startsWith('//') ? n : null);

export default function Login() {
  const { user, loading, login, register } = useAuth();
  const [params] = useSearchParams();
  const nav = useNavigate();
  const next = safeNext(params.get('next'));
  const [mode, setMode] = useState<'in' | 'up'>(params.get('mode') === 'register' ? 'up' : 'in');
  const [f, setF] = useState({ name: '', username: '', password: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  if (loading) return <Splash />;
  if (user && !busy) return <Navigate to={next && user.role !== 'officer' ? next : homeFor(user)} replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr('');
    if (mode === 'up' && f.password.length < 8) { setErr('Use at least 8 characters for your password.'); return; }
    setBusy(true);
    try {
      const u = mode === 'in' ? await login(f.username.trim(), f.password) : await register(f.username.trim(), f.password, f.name.trim() || undefined);
      const citizenOnly = next && /^\/(home|file|complaints)/.test(next) && u.role !== 'citizen' && !(u.role === 'admin' && next.startsWith('/complaints'));
      nav(next && !citizenOnly && u.role !== 'officer' ? next : homeFor(u), { replace: true });
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2.message : 'Something went wrong. Try again.');
      setBusy(false);
    }
  }

  return (
    <PublicPage links={false}>
      <main className="auth page-enter">
        <div className="box">
          <h1 className="ns-title">{mode === 'in' ? 'Sign in' : 'Create your account'}</h1>
          <p className="ns-lead sub" style={{ fontSize: 17 }}>{mode === 'in' ? 'Citizens, department officers and administrators.' : 'Citizen accounts only. Officers get theirs from their department.'}</p>
          <div style={{ display: 'flex', justifyContent: 'center', marginTop: 24 }}>
            <Segmented label="Account" value={mode} onChange={m => { setMode(m); setErr(''); }} options={[{ value: 'in', label: 'Sign in' }, { value: 'up', label: 'Create account' }]} />
          </div>
          <form onSubmit={submit} noValidate>
            {mode === 'up' && (
              <div className="ns-field"><label htmlFor="name">Your name</label>
                <div className="ns-input"><input id="name" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} autoComplete="name" placeholder="Asha Verma" /></div></div>
            )}
            <div className="ns-field"><label htmlFor="u">Username</label>
              <div className={`ns-input${err ? ' is-error' : ''}`}><input id="u" value={f.username} onChange={e => setF({ ...f, username: e.target.value })} autoComplete="username" autoCapitalize="none" spellCheck={false} required /></div></div>
            <div className="ns-field"><label htmlFor="p">Password</label>
              <div className={`ns-input${err ? ' is-error' : ''}`}><input id="p" type="password" value={f.password} onChange={e => setF({ ...f, password: e.target.value })} autoComplete={mode === 'in' ? 'current-password' : 'new-password'} required /></div>
              {mode === 'up' && <span className="ns-help">At least 8 characters.</span>}</div>
            <p className="err" role="alert">{err}</p>
            <button className="ns-btn ns-btn-primary ns-btn-lg" type="submit" disabled={busy || !f.username.trim() || !f.password}>
              {busy ? <span className="spin" aria-label="Signing in" /> : mode === 'in' ? 'Continue' : 'Create account'}
            </button>
          </form>
          {mode === 'in' && (
            <div className="demo">
              Demo accounts — tap to fill the username. Passwords are the <span className="mono">DEMO_*_PASSWORD</span> values in your <span className="mono">.env</span>.
              <div className="chips">{DEMO.map(u => <button key={u} type="button" className={`ns-chip${f.username === u ? ' on' : ''}`} onClick={() => setF({ ...f, username: u })}>{u}</button>)}</div>
            </div>
          )}
          <p className="switch"><Link to="/" className="link">Back to home</Link></p>
        </div>
      </main>
    </PublicPage>
  );
}
