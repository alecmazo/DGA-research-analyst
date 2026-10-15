// ─────────────────────────────────────────────────────────────────────────────
// MarketsScreen — GP home tab. Koyfin-style index board, session, brief, pulse.
// Watchlist names + Idea Generator live on the Watchlist tab.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import {
  View, Text, ScrollView, RefreshControl, TouchableOpacity,
  ActivityIndicator, StyleSheet, Alert,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useAppResume } from '../hooks/useAppResume';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { api } from '../api/client';
import { readScreenCache, patchScreenCache, putWatchlist } from '../api/screenCache';
import AppHeader from '../components/AppHeader';
import { spacing, radius, Card, haptics, makeMdStyles, useTheme } from '../design';
import {
  QUOTE_POLL_MS, fmtPct, fmtPx, fmtClock,
  etSessionDate, usEquitySession, paintMarketIndices,
  BriefMarkdown, SentimentPill, SectionHeader, pulseSummary,
} from './marketsShared';

export default function MarketsScreen({ navigation }) {
  const { theme: t } = useTheme();
  const s = useMemo(() => makeStyles(t), [t]);
  const md = useMemo(() => makeMdStyles(t), [t]);
  const [indices, setIndices]   = useState([]);
  const [watch, setWatch]       = useState(null);
  const [brief, setBrief]       = useState(undefined);
  const [briefOpen, setBriefOpen] = useState(false);
  const [briefBusy, setBriefBusy] = useState(false);
  const [pulse, setPulse]           = useState(undefined);
  const [pulseInfoOpen, setPulseInfoOpen] = useState(false);
  const [pulseExpanded, setPulseExpanded] = useState({});
  const [pulseBusy, setPulseBusy]   = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [quotesBusy, setQuotesBusy] = useState(false);
  const [lastQuotesAt, setLastQuotesAt] = useState(null);
  const [sessionTick, setSessionTick] = useState(0);
  const pollRef = useRef(null);
  const focusedRef = useRef(false);
  const lastLiveRefreshDateRef = useRef('');
  const lastQuotesAtRef = useRef(0);

  const session = useMemo(() => usEquitySession(new Date()), [sessionTick, lastQuotesAt]);
  const boardIndices = useMemo(() => paintMarketIndices(indices), [indices]);

  const loadQuotes = useCallback(async (opts = {}) => {
    const live = usEquitySession().live;
    const sdate = etSessionDate();
    const firstLiveToday = live && lastLiveRefreshDateRef.current !== sdate;
    const fresh = !!opts.fresh || firstLiveToday;
    try {
      const home = await api.getMobileHome();
      if (Array.isArray(home?.indices)) setIndices(home.indices);
      const wl = home?.watchlist || { tickers: [], quotes: {} };
      setWatch(wl);
      putWatchlist(wl);
      patchScreenCache('markets', {
        indices: home?.indices || [],
        watch: wl,
      });
    } catch {
      /* keep last painted board */
    }
    if (fresh && sdate) lastLiveRefreshDateRef.current = sdate;
    const now = new Date();
    lastQuotesAtRef.current = now.getTime();
    setLastQuotesAt(now);
  }, []);

  const extrasTimer = useRef(null);
  const loadBriefAndPulse = useCallback(() => {
    api.getLatestDailyBrief().then(d => {
      const b = d && d.exists && d.markdown ? d : null;
      setBrief(b);
      patchScreenCache('markets', { brief: b });
    }).catch(() => setBrief(null));
    api.getLatestScan().then(d => {
      const p = d && d.exists && d.results ? d : null;
      setPulse(p);
      patchScreenCache('markets', { pulse: p });
    }).catch(() => setPulse(null));
  }, []);
  const loadAll = useCallback(async () => {
    // Board only. Idea-feed lives on Watchlist. Brief / pulse wait 12s.
    await loadQuotes({ ideas: false });
    if (extrasTimer.current) clearTimeout(extrasTimer.current);
    extrasTimer.current = setTimeout(() => {
      extrasTimer.current = null;
      loadBriefAndPulse();
    }, 12000);
  }, [loadQuotes, loadBriefAndPulse]);

  useEffect(() => {
    readScreenCache('markets').then((c) => {
      if (!c) return;
      if (Array.isArray(c.indices)) setIndices(c.indices);
      if (c.watch) {
        setWatch(c.watch);
        putWatchlist(c.watch);
      }
      if (c.brief !== undefined) setBrief(c.brief);
      if (c.pulse !== undefined) setPulse(c.pulse);
    }).catch(() => {});
  }, []);

  useFocusEffect(useCallback(() => {
    focusedRef.current = true;
    const age = Date.now() - (lastQuotesAtRef.current || 0);
    if (age > 45_000) loadAll();
    else loadQuotes({ ideas: false }).catch(() => {});
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(() => {
      if (!focusedRef.current) return;
      if (!usEquitySession().live) {
        setSessionTick((n) => n + 1);
        return;
      }
      loadQuotes({ ideas: false }).catch(() => {});
      setSessionTick((n) => n + 1);
    }, QUOTE_POLL_MS);
    return () => {
      focusedRef.current = false;
      if (extrasTimer.current) {
        clearTimeout(extrasTimer.current);
        extrasTimer.current = null;
      }
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [loadAll, loadQuotes]));

  useAppResume(() => {
    loadQuotes({ fresh: usEquitySession().live }).catch(() => {});
    setSessionTick((n) => n + 1);
  });

  useEffect(() => {
    const id = setInterval(() => setSessionTick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    if (extrasTimer.current) {
      clearTimeout(extrasTimer.current);
      extrasTimer.current = null;
    }
    await loadQuotes({ ideas: false });
    loadBriefAndPulse();
    setRefreshing(false);
  }, [loadQuotes, loadBriefAndPulse]);

  const onRefreshQuotes = useCallback(async () => {
    if (quotesBusy) return;
    setQuotesBusy(true);
    haptics.onPressPrimary?.();
    try {
      await loadQuotes({ ideas: false });
    } finally {
      setQuotesBusy(false);
    }
  }, [loadQuotes, quotesBusy]);

  const runBrief = useCallback(async () => {
    setBriefBusy(true);
    try {
      const job = await api.startDailyBrief();
      for (let i = 0; i < 80; i++) {
        await new Promise(r => setTimeout(r, 3000));
        const j = await api.getDailyBriefJob(job.job_id).catch(() => null);
        if (j && (j.status === 'done' || j.status === 'completed' || j.status === 'error')) break;
      }
      const d = await api.getLatestDailyBrief().catch(() => null);
      setBrief(d && d.exists && d.markdown ? d : null);
      setBriefOpen(true);
    } catch (e) { /* swallow */ }
    finally { setBriefBusy(false); }
  }, []);

  const runPulseScan = useCallback(() => {
    const tks = (watch && watch.tickers) || [];
    const n = tks.length;
    if (!n) {
      Alert.alert('Watchlist empty', 'Market Pulse scans your watchlist tickers — add some in Watchlist first.');
      return;
    }
    Alert.alert(
      'Run Market Pulse now?',
      `This runs an AI scan (Grok live web/X search) across ${n} watchlist ticker${n === 1 ? '' : 's'}.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Run', onPress: async () => {
          haptics.onPressPrimary?.();
          setPulseBusy(true);
          try {
            const job = await api.startScan(tks);
            for (let i = 0; i < 120; i++) {
              await new Promise(r => setTimeout(r, 4000));
              const j = await api.getScanJob(job.job_id).catch(() => null);
              if (j && (j.status === 'done' || j.status === 'cancelled' || j.status === 'failed')) break;
              if (i % 3 === 2) {
                const d = await api.getLatestScan().catch(() => null);
                if (d && d.exists && d.results) setPulse(d);
              }
            }
          } catch (e) {
            Alert.alert('Scan failed', e.message || String(e));
          } finally {
            const d = await api.getLatestScan().catch(() => null);
            if (d && d.exists && d.results) setPulse(d);
            setPulseBusy(false);
          }
        }},
      ],
    );
  }, [watch]);

  const breadth = useMemo(() => {
    let up = 0, down = 0, flat = 0;
    const push = (p) => {
      if (p == null || isNaN(p)) return;
      if (p > 0.02) up += 1;
      else if (p < -0.02) down += 1;
      else flat += 1;
    };
    boardIndices.forEach((ix) => push(ix.pct));
    return { up, down, flat, total: up + down + flat };
  }, [boardIndices]);

  const cardStyle = [s.card, { backgroundColor: t.surface, borderColor: t.border, borderWidth: 1 }];

  const quotesRefreshBtn = (
    <TouchableOpacity
      onPress={onRefreshQuotes}
      disabled={quotesBusy}
      activeOpacity={0.7}
      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      style={s.quotesRefreshBtn}
      accessibilityLabel="Refresh stock quotes"
    >
      {quotesBusy
        ? <ActivityIndicator color="#F5C542" size="small" />
        : <Ionicons name="refresh" size={20} color="#F5C542" />}
    </TouchableOpacity>
  );

  const subtitle = session.live
    ? `${session.label} · auto 60s`
    : `${session.label} · tap ↻ for quotes`;

  const openWatchlist = useCallback(() => {
    haptics.onPressPrimary?.();
    navigation?.navigate('Watchlist');
  }, [navigation]);

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <AppHeader
        title="Markets"
        subtitle={subtitle}
        showLogo
        right={quotesRefreshBtn}
      />
      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.primary} />}
      >
        <View style={s.liveStrip}>
          <View style={s.liveLeft}>
            <View style={[s.liveDot, { backgroundColor: session.color }]} />
            <Text style={[s.liveLabel, { color: session.live ? t.textPrimary : t.textSecondary }]}>
              {session.label}
            </Text>
            {session.live ? (
              <View style={s.liveBadge}>
                <Text style={s.liveBadgeTxt}>LIVE</Text>
              </View>
            ) : null}
          </View>
          <TouchableOpacity
            onPress={onRefreshQuotes}
            disabled={quotesBusy}
            activeOpacity={0.7}
            style={s.liveRefresh}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            {quotesBusy
              ? <ActivityIndicator color={t.primary} size="small" />
              : (
                <>
                  <Ionicons name="refresh" size={14} color={t.primary} />
                  <Text style={s.liveAsOf}>
                    {lastQuotesAt ? fmtClock(lastQuotesAt) : '—'}
                  </Text>
                </>
              )}
          </TouchableOpacity>
        </View>

        {breadth.total > 0 && (
          <View style={s.breadthRow}>
            <Text style={[s.breadthTxt, { color: t.pillUpFg }]}>▲ {breadth.up}</Text>
            <View style={s.breadthTrack}>
              <View
                style={[
                  s.breadthUp,
                  {
                    flex: Math.max(breadth.up, 0.01),
                    backgroundColor: t.pillUpFg,
                  },
                ]}
              />
              <View
                style={[
                  s.breadthDown,
                  {
                    flex: Math.max(breadth.down, 0.01),
                    backgroundColor: t.pillDownFg,
                  },
                ]}
              />
            </View>
            <Text style={[s.breadthTxt, { color: t.pillDownFg }]}>{breadth.down} ▼</Text>
          </View>
        )}

        <SectionHeader
          icon="pulse"
          t={t}
          s={s}
          right={
            <TouchableOpacity
              onPress={onRefreshQuotes}
              disabled={quotesBusy}
              activeOpacity={0.7}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              style={s.quotesRefreshChip}
            >
              {quotesBusy
                ? <ActivityIndicator color={t.primary} size="small" />
                : <>
                    <Ionicons name="refresh" size={13} color={t.primary} />
                    <Text style={s.quotesRefreshTxt}>Quotes</Text>
                  </>}
            </TouchableOpacity>
          }
        >Indices</SectionHeader>
        <View style={s.idxGrid}>
          {boardIndices.map((ix) => {
            const up = ix.pct == null ? null : ix.pct >= 0;
            const edge = up == null ? t.border : up ? t.pillUpFg : t.pillDownFg;
            const tint = up == null
              ? t.surface
              : up
                ? (t.isDark ? 'rgba(74,222,128,0.08)' : 'rgba(22,163,74,0.06)')
                : (t.isDark ? 'rgba(248,113,113,0.08)' : 'rgba(220,38,38,0.05)');
            return (
              <View
                key={ix.symbol}
                style={[
                  s.idxCell,
                  {
                    borderLeftColor: edge,
                    backgroundColor: tint,
                  },
                ]}
              >
                <Text style={s.idxLabel} numberOfLines={1}>{ix.label}</Text>
                <Text style={s.idxPx}>{fmtPx(ix.price)}</Text>
                <Text
                  style={[
                    s.idxChg,
                    { color: up == null ? t.textDim : up ? t.pillUpFg : t.pillDownFg },
                  ]}
                >
                  {fmtPct(ix.pct)}
                </Text>
              </View>
            );
          })}
        </View>

        <TouchableOpacity
          style={s.wlCta}
          onPress={openWatchlist}
          activeOpacity={0.75}
          accessibilityLabel="Open Watchlist"
        >
          <View style={[s.wlCtaIcon, { backgroundColor: t.surfaceTint }]}>
            <MaterialCommunityIcons name="star-outline" size={16} color={t.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.wlCtaTitle}>Watchlist</Text>
            <Text style={s.wlCtaSub}>Your names and ideas</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={t.textDim} />
        </TouchableOpacity>

        <SectionHeader icon="newspaper-variant-outline" t={t} s={s}
          right={
            <TouchableOpacity onPress={runBrief} disabled={briefBusy} style={s.runBtn} activeOpacity={0.8}>
              {briefBusy ? <ActivityIndicator color={t.chromeNavy} size="small" />
                : <><Ionicons name="refresh" size={13} color={t.chromeNavy} /><Text style={s.runBtnTxt}>Run</Text></>}
            </TouchableOpacity>
          }
        >Daily Brief</SectionHeader>
        <Card style={cardStyle}>
          {brief === undefined ? (
            <ActivityIndicator color={t.primary} />
          ) : brief === null ? (
            <Text style={s.muted}>No brief yet — tap Run to generate today’s brief.</Text>
          ) : (
            <View>
              <TouchableOpacity style={s.briefHead} onPress={() => setBriefOpen(o => !o)} activeOpacity={0.7}>
                <Text style={s.briefMeta}>Generated {brief.generated_at ? String(brief.generated_at).slice(5, 16).replace('T', ' ') : ''}</Text>
                <Ionicons name={briefOpen ? 'chevron-up' : 'chevron-down'} size={18} color={t.textDim} />
              </TouchableOpacity>
              {briefOpen
                ? <BriefMarkdown style={md}>{brief.markdown}</BriefMarkdown>
                : <Text style={s.muted} numberOfLines={2}>{(brief.markdown || '').replace(/[#*>`]/g, '').replace(/\n+/g, ' ').trim()}</Text>}
            </View>
          )}
        </Card>

        <SectionHeader icon="radar" t={t} s={s}
          right={
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              {pulse && pulse.scanned_at ? (
                <Text style={s.asOf}>{String(pulse.scanned_at).slice(5, 16).replace('T', ' ')}</Text>
              ) : null}
              <TouchableOpacity
                onPress={() => setPulseInfoOpen(o => !o)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                activeOpacity={0.6}
              >
                <Ionicons name="information-circle-outline" size={17}
                  color={pulseInfoOpen ? t.primary : t.textDim} />
              </TouchableOpacity>
              <TouchableOpacity onPress={runPulseScan} disabled={pulseBusy} style={s.runBtn} activeOpacity={0.8}>
                {pulseBusy ? <ActivityIndicator color={t.chromeNavy} size="small" />
                  : <><Ionicons name="flash" size={13} color={t.chromeNavy} /><Text style={s.runBtnTxt}>Scan</Text></>}
              </TouchableOpacity>
            </View>
          }
        >Market Pulse</SectionHeader>
        <Card style={[...cardStyle, { padding: 0 }]}>
          {pulseInfoOpen && (
            <View style={s.pulseInfoBox}>
              <Text style={s.pulseInfoTxt}>
                Market Pulse runs a live web + X (Twitter) search for every ticker on your
                watchlist and tags each one Bullish / Bearish / Neutral with the day's primary
                price driver. It runs on your Automation schedule (Settings) or when you tap
                Scan — opening this screen only loads the last completed scan and never starts
                a new one.
              </Text>
            </View>
          )}
          {pulse === undefined ? (
            <View style={{ padding: 14 }}><ActivityIndicator color={t.primary} /></View>
          ) : (pulse === null || !Object.keys(pulse.results || {}).length) ? (
            <Text style={[s.muted, { padding: 14 }]}>
              No pulse scan yet — tap Scan or schedule it in Settings.
            </Text>
          ) : (
            Object.keys(pulse.results).sort().map((tk, i, arr) => {
              const r = pulse.results[tk] || {};
              const failed = r.ok === false;
              const line = failed
                ? (r.error ? `Scan failed: ${String(r.error).slice(0, 120)}` : 'Scan failed.')
                : pulseSummary(r.markdown);
              const canExpand = !failed && !!r.markdown;
              const open = !!pulseExpanded[tk];
              const head = (
                <>
                  <View style={s.pulseHead}>
                    <Text style={s.pulseTk}>{tk}</Text>
                    <SentimentPill sentiment={failed ? 'UNKNOWN' : r.sentiment} t={t} />
                    <View style={{ flex: 1 }} />
                    {r.pct_change != null && (
                      <Text style={[s.pulsePct, { color: r.pct_change >= 0 ? t.pillUpFg : t.pillDownFg }]}>
                        {fmtPct(r.pct_change)}
                      </Text>
                    )}
                    {canExpand && (
                      <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={16} color={t.textDim} style={{ marginLeft: 6 }} />
                    )}
                  </View>
                  {!!line && <Text style={s.pulseTxt} numberOfLines={open ? 0 : 2}>{line}</Text>}
                </>
              );
              return (
                <View key={tk} style={[s.pulseRow, i < arr.length - 1 && s.divider]}>
                  {canExpand ? (
                    <TouchableOpacity
                      activeOpacity={0.7}
                      onPress={() => { haptics.onPressPrimary?.(); setPulseExpanded(e => ({ ...e, [tk]: !e[tk] })); }}
                    >
                      {head}
                    </TouchableOpacity>
                  ) : head}
                  {canExpand && open && (
                    <View style={{ marginTop: 6 }}>
                      <BriefMarkdown style={md}>{r.markdown}</BriefMarkdown>
                    </View>
                  )}
                </View>
              );
            })
          )}
        </Card>
      </ScrollView>
    </View>
  );
}

