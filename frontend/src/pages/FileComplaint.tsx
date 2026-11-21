import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUp, ChevronRight } from 'lucide-react';
import { api, ApiError } from '../api/client';
import type { ChatReply, NluMode, StructuredComplaint, UnifiedStatus } from '../api/types';
import { PinMap } from '../components/PinMap';
import { AppShell } from '../components/AppShell';
import { useToast } from '../components/Overlays';
import { PriorityTag, Status } from '../components/ui';
import { Timeline } from '../components/Workflow';
import { miniMarkdown } from '../lib/format';
import { chatSessionId, readNlu, useTechView } from '../lib/prefs';
import { deptIcon, issueLabel, shortDept, statusLabel } from '../lib/status';
import { buildRun, splitRun, type StepView } from '../lib/trail';

interface Item { id: number; kind: 'me' | 'bot' | 'meta' | 'stamp' | 'card'; text?: string; unified?: UnifiedStatus }

const SAMPLES = [
  'The road repair work near Laxmi Nagar metro station has broken the water pipe and water is flowing everywhere',
  'MCD dug up the road in Shastri Park and cut the electricity cable, no power since morning',
  'Wire is sparking on the pole near the school in Karol Bagh',
  'Rohini me bijli nahi hai subah se',
  'Garbage not collected in Rohini and the drain is blocked',
  'There is a huge pothole on the main road',
];
const WELCOME = "Hi, I’m the Concierge. Tell me what’s wrong and where — in English or Hinglish. I’ll work out which departments are involved, file a ticket with each one, and give you a single complaint ID to follow.";
const WAITING: StepView[] = [
  { key: 'discover', label: 'Understand', long: 'Reading your complaint', state: 'now' },
  { key: 'decompose', label: 'Route', long: 'Finding the right departments', state: 'pending' },
  { key: 'dispatch', label: 'Register', long: 'Registering it with each department', state: 'pending' },
  { key: 'track', label: 'Confirm', long: 'Waiting for each department to confirm', state: 'pending' },
  { key: 'aggregate', label: 'Done', long: 'Giving you one complaint ID', state: 'pending' },
];
/** What citizens see once filing finished (the technical view shows the real agent run instead). */
const FILED: StepView[] = WAITING.map(s => ({ ...s, state: 'done' }));

