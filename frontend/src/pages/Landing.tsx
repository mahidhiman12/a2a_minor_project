import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowRight, ArrowUp, Building2, CalendarClock, CircleCheck, Hash, Languages, Link2, Lock, MapPin,
  MessageCircle, Search, Send, Sparkles, WifiOff,
} from 'lucide-react';
import { api } from '../api/client';
import type { PublicOverview } from '../api/types';
import { useAuth } from '../auth';
import { PublicFooter, PublicPage } from '../components/Public';
import { Empty, ListSkeleton, PriorityTag, Reveal, Status } from '../components/ui';
import { useAsync, useInterval } from '../lib/hooks';
import { COMPLAINT_ID_RX, deptIcon, deptName, normaliseId } from '../lib/status';

const KNOWN = [
  { key: 'water', code: 'DJB', scope: 'Water supply, pipes and sewers', issues: ['Pipe burst or leakage', 'No water supply', 'Contaminated water', 'Low pressure', 'Sewer overflow'] },
  { key: 'electricity', code: 'ELC', scope: 'Power supply, poles, streetlights', issues: ['Power outage', 'Live wire or sparking', 'Underground cable damage', 'Transformer fault', 'Voltage fluctuation', 'Streetlight not working'] },
  { key: 'roads', code: 'MCD', scope: 'Roads and footpaths', issues: ['Potholes', 'Unsafe digging', 'Waterlogging', 'Debris or blocked road', 'Broken footpath'] },
  { key: 'sanitation', code: 'SAN', scope: 'Garbage and cleanliness', issues: ['Garbage not collected', 'Dead animal removal'] },
];

const WHY = [
  { icon: Building2, title: 'No need to know which department.', text: 'A pipe broken by road work needs both the Water Board and the roads department. Just describe what you see; we send it to everyone who has to act.' },
  { icon: Hash, title: 'One complaint ID for everything.', text: 'Every department’s ticket, crew and expected date sit on one page, with one overall status.' },
  { icon: CalendarClock, title: 'Fixed in the right order.', text: 'Departments are told how to work together, so the pipe is repaired before the road is resurfaced, not after.' },
  { icon: Languages, title: 'Write it your way.', text: 'English or Hinglish, the way you’d tell a neighbour. “Rohini me bijli nahi hai” works fine.' },
  { icon: MapPin, title: 'Any place in Delhi.', text: 'A locality, a metro station, a market or a landmark. We find the nearest zone office and crew.' },
  { icon: Link2, title: 'Already reported? We link it.', text: 'If someone nearby reported the same problem, your report joins theirs, so the crew already on it knows.' },
];

const FAQ = [
  { q: 'Do I need to know which department to contact?', a: 'No. Describe the problem and where it is. We work out which departments are involved and send it to each one.' },
  { q: 'What happens after I file?', a: 'Each department registers its own ticket, assigns a crew from the nearest zone office and gives an expected date. You follow all of them on one complaint page.' },
  { q: 'How do I check on my complaint?', a: 'Sign in and open My complaints, or enter your complaint ID below. You can also type “status” followed by your ID in the chat.' },
  { q: 'Is what I write made public?', a: 'No. The activity shown on this page has only the type of problem, the locality and the status. Never names, messages or exact addresses.' },
  { q: 'Can I use this in an emergency?', a: 'If anyone is in immediate danger, call 112 first. You can still report it here so the department follows up.' },
  { q: 'Is this an official government service?', a: 'Not yet. This is a working demonstration: the departments, tickets and crews are simulated.' },
];

