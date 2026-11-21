import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import type { NluMode } from '../api/types';
import { useAuth } from '../auth';
import { AppShell } from '../components/AppShell';
import { useToast } from '../components/Overlays';
import { Avatar, Segmented, Status } from '../components/ui';
import { useAsync } from '../lib/hooks';
import { readNlu, writeNlu } from '../lib/prefs';
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
  if (!user) return null;
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
          </div>
          <p>Names and passwords can’t be changed here yet — the backend has no account-editing endpoint.</p>
        </div>

        {user.role === 'citizen' && (
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

        {cfg.data && (
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
