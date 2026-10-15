// Watchlist board — GP tab. Koyfin two-line rows + Idea Generator.
import React, { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import {
  View, Text, ScrollView, RefreshControl, TouchableOpacity,
  ActivityIndicator, StyleSheet, Linking, Alert,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useAppResume } from '../hooks/useAppResume';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../api/client';
import { readScreenCache, patchScreenCache, putWatchlist } from '../api/screenCache';
import AppHeader from '../components/AppHeader';
import { StockSnapshotSheet } from '../components/StockInfoCard';
import { spacing, Card, haptics, useTheme } from '../design';
import {
  QUOTE_POLL_MS, fmtPct, fmtPx, fmtChg,
  etSessionDate, usEquitySession, mergeWatchQuotes, overlayFromMovers,
  absChange, companyName, PctPill, SectionHeader,
} from './marketsShared';

export default function WatchlistBoardScreen({ navigation }) {
  const { theme: t } = useTheme();
  const s = useMemo(() => makeStyles(t), [t]);
  const [movers, setMovers]     = useState(null);
  const [moversAsOf, setAsOf]   = useState('');
  const [expanded, setExpanded] = useState({});
  const [peekTk, setPeekTk]     = useState(null);
  const [watch, setWatch]       = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [quotesBusy, setQuotesBusy] = useState(false);
  const [lastQuotesAt, setLastQuotesAt] = useState(null);
  const [sessionTick, setSessionTick] = useState(0);
  const moversRef = useRef([]);
  const pollRef = useRef(null);
  const focusedRef = useRef(false);
  const lastLiveRefreshDateRef = useRef('');
  const lastQuotesAtRef = useRef(0);

  const session = useMemo(() => usEquitySession(new Date()), [sessionTick, lastQuotesAt]);

  const loadQuotes = useCallback(async (opts = {}) => {
    const live = usEquitySession().live;
    const sdate = etSessionDate();
    const firstLiveToday = live && lastLiveRefreshDateRef.current !== sdate;
    const fresh = !!opts.fresh || firstLiveToday;
    try {
      const home = await api.getMobileHome();
      const wl = home?.watchlist || { tickers: [], quotes: {} };
      setWatch(wl);
      putWatchlist(wl);
      patchScreenCache('markets', {
        indices: home?.indices || [],
        watch: wl,
        movers: moversRef.current,
      });
    } catch {
      /* keep last painted board */
    }
    if (opts.ideas !== false) {
      api.getIdeaFeed(4, 60).then((d) => {
        const moversList = d.movers || [];
        moversRef.current = moversList;
        setMovers(moversList);
        setAsOf(d.as_of || '');
        patchScreenCache('markets', { movers: moversList, asOf: d.as_of || '' });
        const moverOverlay = overlayFromMovers(moversList);
        if (Object.keys(moverOverlay).length) {
          setWatch((prev) => mergeWatchQuotes(prev, moverOverlay));
        }
      }).catch(() => {
        setMovers((prev) => (prev == null ? [] : prev));
      });
    }
    if (fresh && sdate) lastLiveRefreshDateRef.current = sdate;
    const now = new Date();
    lastQuotesAtRef.current = now.getTime();
    setLastQuotesAt(now);
  }, []);

  const loadAll = useCallback(async () => {
    await loadQuotes({ ideas: true });
  }, [loadQuotes]);

  useEffect(() => {
    readScreenCache('markets').then((c) => {
      if (!c) return;
      if (c.watch) {
        setWatch(c.watch);
        putWatchlist(c.watch);
      }
      if (Array.isArray(c.movers)) {
        setMovers(c.movers);
        moversRef.current = c.movers;
      }
      if (c.asOf) setAsOf(c.asOf);
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
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [loadAll, loadQuotes]));

  useAppResume(() => {
    loadQuotes({ fresh: usEquitySession().live, ideas: false }).catch(() => {});
    setSessionTick((n) => n + 1);
  });

  useEffect(() => {
    const id = setInterval(() => setSessionTick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadQuotes({ ideas: true });
    setRefreshing(false);
  }, [loadQuotes]);

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

  const toggleMover = useCallback(async (m) => {
    const tk = m.ticker;
    setExpanded((e) => ({ ...e, [tk]: !e[tk] }));
    haptics.onPressPrimary?.();
    if ((!m.news || !m.news.length) && !m._newsTried) {
      m._newsTried = true;
      try {
        const d = await api.getNews(tk, 6);
        const items = (d.news && d.news[tk]) || [];
        if (items.length) { m.news = items; setMovers([...moversRef.current]); }
      } catch { /* leave "no headlines" */ }
    }
  }, []);

  const watchRows = useMemo(() => {
    const tks = (watch && watch.tickers) || [];
    const quotes = (watch && watch.quotes) || {};
    return tks
      .map((tk) => {
        const q = quotes[tk] || quotes[String(tk || '').toUpperCase()] || {};
        const pct = q.pct != null ? Number(q.pct) : (q.pct_change != null ? Number(q.pct_change) : null);
        const chg = absChange(q, pct);
        const name = companyName(q);
        return { tk, q, pct, chg, name, abs: pct == null || isNaN(pct) ? -1 : Math.abs(pct) };
      })
      .sort((a, b) => b.abs - a.abs);
  }, [watch]);

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

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <AppHeader
        title="Watchlist"
        subtitle={subtitle}
        showLogo
        right={quotesRefreshBtn}
      />
      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.primary} />}
      >
        <SectionHeader
          icon="star-outline"
          t={t}
          s={s}
          right={<Text style={s.asOf}>tap for snapshot · by day %</Text>}
        >Watchlist</SectionHeader>
        {watch == null ? (
          <Card style={cardStyle}><ActivityIndicator color={t.primary} /></Card>
        ) : !watchRows.length ? (
          <Card style={cardStyle}><Text style={s.muted}>No tickers followed yet.</Text></Card>
        ) : (
          <Card style={[...cardStyle, { padding: 0 }]}>
            {watchRows.map((row, i) => {
              const { tk, q, pct, chg, name } = row;
              const up = pct == null || isNaN(pct) ? null : pct >= 0;
              const chgColor = up == null ? t.textDim : up ? t.pillUpFg : t.pillDownFg;
              return (
                <View key={tk} style={i < watchRows.length - 1 ? s.divider : null}>
                  <TouchableOpacity
                    style={s.wlRow}
                    activeOpacity={0.7}
                    onPress={() => {
                      haptics.onPressPrimary?.();
                      setPeekTk(tk);
                    }}
                  >
                    <View style={s.wlLeft}>
                      <Text style={s.wlTk} numberOfLines={1}>{tk}</Text>
                      {!!name && (
                        <Text style={s.wlName} numberOfLines={1}>{name}</Text>
                      )}
                    </View>
                    <View style={s.wlRight}>
                      <Text style={s.wlPx}>{fmtPx(q.price)}</Text>
                      <View style={s.wlChgRow}>
                        <Text style={[s.wlChg, { color: chgColor }]}>{fmtChg(chg)}</Text>
                        <PctPill p={pct} t={t} caret={false} />
                      </View>
                    </View>
                  </TouchableOpacity>
                </View>
              );
            })}
          </Card>
        )}

        <SectionHeader icon="lightbulb-on-outline" t={t} s={s}
          right={moversAsOf ? <Text style={s.asOf}>{moversAsOf}</Text> : null}>
          Idea Generator
        </SectionHeader>
        {movers == null ? (
          <Card style={cardStyle}><ActivityIndicator color={t.primary} /></Card>
        ) : movers.length === 0 ? (
          <Card style={cardStyle}><Text style={s.muted}>No movers ≥ ±4% in your universe right now.</Text></Card>
        ) : (
          <Card style={[...cardStyle, { padding: 0 }]}>
            {movers.map((m, i) => {
              const open = !!expanded[m.ticker];
              const up = m.pct_change == null ? null : m.pct_change >= 0;
              return (
                <View
                  key={m.ticker}
                  style={[
                    s.moverWrap,
                    i < movers.length - 1 && s.divider,
                    up != null && {
                      borderLeftWidth: 3,
                      borderLeftColor: up ? t.pillUpFg : t.pillDownFg,
                    },
                  ]}
                >
                  <TouchableOpacity style={s.moverRow} onPress={() => toggleMover(m)} activeOpacity={0.7}>
                    <View style={{ flex: 1 }}>
                      <View style={s.moverHead}>
                        <Text style={s.moverTk}>{m.ticker}</Text>
                        {(m.reason_class && m.reason_class !== 'unknown') ? (
                          <Text style={s.reasonChip}>{String(m.reason_class).replace('_', ' ')}</Text>
                        ) : null}
                      </View>
                      {!!m.reason_text && <Text style={s.reasonTxt} numberOfLines={open ? 0 : 1}>{m.reason_text}</Text>}
                    </View>
                    <View style={{ alignItems: 'flex-end', gap: 2 }}>
                      <PctPill p={m.pct_change} t={t} />
                      <Text style={s.moverPx}>{fmtPx(m.price)}</Text>
                    </View>
                    <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={16} color={t.textDim} style={{ marginLeft: 8 }} />
                  </TouchableOpacity>
                  {open && (
                    <View style={s.moverDetail}>
                      {m.sector && m.sector !== 'Unknown' ? (
                        <Text style={s.detailMeta}>
                          {m.sector}{m.sector_etf ? `  ·  ${m.sector_etf} ${fmtPct(m.sector_pct_change)}` : ''}
                        </Text>
                      ) : null}
                      {(m.news && m.news.length) ? m.news.map((n, j) => (
                        <TouchableOpacity key={j} style={s.newsItem}
                          onPress={() => n.url && Linking.openURL(n.url).catch(() => {})} activeOpacity={n.url ? 0.6 : 1}>
                          <Text style={s.newsTitle}>{n.title}</Text>
                          <Text style={s.newsMeta}>{n.publisher || ''}</Text>
                        </TouchableOpacity>
                      )) : <Text style={s.muted}>No recent headlines.</Text>}
                    </View>
                  )}
                </View>
              );
            })}
          </Card>
        )}
      </ScrollView>
      <StockSnapshotSheet
        ticker={peekTk}
        visible={!!peekTk}
        onClose={() => setPeekTk(null)}
        onOpenReport={peekTk ? () => {
          const tk = peekTk;
          setPeekTk(null);
          try {
            navigation?.navigate('Research', {
              screen: 'Report',
              params: { ticker: tk },
            });
          } catch { /* ignore */ }
        } : undefined}
        onRunAnalysis={peekTk ? () => {
          const tk = peekTk;
          Alert.alert(
            'Run AI analysis?',
            `${tk} full equity report costs tokens (Grok). This is deliberate — not automatic.`,
            [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Run',
                onPress: async () => {
                  try {
                    haptics.onPressPrimary?.();
                    setPeekTk(null);
                    const job = await api.startAnalysis(tk, false, 'grok');
                    navigation?.navigate('Research', {
                      screen: 'Analysis',
                      params: { jobId: job.job_id, ticker: tk },
                    });
                  } catch (e) {
                    Alert.alert('Analysis failed', e.message || String(e));
                  }
                },
              },
            ],
          );
        } : undefined}
      />
    </View>
  );
}

