/**
 * Fire when the app returns from background (not on every focus / Control Center flicker).
 *
 * React Navigation's useFocusEffect does NOT re-run when iOS keeps the JS
 * bundle warm — so Markets / Positions stay stale until a force-quit.
 */
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

export function useAppResume(onResume, { minBackgroundMs = 2000 } = {}) {
  const cbRef = useRef(onResume);
  cbRef.current = onResume;
  const bgAtRef = useRef(0);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'background' || next === 'inactive') {
        if (!bgAtRef.current) bgAtRef.current = Date.now();
        return;
      }
      if (next !== 'active') return;
      const started = bgAtRef.current;
      bgAtRef.current = 0;
      if (!started) return;
      const elapsed = Date.now() - started;
      if (elapsed < minBackgroundMs) return;
      try {
        cbRef.current(elapsed);
      } catch {
        /* never let a screen refresh crash resume */
      }
    });
    return () => sub.remove();
  }, [minBackgroundMs]);
}
