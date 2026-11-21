import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Bot, WifiOff } from 'lucide-react';
import { api } from '../api/client';
import type { AgentCard } from '../api/types';
import { useAuth } from '../auth';
import { AppShell } from '../components/AppShell';
import { Drawer } from '../components/Overlays';
import { Empty, Skeleton, Status } from '../components/ui';
import { useAsync } from '../lib/hooks';
import { agentIcon, deptName } from '../lib/status';

export default function Agents() {
  const { user } = useAuth();
  const { data, error, loading, reload } = useAsync(api.agents, []);
  const [card, setCard] = useState<AgentCard | null>(null);
  const online = data?.filter(a => !a._offline).length ?? 0;

  return (
    <AppShell crumbs={[{ label: 'Agents' }]}>
      <div className="page-head">
        <div>
          <h1 className="ns-title">Agents</h1>
          <p>The Orchestrator knows only these agents’ addresses. Everything else — names, skills, endpoints — is read from each agent’s <span className="mono" style={{ fontSize: 13 }}>/.well-known/agent-card.json</span>.</p>
        </div>
        {data && <Status tone={online ? 'done' : 'error'}>{online} of {data.length} online</Status>}
      </div>
      {loading && !data ? <div className="agents">{[0, 1, 2, 3].map(i => <Skeleton key={i} h={210} r={18} />)}</div>
        : error ? <Empty icon={WifiOff} title="Couldn’t reach the Orchestrator" action={<button className="ns-btn ns-btn-secondary ns-btn-sm" onClick={() => reload()}>Try again</button>}>{error.message}</Empty>
        : !data?.length ? <Empty icon={Bot} title="No agents discovered">Start the department agents with python run_all.py.</Empty>
        : <div className="agents fade-in">{data.map(a => {
            const I = agentIcon(a.key);
            const canOpen = user && (user.role === 'admin' || (user.role === 'officer' && user.department === a.key));
            return (
              <article className="agent" key={a.key}>
                <div className="hd">
                  <span className="ic"><I aria-hidden="true" /></span>
                  <div className="grow"><h3>{a.name}</h3><div className="u">{a.url || a._base}</div></div>
                  <Status tone={a._offline ? 'error' : 'done'}>{a._offline ? 'Offline' : 'Online'}</Status>
                </div>
                {a.description && <p>{a.description}</p>}
                <div className="ns-footnote">{[a.provider?.organization, a.protocolVersion && `A2A ${a.protocolVersion}`, a.preferredTransport].filter(Boolean).join(' · ')}</div>
                {!!a.skills?.length && <div className="skills" aria-label="Skills">{a.skills.map(s => <span key={s.id} title={s.description || s.name}>{s.id}</span>)}</div>}
                <div className="ft">
                  <button className="link" type="button" onClick={() => setCard(a)}>View Agent Card</button>
                  {canOpen && <Link className="link" to={`/dept/${a.key}`}>Open {deptName(a.key)} queue</Link>}
                </div>
              </article>
            );
          })}</div>}
      {card && (
        <Drawer onClose={() => setCard(null)} title={<div><div style={{ fontSize: 15, fontWeight: 600 }}>{card.name}</div><div className="ns-footnote mono">agent-card.json</div></div>}>
          {!!card.skills?.length && <>
            <h3 style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Skills</h3>
            <div className="ns-list inset" style={{ marginBottom: 20 }}>
              {card.skills.map(s => <div className="ns-item" key={s.id} style={{ gridTemplateColumns: '1fr' }}><div><div className="t">{s.name || s.id}</div><div className="m"><span className="mono" style={{ fontSize: 12 }}>{s.id}</span>{s.description && ` · ${s.description}`}</div></div></div>)}
            </div>
          </>}
          <h3 style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Raw card</h3>
          <pre>{JSON.stringify(Object.fromEntries(Object.entries(card).filter(([k]) => !k.startsWith('_') && k !== 'key')), null, 2)}</pre>
        </Drawer>
      )}
    </AppShell>
  );
}
