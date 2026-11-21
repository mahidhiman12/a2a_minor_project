import { Link } from 'react-router-dom';
import { ChevronRight, Link2 } from 'lucide-react';
import type { DepartmentStatus, UnifiedStatus } from '../api/types';
import { when } from '../lib/format';
import { deptIcon, progressIndex, shortDept } from '../lib/status';
import { IdChip, PriorityTag, Status } from './ui';

export const firstIssue = (u: UnifiedStatus) => u.departments.find(d => d.issue_name)?.issue_name;
export const deptsOf = (u: UnifiedStatus) => u.departments.map(d => shortDept(d.department, d.department_name)).join(', ');
/** Not resolved and the promised date has passed. */
export const isOverdue = (u: UnifiedStatus) =>
  u.overall_status !== 'RESOLVED' && !!u.overall_eta && new Date(u.overall_eta).getTime() < Date.now();
/** A department says it's fixed and is waiting for the citizen to confirm or reopen. */
export const awaitsConfirmation = (u: UnifiedStatus) => u.departments.some(d => d.ticket_status === 'RESOLVED');
/** A department asked the citizen something and is waiting for the reply. */
export const awaitsReply = (u: UnifiedStatus) => u.departments.some(d => d.awaiting_citizen);

/** One complaint as a grouped-list row. */
export function ComplaintRow({ u, to }: { u: UnifiedStatus; to: string }) {
  const I = deptIcon(u.departments[0]?.department);
  return (
    <Link className="ns-item" to={to}>
      <span className="ic"><I aria-hidden="true" /></span>
      <div style={{ minWidth: 0 }}>
        <div className="t">{u.summary || firstIssue(u) || 'Civic complaint'}</div>
        <div className="m ellipsis"><span className="mono" style={{ fontSize: 12 }}>{u.complaint_id}</span>{u.location && ` · ${u.location}`}{u.departments.length ? ` · ${deptsOf(u)}` : ''}</div>
      </div>
      <div className="row" style={{ gap: 12 }}>
        <div className="r" style={{ display: 'flex' }}>{awaitsReply(u) ? <Status tone="pending">Reply needed</Status> : awaitsConfirmation(u) ? <Status tone="pending">Is it fixed?</Status> : isOverdue(u) ? <Status tone="error">Overdue</Status> : <Status value={u.overall_status} />}{u.updated_at ? when(u.updated_at) : ''}</div>
        <ChevronRight className="chev" aria-hidden="true" />
      </div>
    </Link>
  );
}

export function Progress({ overall }: { overall?: string }) {
  const i = progressIndex(overall);
  const labels = ['Registered', 'In progress', 'Resolved'];
  if (overall === 'NOT_ROUTED') return <p className="ns-footnote" style={{ marginTop: 20 }}><Status value="NOT_ROUTED" /> No department agent could take this complaint.</p>;
  if (overall === 'REJECTED') return <p className="ns-footnote" style={{ marginTop: 20 }}><Status value="REJECTED" /> The departments couldn’t take this on. Their reasons are below.</p>;
  return (
    <div className="progress" aria-label={`Progress: ${labels[i]}`}>
      {labels.map((l, k) => <div key={l} className={k < i ? 'on done' : k === i ? (i === 2 ? 'on done' : 'on') : ''}>{l}</div>)}
    </div>
  );
}

/** One department's ticket inside a complaint. */
export function TicketBlock({ d, raw }: { d: DepartmentStatus; raw?: boolean }) {
  const I = deptIcon(d.department);
  const failed = d.a2a_task_state && d.a2a_task_state !== 'completed';
  return (
    <div className="ticket">
      <div className="hd">
        <span className="ic"><I aria-hidden="true" /></span>
        <div className="grow">
          <div style={{ fontSize: 15, fontWeight: 600 }}>{shortDept(d.department, d.department_name)}</div>
          <div className="ns-footnote">{d.issue_name || d.issue_type}{d.department_name && ` · ${d.department_name}`}</div>
        </div>
        {failed ? <Status value={d.a2a_task_state} raw={raw} /> : <Status value={d.ticket_status} raw={raw} />}
      </div>
      {failed
        ? <p className="ns-footnote" style={{ marginTop: 12 }}>This department could not register the ticket{d.error ? `: ${d.error}` : '.'}</p>
        : <dl>
            <div><dt>Ticket</dt><dd>{d.ticket_id ? <IdChip id={d.ticket_id} /> : '—'}</dd></div>
            <div><dt>Priority</dt><dd><PriorityTag priority={d.priority} /></dd></div>
            <div><dt>Office · crew</dt><dd>{[d.assigned_office, d.crew].filter(Boolean).join(' · ') || '—'}</dd></div>
            <div><dt>ETA</dt><dd>{when(d.eta) || '—'}</dd></div>
          </dl>}
      {d.duplicate_of && <p className="ns-footnote row" style={{ marginTop: 12, gap: 6 }}><Link2 width={14} height={14} aria-hidden="true" />Linked to an existing report, <span className="mono">{d.duplicate_of}</span>. The crew is already on it.</p>}
    </div>
  );
}