let nextId = 1;
const stamp = () => ({ id: nextId++, kind: 'stamp' as const, text: 'Today ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) });
/** Kept for the life of the tab so leaving and coming back keeps the conversation. */
const store: { items: Item[]; last: ChatReply | null; steps: StepView[] | null; draft: StructuredComplaint | null } = {
  items: [stamp(), { id: nextId++, kind: 'bot', text: WELCOME }], last: null, steps: null, draft: null,
};

export default function FileComplaint() {
  const toast = useToast();
  const [items, setItems] = useState<Item[]>(store.items);
  const [last, setLast] = useState<ChatReply | null>(store.last);
  const [steps, setSteps] = useState<StepView[] | null>(store.steps);
  // the complaint the Concierge understood and is waiting for the citizen to confirm
  const [draft, setDraft] = useState<StructuredComplaint | null>(store.draft);
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState('');
  const [mode, setMode] = useState<NluMode | undefined>(readNlu() ?? undefined);
  const list = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const session = useRef(chatSessionId());
  const tech = useTechView();

  useEffect(() => { store.items = items; store.last = last; store.steps = steps; store.draft = draft; }, [items, last, steps, draft]);
  useEffect(() => { if (!mode) api.config().then(c => setMode(c.nlu_mode as NluMode)).catch(() => {}); }, [mode]);
  useEffect(() => { list.current?.scrollTo({ top: 1e9, behavior: 'smooth' }); }, [items, busy]);
  useEffect(() => { input.current?.focus(); }, []);
  useEffect(() => { const el = input.current; if (el) { el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 140) + 'px'; } }, [text]);

  const push = (...add: Omit<Item, 'id'>[]) => setItems(cur => [...cur, ...add.map(a => ({ ...a, id: nextId++ }))]);

  async function send(msg: string) {
    const m = msg.trim();
    if (!m || busy) return;
    setText('');
    push({ kind: 'me', text: m });
    await talk(() => api.chat(m, session.current, mode), !!draft && /^(yes|y|ok|okay|haan|han|ha|ji|sure|confirm)\W*$/i.test(m));
  }

  /** One round trip with the Concierge. `filing`: this request registers the complaint. */
  async function talk(call: () => Promise<ChatReply>, filing: boolean) {
    setBusy(true);
    // reading a message only shows "Understand"; filing walks through the steps
    setSteps(filing ? WAITING : WAITING.slice(0, 1));
    const tick = filing ? window.setInterval(() => setSteps(s => {
      if (!s) return s;
      const i = s.findIndex(x => x.state === 'now');
      if (i < 0 || i >= s.length - 2) return s; // stop before the last steps: the real trail fills those in
      return s.map((x, k) => (k === i ? { ...x, state: 'done' } : k === i + 1 ? { ...x, state: 'now' } : x));
    }), 700) : undefined;
    try {
      const d = await call();
      setLast(d);
      setDraft(d.state === 'confirm' ? d.structured ?? null : null);
      const s = d.structured;
      const meta = s?.nlu_mode ? [statusLabel(s.nlu_mode) + ' engine', ...(s.issues?.length ? [s.issues.map(i => i.issue_type).join(', ')] : []), ...(s.urgency ? [s.urgency + ' urgency'] : [])].join(' · ') : '';
      push({ kind: 'bot', text: d.reply || '' }, ...(meta && tech ? [{ kind: 'meta' as const, text: meta }] : []), ...(d.unified ? [{ kind: 'card' as const, unified: d.unified }] : []));
      if (d.unified) {
        if (tech) {
          try {
            const ev = await api.trail(d.unified.complaint_id);
            setSteps(buildRun(splitRun(ev).run, d.unified).steps);
          } catch { setSteps(null); }
        } else setSteps(d.state === 'completed' ? FILED : null);
        if (d.state === 'completed') toast('Complaint filed', `${d.unified.complaint_id} · ${d.unified.departments.length} department${d.unified.departments.length === 1 ? '' : 's'}`, 'ok');
      } else setSteps(null);
    } catch (e) {
      setSteps(null);
      if (!(e instanceof ApiError && e.status === 401)) push({ kind: 'bot', text: 'Sorry — I couldn’t reach the agents just now. ' + (e as Error).message });
    } finally {
      window.clearInterval(tick);
      setBusy(false);
      input.current?.focus();
    }
  }
  const fileDraft = (pin: { lat: number; lng: number } | null) => {
    push({ kind: 'me', text: pin ? 'File it at the spot I marked' : 'File it' });
    return talk(() => api.confirmComplaint(session.current, 'file', pin), true);
  };
  const cancelDraft = () => { push({ kind: 'me', text: 'Cancel' }); return talk(() => api.confirmComplaint(session.current, 'cancel'), false); };
  const submit = (e?: FormEvent) => { e?.preventDefault(); send(text); };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } };
  const reset = () => { setItems([stamp(), { id: nextId++, kind: 'bot', text: WELCOME }]); setLast(null); setSteps(null); setDraft(null); };
  const s = last?.structured;
  const u = last?.unified;

  return (
    <AppShell bare crumbs={[{ label: 'Home', to: '/home' }, { label: 'File a complaint' }]}
      actions={items.length > 2 && <button className="ns-btn ns-btn-plain ns-btn-sm" type="button" onClick={reset} disabled={busy}>New conversation</button>}>
      <div className="file page-enter">
        <section className="chat" aria-label="Conversation with the Concierge">
          <div className="msgs" ref={list} aria-live="polite">
            {items.map(m => {
              if (m.kind === 'stamp') return <div key={m.id} className="stamp">{m.text}</div>;
              if (m.kind === 'meta') return <div key={m.id} className="ns-meta">{m.text}</div>;
              if (m.kind === 'card' && m.unified) return <FiledCard key={m.id} u={m.unified} />;
              return <div key={m.id} className={`ns-bubble ${m.kind === 'me' ? 'me' : 'them'} fade-in`} dangerouslySetInnerHTML={{ __html: miniMarkdown(m.text || '') }} />;
            })}
            {draft && !busy && <ConfirmCard key={JSON.stringify([draft.location, draft.issues, draft.geo])} draft={draft} tech={tech} onFile={fileDraft} onCancel={cancelDraft} />}
            {busy && <div className="typing" aria-label="Concierge is working"><i /><i /><i /></div>}
          </div>
          {items.length <= 2 && <div className="suggest" aria-label="Examples">{SAMPLES.map(x => <button key={x} type="button" title={x} onClick={() => send(x)}>{x}</button>)}</div>}
          <form className="composer" onSubmit={submit}>
            <div className="fieldbox">
              <textarea ref={input} rows={1} value={text} onChange={e => setText(e.target.value)} onKeyDown={onKey}
                placeholder="Describe the problem and the locality" aria-label="Message to the Concierge" />
              <button className="send" type="submit" aria-label="Send" disabled={!text.trim() || busy}><ArrowUp /></button>
            </div>
            <p className="ns-caption" style={{ marginTop: 8, textAlign: 'center' }}>To check one you filed, type “status” and its complaint ID.{tech && <> Language engine: {mode ? statusLabel(mode) : '…'} · change it in Settings.</>}</p>
          </form>
        </section>

        <aside className="rail" aria-label="What the agents are doing">
          <h3>What I understood</h3>
          {s ? (
            <dl className="kv">
              <dt>Place</dt><dd>{s.location || <span className="faint">not yet</span>}</dd>
              <dt>{(s.issues?.length ?? 0) > 1 ? 'Problems' : 'Problem'}</dt><dd>{s.issues?.length ? s.issues.map(i => tech
                ? <div key={i.issue_type} className="mono" style={{ fontSize: 12 }}>{i.issue_type}</div>
                : <div key={i.issue_type}>{issueLabel(i.issue_type, u?.departments)}</div>) : <span className="faint">none yet</span>}</dd>
              <dt>Urgency</dt><dd>{s.urgency ? statusLabel(s.urgency) : '—'}</dd>
              {tech && <><dt>Engine</dt><dd>{s.nlu_mode ? statusLabel(s.nlu_mode) : '—'}</dd></>}
            </dl>
          ) : <p className="hint" style={{ marginBottom: 28 }}>As you describe the problem, you’ll see what we picked up here: the place, what’s wrong and how urgent it is.</p>}
          <h3>{tech ? 'Agent activity' : 'Progress'}</h3>
          {steps ? <Timeline steps={steps} /> : <p className="hint">{tech
            ? 'When you send a complaint, you’ll see the agents discover each other, file tickets and combine their answers.'
            : 'Once you send it, you’ll see your complaint being registered with each department.'}</p>}
          {u && last?.state === 'completed' && (
            <div style={{ marginTop: 20 }}>
              <Link to={`/complaints/${u.complaint_id}`} className="ns-btn ns-btn-primary" style={{ width: '100%' }}>Track {u.complaint_id}</Link>
              {tech && <Link to={`/complaints/${u.complaint_id}?tab=execution`} className="ns-btn ns-btn-plain" style={{ width: '100%', marginTop: 6 }}>See the agent run</Link>}
            </div>
          )}
        </aside>
      </div>
    </AppShell>
  );
}