const ago = (iso?: string) => {
  if (!iso) return '';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} hr ago`;
  return new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short' });
};

const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });

export default function Landing() {
  const { user } = useAuth();
  const nav = useNavigate();
  const { data, error, loading, reload } = useAsync(api.publicOverview, []);
  useInterval(() => reload(true), 30000);
  const fileTo = user ? (user.role === 'citizen' ? '/file' : '/home') : '/login?next=/file';
  const total = data?.departments.length ?? 0;
  const online = data?.departments.filter(d => d.online).length ?? 0;

  return (
    <PublicPage>
      <main className="lp">
        {/* HERO */}
        <section className="hero"><div className="wrap">
          <span className="status">
            {total > 0
              ? <><span className={`ns-live${online ? ' ok' : ''}`} />{online === total ? 'All departments taking complaints' : `${online} of ${total} departments taking complaints`} · Delhi</>
              : 'Civic complaints · Delhi'}
          </span>
          <h1 className="ns-display">One complaint. <span>Every department<br />that can fix it.</span></h1>
          <p className="ns-lead">Broken pipe, no power, a pothole, garbage piling up? Tell us in your own words. We send it to every department that needs to act and give you one complaint ID to follow until it’s fixed.</p>
          <div className="ctas">
            <Link className="ns-btn ns-btn-primary ns-btn-lg" to={fileTo}>File a complaint</Link>
            <a className="ns-btn ns-btn-secondary ns-btn-lg" href="#track" onClick={e => { e.preventDefault(); scrollTo('track'); }}>Track a complaint</a>
          </div>
          <div className="trust"><span><Languages aria-hidden="true" />English and Hinglish</span><span><MapPin aria-hidden="true" />Any place in Delhi</span><span><Lock aria-hidden="true" />Your details stay private</span></div>
        </div>
          <div className="stage" aria-hidden="true">
            <div className="win">
              <div className="bar"><i /><i /><i /><span>Complaint</span><span className="mono">CMP-20261121-0004</span></div>
              <div className="body">
                <div className="main">
                  <span className="ns-caption">Laxmi Nagar · filed 9:41 am</span>
                  <h3>Road repair near the metro broke the water pipe</h3>
                  <div className="meta"><Status value="IN_PROGRESS" /><PriorityTag priority="HIGH" /><span>Expected by Sat 22 Nov, 9:15 am</span></div>
                  <div className="grp"><span className="ns-caption">Departments</span>
                    <div className="ns-list inset">
                      {[['water', 'Crew C4 · East Delhi Zone Office', 'RESOLVED'], ['roads', 'Crew A7 · East Delhi Zone Office', 'IN_PROGRESS']].map(([k, m, s]) => {
                        const I = deptIcon(k); return (
                          <div className="ns-item" key={k}><span className="ic"><I /></span><div><div className="t">{deptName(k)}</div><div className="m" style={{ fontSize: 12 }}>{m}</div></div><Status value={s} /></div>);
                      })}
                    </div></div>
                  <p className="plan"><b>What happens next</b>: the Water Board repairs the pipe first; Roads resurfaces once that’s done.</p>
                </div>
                <div className="side"><h4>What’s happened</h4>
                  <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 14, fontSize: 13 }}>
                    <li><Status tone="done">Complaint received</Status><div className="ns-caption">9:41 am</div></li>
                    <li><Status tone="done">Sent to Water Board and Roads</Status><div className="ns-caption">9:41 am</div></li>
                    <li><Status tone="done">Water Board fixed the pipe</Status><div className="ns-caption">2:10 pm</div></li>
                    <li><Status tone="active">Roads is resurfacing the road</Status><div className="ns-caption">Crew A7</div></li>
                  </ul>
                </div>
              </div>
            </div>
            <div className="phone"><div className="scr">
              <div className="isl" />
              <div className="hd"><div className="av"><MessageCircle /></div><div className="t">Nagrik Sahayak</div></div>
              <div className="ns-chat">
                <div className="ns-bubble me">Laxmi Nagar metro ke paas road repair se paani ki pipe toot gayi</div>
                <div className="ns-bubble them">I’ve sent this to <b style={{ fontWeight: 600 }}>2 departments</b>: the Water Board and Municipal Roads.</div>
                <div className="ns-bubble them">Your complaint ID is <span className="mono" style={{ fontSize: 12 }}>CMP-20261121-0004</span>. The pipe gets fixed first.</div>
                <div className="typing"><i /><i /><i /></div>
              </div>
              <div className="comp">Message<span className="send"><ArrowUp /></span></div>
            </div></div>
          </div>
        </section>

        {/* WHY */}
        <section className="sec" id="why" style={{ marginTop: 48 }}>
          <Reveal className="sec-head wrap"><span className="ns-eyebrow">Why use it</span><h2 className="ns-headline">Stop chasing departments.<br />Report it once.</h2></Reveal>
          <Reveal className="feats" style={{ marginTop: 0 }}>
            {WHY.map(w => <div key={w.title}><w.icon aria-hidden="true" /><h4>{w.title}</h4><p>{w.text}</p></div>)}
          </Reveal>
        </section>

        {/* HOW IT WORKS */}
        <section className="sec subtle" id="how">
          <Reveal className="sec-head wrap"><span className="ns-eyebrow">How it works</span><h2 className="ns-headline">From your words<br />to the right crews.</h2><p className="ns-lead">It takes about a minute. No forms, no department codes.</p></Reveal>
          <Reveal className="steps">
            <div className="step"><span className="n">1</span><MessageCircle aria-hidden="true" /><h3 className="ns-title3">Tell us what’s wrong.</h3><p>Type it the way you’d say it, with the area or a landmark.</p><div className="viz"><div className="ns-chat"><div className="ns-bubble me" style={{ fontSize: 13 }}>Rohini me bijli nahi hai subah se</div></div></div></div>
            <div className="step"><span className="n">2</span><Sparkles aria-hidden="true" /><h3 className="ns-title3">We understand it.</h3><p>We pick out the problem, the place and how urgent it is, and ask if anything is missing.</p><div className="viz"><div className="kv"><span>Problem</span><span>Power outage</span></div><div className="kv"><span>Place</span><span>Rohini</span></div><div className="kv"><span>Urgency</span><span>Normal</span></div></div></div>
            <div className="step"><span className="n">3</span><Send aria-hidden="true" /><h3 className="ns-title3">The right departments get it.</h3><p>Each one registers a ticket and assigns a crew from the nearest office.</p><div className="viz"><div className="kv"><span>Electricity</span><Status value="ASSIGNED">Crew assigned</Status></div><div className="kv"><span>Crew</span><span>B3 · Rohini</span></div><div className="kv"><span>Expected</span><span>Today, 6:30 pm</span></div></div></div>
            <div className="step"><span className="n">4</span><CircleCheck aria-hidden="true" /><h3 className="ns-title3">Follow it until it’s fixed.</h3><p>One complaint ID and one status, even when three departments are involved.</p><div className="viz"><div className="kv"><span>CMP-20261121-0007</span><Status value="IN_PROGRESS" /></div><div className="kv"><span>Updated</span><span>12 min ago</span></div></div></div>
          </Reveal>
        </section>

        {/* WHAT YOU CAN REPORT */}
        <section className="sec" id="departments">
          <Reveal className="sec-head wrap"><span className="ns-eyebrow">What you can report</span><h2 className="ns-headline">Water, power, roads, garbage.<br />One place for all of it.</h2><p className="ns-lead">You don’t need to know who handles what. These are the problems we can send to the right team today.</p></Reveal>
          <Reveal className="depts">
            {deptList(data).map(d => {
              const I = deptIcon(d.key);
              return (
                <div className="dept" key={d.key}>
                  <I aria-hidden="true" /><h3 className="ns-title3">{deptName(d.key, d.name)}</h3><span className="code">{d.code}</span>
                  <div className="scope">{d.scope}</div>
                  <ul>{d.issues.map(x => <li key={x}>{x}</li>)}</ul>
                  {d.online === false && <div className="foot"><Status tone="pending">Not taking complaints right now</Status></div>}
                </div>
              );
            })}
          </Reveal>
        </section>

        {/* ACTIVITY */}
        <section className="sec subtle">
          <Reveal className="sec-head wrap"><span className="ns-eyebrow">Across the city</span><h2 className="ns-headline">What Delhi is<br />reporting right now.</h2><p className="ns-lead">Where complaints are coming from and how they’re moving.</p></Reveal>
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
                : !data.recent.length ? <Empty icon={Sparkles} title="No complaints yet" action={<Link className="ns-btn ns-btn-primary ns-btn-sm" to={fileTo}>File a complaint</Link>}>Be the first. It takes about a minute.</Empty>
                : <div className="ns-list inset">{data.recent.map((r, i) => {
                    const I = deptIcon(r.departments[0]);
                    return (
                      <div className="ns-item" key={i}>
                        <span className="ic"><I aria-hidden="true" /></span>
                        <div style={{ minWidth: 0 }}><div className="t">{r.issue || 'Civic complaint'}</div><div className="m ellipsis">{[r.location, r.departments.map(d => deptName(d)).join(', ')].filter(Boolean).join(' · ')}</div></div>
                        <div className="r"><Status value={r.status} />{ago(r.created_at)}</div>
                      </div>);
                  })}</div>}
              <p className="ns-footnote" style={{ marginTop: 14 }}>Shows the type of problem, locality and status only. Never names, messages or exact addresses.</p>
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section className="sec" id="faq">
          <Reveal className="sec-head wrap"><span className="ns-eyebrow">Questions</span><h2 className="ns-headline">Good to know.</h2></Reveal>
          <div className="faq">
            {FAQ.map(f => <details key={f.q}><summary>{f.q}</summary><p>{f.a}</p></details>)}
          </div>
          <p className="tech-band">Curious how it works behind the scenes? <Link className="link" to="/technology">See the technology<ArrowRight width={14} height={14} aria-hidden="true" /></Link></p>
        </section>

        {/* CTA */}
        <section className="sec subtle cta" id="track"><div className="wrap">
          <Reveal>
            <h2 className="ns-headline">Your street deserves a fix.</h2>
            <p className="ns-lead" style={{ marginTop: 20 }}>It takes about a minute. You’ll get a complaint ID and can check its status any time.</p>
            <div className="ctas"><Link className="ns-btn ns-btn-primary ns-btn-lg" to={fileTo}>File a complaint</Link>
              <a className="ns-btn ns-btn-secondary ns-btn-lg" href="#how" onClick={e => { e.preventDefault(); scrollTo('how'); }}>How it works</a></div>
            <TrackField onGo={id => nav(user?.role === 'citizen' || user?.role === 'admin' ? `/complaints/${id}` : `/login?next=${encodeURIComponent('/complaints/' + id)}`)} />
          </Reveal>
        </div></section>
      </main>
      <PublicFooter />
      <div className="pb-sticky"><a className="ns-btn ns-btn-secondary" href="#track">Track</a><Link className="ns-btn ns-btn-primary" to={fileTo}>File a complaint</Link></div>
    </PublicPage>
  );
}

/** The four known departments, plus any other department that is currently up. */
function deptList(data?: PublicOverview) {
  const live = new Map((data?.departments ?? []).map(d => [d.key, d]));
  const rows = KNOWN.map(k => ({ ...k, name: undefined as string | undefined, online: live.get(k.key)?.online as boolean | undefined }));
  for (const d of data?.departments ?? []) {
    if (!KNOWN.some(k => k.key === d.key)) rows.push({ key: d.key, code: d.key.slice(0, 3).toUpperCase(), scope: d.name?.replace(/ Agent$/, '') || 'Other civic issues', issues: d.skills.slice(0, 6), name: d.name?.replace(/ Agent$/, ''), online: d.online });
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
