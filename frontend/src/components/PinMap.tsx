import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

const pinIcon = L.divIcon({ className: 'pin-icon', html: '<span></span>', iconSize: [26, 26], iconAnchor: [13, 26] });

/**
 * A small OpenStreetMap with one pin. Editable: drag the pin or tap the map to move it
 * (onMove gets the new spot). Read-only otherwise, e.g. for the crew on the ticket page.
 */
export function PinMap({ lat, lng, editable, onMove, height = 200, label }: {
  lat: number; lng: number; editable?: boolean; onMove?: (lat: number, lng: number) => void; height?: number; label: string;
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const marker = useRef<L.Marker | null>(null);
  const moveRef = useRef(onMove);
  moveRef.current = onMove;

  useEffect(() => {
    if (!el.current) return;
    const m = L.map(el.current, { zoomControl: false, attributionControl: true, scrollWheelZoom: false, dragging: true })
      .setView([lat, lng], 16);
    L.control.zoom({ position: 'bottomright' }).addTo(m);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors', className: 'mono-tiles' }).addTo(m);
    const mk = L.marker([lat, lng], { icon: pinIcon, draggable: !!editable, keyboard: !!editable, title: label }).addTo(m);
    if (editable) {
      mk.on('dragend', () => { const p = mk.getLatLng(); moveRef.current?.(p.lat, p.lng); });
      m.on('click', (e: L.LeafletMouseEvent) => { mk.setLatLng(e.latlng); moveRef.current?.(e.latlng.lat, e.latlng.lng); });
    }
    map.current = m; marker.current = mk;
    setTimeout(() => m.invalidateSize(), 50); // the card may still be animating in
    return () => { m.remove(); map.current = null; marker.current = null; };
  }, [editable, label]); // eslint-disable-line react-hooks/exhaustive-deps

  // follow a new spot from outside (e.g. the place was corrected in the chat)
  useEffect(() => {
    const m = map.current, mk = marker.current;
    if (!m || !mk) return;
    const cur = mk.getLatLng();
    if (Math.abs(cur.lat - lat) > 1e-6 || Math.abs(cur.lng - lng) > 1e-6) { mk.setLatLng([lat, lng]); m.setView([lat, lng]); }
  }, [lat, lng]);

  return <div className="pinmap mapbox" ref={el} style={{ height }} role="application" aria-label={label} />;
}