function FiledCard({ u }: { u: UnifiedStatus }) {
  return (
    <Link className="attach fade-in" to={`/complaints/${u.complaint_id}`}>
      <div className="top between">
        <div><div className="mono" style={{ fontSize: 13, fontWeight: 500 }}>{u.complaint_id}</div><div className="ns-footnote">{u.location}{u.composite ? ' · multi-department' : ''}</div></div>
        <Status value={u.overall_status} />
      </div>
      {u.departments.map(d => {
        const I = deptIcon(d.department);
        return <div className="row" key={d.department + (d.ticket_id || '')}><I aria-hidden="true" /><span className="grow">{shortDept(d.department, d.department_name)}</span><PriorityTag priority={d.priority} /></div>;
      })}
      <div className="foot"><span>Track this complaint</span><ChevronRight aria-hidden="true" /></div>
    </Link>
  );
}

/** "Check before we file": what the Concierge understood, with the spot on a map the citizen
 *  can correct. Typing in the chat instead corrects the details. */
function ConfirmCard({ draft, tech, onFile, onCancel }: {
  draft: StructuredComplaint; tech: boolean;
  onFile: (pin: { lat: number; lng: number } | null) => void; onCancel: () => void;
}) {
  const geo = draft.geo && draft.geo.lat != null && draft.geo.lng != null ? { lat: draft.geo.lat, lng: draft.geo.lng } : null;
  const [pin, setPin] = useState(geo);
  const moved = !!(pin && geo && (Math.abs(pin.lat - geo.lat) > 1e-6 || Math.abs(pin.lng - geo.lng) > 1e-6));
  const issues = draft.issues ?? [];
  return (
    <div className="confirm-card fade-in" role="group" aria-label="Check your complaint before filing">
      <h4>Check before we file</h4>
      <dl>
        <dt>{issues.length > 1 ? 'Problems' : 'Problem'}</dt>
        <dd>{issues.map(i => <div key={i.issue_type}>{tech ? <span className="mono" style={{ fontSize: 12 }}>{i.issue_type}</span> : issueLabel(i.issue_type)}{i.department ? <span className="ns-footnote"> · {shortDept(i.department)}</span> : null}</div>)}</dd>
        <dt>Place</dt><dd>{draft.location || '—'}</dd>
        <dt>Urgency</dt><dd>{draft.urgency ? statusLabel(draft.urgency) : 'Normal'}</dd>
      </dl>
      {pin && <>
        <PinMap lat={pin.lat} lng={pin.lng} editable height={190} label="Where the problem is. Drag the pin or tap the map to move it." onMove={(lat, lng) => setPin({ lat, lng })} />
        <p className="ns-footnote">{moved ? 'Pin moved. The crew gets this exact spot.' : 'Is the pin on the right spot? Drag it, or tap the map, to show the crew exactly where.'}</p>
      </>}
      <div className="row" style={{ gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
        <button className="ns-btn ns-btn-primary ns-btn-sm" type="button" onClick={() => onFile(moved ? pin : null)}>File complaint</button>
        <button className="ns-btn ns-btn-plain ns-btn-sm" type="button" onClick={onCancel}>Cancel</button>
      </div>
      <p className="ns-footnote">Something wrong? Type the correction below, e.g. “it’s in Rohini, not Pitampura”.</p>
    </div>
  );
}
