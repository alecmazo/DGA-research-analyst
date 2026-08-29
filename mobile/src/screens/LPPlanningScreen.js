/**
 * LP Documents tab — this login's planning worksheet (nobody else's).
 * Lives under Documents, not a standalone Planning tab.
 */
import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, RefreshControl,
  ActivityIndicator, TouchableOpacity, TextInput, Alert,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useAppResume } from '../hooks/useAppResume';
import { v2Fetch } from '../api/client';
import AppHeader from '../components/AppHeader';
import { haptics, useTheme } from '../design';

const SECTIONS = [
  { key: 'current', label: 'Current assets', add: '+ Asset' },
  { key: 'long_term', label: 'Long-term assets', add: '+ Property' },
  { key: 'income', label: 'Other annual income', add: '+ Income' },
  { key: 'liability', label: 'Liabilities', add: '+ Liability' },
];

function nid() {
  return 'r' + Math.random().toString(16).slice(2, 12);
}
function parseNum(raw) {
  const t = String(raw || '').trim().replace(/[$,%\s]/g, '').replace(/^\((.+)\)$/, '-$1');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}
function isLive(r) {
  return r && (r.source === 'managed' || r.source === 'fund');
}

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

export default function LPPlanningScreen({ gpMode = false, embedded = false }) {
  const { theme: t } = useTheme();
  const s = useMemo(() => makeS(t), [t]);
  const [pack, setPack] = useState(null);
  const [rows, setRows] = useState([]);
  const [expenses, setExpenses] = useState(0);
  const [notes, setNotes] = useState('');
  const [asOf, setAsOf] = useState('');
  const [title, setTitle] = useState('');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [roster, setRoster] = useState([]);
  const [lpId, setLpId] = useState('');

  const applyPack = (d) => {
    const snap = d?.snapshot || {};
    setPack(d);
    setRows((snap.rows || []).filter((r) => !r.hidden));
    setExpenses(Number(snap.annual_expenses || 0));
    setNotes(snap.notes || '');
    setAsOf(snap.as_of || '');
    setTitle(snap.title || '');
    setDirty(false);
  };

  const load = useCallback(async (explicitId) => {
    setError(null);
    try {
      if (gpMode) {
        const rList = await v2Fetch('/api/v2/gp/lp-planning');
        if (!rList.ok) throw new Error('Could not load LP list (' + rList.status + ')');
        const list = (await rList.json())?.lps || [];
        setRoster(list);
        const pick = explicitId || lpId || list[0]?.lp_id || '';
        if (pick && pick !== lpId) setLpId(pick);
        if (!pick) {
          setPack(null);
          setRows([]);
          setLoading(false);
          return;
        }
        const resp = await v2Fetch('/api/v2/gp/lp-planning/' + encodeURIComponent(pick));
        if (!resp.ok) throw new Error('Could not load planning (' + resp.status + ')');
        applyPack(await resp.json());
      } else {
        const resp = await v2Fetch('/api/v2/lp/planning');
        if (resp.status === 403) throw new Error('This worksheet is only on your LP login.');
        if (!resp.ok) throw new Error('Could not load planning (' + resp.status + ')');
        applyPack(await resp.json());
      }
    } catch (e) {
      setError(e?.message || 'Could not load your planning worksheet.');
    } finally {
      setLoading(false);
    }
  }, [gpMode, lpId]);

  useFocusEffect(useCallback(() => {
    if (!dirty) load();
  }, [load, dirty]));
  useAppResume(() => { if (!dirty) load(); });

  const onRefresh = async () => {
    if (dirty) {
      Alert.alert('Unsaved changes', 'Save first so you don’t lose household edits.', [
        { text: 'Keep editing', style: 'cancel' },
        { text: 'Discard', style: 'destructive', onPress: () => { setDirty(false); load(); } },
      ]);
      return;
    }
    haptics.onPressTab?.();
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const lp = pack?.lp || {};
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

  const patch = (id, partial) => {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...partial } : r)));
    setDirty(true);
    setSaveMsg('');
  };
  const addRow = (section) => {
    const n = rows.filter((r) => r.section === section).length;
    const labels = {
      current: n ? `Other asset ${n}` : 'Other asset',
      long_term: n ? `Property ${n + 1} (FMV)` : 'Real estate (FMV)',
      liability: n ? `Liability ${n + 1}` : 'Mortgage / property debt',
      income: n ? `Income source ${n + 1}` : 'Social Security (annual)',
    };
    setRows((rs) => [...rs, {
      id: nid(), section, label: labels[section] || 'Line',
      amount: null, yield_pct: null, notes: '',
      include_in_investments: section === 'current', source: 'manual',
      hidden: false,
    }]);
    setDirty(true);
  };
  const save = async () => {
    if (gpMode && !lpId) return;
    setSaving(true);
    setSaveMsg('');
    try {
      const path = gpMode
        ? '/api/v2/gp/lp-planning/' + encodeURIComponent(lpId)
        : '/api/v2/lp/planning';
      const resp = await v2Fetch(path, {
        method: 'PUT',
        body: JSON.stringify({
          title, as_of: asOf, notes, annual_expenses: expenses || 0,
          rows: rows.map((r) => ({
            id: r.id, section: r.section, label: r.label, amount: r.amount,
            yield_pct: r.yield_pct, pnl_actual: r.pnl_actual, notes: r.notes || '',
            include_in_investments: !!r.include_in_investments,
            source: r.source || 'manual', link_id: r.link_id || null,
            hidden: !!r.hidden, amount_override: r.amount_override,
            capital_gains: r.capital_gains,
          })),
        }),
      });
      if (!resp.ok) {
        let msg = 'Save failed (' + resp.status + ')';
        try { const j = await resp.json(); msg = j.detail || j.error || msg; } catch {}
        throw new Error(msg);
      }
      applyPack(await resp.json());
      setSaveMsg(gpMode ? 'Saved — this is the version the LP sees' : 'Saved — your GP sees this version');
    } catch (e) {
      setSaveMsg(e?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const pickLp = (id) => {
    if (id === lpId) return;
    if (dirty) {
      Alert.alert('Unsaved changes', 'Save first, or discard and switch LPs.', [
        { text: 'Keep editing', style: 'cancel' },
        { text: 'Discard', style: 'destructive', onPress: () => { setDirty(false); setLpId(id); load(id); } },
      ]);
      return;
    }
    setLpId(id);
    setLoading(true);
    load(id);
  };

  return (
    <View style={s.container}>
      {!embedded && (
        <AppHeader
          title={gpMode ? 'Planning' : 'Documents'}
          subtitle={lp.name || (gpMode ? 'Pick an LP' : 'Your worksheet')}
        />
      )}
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
        {gpMode && roster.length > 0 && (
          <ScrollView horizontal nestedScrollEnabled showsHorizontalScrollIndicator={false} style={s.picker} contentContainerStyle={s.pickerRow}>
            {roster.map((u) => {
              const on = u.lp_id === lpId;
              return (
                <TouchableOpacity key={u.lp_id} onPress={() => pickLp(u.lp_id)} style={[s.chip, on && s.chipOn]}>
                  <Text style={[s.chipTxt, on && s.chipTxtOn]} numberOfLines={1}>
                    {u.name || u.email || u.lp_id}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        )}
        {gpMode && !roster.length && !loading && !error && (
          <View style={s.card}>
            <Text style={s.secTitle}>No LPs yet</Text>
            <Text style={s.hint}>Add LPs under Settings → Users on the web desk, then come back here.</Text>
          </View>
        )}
        {pack && (
          <>
            {!gpMode && (
            <View style={s.card}>
              <Text style={s.secTitle}>Documents</Text>
              <Text style={s.hint}>
                K-1s, statements, and GP letters will appear here when published.
                The planning worksheet is shared with your GP — latest save wins.
              </Text>
            </View>
            )}
            {gpMode && (
              <Text style={s.hint}>
                Same worksheet the LP sees. Latest save wins — they can fill household lines you may not have.
              </Text>
            )}
            <View style={s.headRow}>
              <Text style={s.hint}>Planning worksheet</Text>
              <TouchableOpacity
                style={[s.saveBtn, (!dirty || saving) && { opacity: 0.45 }]}
                disabled={!dirty || saving}
                onPress={() => { haptics.onPressTab?.(); save(); }}
              >
                <Text style={s.saveBtnTxt}>{saving ? 'SAVING…' : 'SAVE'}</Text>
              </TouchableOpacity>
            </View>
            {!!saveMsg && <Text style={s.saveMsg}>{saveMsg}</Text>}
            <View style={s.kpiRow}>
              {[
                ['Net worth', fmtUsd(nw)],
                ['Investable', fmtUsd(invest)],
                ['Taxable P&L', hasTax ? fmtUsd(taxTot) : '—'],
                ['YTD unrl.', hasYtd ? fmtUsd(ytdTot) : '—'],
                ['Expenses', fmtUsd(expenses)],
              ].map(([lab, val]) => (
                <View key={lab} style={s.kpi}>
                  <Text style={s.kpiL}>{lab}</Text>
                  <Text style={s.kpiV}>{val}</Text>
                </View>
              ))}
            </View>
            <View style={s.card}>
              <Text style={s.secTitle}>Annual expenses</Text>
              <TextInput
                style={s.input}
                keyboardType="decimal-pad"
                value={expenses ? String(expenses) : ''}
                placeholder="200000"
                placeholderTextColor="#A8B2C1"
                onChangeText={(v) => { setExpenses(parseNum(v) || 0); setDirty(true); }}
              />
            </View>
            {SECTIONS.map((sec) => {
              const chunk = rows.filter((r) => r.section === sec.key);
              const sub = chunk.reduce((n, r) => n + amt(r), 0);
              return (
                <View key={sec.key} style={s.card}>
                  <View style={s.secHead}>
                    <Text style={s.secTitle}>{sec.label}</Text>
                    <TouchableOpacity onPress={() => addRow(sec.key)}>
                      <Text style={s.addBtn}>{sec.add}</Text>
                    </TouchableOpacity>
                  </View>
                  <Text style={s.secAmt}>{fmtUsd(sub)}</Text>
                  {chunk.map((r) => {
                    const live = isLive(r);
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
                          {live ? (
                            <Text style={s.lineName}>{r.label || '—'}</Text>
                          ) : (
                            <TextInput
                              style={s.lineInput}
                              value={r.label || ''}
                              onChangeText={(v) => patch(r.id, { label: v })}
                            />
                          )}
                          <TextInput
                            style={s.noteInput}
                            value={r.notes || ''}
                            placeholder="Note for your GP"
                            placeholderTextColor="#A8B2C1"
                            onChangeText={(v) => patch(r.id, { notes: v })}
                          />
                        </View>
                        <View style={{ alignItems: 'flex-end', minWidth: 110 }}>
                          {live ? (
                            <Text style={s.lineAmt}>{fmtUsd(a)}</Text>
                          ) : (
                            <TextInput
                              style={s.amtInput}
                              keyboardType="decimal-pad"
                              value={r.amount != null ? String(r.amount) : ''}
                              placeholder="0"
                              placeholderTextColor="#A8B2C1"
                              onChangeText={(v) => patch(r.id, { amount: parseNum(v) })}
                            />
                          )}
                          {!!taxS && <Text style={s.lineSub}>P&L {taxS}</Text>}
                          {yv != null && <Text style={s.lineSub}>YTD {fmtUsd(yv)}</Text>}
                        </View>
                      </View>
                    );
                  })}
                </View>
              );
            })}
            <View style={s.card}>
              <Text style={s.secTitle}>Planning notes (shared with GP)</Text>
              <TextInput
                style={s.notesBox}
                multiline
                value={notes}
                placeholder="Property details, Social Security, liquidity needs…"
                placeholderTextColor="#A8B2C1"
                onChangeText={(v) => { setNotes(v); setDirty(true); }}
              />
            </View>
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
    headRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
    saveBtn: {
      backgroundColor: '#0A1628', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 6,
    },
    saveBtnTxt: { color: '#F5C242', fontSize: 11, fontWeight: '800', letterSpacing: 0.8 },
    saveMsg: { fontSize: 12, fontWeight: '600', color: '#166534', marginBottom: 8 },
    input: {
      marginTop: 8, borderWidth: 1, borderColor: '#E8ECF2', borderRadius: 6,
      paddingHorizontal: 10, paddingVertical: 8, fontSize: 15, fontWeight: '700', color: '#0A1628',
    },
    addBtn: { fontSize: 11, fontWeight: '800', color: '#3E9AB8' },
    lineInput: { fontSize: 13, fontWeight: '600', color: '#0A1628', paddingVertical: 2 },
    noteInput: { fontSize: 11, color: '#5b6b82', paddingVertical: 2, marginTop: 2 },
    amtInput: {
      minWidth: 100, textAlign: 'right', fontSize: 13, fontWeight: '800', color: '#0A1628',
      borderWidth: 1, borderColor: '#E8ECF2', borderRadius: 4, paddingHorizontal: 8, paddingVertical: 4,
    },
    notesBox: {
      marginTop: 8, minHeight: 80, borderWidth: 1, borderColor: '#E8ECF2', borderRadius: 8,
      padding: 10, fontSize: 13, color: '#0A1628', textAlignVertical: 'top',
    },
    picker: { marginBottom: 10, maxHeight: 44 },
    pickerRow: { paddingRight: 8, gap: 8 },
    chip: {
      paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16,
      backgroundColor: t.surface || '#fff', borderWidth: 1, borderColor: t.border || '#E8ECF2',
    },
    chipOn: { backgroundColor: '#0A1628', borderColor: '#0A1628' },
    chipTxt: { fontSize: 12, fontWeight: '700', color: '#0A1628', maxWidth: 160 },
    chipTxtOn: { color: '#F5C242' },
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
