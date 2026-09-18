/**
 * Last-known-good payloads so Markets / Positions / Financials / Research
 * paint immediately instead of a spinner on every open.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const PREFIX = '@dga_sc_';
const mem = Object.create(null);
const memTs = Object.create(null);

let _wl = { ts: 0, data: null };

export async function readScreenCache(key) {
  if (mem[key] !== undefined) return mem[key];
  try {
    const raw = await AsyncStorage.getItem(PREFIX + key);
    if (!raw) {
      mem[key] = null;
      memTs[key] = 0;
      return null;
    }
    const d = JSON.parse(raw);
    mem[key] = d;
    // Disk hit is last-known-good, not a fresh network write.
    if (memTs[key] == null) memTs[key] = 0;
    return d;
  } catch {
    return null;
  }
}

export function writeScreenCache(key, data) {
  mem[key] = data;
  memTs[key] = Date.now();
  try {
    AsyncStorage.setItem(PREFIX + key, JSON.stringify(data)).catch(() => {});
  } catch { /* quota */ }
}

export function patchScreenCache(key, patch) {
  const prev = mem[key] && typeof mem[key] === 'object' && !Array.isArray(mem[key])
    ? mem[key]
    : {};
  writeScreenCache(key, { ...prev, ...patch });
}

export function screenCacheFresh(key, maxAgeMs = 45_000) {
  return mem[key] != null && memTs[key] > 0 && Date.now() - memTs[key] < maxAgeMs;
}

export function peekWatchlist() {
  return _wl.data;
}

export function putWatchlist(d) {
  if (!d) return;
  _wl = { ts: Date.now(), data: d };
}

export function watchlistFresh(maxAgeMs = 45_000) {
  return !!(_wl.data && Date.now() - _wl.ts < maxAgeMs);
}
