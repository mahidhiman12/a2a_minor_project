import { useEffect } from 'react';
import { Route, Routes, useLocation } from 'react-router-dom';
import { RequireRole } from './auth';
import Landing from './pages/Landing';
import Login from './pages/Login';
import Home from './pages/Home';
import FileComplaint from './pages/FileComplaint';
import MyComplaints from './pages/MyComplaints';
import ComplaintDetail from './pages/ComplaintDetail';
import Agents from './pages/Agents';
import MapPage from './pages/MapPage';
import Settings from './pages/Settings';
import DeptQueue from './pages/DeptQueue';
import AdminOverview from './pages/AdminOverview';
import NotFound from './pages/NotFound';

const TITLES: [RegExp, string | ((m: RegExpMatchArray) => string)][] = [
  [/^\/login/, 'Sign in'], [/^\/home/, 'Home'], [/^\/file/, 'File a complaint'],
  [/^\/complaints\/([^/]+)/, m => decodeURIComponent(m[1]).toUpperCase()], [/^\/complaints/, 'My complaints'],
  [/^\/agents/, 'Agents'], [/^\/map/, 'Hotspot map'], [/^\/settings/, 'Settings'], [/^\/dept\//, 'Ticket queue'], [/^\/admin/, 'Overview'],
];

/** Document title per route, and scroll to top on navigation (unless jumping to an anchor). */
function useRouteChrome() {
  const { pathname, hash } = useLocation();
  useEffect(() => {
    if (pathname === '/') document.title = 'Nagrik Sahayak — One complaint. Every department.';
    else {
      const hit = TITLES.map(([rx, t]) => [pathname.match(rx), t] as const).find(([m]) => m);
      const t = hit ? (typeof hit[1] === 'function' ? hit[1](hit[0]!) : hit[1]) : 'Not found';
      document.title = `${t} · Nagrik Sahayak`;
    }
    if (!hash) window.scrollTo(0, 0);
  }, [pathname, hash]);
}

const ALL: ('citizen' | 'officer' | 'admin')[] = ['citizen', 'officer', 'admin'];

export default function App() {
  useRouteChrome();
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<Login />} />
      <Route path="/home" element={<RequireRole roles={['citizen']}><Home /></RequireRole>} />
      <Route path="/file" element={<RequireRole roles={['citizen']}><FileComplaint /></RequireRole>} />
      <Route path="/complaints" element={<RequireRole roles={['citizen']}><MyComplaints /></RequireRole>} />
      <Route path="/complaints/:id" element={<RequireRole roles={['citizen', 'admin']}><ComplaintDetail /></RequireRole>} />
      <Route path="/agents" element={<RequireRole roles={ALL}><Agents /></RequireRole>} />
      <Route path="/map" element={<RequireRole roles={ALL}><MapPage /></RequireRole>} />
      <Route path="/settings" element={<RequireRole roles={ALL}><Settings /></RequireRole>} />
      <Route path="/dept/:dept" element={<RequireRole roles={['officer', 'admin']}><DeptQueue /></RequireRole>} />
      <Route path="/admin" element={<RequireRole roles={['admin']}><AdminOverview /></RequireRole>} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
