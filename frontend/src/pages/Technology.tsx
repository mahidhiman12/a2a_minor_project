import { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Code, FileText, GitFork, Languages, MessageCircle, Network, Server } from 'lucide-react';
import { api } from '../api/client';
import { useAuth } from '../auth';
import { PublicFooter, PublicPage } from '../components/Public';
import { ListSkeleton, Reveal, Status } from '../components/ui';
import { Timeline, WorkflowGraph } from '../components/Workflow';
import { useAsync, useInterval } from '../lib/hooks';
import { deptIcon, deptName } from '../lib/status';
import type { RunView } from '../lib/trail';

/** A finished two-department run, used as the illustration on this page. */
const DEMO_RUN: RunView = {
  concierge: 'done', orchestrator: 'active', orchSub: 'tracking 2 tasks', liveEdge: null,
  depts: [
    { key: 'water', name: 'Water Board', state: 'done', sub: 'DJB-261121-0004', edge: 'done' },
    { key: 'roads', name: 'Municipal Roads', state: 'active', sub: 'working', edge: 'live' },
    { key: 'electricity', name: 'Electricity', state: 'idle', sub: 'not involved', edge: 'idle' },
  ],
  steps: [
    { key: 'discover', label: 'Discover', long: 'Discovered agents', state: 'done', at: 40, detail: '4 Agent Cards read' },
    { key: 'decompose', label: 'Decompose', long: 'Split into 2 tasks', state: 'done', at: 60, detail: 'water_pipe_burst, excavation_damage' },
    { key: 'dispatch', label: 'Dispatch', long: 'Dispatched', state: 'done', at: 210, detail: 'message/send × 2' },
    { key: 'track', label: 'Track', long: 'Tracking', state: 'now', at: 480, detail: 'tasks/get · Roads working' },
    { key: 'aggregate', label: 'Aggregate', long: 'Combined status', state: 'pending', detail: 'Waiting for Roads' },
  ],
};

const LAYERS = [
  { icon: MessageCircle, name: 'Citizen Concierge', role: 'Host agent and web API',
    text: 'Talks to the citizen, extracts the issues, place and urgency (rules engine for English and Hinglish, or Ollama / Gemini with automatic fallback), geocodes the place with OpenStreetMap Nominatim, and serves this website.' },
  { icon: GitFork, name: 'Orchestrator', role: 'LangGraph state machine',
    text: 'Discovers department agents from their Agent Cards, splits a complaint into one task per department, dispatches them in parallel over A2A, tracks each task and combines the answers into one status with a coordination plan.' },
  { icon: Server, name: 'Department agents', role: 'Water · Electricity · Roads · Sanitation',
    text: 'Independent services, each with its own ticket database, zone offices, crews, SLAs and duplicate detection. They know nothing about each other; the Orchestrator coordinates them.' },
];

