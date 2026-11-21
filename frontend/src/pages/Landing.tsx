import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowRight, ArrowUp, CircleCheck, Code, FileText, GitFork, Languages, MapPin, MessageCircle,
  Search, ShieldCheck, Sparkles, WifiOff,
} from 'lucide-react';
import { api } from '../api/client';
import type { PublicOverview } from '../api/types';
import { useAuth } from '../auth';
import { PublicFooter, PublicPage } from '../components/Public';
import { Empty, ListSkeleton, PriorityTag, Reveal, Status } from '../components/ui';
import { Timeline, WorkflowGraph } from '../components/Workflow';
import { useAsync, useInterval } from '../lib/hooks';
import { COMPLAINT_ID_RX, deptIcon, deptName, normaliseId } from '../lib/status';
import type { RunView } from '../lib/trail';

const KNOWN = [
  { key: 'water', code: 'DJB', scope: 'Water mains and sewer lines', issues: ['Pipe burst or leakage', 'No water supply', 'Contaminated water', 'Low pressure', 'Sewer overflow'] },
  { key: 'electricity', code: 'ELC', scope: 'Feeders, transformers, streetlights', issues: ['Power outage', 'Live wire or sparking', 'Underground cable damage', 'Transformer fault', 'Voltage fluctuation', 'Streetlight not working'] },
  { key: 'roads', code: 'MCD', scope: 'Roads and footpaths', issues: ['Potholes', 'Unsafe excavation', 'Waterlogging', 'Debris or blocked road', 'Broken footpath'] },
  { key: 'sanitation', code: 'SAN', scope: 'Garbage collection points', issues: ['Garbage not collected', 'Dead animal removal'] },
];

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

