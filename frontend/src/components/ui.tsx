import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import type { Priority } from '../api/types';
import { deptCode, deptIcon, deptName, statusLabel, toneOf, type Tone } from '../lib/status';
import { useToast } from './Overlays';

/** Status dot + word. `raw` shows the backend value in mono (operator views). */
export function Status({ value, tone, live, raw, children }: { value?: string | null; tone?: Tone; live?: boolean; raw?: boolean; children?: ReactNode }) {
  const t = tone ?? toneOf(value);
  return <span className={`ns-status ${t}${live && t === 'active' ? ' live' : ''}${raw ? ' mono' : ''}`}>{children ?? (raw ? value : statusLabel(value))}</span>;
}

export function Badge({ value, tone, children }: { value?: string | null; tone?: Tone; children?: ReactNode }) {
  return <span className={`ns-badge ${tone ?? toneOf(value)}`}>{children ?? statusLabel(value)}</span>;
}

const LEVEL: Record<string, number> = { LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 };
export function PriorityTag({ priority }: { priority?: Priority | null }) {
  if (!priority) return null;
  const n = LEVEL[priority] ?? 1;
  return (
    <span className={`ns-prio${priority === 'CRITICAL' ? ' critical' : ''}`} title={`Priority: ${statusLabel(priority)}`}>
      <i aria-hidden="true">{[0, 1, 2, 3].map(k => <b key={k} className={k < n ? 'on' : ''} />)}</i>{statusLabel(priority)}
    </span>
  );
}

export function DeptChip({ dept, name, on, onClick, code = true }: { dept: string; name?: string | null; on?: boolean; onClick?: () => void; code?: boolean }) {
  const I = deptIcon(dept);
  const inner = <><I aria-hidden="true" />{deptName(dept, name)}{code && <span className="ns-mono">{deptCode(dept)}</span>}</>;
  return onClick
    ? <button type="button" className={`ns-chip${on ? ' on' : ''}`} onClick={onClick} aria-pressed={on}>{inner}</button>
    : <span className={`ns-chip${on ? ' on' : ''}`}>{inner}</span>;
}

export function IconTile({ icon: I }: { icon: LucideIcon }) {
  return <span className="ic"><I aria-hidden="true" /></span>;
}

export function Empty({ icon: I, title, children, action }: { icon: LucideIcon; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty fade-in">
      <I aria-hidden="true" />
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function Skeleton({ h = 16, w, style, r }: { h?: number; w?: number | string; style?: CSSProperties; r?: number }) {
  return <div className="ns-skel" style={{ height: h, width: w, borderRadius: r, ...style }} aria-hidden="true" />;
}

export function ListSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="ns-list inset" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <div className="ns-item" key={i}>
          <span className="ic ns-skel" />
          <div><Skeleton h={12} w="70%" /><Skeleton h={10} w="40%" style={{ marginTop: 8 }} /></div>
          <Skeleton h={10} w={60} />
        </div>
      ))}
    </div>
  );
}

export function Segmented<T extends string>({ value, onChange, options, label }: {
  value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; label: string;
}) {
  return (
    <div className="ns-seg" role="tablist" aria-label={label}>
      {options.map(o => (
        <button key={o.value} type="button" role="tab" aria-selected={value === o.value} className={value === o.value ? 'on' : ''}
          onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

export function Avatar({ name }: { name?: string | null }) {
  const i = (String(name || '?').trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2) || '?').toUpperCase();
  return <span className="avatar" aria-hidden="true">{i}</span>;
}

/** A complaint or ticket ID in mono; click to copy. */
export function IdChip({ id, className = '' }: { id: string; className?: string }) {
  const toast = useToast();
  return (
    <button type="button" className={`mono ${className}`} title="Copy ID"
      style={{ background: 'none', border: 0, padding: 0, cursor: 'copy', font: 'inherit', fontFamily: 'var(--font-mono)', color: 'inherit' }}
      onClick={e => {
        e.stopPropagation();
        navigator.clipboard?.writeText(id).then(() => toast('ID copied', id, 'ok'), () => toast('Copy failed', 'Select the ID and copy it manually.', 'bad'));
      }}>{id}</button>
  );
}

/** Fades content up once as it scrolls into view. */
export function Reveal({ children, as: Tag = 'div', className = '', ...rest }: { children: ReactNode; as?: 'div' | 'section'; className?: string; [k: string]: unknown }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!('IntersectionObserver' in window)) { el.classList.add('in'); return; }
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { el.classList.add('in'); io.disconnect(); } }, { rootMargin: '0px 0px -8% 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return <Tag ref={ref as never} className={`reveal ${className}`} {...rest}>{children}</Tag>;
}
