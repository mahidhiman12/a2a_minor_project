import { Link } from 'react-router-dom';
import { Compass } from 'lucide-react';
import { homeFor, useAuth } from '../auth';
import { PublicPage } from '../components/Public';

export default function NotFound({ title = 'Page not found', text = 'The page you’re looking for doesn’t exist or has moved.' }: { title?: string; text?: string }) {
  const { user } = useAuth();
  return (
    <PublicPage links={false}>
      <main className="auth page-enter">
        <div className="box" style={{ textAlign: 'center' }}>
          <Compass width={32} height={32} strokeWidth={1.25} style={{ margin: '0 auto', color: 'var(--ink-tertiary)' }} aria-hidden="true" />
          <h1 className="ns-title" style={{ marginTop: 16 }}>{title}</h1>
          <p className="ns-lead" style={{ marginTop: 10, fontSize: 17 }}>{text}</p>
          <Link className="ns-btn ns-btn-primary ns-btn-lg" style={{ marginTop: 28 }} to={user ? homeFor(user) : '/'}>{user ? 'Go to my page' : 'Go home'}</Link>
        </div>
      </main>
    </PublicPage>
  );
}