function makeStyles(t) {
  return StyleSheet.create({
    card: { marginBottom: spacing.md },
    sectionLabel: { fontSize: 12, fontWeight: '800', color: t.textPrimary, letterSpacing: 0.8, textTransform: 'uppercase' },
    asOf: { fontSize: 10, color: t.textDim, fontWeight: '500' },
    muted: { fontSize: 13, color: t.textSecondary },

    liveStrip: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      backgroundColor: t.surface, borderRadius: radius.xl, borderWidth: 1, borderColor: t.border,
      paddingVertical: 10, paddingHorizontal: 12, marginBottom: spacing.sm,
    },
    liveLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    liveDot: { width: 8, height: 8, borderRadius: 4 },
    liveLabel: { fontSize: 13, fontWeight: '800', letterSpacing: 0.2 },
    liveBadge: {
      backgroundColor: 'rgba(22,163,74,0.15)', borderRadius: 4,
      paddingHorizontal: 5, paddingVertical: 1,
    },
    liveBadgeTxt: { fontSize: 9, fontWeight: '900', color: '#16A34A', letterSpacing: 0.8 },
    liveRefresh: { flexDirection: 'row', alignItems: 'center', gap: 5, minWidth: 56, justifyContent: 'flex-end' },
    liveAsOf: { fontSize: 12, fontWeight: '700', color: t.primary, fontVariant: ['tabular-nums'] },

    breadthRow: {
      flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: spacing.md,
      paddingHorizontal: 2,
    },
    breadthTxt: { fontSize: 11, fontWeight: '800', fontVariant: ['tabular-nums'], minWidth: 28 },
    breadthTrack: {
      flex: 1, height: 6, borderRadius: 3, flexDirection: 'row', overflow: 'hidden',
      backgroundColor: t.surfaceAlt,
    },
    breadthUp: { height: 6 },
    breadthDown: { height: 6 },

    idxGrid: {
      flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between',
      marginBottom: spacing.md,
    },
    idxCell: {
      width: '48.5%',
      borderRadius: radius.lg, paddingVertical: 10, paddingHorizontal: 10,
      marginBottom: 8, borderWidth: 1, borderColor: t.border, borderLeftWidth: 3,
    },
    idxLabel: { fontSize: 10, color: t.textSecondary, fontWeight: '700', marginBottom: 4, letterSpacing: 0.3 },
    idxPx: { fontSize: 16, color: t.textPrimary, fontWeight: '800', fontVariant: ['tabular-nums'] },
    idxChg: { fontSize: 12, fontWeight: '800', marginTop: 2, fontVariant: ['tabular-nums'] },

    quotesRefreshBtn: {
      width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center',
      backgroundColor: 'rgba(245,197,66,0.15)', borderWidth: 1, borderColor: 'rgba(245,197,66,0.45)',
    },
    quotesRefreshChip: {
      flexDirection: 'row', alignItems: 'center', gap: 4,
      paddingHorizontal: 9, paddingVertical: 4, borderRadius: 12,
      backgroundColor: t.surfaceTint, borderWidth: 1, borderColor: t.border,
    },
    quotesRefreshTxt: { fontSize: 11, fontWeight: '700', color: t.primary },

    wlCta: {
      flexDirection: 'row', alignItems: 'center', gap: 10,
      backgroundColor: t.surface, borderRadius: radius.xl, borderWidth: 1, borderColor: t.border,
      paddingVertical: 12, paddingHorizontal: 12, marginBottom: spacing.md,
    },
    wlCtaIcon: {
      width: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center',
    },
    wlCtaTitle: { fontSize: 14, fontWeight: '800', color: t.textPrimary, letterSpacing: 0.2 },
    wlCtaSub: { fontSize: 11, color: t.textSecondary, marginTop: 1 },

    divider: { borderBottomWidth: 1, borderBottomColor: t.border },

    runBtn: {
      backgroundColor: t.gold, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 5,
      minWidth: 58, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 3,
    },
    runBtnTxt: { fontSize: 12, fontWeight: '800', color: t.chromeNavy },
    briefHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
    briefMeta: { fontSize: 11, color: t.textSecondary, fontWeight: '600' },

    pulseInfoBox: {
      paddingHorizontal: 14, paddingVertical: 10,
      backgroundColor: t.surfaceAlt,
      borderBottomWidth: 1, borderBottomColor: t.border,
    },
    pulseInfoTxt: { fontSize: 12, color: t.textSecondary, lineHeight: 17 },
    pulseRow:  { paddingHorizontal: 14, paddingVertical: 11 },
    pulseHead: { flexDirection: 'row', alignItems: 'center', gap: 7 },
    pulseTk:   { fontSize: 15, fontWeight: '800', color: t.textPrimary, letterSpacing: 0.5 },
    pulsePct:  { fontSize: 12, fontWeight: '700', fontVariant: ['tabular-nums'] },
    pulseTxt:  { fontSize: 11.5, color: t.textSecondary, marginTop: 3, lineHeight: 16 },
  });
}
