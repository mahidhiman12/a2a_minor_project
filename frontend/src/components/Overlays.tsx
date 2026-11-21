import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Check, CircleAlert, CircleCheck, Info, X } from 'lucide-react';

type Kind = 'ok' | 'bad' | 'info';
interface Toast { id: number; title: string; text?: string; kind: Kind }
interface Choice<T> { title: string; message?: string; options: { label: string; value: T; current?: boolean }[] }

interface Ctx {
  toast: (title: string, text?: string, kind?: Kind) => void;
  choose: <T>(c: Choice<T>) => Promise<T | null>;
}
const C = createContext<Ctx | null>(null);

export const useToast = () => { const c = useContext(C); if (!c) throw new Error('OverlayProvider missing'); return c.toast; };
export const useChoice = () => { const c = useContext(C); if (!c) throw new Error('OverlayProvider missing'); return c.choose; };

let nextId = 1;

export function OverlayProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [choice, setChoice] = useState<(Choice<unknown> & { resolve: (v: unknown) => void }) | null>(null);

  const toast = useCallback((title: string, text?: string, kind: Kind = 'info') => {
    const id = nextId++;
    setToasts(t => [...t.slice(-2), { id, title, text, kind }]);
    window.setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 2600);
  }, []);
  const choose = useCallback(<T,>(c: Choice<T>) => new Promise<T | null>(resolve => {
    setChoice({ ...(c as Choice<unknown>), resolve: v => resolve(v as T | null) });
  }), []);
  const close = (v: unknown) => { choice?.resolve(v); setChoice(null); };

  return (
    <C.Provider value={{ toast, choose }}>
      {children}
      {createPortal(
        <div className="toasts" role="status" aria-live="polite">
          {toasts.map(t => {
            const I = t.kind === 'ok' ? CircleCheck : t.kind === 'bad' ? CircleAlert : Info;
            return <div key={t.id} className={`ns-toast ${t.kind}`}><I aria-hidden="true" /><div>{t.title}{t.text && <small>{t.text}</small>}</div></div>;
          })}
        </div>, document.body)}
      {choice && createPortal(<ChoiceSheet c={choice} onClose={close} />, document.body)}
    </C.Provider>
  );
}

function ChoiceSheet({ c, onClose }: { c: Choice<unknown>; onClose: (v: unknown) => void }) {
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    first.current?.focus();
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(null); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="scrim" onClick={() => onClose(null)}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={c.title} onClick={e => e.stopPropagation()}>
        <h3>{c.title}</h3>
        {c.message && <p>{c.message}</p>}
        <div className="opts">
          {c.options.map((o, i) => (
            <button key={String(o.value)} ref={i === 0 ? first : undefined} type="button" className={`opt${o.current ? ' cur' : ''}`} onClick={() => onClose(o.value)}>
              {o.label}{o.current && <Check width={16} height={16} aria-label="current" />}
            </button>
          ))}
        </div>
        <div className="foot"><button type="button" className="ns-btn ns-btn-secondary" onClick={() => onClose(null)}>Cancel</button></div>
      </div>
    </div>
  );
}

export function Drawer({ title, children, onClose, actions }: { title: ReactNode; children: ReactNode; onClose: () => void; actions?: ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return createPortal(
    <>
      <div className="drawer-scrim" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true">
        <div className="hd"><div className="grow">{title}</div>{actions}<button className="icon-btn" type="button" aria-label="Close" onClick={onClose}><X /></button></div>
        <div className="bd">{children}</div>
      </aside>
    </>, document.body);
}
