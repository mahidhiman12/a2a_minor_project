import { useMemo, useState, type FormEvent } from 'react';
import { Search, TriangleAlert, UserPlus } from 'lucide-react';
import { api, ApiError } from '../api/client';
import type { AdminUser } from '../api/types';
import { useAuth } from '../auth';
import { AppShell } from '../components/AppShell';
import { useToast } from '../components/Overlays';
import { Empty, ListSkeleton, Status } from '../components/ui';
import { when } from '../lib/format';
import { useAsync } from '../lib/hooks';
import { deptName } from '../lib/status';

const ROLE_LABEL: Record<string, string> = { admin: 'Administrator', officer: 'Officer', citizen: 'Citizen' };

/** Admin: one account per officer. Add officers, switch accounts off, reset passwords. */
export default function AdminPeople() {
  const { user } = useAuth();
  const toast = useToast();
  const users = useAsync(api.users, []);
  const depts = useAsync(api.departments, []);
  const [q, setQ] = useState('');
  const [role, setRole] = useState('staff');
  const [adding, setAdding] = useState(false);
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (users.data ?? []).filter(u => (role === 'staff' ? u.role !== 'citizen' : !role || u.role === role)
      && (!s || [u.username, u.display_name, u.department].some(x => String(x || '').toLowerCase().includes(s))));
  }, [users.data, q, role]);

  async function toggle(u: AdminUser) {
    try {
      await api.updateUser(u.id, { active: !u.active });
      toast(u.active ? 'Account switched off' : 'Account switched on', u.active ? `${u.display_name} is signed out and can’t sign in.` : `${u.display_name} can sign in again.`, 'ok');
      users.reload(true);
    } catch (e) { if (!(e instanceof ApiError && e.status === 401)) toast('Couldn’t change the account', (e as Error).message, 'bad'); }
  }

  async function resetPassword(u: AdminUser) {
    const pw = window.prompt(`New password for ${u.display_name} (at least 8 characters). Tell them to change it in Settings.`);
    if (!pw) return;
    try { await api.updateUser(u.id, { password: pw }); toast('Password reset', `Give the new password to ${u.display_name} privately.`, 'ok'); }
    catch (e) { if (!(e instanceof ApiError && e.status === 401)) toast('Couldn’t reset the password', (e as Error).message, 'bad'); }
  }

  return (
    <AppShell crumbs={[{ label: 'Overview', to: '/admin' }, { label: 'People' }]} wide>
      <div className="page-head">
        <div><h1 className="ns-title">People</h1><p>Give every officer their own account, so each update on a ticket shows who made it. Switching an account off signs that person out straight away; their name stays on the tickets they worked on.</p></div>
        <div className="acts"><button className="ns-btn ns-btn-primary" type="button" onClick={() => setAdding(a => !a)}><UserPlus aria-hidden="true" />Add officer</button></div>
      </div>

      {adding && <NewOfficer departments={(depts.data ?? []).map(d => ({ key: d.key, name: deptName(d.key, d.name?.replace(/ Agent$/, '')) }))}
        onDone={u => { setAdding(false); toast('Officer added', `${u.display_name} can sign in as @${u.username}.`, 'ok'); users.reload(true); }}
        onCancel={() => setAdding(false)} />}

      <div className="section">
        <div className="toolbar">
          <label className="ns-input pill"><Search aria-hidden="true" /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Search name, username, department" aria-label="Search accounts" /></label>
          <select className="select" value={role} onChange={e => setRole(e.target.value)} aria-label="Role">
            <option value="staff">Officers and admins</option><option value="officer">Officers</option><option value="admin">Admins</option><option value="citizen">Citizens</option><option value="">Everyone</option>
          </select>
        </div>
        {users.loading && !users.data ? <ListSkeleton rows={5} />
          : users.error ? <Empty icon={TriangleAlert} title="Couldn’t load accounts" action={<button className="ns-btn ns-btn-secondary ns-btn-sm" onClick={() => users.reload()}>Try again</button>}>{users.error.message}</Empty>
          : !shown.length ? <p className="ns-footnote">No accounts match.</p>
          : <div style={{ overflowX: 'auto' }}><table className="table">
              <thead><tr><th>Name</th><th>Role</th><th className="hide-m">Created</th><th>Status</th><th /></tr></thead>
              <tbody>{shown.map(u => (
                <tr key={u.id}>
                  <td>{u.display_name}<div className="ns-footnote mono">@{u.username}</div></td>
                  <td>{ROLE_LABEL[u.role]}{u.department ? <div className="ns-footnote">{deptName(u.department)}</div> : null}</td>
                  <td className="hide-m ns-footnote">{when(u.created_at) || '—'}</td>
                  <td><Status tone={u.active ? 'done' : 'idle'}>{u.active ? 'Active' : 'Switched off'}</Status></td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {u.role !== 'admin' && u.id !== user?.id && <button className="ns-btn ns-btn-plain ns-btn-sm" type="button" onClick={() => toggle(u)}>{u.active ? 'Switch off' : 'Switch on'}</button>}
                    {u.role !== 'citizen' && u.id !== user?.id && <button className="ns-btn ns-btn-plain ns-btn-sm" type="button" onClick={() => resetPassword(u)}>Reset password</button>}
                  </td>
                </tr>))}</tbody>
            </table></div>}
        <p className="ns-footnote" style={{ marginTop: 10 }}>Each department also has a shared <span className="mono">&lt;department&gt;_officer</span> demo account, created automatically from its Agent Card.</p>
      </div>
    </AppShell>
  );
}

