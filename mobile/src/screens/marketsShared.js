// Shared Markets / Watchlist board helpers. Keep DGA tokens; no new palettes.
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { spacing } from '../design';

export const QUOTE_POLL_MS = 60_000;

// Same roster as api/server.py _INDEX_TICKERS. Unknown labels (e.g. CSCO) never paint.
export const INDEX_ALLOW = [
  ['S&P 500', '^GSPC'],
  ['Dow 30', '^DJI'],
  ['Nasdaq', '^IXIC'],
  ['Russell 2000', '^RUT'],
  ['VIX', '^VIX'],
  ['10Y Treasury', '^TNX'],
  ['Dollar Index', 'DX-Y.NYB'],
  ['Gold', 'GC=F'],
  ['Crude Oil', 'CL=F'],
  ['Bitcoin', 'BTC-USD'],
  ['Ethereum', 'ETH-USD'],
];

export function paintMarketIndices(raw) {
  const byLabel = {};
  const bySym = {};
  (raw || []).forEach((ix) => {
    const label = String(ix?.label || '').trim();
    const sym = String(ix?.symbol || '').trim();
    if (label) byLabel[label] = ix;
    if (sym) bySym[sym] = ix;
  });
  return INDEX_ALLOW.map(([label, symbol]) => {
    const hit = byLabel[label] || bySym[symbol] || {};
    return {
      label,
      symbol,
      price: hit.price != null ? hit.price : null,
      pct: hit.pct != null ? hit.pct : null,
    };
  });
}

export function fmtPct(p) {
  if (p == null || isNaN(p)) return '—';
  return (p >= 0 ? '+' : '') + Number(p).toFixed(2) + '%';
}

export function fmtPx(p) {
  if (p == null || isNaN(p)) return '—';
  const n = Number(p);
  return n >= 1000
    ? n.toLocaleString('en-US', { maximumFractionDigits: 0 })
    : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Absolute day change. Koyfin: no plus on up, minus on down, two decimals. */
export function fmtChg(n) {
  if (n == null || isNaN(n)) return '—';
  const sign = n < 0 ? '-' : '';
  const a = Math.abs(Number(n));
  const body = a.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return sign + body;
}

export function wireRelAge(pubTs) {
  if (pubTs == null) return '';
  const sec = Math.max(0, Date.now() / 1000 - Number(pubTs));
  if (sec < 3600) return Math.max(1, Math.floor(sec / 60)) + 'm';
  if (sec < 86400) return Math.floor(sec / 3600) + 'h';
  return Math.floor(sec / 86400) + 'd';
}

export function fmtRevShort(v) {
  if (v == null || Number.isNaN(Number(v))) return '—';
  const n = Math.abs(Number(v));
  const sign = Number(v) < 0 ? '-' : '';
  if (n >= 1e9) return sign + (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return sign + (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return sign + (n / 1e3).toFixed(0) + 'K';
  return sign + String(Math.round(n));
}

export function fmtEps(v) {
  if (v == null || Number.isNaN(Number(v))) return '—';
  const n = Number(v);
  return (n < 0 ? '-$' : '$') + Math.abs(n).toFixed(2);
}

export function fmtClock(d) {
  if (!d) return '';
  try {
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  } catch {
    return '';
  }
}

export function etSessionDate(now = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: 'numeric',
      hour12: false,
    }).formatToParts(now);
    const g = (t) => parts.find((p) => p.type === t)?.value;
    let y = Number(g('year'));
    let m = Number(g('month'));
    let d = Number(g('day'));
    const hour = Number(g('hour'));
    if (hour < 4) {
      const utc = Date.UTC(y, m - 1, d) - 86400000;
      const x = new Date(utc);
      y = x.getUTCFullYear();
      m = x.getUTCMonth() + 1;
      d = x.getUTCDate();
    }
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  } catch {
    return '';
  }
}

export function usEquitySession(now = new Date()) {
  let parts;
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      weekday: 'short',
      hour: 'numeric',
      minute: 'numeric',
      hour12: false,
    }).formatToParts(now);
  } catch {
    return { key: 'unknown', label: 'Markets', live: false, color: '#94a3b8' };
  }
  const get = (t) => parts.find((p) => p.type === t)?.value;
  const wd = get('weekday');
  const hour = Number(get('hour'));
  const minute = Number(get('minute'));
  const mins = hour * 60 + minute;
  const weekend = wd === 'Sat' || wd === 'Sun';
  if (weekend) return { key: 'closed', label: 'Weekend', live: false, color: '#94a3b8' };
  if (mins >= 4 * 60 && mins < 9 * 60 + 30) {
    return { key: 'pre', label: 'Pre-Market', live: true, color: '#F5C542' };
  }
  if (mins >= 9 * 60 + 30 && mins < 16 * 60) {
    return { key: 'open', label: 'US Open', live: true, color: '#16A34A' };
  }
  if (mins >= 16 * 60 && mins < 20 * 60) {
    return { key: 'ah', label: 'After-Hours', live: true, color: '#F5C542' };
  }
  return { key: 'closed', label: 'US Closed', live: false, color: '#94a3b8' };
}

