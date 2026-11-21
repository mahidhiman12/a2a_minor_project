import { useCallback, useEffect, useRef, useState } from 'react';

/** Runs `fn` when `deps` change; `reload()` runs it again. Ignores answers from stale calls. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  const call = useRef(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const run = useCallback(async (quiet = false) => {
    const id = ++call.current;
    if (!quiet) setLoading(true);
    try {
      const d = await fnRef.current();
      if (id === call.current) { setData(d); setError(null); }
    } catch (e) {
      if (id === call.current) setError(e as Error);
    } finally {
      if (id === call.current) setLoading(false);
    }
  }, []);

  useEffect(() => { run(); }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  return { data, error, loading, reload: run };
}

/** Calls `fn` every `ms` while the browser tab is visible. */
export function useInterval(fn: () => void, ms: number) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    const t = window.setInterval(() => { if (!document.hidden) ref.current(); }, ms);
    return () => window.clearInterval(t);
  }, [ms]);
}

export function useMediaQuery(q: string) {
  const [m, setM] = useState(() => window.matchMedia(q).matches);
  useEffect(() => {
    const mq = window.matchMedia(q);
    const on = () => setM(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [q]);
  return m;
}
