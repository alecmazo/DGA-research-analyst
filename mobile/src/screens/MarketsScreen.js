// ─────────────────────────────────────────────────────────────────────────────
// MarketsScreen — GP home tab. Index board, earnings, Market Wire, free pulse.
// Watchlist names + Idea Generator live on the Watchlist tab.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import {
  View, Text, ScrollView, RefreshControl, TouchableOpacity,
  ActivityIndicator, StyleSheet, Linking, Modal,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useAppResume } from '../hooks/useAppResume';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { api } from '../api/client';
import {
  readScreenCache, patchScreenCache, putWatchlist, peekWatchlist,
  writeScreenCache, screenCacheFresh,
} from '../api/screenCache';
import AppHeader from '../components/AppHeader';
import { StockSnapshotSheet } from '../components/StockInfoCard';
import { spacing, radius, Card, haptics, useTheme } from '../design';
import {
  QUOTE_POLL_MS, fmtPct, fmtPx, fmtClock, fmtEps, fmtRevShort, wireRelAge,
  etSessionDate, usEquitySession, paintMarketIndices, SectionHeader,
} from './marketsShared';

const PULSE_POLL_MS = 5 * 60_000;

function pulseNewsItems(row) {
  const items = (row && row.items) || [];
  if (items.length) return items;
  const title = String((row && row.headline) || '').trim();
  if (!title) return [];
  return [{
    title,
    url: row.url,
    publisher: row.publisher,
    pub_ts: row.pub_ts,
    source: row.source,
  }];
}