export function mergeWatchQuotes(base, overlay) {
  if (!overlay || typeof overlay !== 'object') return base;
  const quotes = { ...((base && base.quotes) || {}) };
  let n = 0;
  Object.keys(overlay).forEach((raw) => {
    const tk = String(raw || '').trim().toUpperCase();
    const q = overlay[raw];
    if (!tk || !q || q.price == null) return;
    const prev = quotes[tk] || {};
    const pct = q.pct != null ? q.pct : q.pct_change;
    const name = q.name || q.short_name || q.long_name || q.company || prev.name;
    const chg = q.change != null ? q.change : (q.chg != null ? q.chg : prev.change);
    quotes[tk] = {
      ...prev,
      price: q.price,
      pct: pct != null ? pct : prev.pct,
      pct_change: pct != null ? pct : prev.pct_change,
      as_of: q.as_of || prev.as_of,
      ...(name ? { name } : {}),
      ...(chg != null && !isNaN(Number(chg)) ? { change: Number(chg) } : {}),
    };
    n += 1;
  });
  if (!n) return base;
  return { ...(base || { tickers: [], quotes: {} }), quotes };
}

export function overlayFromMovers(movers) {
  const overlay = {};
  (movers || []).forEach((m) => {
    const tk = String(m?.ticker || '').trim().toUpperCase();
    if (!tk || m.price == null) return;
    overlay[tk] = {
      price: m.price,
      pct: m.pct_change,
      pct_change: m.pct_change,
      name: m.name || m.short_name || m.long_name || m.company,
    };
  });
  return overlay;
}

export function absChange(q, pct) {
  if (!q) return null;
  const raw = q.change != null ? q.change : q.chg;
  if (raw != null && !isNaN(Number(raw))) return Number(raw);
  const px = Number(q.price);
  const p = pct != null ? Number(pct) : null;
  if (p == null || isNaN(p) || isNaN(px) || p === -100) return null;
  return px - px / (1 + p / 100);
}

export function companyName(q) {
  if (!q) return '';
  const n = q.name || q.short_name || q.long_name || q.company || '';
  return String(n).trim();
}

export function pulseSummary(md) {
  if (!md) return '';
  const clean = (ln) => ln.replace(/[*_`#>\[\]]/g, '').replace(/📰/g, '').trim();
  const lines = String(md).split('\n');
  for (const ln of lines) {
    const idx = ln.toLowerCase().indexOf('s move:');
    if (idx >= 0) return clean(ln.slice(idx + 7));
  }
  for (const ln of lines) {
    const txt = clean(ln);
    if (txt.length > 25 && !txt.startsWith('HIGH') && !txt.startsWith('MED') && !txt.startsWith('LOW')) {
      return txt;
    }
  }
  return '';
}

export function BriefMarkdown({ style, children }) {
  const Markdown = require('react-native-markdown-display').default;
  return <Markdown style={style}>{children}</Markdown>;
}

export function PctPill({ p, size = 12, t, caret = true }) {
  const up = p == null ? null : p >= 0;
  const bg = p == null ? t.pillFlatBg : up ? t.pillUpBg : t.pillDownBg;
  const fg = p == null ? t.pillFlatFg : up ? t.pillUpFg : t.pillDownFg;
  return (
    <View style={[sharedStyles.pill, { backgroundColor: bg }]}>
      {p != null && caret ? (
        <Ionicons name={up ? 'caret-up' : 'caret-down'} size={size - 1} color={fg} />
      ) : null}
      <Text style={{ color: fg, fontWeight: '800', fontSize: size, fontVariant: ['tabular-nums'] }}>{fmtPct(p)}</Text>
    </View>
  );
}

export function SentimentPill({ sentiment, t }) {
  const sUp = String(sentiment || '').toUpperCase();
  const bg = sUp === 'BULLISH' ? t.pillUpBg : sUp === 'BEARISH' ? t.pillDownBg : t.pillFlatBg;
  const fg = sUp === 'BULLISH' ? t.pillUpFg : sUp === 'BEARISH' ? t.pillDownFg : t.pillFlatFg;
  const label = sUp ? sUp.charAt(0) + sUp.slice(1).toLowerCase() : 'Neutral';
  return (
    <View style={[sharedStyles.pill, { backgroundColor: bg }]}>
      <Text style={{ color: fg, fontWeight: '800', fontSize: 11 }}>{label}</Text>
    </View>
  );
}

export function SectionHeader({ icon, children, right, t, s }) {
  return (
    <View style={sharedStyles.sectionRow}>
      <View style={[sharedStyles.sectionIcon, { backgroundColor: t.surfaceTint }]}>
        <MaterialCommunityIcons name={icon} size={15} color={t.primary} />
      </View>
      <Text style={s.sectionLabel}>{children}</Text>
      <View style={{ flex: 1 }} />
      {right}
    </View>
  );
}

const sharedStyles = StyleSheet.create({
  pill: { flexDirection: 'row', alignItems: 'center', gap: 1, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
  sectionRow: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.md, marginTop: spacing.xs, gap: 8 },
  sectionIcon: { width: 26, height: 26, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
});
