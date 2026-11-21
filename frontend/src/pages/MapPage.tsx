import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { MapPin, WifiOff } from 'lucide-react';
import { api } from '../api/client';
import { DONE_STATUSES } from '../api/types';
import { AppShell } from '../components/AppShell';
import { Empty, Skeleton } from '../components/ui';
import { useAsync } from '../lib/hooks';
import { deptName } from '../lib/status';

const PRIO_W: Record<string, number> = { LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 };
type HeatFactory = (pts: [number, number, number][], o: object) => L.Layer;
let heatReady: Promise<HeatFactory> | null = null;
function loadHeat() { // leaflet.heat is a classic plugin that extends the global `L`
  (window as unknown as { L: typeof L }).L = L;
  heatReady ??= import('leaflet.heat').then(() => (L as unknown as { heatLayer: HeatFactory }).heatLayer);
  return heatReady;
}

export default function MapPage() {
  const { data, error, loading, reload } = useAsync(api.heatmap, []);
  const depts = useAsync(api.departments, []);
  const [dept, setDept] = useState('');
  const [openOnly, setOpenOnly] = useState(false);
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layers = useRef<L.Layer[]>([]);
  const [tilesFailed, setTilesFailed] = useState(false);

  const pts = useMemo(() => (data?.points ?? []).map(p => {
    const tk = p.tickets.filter(t => (!dept || t.department === dept) && (!openOnly || !DONE_STATUSES.includes(t.status)));
    return { ...p, tk, w: tk.reduce((s, t) => s + (PRIO_W[t.priority] || 1), 0) };
  }).filter(p => p.tk.length).sort((a, b) => b.w - a.w), [data, dept, openOnly]);
  const maxW = Math.max(1, ...pts.map(p => p.w));

  useEffect(() => {
    if (!el.current || map.current) return;
    const m = L.map(el.current, { zoomControl: false, attributionControl: true }).setView([28.635, 77.18], 11);
    L.control.zoom({ position: 'bottomright' }).addTo(m);
    const tiles = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '&copy; OpenStreetMap contributors', className: 'mono-tiles' }).addTo(m);
    let errs = 0;
    tiles.on('tileerror', () => { if (++errs > 6) setTilesFailed(true); });
    map.current = m;
    return () => { m.remove(); map.current = null; };
  }, [loading]);

  useEffect(() => {
    let cancelled = false;
    loadHeat().then(heat => {
      const m = map.current;
      if (cancelled || !m) return;
      m.invalidateSize();
      layers.current.forEach(l => m.removeLayer(l));
      layers.current = [heat(pts.map(p => [p.lat, p.lng, p.w]), { radius: 36, blur: 26, max: maxW, minOpacity: 0.3, gradient: { 0.3: '#FFCC80', 0.6: '#FF9500', 1: '#FF3B30' } }).addTo(m)];
      pts.forEach(p => {
        const box = document.createElement('div');
        const b = document.createElement('b'); b.textContent = p.locality; box.append(b, document.createElement('br'), `${p.complaints} complaint(s), ${p.tk.length} ticket(s)`);
        layers.current.push(L.circleMarker([p.lat, p.lng], { radius: 5, color: '#FFFFFF', weight: 2, fillColor: '#1D1D1F', fillOpacity: 1 }).bindPopup(box).addTo(m));
      });
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [pts, maxW]);

  return (
    <AppShell crumbs={[{ label: 'Hotspot map' }]} wide>
      <style>{'.mono-tiles{filter:grayscale(1) contrast(.92) brightness(1.04)}:root[data-theme="dark"] .mono-tiles{filter:grayscale(1) invert(1) brightness(.85) contrast(.9)}'}</style>
      <div className="page-head">
        <div><h1 className="ns-title">Hotspot map</h1><p>Where complaints cluster. Intensity is tickets weighted by priority, from Low (1) to Critical (4).</p></div>
      </div>
      <div className="toolbar">
        <div className="chips" role="group" aria-label="Department">
          <button type="button" className={`ns-chip${!dept ? ' on' : ''}`} onClick={() => setDept('')}>All departments</button>
          {(depts.data ?? []).map(d => <button key={d.key} type="button" className={`ns-chip${dept === d.key ? ' on' : ''}`} aria-pressed={dept === d.key} onClick={() => setDept(d.key)}>{deptName(d.key)}</button>)}
        </div>
        <button type="button" className={`ns-chip${openOnly ? ' on' : ''}`} aria-pressed={openOnly} onClick={() => setOpenOnly(!openOnly)}>Unresolved only</button>
      </div>
      {error ? <Empty icon={WifiOff} title="Couldn’t load the map data" action={<button className="ns-btn ns-btn-secondary ns-btn-sm" onClick={() => reload()}>Try again</button>}>{error.message}</Empty>
        : loading && !data ? <Skeleton h={520} r={18} />
        : <div className="two-col map-cols">
            <div>
              {tilesFailed && <p className="ns-footnote" style={{ marginBottom: 8 }}>Map tiles need an internet connection. The hotspot list still works offline.</p>}
              <div className="mapbox" ref={el} aria-label="Complaint heatmap of Delhi" />
            </div>
            <section>
              <div className="section-h"><h2>Top hotspots</h2></div>
              {!pts.length ? <Empty icon={MapPin} title="No matching tickets">File a few complaints or change the filters.</Empty>
                : <div className="hots">{pts.slice(0, 10).map(p => <div className="hot" key={p.locality} style={{ gridTemplateColumns: '110px 1fr 28px', fontSize: 14 }}><span className="ellipsis">{p.locality}</span><div className="bar"><i style={{ width: `${(p.w / maxW) * 100}%` }} /></div><span>{p.tk.length}</span></div>)}</div>}
              {!!data?.unmapped && <p className="ns-footnote" style={{ marginTop: 12 }}>{data.unmapped} complaint(s) had no known locality and are not on the map.</p>}
            </section>
          </div>}
    </AppShell>
  );
}
