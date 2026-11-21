import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import type { NluMode } from '../api/types';
import { useAuth } from '../auth';
import { AppShell } from '../components/AppShell';
import { useToast } from '../components/Overlays';
import { Avatar, Segmented, Status } from '../components/ui';
import { useAsync } from '../lib/hooks';
import { readNlu, useTechPref, writeNlu } from '../lib/prefs';
import { deptName } from '../lib/status';
import { readTheme, setTheme, type Theme } from '../lib/theme';

const ENGINES: { value: NluMode; label: string; note: string }[] = [
  { value: 'rules', label: 'Rules', note: 'Free and offline. A weighted English and Hinglish lexicon.' },
  { value: 'ollama', label: 'Ollama', note: 'A local language model on this machine. Falls back to rules if it is not running.' },
  { value: 'gemini', label: 'Gemini', note: 'Google’s free tier. Needs GOOGLE_API_KEY on the server; falls back to rules otherwise.' },
];

export default function Settings() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const cfg = useAsync(api.config, []);
  const [engine, setEngine] = useState<NluMode | null>(readNlu());
  const [theme, setThemeState] = useState<Theme>(readTheme());
  const [techPref, setTechPref] = useTechPref();
  if (!user) return null;
  const tech = user.role !== 'citizen' || techPref;
  const current = engine ?? (cfg.data?.nlu_mode as NluMode | undefined) ?? 'rules';
  const info = ENGINES.find(e => e.value === current)!;

  return (
    <AppShell crumbs={[{ label: 'Settings' }]}>
      <div className="settings">
        <div className="page-head" style={{ marginBottom: 8 }}><div><h1 className="ns-title">Settings</h1></div></div>

        <div className="grp">
          <h2>Account</h2>
          <div className="ns-list inset">
            <div className="ns-item" style={{ gridTemplateColumns: 'auto 1fr' }}><Avatar name={user.display_name} /><div><div className="t" style={{ fontWeight: 600 }}>{user.display_name}</div><div className="m">@{user.username}</div></div></div>
            <div className="ns-item"><span className="t">Role</span><span className="ns-muted">{user.role === 'officer' ? `${deptName(user.department)} officer` : user.role === 'admin' ? 'Administrator' : 'Citizen'}</span></div>
            <button type="button" className="ns-item" style={{ gridTemplateColumns: '1fr', color: 'var(--link, var(--ink))', textAlign: 'left' }} onClick={() => nav('/login?switch=1')}>Use another account in this tab</button>
          </div>
          <p>Each tab can be signed in as a different person, so a citizen and an officer can be open side by side.</p>
        </div>

        <div className="grp">
          <h2>Password</h2>
          <PasswordForm />
        </div>

        {user.role === 'citizen' && (
          <div className="grp">
            <h2>Behind the scenes</h2>
            <div className="ns-list inset">
              <div className="ns-item"><span className="t">Show technical details</span>
                <Segmented label="Show technical details" value={techPref ? 'on' : 'off'} onChange={v => setTechPref(v === 'on')}
                  options={[{ value: 'off', label: 'Off' }, { value: 'on', label: 'On' }]} /></div>
            </div>
            <p>See how the AI agents handle your complaints: the agent workflow, the audit trail of their messages, and the choice of language engine. Stored in this browser.</p>
          </div>
        )}

        {user.role === 'citizen' && tech && (
          <div className="grp">
            <h2>Concierge language engine</h2>
            <div className="ns-list inset">
              <div className="ns-item"><span className="t">Engine</span>
                <Segmented label="Language engine" value={current} onChange={v => { setEngine(v); writeNlu(v); toast('Language engine', `New messages use ${ENGINES.find(e => e.value === v)!.label}.`, 'ok'); }}
                  options={ENGINES.map(e => ({ value: e.value, label: e.label }))} /></div>
              {cfg.data && <>
                <div className="ns-item"><span className="t">Server default</span><span className="ns-muted">{ENGINES.find(e => e.value === cfg.data!.nlu_mode)?.label ?? cfg.data.nlu_mode}</span></div>
                {current === 'ollama' && <div className="ns-item"><span className="t">Ollama model</span><span className="mono ns-muted" style={{ fontSize: 13 }}>{cfg.data.ollama_model}</span></div>}
                {current === 'gemini' && <div className="ns-item"><span className="t">Gemini</span><Status tone={cfg.data.gemini_key_set ? 'done' : 'pending'}>{cfg.data.gemini_key_set ? `Key set · ${cfg.data.gemini_model}` : 'No API key on the server'}</Status></div>}
              </>}
            </div>
            <p>{info.note} Stored in this browser.</p>
          </div>
        )}

        <div className="grp">
          <h2>Appearance</h2>
          <div className="ns-list inset">
            <div className="ns-item"><span className="t">Theme</span>
              <Segmented label="Theme" value={theme} onChange={t => { setThemeState(t); setTheme(t); }}
                options={[{ value: 'system', label: 'Automatic' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]} /></div>
          </div>
        </div>

        {cfg.data && tech && (
          <div className="grp">
            <h2>System</h2>
            <div className="ns-list inset">
              <div className="ns-item"><span className="t">Orchestrator</span><span className="mono ns-muted" style={{ fontSize: 13 }}>{cfg.data.orchestrator}</span></div>
              <div className="ns-item"><span className="t">API reference</span><a className="link" href="/docs" target="_blank" rel="noreferrer">Open /docs</a></div>
            </div>
          </div>
        )}

        <div className="grp">
          <div className="ns-list inset">
            <button type="button" className="ns-item" style={{ gridTemplateColumns: '1fr', color: 'var(--red-ink)' }} onClick={async () => { await logout(); nav('/'); }}>Sign out</button>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function PasswordForm() {
  const toast = useToast();
  const [f, setF] = useState({ current: '', next: '', again: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => { setF({ ...f, [k]: e.target.value }); setErr(''); };
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (f.next.length < 8) { setErr('Use at least 8 characters for the new password.'); return; }
    if (f.next !== f.again) { setErr('The two new passwords don’t match.'); return; }
    setBusy(true);
    try {
      await api.changePassword(f.current, f.next);
      setF({ current: '', next: '', again: '' });
      toast('Password changed', 'Use the new password next time you sign in.', 'ok');
    } catch (e2) { setErr(e2 instanceof ApiError && e2.status === 401 ? '' : (e2 as Error).message); }
    finally { setBusy(false); }
  }
  return (
    <form className="upd" onSubmit={submit} noValidate>
      <div className="ns-field" style={{ marginTop: 0 }}><label htmlFor="pw-cur">Current password</label>
        <input id="pw-cur" className="text" type="password" value={f.current} onChange={set('current')} autoComplete="current-password" /></div>
      <div className="grid2">
        <div className="ns-field"><label htmlFor="pw-new">New password</label>
          <input id="pw-new" className="text" type="password" value={f.next} onChange={set('next')} autoComplete="new-password" /></div>
        <div className="ns-field"><label htmlFor="pw-again">New password again</label>
          <input id="pw-again" className="text" type="password" value={f.again} onChange={set('again')} autoComplete="new-password" /></div>
      </div>
      {err && <p className="ns-help is-error" role="alert">{err}</p>}
      <button className="ns-btn ns-btn-primary" type="submit" disabled={busy || !f.current || !f.next}>{busy ? <span className="spin" aria-label="Saving" /> : 'Change password'}</button>
    </form>
  );
}