function NewOfficer({ departments, onDone, onCancel }: { departments: { key: string; name: string }[]; onDone: (u: AdminUser) => void; onCancel: () => void }) {
  const [f, setF] = useState({ display_name: '', username: '', department: '', password: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => { setF({ ...f, [k]: e.target.value }); setErr(''); };
  // suggest a username from the name: "Ravi Kumar" -> "ravi.kumar"
  const suggest = (name: string) => name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '').slice(0, 32);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!f.display_name.trim() || !f.username.trim() || !f.department) { setErr('Fill in the name, username and department.'); return; }
    if (f.password.length < 8) { setErr('Use at least 8 characters for the password.'); return; }
    setBusy(true);
    try { onDone(await api.createOfficer({ ...f, username: f.username.trim().toLowerCase() })); }
    catch (e2) { setErr(e2 instanceof ApiError && e2.status === 401 ? '' : (e2 as Error).message); setBusy(false); }
  }

  return (
    <form className="upd section" onSubmit={submit} noValidate style={{ maxWidth: 640 }}>
      <h2 style={{ margin: '0 0 4px', fontSize: 17 }}>Add an officer</h2>
      <div className="grid2">
        <div className="ns-field"><label htmlFor="o-name">Name</label>
          <input id="o-name" className="text" value={f.display_name} placeholder="Ravi Kumar" autoComplete="off"
            onChange={e => setF({ ...f, display_name: e.target.value, username: f.username && f.username !== suggest(f.display_name) ? f.username : suggest(e.target.value) })} /></div>
        <div className="ns-field"><label htmlFor="o-user">Username</label>
          <input id="o-user" className="text mono" value={f.username} onChange={set('username')} placeholder="ravi.kumar" autoCapitalize="none" spellCheck={false} autoComplete="off" /></div>
        <div className="ns-field"><label htmlFor="o-dept">Department</label>
          <select id="o-dept" className="select" value={f.department} onChange={set('department')}>
            <option value="">Choose…</option>{departments.map(d => <option key={d.key} value={d.key}>{d.name}</option>)}
          </select></div>
        <div className="ns-field"><label htmlFor="o-pw">Temporary password</label>
          <input id="o-pw" className="text" type="text" value={f.password} onChange={set('password')} placeholder="At least 8 characters" autoComplete="new-password" /></div>
      </div>
      <p className="ns-footnote">Share the password privately. They can change it in Settings after signing in.</p>
      {err && <p className="ns-help is-error" role="alert">{err}</p>}
      <div className="row" style={{ gap: 8 }}>
        <button className="ns-btn ns-btn-primary" type="submit" disabled={busy}>{busy ? <span className="spin" aria-label="Adding" /> : 'Add officer'}</button>
        <button className="ns-btn ns-btn-plain" type="button" style={{ marginTop: 16 }} onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