const ago = (iso?: string) => {
  if (!iso) return '';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} hr ago`;
  return new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short' });
};

export default function Landing() {
  const { user } = useAuth();
  const nav = useNavigate();
  const { data, error, loading, reload } = useAsync(api.publicOverview, []);
  useInterval(() => reload(true), 30000);
  const fileTo = user ? (user.role === 'citizen' ? '/file' : '/home') : '/login?next=/file';

  return (
    <PublicPage>
      <main className="lp">
        {/* HERO */}
        <section className="hero"><div className="wrap">
          <span className="status">
            {data && data.agents_online > 0
              ? <><span className="ns-live ok" />{data.agents_online} department agent{data.agents_online === 1 ? '' : 's'} online · Delhi</>
              : 'Delhi civic grievance platform'}
          </span>
          <h1 className="ns-display">One complaint. <span>Every department<br />that can fix it.</span></h1>
          <p className="ns-lead">Describe the problem in your own words — English or Hinglish. Our agents find every department involved, file a ticket with each one, and give you a single status to follow.</p>
          <div className="ctas">
            <Link className="ns-btn ns-btn-primary ns-btn-lg" to={fileTo}>File a complaint</Link>
            <a className="ns-btn ns-btn-secondary ns-btn-lg" href="#track" onClick={e => { e.preventDefault(); document.getElementById('track')?.scrollIntoView({ behavior: 'smooth' }); }}>Track a complaint</a>
          </div>
          <div className="trust"><span><Languages aria-hidden="true" />English and Hinglish</span><span><MapPin aria-hidden="true" />Any place in Delhi</span><span><ShieldCheck aria-hidden="true" />Every step auditable</span></div>
        </div>
          <div className="stage" aria-hidden="true">
            <div className="win">
              <div className="bar"><i /><i /><i /><span>Complaint</span><span className="mono">CMP-20261121-0004</span></div>
              <div className="body">
                <div className="main">
                  <span className="ns-caption">Laxmi Nagar · filed 9:41 am</span>
                  <h3>Road repair near the metro broke the water pipe</h3>
                  <div className="meta"><Status value="IN_PROGRESS" /><PriorityTag priority="HIGH" /><span>ETA Sat 22 Nov, 9:15 am</span></div>
                  <div className="grp"><span className="ns-caption">Departments</span>
                    <div className="ns-list inset">
                      {[['water', 'DJB-261121-0004 · Crew C4', 'RESOLVED'], ['roads', 'MCD-261121-0002 · Crew A7', 'IN_PROGRESS']].map(([k, m, s]) => {
                        const I = deptIcon(k); return (
                          <div className="ns-item" key={k}><span className="ic"><I /></span><div><div className="t">{deptName(k)}</div><div className="m mono" style={{ fontSize: 12 }}>{m}</div></div><Status value={s} /></div>);
                      })}
                    </div></div>
                  <p className="plan"><b>Plan</b> — Water Board repairs the pipe first; Roads resurfaces once that ticket is resolved.</p>
                </div>
                <div className="side"><h4>Agent activity</h4><Timeline steps={DEMO_RUN.steps} /></div>
              </div>
            </div>
            <div className="phone"><div className="scr">
              <div className="isl" />
              <div className="hd"><div className="av"><MessageCircle /></div><div className="t">Concierge</div></div>
              <div className="ns-chat">
                <div className="ns-bubble me">Laxmi Nagar metro ke paas road repair se paani ki pipe toot gayi</div>
                <div className="ns-bubble them">I’ve filed this with <b style={{ fontWeight: 600 }}>2 departments</b> — Water Board and Municipal Roads.</div>
                <div className="ns-bubble them">Your ID is <span className="mono" style={{ fontSize: 12 }}>CMP-20261121-0004</span>. Water repairs come first.</div>
                <div className="typing"><i /><i /><i /></div>
              </div>
              <div className="comp">Message<span className="send"><ArrowUp /></span></div>
            </div></div>
          </div>
        </section>

        {/* STATS */}
        <section className="stats" id="stats" style={{ paddingTop: 48 }}><div className="wrap">
          <Reveal className="grid4">
            <div className="ns-stat"><span className="v">{data?.departments.length || 4}<small>agents</small></span><span className="k">Water, Electricity, Roads and Sanitation — each an independent AI agent.</span></div>
            <div className="ns-stat"><span className="v">85%</span><span className="k">of unseen complaints routed to exactly the right departments, versus 60% for a one-department portal.</span></div>
            <div className="ns-stat"><span className="v">5<small>of 6</small></span><span className="k">multi-department complaints fully routed. A single-desk portal routes none.</span></div>
            <div className="ns-stat"><span className="v">100%</span><span className="k">of locations understood, from metro stations to “kamla nagar me”.</span></div>
          </Reveal>
          <p className="ns-footnote src">Held-out evaluation set of 20 complaints, rules engine (python evaluate.py).</p>
        </div></section>

        {/* HOW IT WORKS */}
        <section className="sec subtle" id="how" style={{ marginTop: 80 }}>
          <Reveal className="sec-head wrap"><span className="ns-eyebrow">How it works</span><h2 className="ns-headline">From your words<br />to the right crews.</h2><p className="ns-lead">You talk to one assistant. Behind it, a team of agents coordinates every department your problem touches.</p></Reveal>
          <Reveal className="steps">
            <div className="step"><span className="n">1</span><MessageCircle aria-hidden="true" /><h3 className="ns-title3">You describe it.</h3><p>Type it the way you’d say it. No forms, no department codes.</p><div className="viz"><div className="ns-chat"><div className="ns-bubble me" style={{ fontSize: 13 }}>Rohini me bijli nahi hai subah se</div></div></div></div>
            <div className="step"><span className="n">2</span><Sparkles aria-hidden="true" /><h3 className="ns-title3">The Concierge understands.</h3><p>It finds the issue, the place and the urgency — and asks if anything is missing.</p><div className="viz"><div className="kv"><span>Issue</span><span>power_outage</span></div><div className="kv"><span>Place</span><span>Rohini</span></div><div className="kv"><span>Urgency</span><span>normal</span></div></div></div>
            <div className="step"><span className="n">3</span><GitFork aria-hidden="true" /><h3 className="ns-title3">Agents coordinate.</h3><p>The Orchestrator files a ticket with every department involved, in parallel, over A2A.</p><div className="viz"><div className="kv"><span>Electricity</span><Status value="completed">Ticket filed</Status></div><div className="kv"><span>Ticket</span><span>ELC-261121-0007</span></div><div className="kv"><span>Crew</span><span>B3 · Rohini</span></div></div></div>
            <div className="step"><span className="n">4</span><CircleCheck aria-hidden="true" /><h3 className="ns-title3">You follow one status.</h3><p>One complaint ID and one combined status, even when three departments are involved.</p><div className="viz"><div className="kv"><span>CMP-20261121-0007</span><Status value="IN_PROGRESS" /></div><div className="kv"><span>ETA</span><span>Today, 6:30 pm</span></div></div></div>
          </Reveal>
        </section>

        {/* DEPARTMENTS */}
        <section className="sec" id="departments">
          <Reveal className="sec-head wrap"><span className="ns-eyebrow">Departments</span><h2 className="ns-headline">{(data?.departments.length ?? 4) === 4 ? 'Four departments.' : `${data?.departments.length} departments.`}<br />One front door.</h2><p className="ns-lead">Each department runs its own agent, its own records and its own crews. You never need to know which is which.</p></Reveal>
          <Reveal className="depts">
            {deptList(data).map(d => {
              const I = deptIcon(d.key);
              return (
                <div className="dept" key={d.key}>
                  <I aria-hidden="true" /><h3 className="ns-title3">{deptName(d.key, d.name)}</h3><span className="code">{d.code}</span>
                  <div className="scope">{d.scope}</div>
                  <ul>{d.issues.map(x => <li key={x}>{x}</li>)}</ul>
                  <div className="foot">{d.online === undefined ? <Status tone="idle">Status unknown</Status> : d.online ? <Status tone="done">Online</Status> : <Status tone="error">Offline</Status>}</div>
                </div>
              );
            })}
          </Reveal>
          <p className="dept-new"><b>New departments join on their own.</b> Any agent that publishes an Agent Card is discovered automatically.</p>
        </section>

        {/* AI */}
        <section className="sec subtle" id="agents">
          <Reveal className="sec-head wrap"><span className="ns-eyebrow">AI-powered, openly</span><h2 className="ns-headline">Agents that talk to each other.<br />And show their work.</h2><p className="ns-lead">Every department is an independent agent. They speak an open protocol, Agent2Agent, so every request and reply can be inspected.</p></Reveal>
          <Reveal style={{ padding: '0 22px' }}>
            <WorkflowGraph run={DEMO_RUN} citizenSub="Laxmi Nagar" conciergeSub="2 issues found"
              label="Agent workflow: citizen to Concierge to Orchestrator, which dispatches to Water Board (completed) and Municipal Roads (working); Electricity is not involved" />
          </Reveal>
          <Reveal className="feats">
            <div><Languages aria-hidden="true" /><h4>Understands how Delhi talks.</h4><p>A Hinglish-aware rules engine, with optional Ollama or Gemini — and an automatic fallback so it never goes silent.</p></div>
            <div><FileText aria-hidden="true" /><h4>Discovers who can help.</h4><p>Each agent publishes an Agent Card listing what it handles. The Orchestrator reads them to decide where a complaint goes.</p></div>
            <div><Code aria-hidden="true" /><h4>Leaves an audit trail.</h4><p>Every JSON-RPC message, task state and timing is recorded against the complaint ID.</p></div>
          </Reveal>
        </section>

        {/* ACTIVITY */}
        <section className="sec">
          <Reveal className="sec-head wrap"><span className="ns-eyebrow">Across the city</span><h2 className="ns-headline">What Delhi is<br />reporting right now.</h2><p className="ns-lead">Anonymised activity — where complaints come from and how they are moving.</p></Reveal>
          <div className="act">
            <div>
              <div className="feedhd"><h3 className="ns-title3">Hotspots</h3><span className="ns-footnote">complaints per locality</span></div>
              {loading && !data ? <ListSkeleton rows={3} />
                : !data?.hotspots.length ? <Empty icon={MapPin} title="No hotspots yet">Localities appear here once complaints come in.</Empty>
                : <div className="hots">{data.hotspots.map(h => {
                    const max = Math.max(...data.hotspots.map(x => x.complaints));
                    return <div className="hot" key={h.locality}><span className="ellipsis">{h.locality}</span><div className="bar"><i style={{ width: `${(h.complaints / max) * 100}%` }} /></div><span>{h.complaints}</span></div>;
                  })}</div>}
            </div>
            <div>
              <div className="feedhd"><h3 className="ns-title3">Latest</h3>{data && !error && <Status tone="active" live>Live</Status>}</div>
              {loading && !data ? <ListSkeleton rows={4} />
                : error || !data ? <Empty icon={WifiOff} title="Live activity is unavailable" action={<button className="ns-btn ns-btn-secondary ns-btn-sm" onClick={() => reload()}>Try again</button>}>Filing and tracking still work.</Empty>
                : !data.recent.length ? <Empty icon={Sparkles} title="No complaints yet" action={<Link className="ns-btn ns-btn-primary ns-btn-sm" to={fileTo}>File a complaint</Link>}>Be the first — it takes about a minute.</Empty>
                : <div className="ns-list inset">{data.recent.map((r, i) => {
                    const I = deptIcon(r.departments[0]);
                    return (
                      <div className="ns-item" key={i}>
                        <span className="ic"><I aria-hidden="true" /></span>
                        <div style={{ minWidth: 0 }}><div className="t">{r.issue || 'Civic complaint'}</div><div className="m ellipsis">{[r.location, r.departments.map(d => deptName(d)).join(', ')].filter(Boolean).join(' · ')}</div></div>
                        <div className="r"><Status value={r.status} />{ago(r.created_at)}</div>
                      </div>);
                  })}</div>}
              <p className="ns-footnote" style={{ marginTop: 14 }}>Shows issue type, locality and status only — never names, messages or exact addresses.</p>
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="sec subtle cta" id="track"><div className="wrap">
          <Reveal>
            <h2 className="ns-headline">Your street deserves a fix.</h2>
            <p className="ns-lead" style={{ marginTop: 20 }}>It takes about a minute. You’ll get a complaint ID and can check its status any time.</p>
            <div className="ctas"><Link className="ns-btn ns-btn-primary ns-btn-lg" to={fileTo}>File a complaint</Link>
              <a className="ns-btn ns-btn-secondary ns-btn-lg" href="#how" onClick={e => { e.preventDefault(); document.getElementById('how')?.scrollIntoView({ behavior: 'smooth' }); }}>How it works</a></div>
            <TrackField onGo={id => nav(user?.role === 'citizen' || user?.role === 'admin' ? `/complaints/${id}` : `/login?next=${encodeURIComponent('/complaints/' + id)}`)} />
          </Reveal>
        </div></section>
      </main>
      <PublicFooter />
      <div className="pb-sticky"><a className="ns-btn ns-btn-secondary" href="#track">Track</a><Link className="ns-btn ns-btn-primary" to={fileTo}>File a complaint</Link></div>
    </PublicPage>
  );
}

function deptList(data?: PublicOverview) {
  const live = new Map((data?.departments ?? []).map(d => [d.key, d]));
  const rows = KNOWN.map(k => ({ ...k, name: undefined as string | undefined, online: live.get(k.key)?.online as boolean | undefined }));
  for (const d of data?.departments ?? []) {
    if (!KNOWN.some(k => k.key === d.key)) rows.push({ key: d.key, code: d.key.slice(0, 3).toUpperCase(), scope: 'Discovered from its Agent Card', issues: d.skills.slice(0, 6), name: d.name?.replace(/ Agent$/, ''), online: d.online });
  }
  return data?.departments.length ? rows.filter(r => live.has(r.key)) : rows;
}

function TrackField({ onGo }: { onGo: (id: string) => void }) {
  const [v, setV] = useState('');
  const [err, setErr] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const id = normaliseId(v);
    if (!COMPLAINT_ID_RX.test(id)) { setErr('Complaint IDs look like CMP-20261121-0004.'); return; }
    setErr(''); onGo(id.match(COMPLAINT_ID_RX)![0].toUpperCase());
  };
  return (
    <form className="track" onSubmit={submit} noValidate>
      <label className={`ns-input pill${err ? ' is-error' : ''}`}>
        <Search aria-hidden="true" width={18} height={18} />
        <input className="mono" value={v} onChange={e => { setV(e.target.value); setErr(''); }} placeholder="CMP-20261121-0004" aria-label="Complaint ID" aria-invalid={!!err} autoComplete="off" />
        <button className="go" type="submit" aria-label="Track" disabled={!v.trim()}><ArrowRight width={18} height={18} /></button>
      </label>
      <p className={`ns-help${err ? ' is-error' : ''}`}>{err || 'Already filed one? Enter its complaint ID. You’ll be asked to sign in.'}</p>
    </form>
  );
}