function makeStyles(t) {
  return StyleSheet.create({
    card: { marginBottom: spacing.md },
    sectionLabel: { fontSize: 12, fontWeight: '800', color: t.textPrimary, letterSpacing: 0.8, textTransform: 'uppercase' },
    asOf: { fontSize: 10, color: t.textDim, fontWeight: '500' },
    muted: { fontSize: 13, color: t.textSecondary },
    quotesRefreshBtn: {
      width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center',
      backgroundColor: 'rgba(245,197,66,0.15)', borderWidth: 1, borderColor: 'rgba(245,197,66,0.45)',
    },
    divider: { borderBottomWidth: 1, borderBottomColor: t.border },

    wlRow: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingVertical: 12, paddingHorizontal: 14, gap: 12,
    },
    wlLeft: { flex: 1, minWidth: 0, paddingRight: 8 },
    wlTk: { fontSize: 15, fontWeight: '800', color: t.textPrimary, letterSpacing: 0.2 },
    wlName: { fontSize: 12, fontWeight: '500', color: t.textSecondary, marginTop: 2 },
    wlRight: { alignItems: 'flex-end' },
    wlPx: { fontSize: 15, fontWeight: '700', color: t.textPrimary, fontVariant: ['tabular-nums'] },
    wlChgRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 3 },
    wlChg: { fontSize: 12, fontWeight: '700', fontVariant: ['tabular-nums'] },

    moverWrap: { paddingHorizontal: 14 },
    moverRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 11 },
    moverHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    moverTk: { fontSize: 15, fontWeight: '800', color: t.textPrimary, letterSpacing: 0.5 },
    reasonChip: {
      fontSize: 9, fontWeight: '700', color: t.textSecondary, backgroundColor: t.surfaceAlt,
      borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1, overflow: 'hidden', textTransform: 'uppercase',
    },
    reasonTxt: { fontSize: 11.5, color: t.textSecondary, marginTop: 2 },
    moverPx: { fontSize: 11, color: t.textDim, fontVariant: ['tabular-nums'] },
    moverDetail: { paddingBottom: 12, paddingTop: 2 },
    detailMeta: { fontSize: 11, color: t.textSecondary, marginBottom: 6, fontWeight: '600' },
    newsItem: { paddingVertical: 5, borderTopWidth: 1, borderTopColor: t.borderSubtle },
    newsTitle: { fontSize: 12.5, color: t.textPrimary, fontWeight: '600', lineHeight: 17 },
    newsMeta: { fontSize: 10, color: t.textDim, marginTop: 1 },
  });
}