export default function Technology() {
  const { user } = useAuth();
  const { hash } = useLocation();
  const { data, loading, reload } = useAsync(api.publicOverview, []);
  useInterval(() => reload(true), 30000);
  useEffect(() => { if (hash) setTimeout(() => document.getElementById(hash.slice(1))?.scrollIntoView({ behavior: 'smooth' }), 60); }, [hash]);
  const fileTo = user ? (user.role === 'citizen' ? '/file' : '/home') : '/login?next=/file';

  return (
    <PublicPage>
      <main className="lp">
        <section className="sec" style={{ paddingTop: 72 }}>
          <Reveal className="sec-head wrap">
            <span className="ns-eyebrow">Technology</span>
            <h1 className="ns-headline">A team of AI agents<br />behind one front door.</h1>
            <p className="ns-lead">Every department is an independent agent. They speak an open protocol, Agent2Agent (A2A), so every request and reply between them can be inspected.</p>
          </Reveal>
          <Reveal style={{ padding: '0 22px' }}>
            <WorkflowGraph run={DEMO_RUN} citizenSub="Laxmi Nagar" conciergeSub="2 issues found"
              label="Agent workflow: citizen to Concierge to Orchestrator, which dispatches to Water Board (completed) and Municipal Roads (working); Electricity is not involved" />
          </Reveal>
        </section>

        <section className="sec subtle" id="architecture">
          <Reveal className="sec-head wrap"><span className="ns-eyebrow">Architecture</span><h2 className="ns-headline">Three kinds of agent.</h2></Reveal>
          <Reveal className="feats" style={{ marginTop: 0 }}>
            {LAYERS.map(l => (
              <div key={l.name}><l.icon aria-hidden="true" /><h4>{l.name}</h4><p className="ns-footnote" style={{ marginBottom: 8 }}>{l.role}</p><p>{l.text}</p></div>
            ))}
          </Reveal>
          <Reveal className="feats">
            <div><FileText aria-hidden="true" /><h4>Discovery by Agent Card.</h4><p>Each agent publishes <span className="mono">/.well-known/agent-card.json</span> listing its skills. A new department joins just by publishing one.</p></div>
            <div><Network aria-hidden="true" /><h4>JSON-RPC over HTTP.</h4><p>Tasks are created with <span className="mono">message/send</span> and followed with <span className="mono">tasks/get</span>, using the standard A2A task states.</p></div>
            <div><Code aria-hidden="true" /><h4>A full audit trail.</h4><p>Every JSON-RPC message, task state and timing is recorded against the complaint ID and can be replayed step by step.</p></div>
          </Reveal>
        </section>

        <section className="sec" id="run">
          <Reveal className="sec-head wrap"><span className="ns-eyebrow">One run</span><h2 className="ns-headline">Five steps, in under a second.</h2><p className="ns-lead">The Orchestrator’s run for a pipe burst caused by road work: two departments, one combined status.</p></Reveal>
          <Reveal style={{ maxWidth: 560, margin: '0 auto', padding: '0 22px' }}><Timeline steps={DEMO_RUN.steps} /></Reveal>
        </section>

        <section className="sec subtle" id="agents">
          <Reveal className="sec-head wrap"><span className="ns-eyebrow">Live</span><h2 className="ns-headline">Department agents right now.</h2><p className="ns-lead">Read from each agent’s Agent Card, refreshed every 30 seconds.</p></Reveal>
          <div style={{ maxWidth: 720, margin: '0 auto', padding: '0 22px' }}>
            {loading && !data ? <ListSkeleton rows={4} />
              : !data?.departments.length ? <p className="ns-footnote" style={{ textAlign: 'center' }}>No department agents are reachable right now.</p>
              : <div className="ns-list inset">{data.departments.map(d => {
                  const I = deptIcon(d.key);
                  return (
                    <div className="ns-item" key={d.key}>
                      <span className="ic"><I aria-hidden="true" /></span>
                      <div style={{ minWidth: 0 }}><div className="t">{deptName(d.key, d.name?.replace(/ Agent$/, ''))}</div><div className="m ellipsis">{d.skills.join(' · ')}</div></div>
                      <Status tone={d.online ? 'done' : 'error'}>{d.online ? 'Online' : 'Offline'}</Status>
                    </div>);
                })}</div>}
          </div>
        </section>

        <section className="stats sec" id="evaluation"><div className="wrap">
          <Reveal className="sec-head" style={{ padding: 0 }}><span className="ns-eyebrow">Evaluation</span><h2 className="ns-headline">Does the routing work?</h2></Reveal>
          <Reveal className="grid4">
            <div className="ns-stat"><span className="v">85%</span><span className="k">of unseen complaints routed to exactly the right departments, versus 60% for a one-department portal.</span></div>
            <div className="ns-stat"><span className="v">5<small>of 6</small></span><span className="k">multi-department complaints fully routed. A single-desk portal routes none.</span></div>
            <div className="ns-stat"><span className="v">100%</span><span className="k">of locations understood, from metro stations to “kamla nagar me”.</span></div>
            <div className="ns-stat"><span className="v"><Languages width={36} height={36} aria-hidden="true" /></span><span className="k">English and Hinglish, with the rules engine alone. No paid API needed.</span></div>
          </Reveal>
          <p className="ns-footnote src">Held-out evaluation set of 20 complaints, rules engine (python evaluate.py).</p>
        </div></section>

        <section className="sec subtle cta"><div className="wrap">
          <Reveal>
            <h2 className="ns-headline">See it on a real complaint.</h2>
            <p className="ns-lead" style={{ marginTop: 20 }}>File one, then open it and choose “See how the agents handled this”. Turn on Settings → Show technical details to keep these views on.</p>
            <div className="ctas">
              <Link className="ns-btn ns-btn-primary ns-btn-lg" to={fileTo}>File a complaint</Link>
              <a className="ns-btn ns-btn-secondary ns-btn-lg" href="/docs" target="_blank" rel="noreferrer">API reference</a>
            </div>
          </Reveal>
        </div></section>
      </main>
      <PublicFooter />
    </PublicPage>
  );
}