export default function MarketsScreen({ navigation }) {
  const { theme: t } = useTheme();
  const s = useMemo(() => makeStyles(t), [t]);
  const [indices, setIndices]   = useState([]);
  const [watch, setWatch]       = useState(null);
  const [wireItems, setWireItems] = useState([]);
  const [wireAsOf, setWireAsOf]   = useState('');
  const [wireLoading, setWireLoading] = useState(false);
  const [wireError, setWireError] = useState('');
  const [earnItems, setEarnItems] = useState([]);
  const [earnLoading, setEarnLoading] = useState(false);
  const [earnOpen, setEarnOpen] = useState(null);
  const [pulseData, setPulseData] = useState(null);
  const [pulseBusy, setPulseBusy] = useState(false);
  const [pulseInfoOpen, setPulseInfoOpen] = useState(false);
  const [pulseOpenTk, setPulseOpenTk] = useState(null);
  const [pulseExtra, setPulseExtra] = useState({});
  const [pulseExtraBusy, setPulseExtraBusy] = useState({});
  const [peekTk, setPeekTk] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [quotesBusy, setQuotesBusy] = useState(false);
  const [lastQuotesAt, setLastQuotesAt] = useState(null);
  const [sessionTick, setSessionTick] = useState(0);
  const pollRef = useRef(null);
  const pulsePollRef = useRef(null);
  const focusedRef = useRef(false);
  const lastLiveRefreshDateRef = useRef('');
  const lastQuotesAtRef = useRef(0);
  const extrasTimer = useRef(null);

  const session = useMemo(() => usEquitySession(new Date()), [sessionTick, lastQuotesAt]);
  const boardIndices = useMemo(() => paintMarketIndices(indices), [indices]);

  const loadQuotes = useCallback(async (opts = {}) => {
    const live = usEquitySession().live;
    const sdate = etSessionDate();
    const firstLiveToday = live && lastLiveRefreshDateRef.current !== sdate;
    const fresh = !!opts.fresh || firstLiveToday;
    let wl = null;
    try {
      const home = await api.getMobileHome();
      if (Array.isArray(home?.indices)) setIndices(home.indices);
      wl = home?.watchlist || { tickers: [], quotes: {} };
      setWatch(wl);
      putWatchlist(wl);
      patchScreenCache('markets', {
        indices: home?.indices || [],
        watch: wl,
      });
    } catch {
      wl = peekWatchlist();
    }
    if (fresh && sdate) lastLiveRefreshDateRef.current = sdate;
    const now = new Date();
    lastQuotesAtRef.current = now.getTime();
    setLastQuotesAt(now);
    return wl;
  }, []);

  const loadMarketWire = useCallback(async (force = false) => {
    const cached = await readScreenCache('wire');
    if (cached && Array.isArray(cached.items)) {
      setWireItems(cached.items);
      setWireAsOf(cached.asOf || '');
    }
    if (!force && screenCacheFresh('wire', 60_000) && cached?.items?.length) return;
    setWireLoading(true);
    setWireError('');
    try {
      const d = await api.getMarketWire(10);
      const raw = Array.isArray(d?.items)
        ? d.items
        : (Array.isArray(d?.market_wire?.items) ? d.market_wire.items : []);
      setWireItems(raw);
      const asOf = d?.as_of || d?.market_wire?.as_of || '';
      setWireAsOf(asOf);
      writeScreenCache('wire', { items: raw, asOf });
      if (!raw.length && d && d.ok === false) {
        setWireError(d.error || d.detail || 'Wire unavailable');
      }
    } catch (err) {
      setWireError(err.message || 'Could not load Market Wire');
    } finally {
      setWireLoading(false);
    }
  }, []);

  const loadEarnings = useCallback(async (force = false, wlArg = null) => {
    const cached = await readScreenCache('earnings');
    if (Array.isArray(cached) && cached.length) setEarnItems(cached);
    if (!force && screenCacheFresh('earnings', 60_000) && cached?.length) return;
    setEarnLoading(true);
    try {
      let wl = wlArg || peekWatchlist();
      const tickers = (wl?.tickers || Object.keys(wl?.quotes || {}) || [])
        .map((x) => String(x || '').toUpperCase())
        .filter(Boolean)
        .slice(0, 14);
      if (!tickers.length) { setEarnItems([]); return; }
      const batch = await api.getEarningsBatch(tickers).catch(() => null);
      const cards = (batch && batch.cards) || {};
      const items = tickers.map((tk) => {
        const d = cards[tk];
        if (!d || d.ok === false) return null;
        const ev = d.event || {};
        const res = d.result || {};
        if (!ev.date && res.eps_actual == null && res.revenue_actual == null) return null;
        return {
          ticker: tk,
          status: d.status || 'unknown',
          date: ev.date || null,
          days_until: ev.days_until,
          session: ev.session || null,
          fiscal_quarter: ev.fiscal_quarter || null,
          name: ev.name || null,
          eps_actual: res.eps_actual,
          eps_estimate: res.eps_estimate,
          surprise_pct: res.surprise_pct,
          beat: res.beat || null,
          revenue_actual: res.revenue_actual,
          revenue_estimate: res.revenue_estimate,
          revenue_surprise_pct: res.revenue_surprise_pct,
          revenue_beat: res.revenue_beat || null,
          raw: d,
        };
      }).filter(Boolean);
      items.sort((a, b) => {
        const da = a.days_until != null ? a.days_until : 99;
        const db = b.days_until != null ? b.days_until : 99;
        return Math.abs(da) - Math.abs(db);
      });
      const top = items.slice(0, 10);
      setEarnItems(top);
      writeScreenCache('earnings', top);
    } catch {
      /* keep last */
    } finally {
      setEarnLoading(false);
    }
  }, []);

  const loadPulse = useCallback(async (force = false, wlArg = null) => {
    const wl = wlArg || peekWatchlist();
    const tks = [...new Set(
      (wl?.tickers || [])
        .map((x) => String(x || '').toUpperCase().trim())
        .filter(Boolean),
    )];
    if (!tks.length) {
      setPulseData({ ok: true, results: {}, count: 0 });
      return;
    }
    setPulseBusy(true);
    try {
      const d = await api.getMarketPulse(tks, { limit: 6, force });
      setPulseData(d);
      if (force) setPulseExtra({});
      patchScreenCache('markets', { pulseFree: d });
    } catch {
      setPulseData((prev) => prev || { ok: false, results: {} });
    } finally {
      setPulseBusy(false);
    }
  }, []);

  const loadDeskNews = useCallback((opts = {}) => {
    const force = !!opts.force;
    const wl = opts.wl || null;
    loadMarketWire(force);
    loadEarnings(force, wl);
    loadPulse(force, wl);
  }, [loadMarketWire, loadEarnings, loadPulse]);

  const loadAll = useCallback(async () => {
    // Board first. Wire / earnings / free pulse follow — never block indices.
    const wl = await loadQuotes({ ideas: false });
    if (extrasTimer.current) clearTimeout(extrasTimer.current);
    extrasTimer.current = setTimeout(() => {
      extrasTimer.current = null;
      loadDeskNews({ wl });
    }, 400);
  }, [loadQuotes, loadDeskNews]);

  useEffect(() => {
    readScreenCache('markets').then((c) => {
      if (!c) return;
      if (Array.isArray(c.indices)) setIndices(c.indices);
      if (c.watch) {
        setWatch(c.watch);
        putWatchlist(c.watch);
      }
      if (c.pulseFree) setPulseData(c.pulseFree);
    }).catch(() => {});
    readScreenCache('wire').then((c) => {
      if (c && Array.isArray(c.items)) {
        setWireItems(c.items);
        setWireAsOf(c.asOf || '');
      }
    }).catch(() => {});
    readScreenCache('earnings').then((c) => {
      if (Array.isArray(c) && c.length) setEarnItems(c);
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
    if (pulsePollRef.current) clearInterval(pulsePollRef.current);
    pulsePollRef.current = setInterval(() => {
      if (!focusedRef.current) return;
      loadPulse(false).catch(() => {});
    }, PULSE_POLL_MS);
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
      if (pulsePollRef.current) {
        clearInterval(pulsePollRef.current);
        pulsePollRef.current = null;
      }
    };
  }, [loadAll, loadQuotes, loadPulse]));

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
    const wl = await loadQuotes({ ideas: false });
    loadDeskNews({ force: true, wl });
    setRefreshing(false);
  }, [loadQuotes, loadDeskNews]);

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

  const loadPulseMore = useCallback(async (tk) => {
    setPulseExtraBusy((s) => ({ ...s, [tk]: true }));
    try {
      const d = await api.getMarketPulse([tk], { limit: 8, merge: true });
      const row = d?.results?.[tk] || d?.results?.[String(tk).toUpperCase()];
      if (row) setPulseExtra((s) => ({ ...s, [tk]: row }));
    } catch {
      /* keep row */
    } finally {
      setPulseExtraBusy((s) => ({ ...s, [tk]: false }));
    }
  }, []);

  const pulseEntries = useMemo(() => {
    const tks = [...new Set(
      ((watch && watch.tickers) || [])
        .map((x) => String(x || '').toUpperCase().trim())
        .filter(Boolean),
    )];
    const quotes = (watch && watch.quotes) || {};
    const results = (pulseData && pulseData.results) || {};
    return tks
      .map((tk) => {
        const q = quotes[tk] || quotes[tk.toUpperCase()] || {};
        const pct = q.pct != null ? Number(q.pct) : (q.pct_change != null ? Number(q.pct_change) : null);
        const row = pulseExtra[tk] || results[tk] || results[tk.toUpperCase()] || {};
        return {
          tk,
          pct: pct != null && !isNaN(pct) ? pct : null,
          abs: pct == null || isNaN(pct) ? -1 : Math.abs(pct),
          row,
        };
      })
      .sort((a, b) => b.abs - a.abs || a.tk.localeCompare(b.tk));
  }, [watch, pulseData, pulseExtra]);

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

  const withNews = pulseEntries.filter((e) => e.row && e.row.headline).length;

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

        <SectionHeader
          icon="calendar-month-outline"
          t={t}
          s={s}
          right={
            <TouchableOpacity
              onPress={() => { haptics.onPressPrimary?.(); loadEarnings(true); }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              {earnLoading
                ? <ActivityIndicator color={t.primary} size="small" />
                : <Text style={s.quotesRefreshTxt}>FREE</Text>}
            </TouchableOpacity>
          }
        >Earnings</SectionHeader>
        <Card style={[...cardStyle, { padding: 0 }]}>
          {!earnLoading && earnItems.length === 0 ? (
            <Text style={[s.muted, { padding: 14 }]}>
              No watchlist earnings in the ±14 day window.
            </Text>
          ) : (
            earnItems.map((it, i) => {
              const when =
                it.days_until === 0 ? 'Today'
                  : it.days_until === -1 ? 'Yesterday'
                    : it.days_until != null && it.days_until > 0
                      ? `In ${it.days_until}d`
                      : it.days_until != null && it.days_until < 0
                        ? `${Math.abs(it.days_until)}d ago`
                        : (it.date || '—');
              const epsStr = it.eps_actual != null
                ? `A $${Number(it.eps_actual).toFixed(2)}`
                : it.eps_estimate != null
                  ? `E $${Number(it.eps_estimate).toFixed(2)}`
                  : 'EPS —';
              const revStr = it.revenue_actual != null
                ? `Rev $${fmtRevShort(it.revenue_actual)}`
                : it.revenue_estimate != null
                  ? `Rev E $${fmtRevShort(it.revenue_estimate)}`
                  : '';
              const beat = it.beat || it.revenue_beat;
              const beatClr = beat === 'beat' ? t.green : beat === 'miss' ? t.red : t.textDim;
              return (
                <TouchableOpacity
                  key={it.ticker + i}
                  style={[s.newsRow, i < earnItems.length - 1 && s.divider]}
                  activeOpacity={0.75}
                  onPress={() => { haptics.onPressPrimary?.(); setEarnOpen(it); }}
                >
                  <View style={s.earnRowTop}>
                    <Text style={s.earnTk}>{it.ticker}</Text>
                    {beat ? (
                      <Text style={[s.earnBadge, { color: beatClr }]}>
                        {String(beat).toUpperCase()}
                        {it.surprise_pct != null
                          ? ` ${it.surprise_pct >= 0 ? '+' : ''}${Number(it.surprise_pct).toFixed(1)}%`
                          : ''}
                      </Text>
                    ) : (
                      <Text style={[s.earnBadge, { color: t.textDim }]}>
                        {(it.status || 'scheduled').replace(/_/g, ' ').toUpperCase()}
                      </Text>
                    )}
                    <Text style={s.earnWhen}>{when}</Text>
                  </View>
                  <Text style={s.earnLine} numberOfLines={1}>
                    {epsStr}{revStr ? `  ·  ${revStr}` : ''}
                    {it.fiscal_quarter ? `  ·  FQ ${it.fiscal_quarter}` : ''}
                  </Text>
                </TouchableOpacity>
              );
            })
          )}
          <Text style={s.cardFoot}>Watchlist ±14d · tap a row · no AI</Text>
        </Card>

        <SectionHeader
          icon="newspaper-variant-outline"
          t={t}
          s={s}
          right={
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              {wireAsOf ? <Text style={s.asOf}>{wireAsOf}</Text> : null}
              <TouchableOpacity
                onPress={() => { haptics.onPressPrimary?.(); loadMarketWire(true); }}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                {wireLoading
                  ? <ActivityIndicator color={t.primary} size="small" />
                  : <Ionicons name="refresh" size={16} color={t.primary} />}
              </TouchableOpacity>
            </View>
          }
        >Market Wire</SectionHeader>
        <Card style={[...cardStyle, { padding: 0 }]}>
          {wireError && wireItems.length === 0 ? (
            <Text style={[s.muted, { padding: 14 }]}>Could not load wire: {wireError}</Text>
          ) : wireItems.length === 0 && !wireLoading ? (
            <Text style={[s.muted, { padding: 14 }]}>
              No high-signal macro items right now. Tap ↻ or pull to refresh.
            </Text>
          ) : (
            wireItems.slice(0, 8).map((it, i) => {
              const age = wireRelAge(it.pub_ts);
              const feed = it.feed || it.publisher || 'Wire';
              return (
                <TouchableOpacity
                  key={(it.url || it.title || '') + i}
                  style={[s.newsRow, i < Math.min(wireItems.length, 8) - 1 && s.divider]}
                  activeOpacity={0.7}
                  onPress={() => {
                    if (it.url) {
                      haptics.onPressTab?.();
                      Linking.openURL(it.url).catch(() => {});
                    }
                  }}
                >
                  <Text style={s.wireTitle} numberOfLines={2}>{it.title || '—'}</Text>
                  <View style={s.wireMeta}>
                    <Text style={s.wireChip}>{feed}</Text>
                    {age ? <Text style={s.asOf}>{age} ago</Text> : null}
                  </View>
                </TouchableOpacity>
              );
            })
          )}
          <Text style={s.cardFoot}>Macro / policy RSS · zero tokens</Text>
        </Card>

        <SectionHeader
          icon="radar"
          t={t}
          s={s}
          right={
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={s.asOf}>
                {pulseBusy && !pulseData
                  ? 'Loading…'
                  : [
                    pulseData?.as_of ? String(pulseData.as_of) : null,
                    pulseEntries.length ? `${withNews}/${pulseEntries.length}` : null,
                  ].filter(Boolean).join(' · ') || 'by |day %|'}
              </Text>
              <TouchableOpacity
                onPress={() => setPulseInfoOpen((o) => !o)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                activeOpacity={0.6}
              >
                <Ionicons name="information-circle-outline" size={17}
                  color={pulseInfoOpen ? t.primary : t.textDim} />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => { haptics.onPressPrimary?.(); loadPulse(true); }}
                disabled={pulseBusy}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                {pulseBusy
                  ? <ActivityIndicator color={t.primary} size="small" />
                  : <Ionicons name="refresh" size={16} color={t.primary} />}
              </TouchableOpacity>
            </View>
          }
        >Market Pulse</SectionHeader>
        <Card style={[...cardStyle, { padding: 0 }]}>
          {pulseInfoOpen && (
            <View style={s.pulseInfoBox}>
              <Text style={s.pulseInfoTxt}>
                Newest public headline for each watchlist name, from Yahoo Finance
                and Google News RSS. No LLM. Ranked by |day %|. Tap the ticker for
                a snapshot, the headline to open the article, or the row for more
                headlines.
              </Text>
            </View>
          )}
          {!pulseEntries.length ? (
            <Text style={[s.muted, { padding: 14 }]}>
              Add tickers to the watchlist to see today’s headlines.
            </Text>
          ) : (
            pulseEntries.map(({ tk, pct, row }, i) => {
              const age = wireRelAge(row.pub_ts);
              const title = String(row.headline || '').trim();
              const href = String(row.url || '').trim();
              const open = pulseOpenTk === tk;
              const list = pulseNewsItems(row);
              const up = pct == null ? null : pct >= 0;
              return (
                <View key={tk} style={i < pulseEntries.length - 1 ? s.divider : null}>
                  <TouchableOpacity
                    style={s.pulseRow}
                    activeOpacity={0.7}
                    onPress={() => {
                      const next = open ? null : tk;
                      setPulseOpenTk(next);
                      if (next && !pulseExtra[tk] && !pulseExtraBusy[tk]) {
                        loadPulseMore(tk);
                      }
                    }}
                  >
                    <View style={s.pulseHead}>
                      <TouchableOpacity
                        onPress={() => { haptics.onPressPrimary?.(); setPeekTk(tk); }}
                        hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
                      >
                        <Text style={s.pulseTk}>{tk}</Text>
                      </TouchableOpacity>
                      {pct != null && (
                        <Text style={[s.pulsePct, { color: up ? t.pillUpFg : t.pillDownFg }]}>
                          {fmtPct(pct)}
                        </Text>
                      )}
                      <View style={{ flex: 1 }} />
                      {row.publisher ? <Text style={s.pulsePub} numberOfLines={1}>{row.publisher}</Text> : null}
                      {age ? <Text style={s.asOf}>{age} ago</Text> : null}
                      <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={16} color={t.textDim} />
                    </View>
                    {href && title ? (
                      <Text
                        style={s.pulseHeadline}
                        numberOfLines={open ? 0 : 2}
                        onPress={() => Linking.openURL(href).catch(() => {})}
                      >
                        {title}
                      </Text>
                    ) : (
                      <Text style={s.pulseHeadline} numberOfLines={2}>
                        {title || (pulseBusy ? '…' : 'No recent headline')}
                      </Text>
                    )}
                  </TouchableOpacity>
                  {open && (
                    <View style={s.pulseMoreBox}>
                      {pulseExtraBusy[tk] && list.length < 2 ? (
                        <ActivityIndicator color={t.primary} size="small" />
                      ) : null}
                      {list.map((it, j) => {
                        const ht = String(it.title || '').trim();
                        const u = String(it.url || '').trim();
                        const a = wireRelAge(it.pub_ts);
                        return (
                          <TouchableOpacity
                            key={`${tk}-${j}-${u || ht}`}
                            style={s.pulseHeadItem}
                            disabled={!u}
                            onPress={() => u && Linking.openURL(u).catch(() => {})}
                          >
                            <Text style={s.asOf}>
                              {a ? `${a} ago` : '—'}
                              {it.publisher ? ` · ${it.publisher}` : ''}
                            </Text>
                            <Text style={s.pulseHeadTitle}>{ht || '—'}</Text>
                          </TouchableOpacity>
                        );
                      })}
                      {!list.length && !pulseExtraBusy[tk] ? (
                        <Text style={s.muted}>No public headlines for {tk}.</Text>
                      ) : null}
                    </View>
                  )}
                </View>
              );
            })
          )}
          <Text style={s.cardFoot}>Watchlist · Yahoo / Google News RSS · no LLM · |day %|</Text>
        </Card>
      </ScrollView>

      <Modal
        visible={!!earnOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setEarnOpen(null)}
      >
        <TouchableOpacity
          style={s.earnModalBg}
          activeOpacity={1}
          onPress={() => setEarnOpen(null)}
        >
          <TouchableOpacity activeOpacity={1} style={s.earnModalCard} onPress={(e) => e.stopPropagation?.()}>
            {earnOpen && (
              <ScrollView>
                <View style={s.earnModalHead}>
                  <Text style={s.earnModalTk}>{earnOpen.ticker}</Text>
                  <Text style={s.earnModalTag}>EARNINGS</Text>
                  <TouchableOpacity onPress={() => setEarnOpen(null)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                    <Text style={s.earnModalClose}>✕</Text>
                  </TouchableOpacity>
                </View>
                {earnOpen.name ? <Text style={s.earnModalName}>{earnOpen.name}</Text> : null}
                <Text style={s.earnModalWhen}>
                  {earnOpen.date || '—'}
                  {earnOpen.session ? ` · ${earnOpen.session}` : ''}
                  {earnOpen.fiscal_quarter ? ` · FQ ${earnOpen.fiscal_quarter}` : ''}
                </Text>
                <View style={s.earnMetricGrid}>
                  <View style={s.earnMetric}>
                    <Text style={s.earnMetricLbl}>Actual EPS</Text>
                    <Text style={s.earnMetricVal}>{fmtEps(earnOpen.eps_actual)}</Text>
                  </View>
                  <View style={s.earnMetric}>
                    <Text style={s.earnMetricLbl}>Consensus EPS</Text>
                    <Text style={s.earnMetricVal}>{fmtEps(earnOpen.eps_estimate)}</Text>
                  </View>
                  <View style={s.earnMetric}>
                    <Text style={s.earnMetricLbl}>EPS Surprise</Text>
                    <Text style={[s.earnMetricVal, {
                      color: earnOpen.beat === 'beat' ? t.green
                        : earnOpen.beat === 'miss' ? t.red : t.textPrimary,
                    }]}>
                      {earnOpen.surprise_pct != null
                        ? `${earnOpen.surprise_pct >= 0 ? '+' : ''}${Number(earnOpen.surprise_pct).toFixed(1)}%`
                        : '—'}
                    </Text>
                  </View>
                  <View style={s.earnMetric}>
                    <Text style={s.earnMetricLbl}>Actual Revenue</Text>
                    <Text style={s.earnMetricVal}>
                      {earnOpen.revenue_actual != null ? '$' + fmtRevShort(earnOpen.revenue_actual) : '—'}
                    </Text>
                  </View>
                  <View style={s.earnMetric}>
                    <Text style={s.earnMetricLbl}>Consensus Revenue</Text>
                    <Text style={s.earnMetricVal}>
                      {earnOpen.revenue_estimate != null ? '$' + fmtRevShort(earnOpen.revenue_estimate) : '—'}
                    </Text>
                  </View>
                  <View style={s.earnMetric}>
                    <Text style={s.earnMetricLbl}>Rev Surprise</Text>
                    <Text style={[s.earnMetricVal, {
                      color: earnOpen.revenue_beat === 'beat' ? t.green
                        : earnOpen.revenue_beat === 'miss' ? t.red : t.textPrimary,
                    }]}>
                      {earnOpen.revenue_surprise_pct != null
                        ? `${earnOpen.revenue_surprise_pct >= 0 ? '+' : ''}${Number(earnOpen.revenue_surprise_pct).toFixed(1)}%`
                        : '—'}
                    </Text>
                  </View>
                </View>
                {(earnOpen.raw?.investor_relations_url ||
                  earnOpen.raw?.press_release_url ||
                  earnOpen.raw?.website_url) ? (
                  <View style={{ gap: 6, marginTop: 10 }}>
                    {!!earnOpen.raw?.investor_relations_url && (
                      <TouchableOpacity
                        style={s.earnExtBtn}
                        onPress={() => Linking.openURL(earnOpen.raw.investor_relations_url).catch(() => {})}
                      >
                        <Text style={s.earnExtBtnTxt}>↗ Investor relations</Text>
                        <Text style={s.earnExtBtnSub}>full earnings release</Text>
                      </TouchableOpacity>
                    )}
                    {!!earnOpen.raw?.press_release_url && (
                      <TouchableOpacity
                        style={s.earnExtBtn}
                        onPress={() => Linking.openURL(earnOpen.raw.press_release_url).catch(() => {})}
                      >
                        <Text style={s.earnExtBtnTxt}>↗ SEC press release</Text>
                        <Text style={s.earnExtBtnSub}>8-K Item 2.02</Text>
                      </TouchableOpacity>
                    )}
                    {!earnOpen.raw?.investor_relations_url && !!earnOpen.raw?.website_url && (
                      <TouchableOpacity
                        style={s.earnExtBtn}
                        onPress={() => Linking.openURL(earnOpen.raw.website_url).catch(() => {})}
                      >
                        <Text style={s.earnExtBtnTxt}>↗ Company website</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                ) : null}
                <TouchableOpacity
                  style={s.earnAnalyzeBtn}
                  onPress={() => {
                    const tk = earnOpen.ticker;
                    setEarnOpen(null);
                    navigation?.navigate('Research', { screen: 'Home', params: { prefillTicker: tk } });
                  }}
                >
                  <Text style={s.earnAnalyzeBtnTxt}>Use {earnOpen.ticker} in Analyze</Text>
                </TouchableOpacity>
              </ScrollView>
            )}
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      <StockSnapshotSheet
        ticker={peekTk}
        visible={!!peekTk}
        onClose={() => setPeekTk(null)}
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
    newsRow: { paddingHorizontal: 14, paddingVertical: 10 },
    cardFoot: {
      fontSize: 9, color: t.textDim, paddingHorizontal: 14, paddingVertical: 8,
      borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.border,
    },

    earnRowTop: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 },
    earnTk: { fontSize: 13, fontWeight: '800', color: t.textPrimary, letterSpacing: 0.3, minWidth: 44 },
    earnBadge: { fontSize: 9, fontWeight: '800', letterSpacing: 0.3 },
    earnWhen: { marginLeft: 'auto', fontSize: 10, fontWeight: '600', color: t.textDim },
    earnLine: { fontSize: 11, color: t.textSecondary, fontVariant: ['tabular-nums'] },

    wireTitle: { fontSize: 13, fontWeight: '600', color: t.textPrimary, lineHeight: 18 },
    wireMeta: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
    wireChip: {
      fontSize: 9, fontWeight: '700', color: t.primary, backgroundColor: t.surfaceAlt,
      paddingHorizontal: 5, paddingVertical: 1, borderRadius: 3, overflow: 'hidden',
    },

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
    pulsePub:  { fontSize: 10, color: t.textSecondary, maxWidth: 90 },
    pulseHeadline: { fontSize: 12.5, color: t.textPrimary, marginTop: 4, lineHeight: 17, fontWeight: '600' },
    pulseMoreBox: { paddingHorizontal: 14, paddingBottom: 10, gap: 8 },
    pulseHeadItem: { paddingVertical: 4 },
    pulseHeadTitle: { fontSize: 12, color: t.textPrimary, fontWeight: '600', marginTop: 1 },

    earnModalBg: {
      flex: 1, backgroundColor: 'rgba(10,22,40,0.55)',
      justifyContent: 'center', padding: 20,
    },
    earnModalCard: {
      backgroundColor: t.surface, borderRadius: 14, padding: 16,
      borderWidth: 1, borderColor: t.border, maxHeight: '80%',
    },
    earnModalHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
    earnModalTk: { fontSize: 18, fontWeight: '800', color: t.textPrimary },
    earnModalTag: {
      fontSize: 9, fontWeight: '800', letterSpacing: 0.6, color: t.primary,
      backgroundColor: t.surfaceTint, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4,
    },
    earnModalClose: { marginLeft: 'auto', fontSize: 18, color: t.textDim, fontWeight: '600' },
    earnModalName: { fontSize: 13, color: t.textSecondary, marginBottom: 2 },
    earnModalWhen: { fontSize: 12, color: t.textDim, marginBottom: 12 },
    earnMetricGrid: { flexDirection: 'row', flexWrap: 'wrap' },
    earnMetric: { width: '33.33%', paddingVertical: 8, paddingRight: 6 },
    earnMetricLbl: {
      fontSize: 9, fontWeight: '700', letterSpacing: 0.3, color: t.textDim,
      textTransform: 'uppercase',
    },
    earnMetricVal: {
      fontSize: 14, fontWeight: '800', color: t.textPrimary, marginTop: 2,
      fontVariant: ['tabular-nums'],
    },
    earnAnalyzeBtn: {
      marginTop: 12, backgroundColor: t.primary, borderRadius: 8,
      paddingVertical: 10, alignItems: 'center',
    },
    earnAnalyzeBtnTxt: { color: t.onAccent || t.chromeNavy, fontWeight: '800', fontSize: 13 },
    earnExtBtn: {
      paddingVertical: 10, paddingHorizontal: 12, borderRadius: 8,
      borderWidth: 1, borderColor: t.border, backgroundColor: t.surfaceAlt,
    },
    earnExtBtnTxt: { fontSize: 13, fontWeight: '700', color: t.primary },
    earnExtBtnSub: { fontSize: 10, fontWeight: '600', color: t.textDim, marginTop: 2 },
  });
}
