/**
 * LPPlanningScreen — this login's planning worksheet only.
 * GPs never see this tab. The API refuses any other LP's book.
 */
import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, RefreshControl,
  ActivityIndicator, TouchableOpacity,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useAppResume } from '../hooks/useAppResume';
import { v2Fetch } from '../api/client';
import AppHeader from '../components/AppHeader';
import { haptics, useTheme } from '../design';

const SECTIONS = [
  { key: 'current', label: 'Current assets' },
  { key: 'long_term', label: 'Long-term assets' },
  { key: 'income', label: 'Other annual income' },
  { key: 'liability', label: 'Liabilities' },
];

function fmtUsd(v) {
  if (v == null || Number.isNaN(Number(v))) return '—';
  return Number(v).toLocaleString('en-US', {
    style: 'currency', currency: 'USD', maximumFractionDigits: 0,
  });
}
function isIra(label, na) {
  if (na) return true;
  return /\b(ira|roth|401\s*\(?k\)?|sep)\b/i.test(label || '');
}
function amt(r) {
  if (r.hidden) return 0;
  if (r.amount_override != null) return Number(r.amount_override);
  if (r.source !== 'manual' && r.live_amount != null) return Number(r.live_amount);
  return Number(r.amount || 0);
}
function yld(r) {
  if (r.yield_pct != null) return Number(r.yield_pct);
  return r.yield_pct_live != null ? Number(r.yield_pct_live) : null;
}
function tax(r) {
  if (r.section === 'liability' || r.section === 'long_term') return null;
  if (r.section === 'income') return amt(r);
  if (isIra(r.label, r.realized_na)) return null;
  if (r.capital_gains != null) return Number(r.capital_gains);
  return r.capital_gains_live != null ? Number(r.capital_gains_live) : null;
}
function ytd(r) {
  if (r.section === 'long_term' || r.section === 'liability' || r.section === 'income') return null;
  if (r.source === 'manual') return null;
  return r.pnl_actual_live != null ? Number(r.pnl_actual_live) : null;
}

