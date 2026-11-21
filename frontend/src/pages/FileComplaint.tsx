import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUp, ChevronRight } from 'lucide-react';
import { api, ApiError } from '../api/client';
import type { ChatReply, NluMode, UnifiedStatus } from '../api/types';
import { AppShell } from '../components/AppShell';
import { useToast } from '../components/Overlays';
import { PriorityTag, Status } from '../components/ui';
import { Timeline } from '../components/Workflow';
import { miniMarkdown } from '../lib/format';
import { chatSessionId, readNlu } from '../lib/prefs';
import { deptIcon, shortDept, statusLabel } from '../lib/status';
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
  { key: 'discover', label: 'Understand', long: 'Understanding your complaint', state: 'now' },
  { key: 'decompose', label: 'Route', long: 'Finding the right departments', state: 'pending' },
  { key: 'dispatch', label: 'File', long: 'Filing tickets over A2A', state: 'pending' },
  { key: 'track', label: 'Track', long: 'Waiting for each department', state: 'pending' },
  { key: 'aggregate', label: 'Combine', long: 'Combining into one status', state: 'pending' },
];

let nextId = 1;
const stamp = () => ({ id: nextId++, kind: 'stamp' as const, text: 'Today ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) });
/** Kept for the life of the tab so leaving and coming back keeps the conversation. */
const store: { items: Item[]; last: ChatReply | null; steps: StepView[] | null } = {
  items: [stamp(), { id: nextId++, kind: 'bot', text: WELCOME }], last: null, steps: null,
};

export default function FileComplaint() {
  const toast = useToast();
  const [items, setItems] = useState<Item[]>(store.items);
  const [last, setLast] = useState<ChatReply | null>(store.last);
  const [steps, setSteps] = useState<StepView[] | null>(store.steps);
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState('');
  const [mode, setMode] = useState<NluMode | undefined>(readNlu() ?? undefined);
  const list = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const session = useRef(chatSessionId());

  useEffect(() => { store.items = items; store.last = last; store.steps = steps; }, [items, last, steps]);
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
    setBusy(true);
    setSteps(WAITING);
    const tick = window.setInterval(() => setSteps(s => {
      if (!s) return s;
      const i = s.findIndex(x => x.state === 'now');
      if (i < 0 || i >= s.length - 2) return s; // stop before the last steps: the real trail fills those in
      return s.map((x, k) => (k === i ? { ...x, state: 'done' } : k === i + 1 ? { ...x, state: 'now' } : x));
    }), 700);
    try {
      const d = await api.chat(m, session.current, mode);
      setLast(d);
      const s = d.structured;
      const meta = s?.nlu_mode ? [statusLabel(s.nlu_mode) + ' engine', ...(s.issues?.length ? [s.issues.map(i => i.issue_type).join(', ')] : []), ...(s.urgency ? [s.urgency + ' urgency'] : [])].join(' · ') : '';
      push({ kind: 'bot', text: d.reply || '' }, ...(meta ? [{ kind: 'meta' as const, text: meta }] : []), ...(d.unified ? [{ kind: 'card' as const, unified: d.unified }] : []));
      if (d.unified) {
        try {
          const ev = await api.trail(d.unified.complaint_id);
          setSteps(buildRun(splitRun(ev).run, d.unified).steps);
        } catch { setSteps(null); }
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
  const submit = (e?: FormEvent) => { e?.preventDefault(); send(text); };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } };
  const reset = () => { setItems([stamp(), { id: nextId++, kind: 'bot', text: WELCOME }]); setLast(null); setSteps(null); };
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
            {busy && <div className="typing" aria-label="Concierge is working"><i /><i /><i /></div>}
          </div>
          {items.length <= 2 && <div className="suggest" aria-label="Examples">{SAMPLES.map(x => <button key={x} type="button" title={x} onClick={() => send(x)}>{x}</button>)}</div>}
          <form className="composer" onSubmit={submit}>
            <div className="fieldbox">
              <textarea ref={input} rows={1} value={text} onChange={e => setText(e.target.value)} onKeyDown={onKey}
                placeholder="Describe the problem and the locality" aria-label="Message to the Concierge" />
              <button className="send" type="submit" aria-label="Send" disabled={!text.trim() || busy}><ArrowUp /></button>
            </div>
            <p className="ns-caption" style={{ marginTop: 8, textAlign: 'center' }}>Ask about one you filed with “status CMP-…”. Language engine: {mode ? statusLabel(mode) : '…'} · change it in Settings.</p>
          </form>
        </section>

        <aside className="rail" aria-label="What the agents are doing">
          <h3>What I understood</h3>
          {s ? (
            <dl className="kv">
              <dt>Place</dt><dd>{s.location || <span className="faint">not yet</span>}</dd>
              <dt>Issues</dt><dd>{s.issues?.length ? s.issues.map(i => <div key={i.issue_type} className="mono" style={{ fontSize: 12 }}>{i.issue_type}</div>) : <span className="faint">none yet</span>}</dd>
              <dt>Urgency</dt><dd>{s.urgency ? statusLabel(s.urgency) : '—'}</dd>
              <dt>Engine</dt><dd>{s.nlu_mode ? statusLabel(s.nlu_mode) : '—'}</dd>
            </dl>
          ) : <p className="hint" style={{ marginBottom: 28 }}>Details appear here as the Concierge reads your message: the place, what’s wrong and how urgent it is.</p>}
          <h3>Agent activity</h3>
          {steps ? <Timeline steps={steps} /> : <p className="hint">When you send a complaint, you’ll see the agents discover each other, file tickets and combine their answers.</p>}
          {u && last?.state === 'completed' && (
            <div style={{ marginTop: 20 }}>
              <Link to={`/complaints/${u.complaint_id}`} className="ns-btn ns-btn-primary" style={{ width: '100%' }}>Track {u.complaint_id}</Link>
              <Link to={`/complaints/${u.complaint_id}?tab=execution`} className="ns-btn ns-btn-plain" style={{ width: '100%', marginTop: 6 }}>See the agent run</Link>
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