export default function LPPlanningScreen() {
  const { theme: t } = useTheme();
  const s = useMemo(() => makeS(t), [t]);
  const [pack, setPack] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const resp = await v2Fetch('/api/v2/lp/planning');
      if (resp.status === 403) throw new Error('Planning is only on your LP login.');
      if (!resp.ok) throw new Error('Could not load planning (' + resp.status + ')');
      setPack(await resp.json());
    } catch (e) {
      setError(e?.message || 'Could not load your planning worksheet.');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));
  useAppResume(() => { load(); });

  const onRefresh = async () => {
    haptics.onPressTab?.();
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const snap = pack?.snapshot || {};
  const lp = pack?.lp || {};
  const rows = (snap.rows || []).filter((r) => !r.hidden);
  let assets = 0, liab = 0, invest = 0, taxTot = 0, ytdTot = 0, hasTax = false, hasYtd = false;
  rows.forEach((r) => {
    const a = amt(r);
    if (r.section === 'liability') { liab += a; return; }
    if (r.section === 'income') {
      const tv = tax(r);
      if (tv != null) { taxTot += tv; hasTax = true; }
      return;
    }
    assets += a;
    if (r.include_in_investments) invest += a;
    const tv = tax(r); if (tv != null) { taxTot += tv; hasTax = true; }
    const yv = ytd(r); if (yv != null) { ytdTot += yv; hasYtd = true; }
  });
  const nw = assets - liab;

  return (
    <View style={s.container}>
      <AppHeader title="Planning" subtitle={lp.name || 'Your worksheet'} />
      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.primary} />}
        contentContainerStyle={s.scroll}
      >
        {loading && !pack && (
          <View style={s.center}>
            <ActivityIndicator color={t.primary} />
            <Text style={s.muted}>Loading your worksheet…</Text>
          </View>
        )}
        {error && (
          <View style={s.errBox}>
            <Text style={s.errText}>{error}</Text>
            <TouchableOpacity onPress={load}><Text style={s.retry}>RETRY</Text></TouchableOpacity>
          </View>
        )}
        {pack && (
          <>
            <Text style={s.hint}>Only you and your GP can see this worksheet.</Text>
            <View style={s.kpiRow}>
              {[
                ['Net worth', fmtUsd(nw)],
                ['Investable', fmtUsd(invest)],
                ['Taxable P&L', hasTax ? fmtUsd(taxTot) : '—'],
                ['YTD unrl.', hasYtd ? fmtUsd(ytdTot) : '—'],
              ].map(([lab, val]) => (
                <View key={lab} style={s.kpi}>
                  <Text style={s.kpiL}>{lab}</Text>
                  <Text style={s.kpiV}>{val}</Text>
                </View>
              ))}
            </View>
            {SECTIONS.map((sec) => {
              const chunk = rows.filter((r) => r.section === sec.key);
              if (!chunk.length) return null;
              const sub = chunk.reduce((n, r) => n + amt(r), 0);
              return (
                <View key={sec.key} style={s.card}>
                  <View style={s.secHead}>
                    <Text style={s.secTitle}>{sec.label}</Text>
                    <Text style={s.secAmt}>{fmtUsd(sub)}</Text>
                  </View>
                  {chunk.map((r) => {
                    const a = amt(r);
                    const tv = tax(r);
                    const yv = ytd(r);
                    const ira = isIra(r.label, r.realized_na);
                    let taxS = '';
                    if (r.section === 'liability' || r.section === 'long_term') taxS = '';
                    else if (ira && r.section !== 'income') taxS = 'N/A';
                    else if (tv != null) taxS = fmtUsd(tv);
                    return (
                      <View key={r.id || r.label} style={s.line}>
                        <View style={{ flex: 1, paddingRight: 10 }}>
                          <Text style={s.lineName}>{r.label || '—'}</Text>
                          {!!r.notes && <Text style={s.lineNote}>{r.notes}</Text>}
                        </View>
                        <View style={{ alignItems: 'flex-end' }}>
                          <Text style={s.lineAmt}>{fmtUsd(a)}</Text>
                          {!!taxS && <Text style={s.lineSub}>P&L {taxS}</Text>}
                          {yv != null && <Text style={s.lineSub}>YTD {fmtUsd(yv)}</Text>}
                        </View>
                      </View>
                    );
                  })}
                </View>
              );
            })}
            <View style={[s.card, s.totCard]}>
              <Text style={s.secTitle}>Equity / net worth</Text>
              <Text style={s.totAmt}>{fmtUsd(nw)}</Text>
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

function makeS(t) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: t.bg || '#F5F7FA' },
    scroll: { padding: 16, paddingBottom: 40 },
    center: { alignItems: 'center', paddingVertical: 40, gap: 10 },
    muted: { fontSize: 12, color: t.textSecondary || '#8A95A8' },
    hint: { fontSize: 12, color: t.textSecondary || '#6a7890', marginBottom: 12, lineHeight: 17 },
    errBox: { padding: 16, backgroundColor: 'rgba(220,38,38,0.08)', borderRadius: 8 },
    errText: { color: '#b91c1c', fontSize: 13, marginBottom: 8 },
    retry: { fontSize: 11, fontWeight: '800', letterSpacing: 0.8, color: '#0A1628' },
    kpiRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 },
    kpi: {
      width: '48%', backgroundColor: t.surface || '#fff', borderRadius: 8,
      borderWidth: 1, borderColor: t.border || '#E8ECF2', padding: 10,
    },
    kpiL: { fontSize: 9, fontWeight: '800', letterSpacing: 0.5, textTransform: 'uppercase', color: '#8A95A8' },
    kpiV: { marginTop: 4, fontSize: 16, fontWeight: '800', color: t.textPrimary || '#0A1628' },
    card: {
      backgroundColor: t.surface || '#fff', borderRadius: 10,
      borderWidth: 1, borderColor: t.border || '#E8ECF2', padding: 12, marginBottom: 12,
    },
    secHead: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
    secTitle: { fontSize: 10, fontWeight: '800', letterSpacing: 0.6, textTransform: 'uppercase', color: '#0A1628' },
    secAmt: { fontSize: 12, fontWeight: '800', color: '#0A1628' },
    line: {
      flexDirection: 'row', justifyContent: 'space-between',
      paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#E8ECF2',
    },
    lineName: { fontSize: 13, fontWeight: '600', color: '#0A1628' },
    lineNote: { fontSize: 11, color: '#8A95A8', marginTop: 2 },
    lineAmt: { fontSize: 13, fontWeight: '800', color: '#0A1628' },
    lineSub: { fontSize: 10, color: '#6a7890', marginTop: 2 },
    totCard: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    totAmt: { fontSize: 18, fontWeight: '800', color: '#0A1628' },
  });
}
