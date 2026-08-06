/**
 * StrategistScreen — Portfolio Strategist (mobile)
 *
 * Pick one or more funds/accounts → IC-style agentic review of that book.
 * Same backend as desktop Desk StrategistCard (/api/research/portfolio-strategist).
 * Requires Fund tab unlock (x-fund-token) so we can list accounts.
 */
import React, { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, RefreshControl, Alert,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Markdown from 'react-native-markdown-display';
import { api } from '../api/client';
import { spacing, radius, fontSize, haptics, makeMdStyles, useTheme } from '../design';
import AppHeader, { BackButton } from '../components/AppHeader';

const ENGINE_KEY = '@dga_strategist_engine_v1';
const ENGINES = [
  { id: 'claude', label: 'Claude', sub: 'Opus 5' },
  { id: 'grok', label: 'Grok', sub: '4.5' },
  { id: 'deepseek', label: 'DeepSeek', sub: 'V4 Pro' },
];

function cleanAnswer(text) {
  return (text || '').replace(/```sleeve[\s\S]*?```/g, '').trim();
}

function formatWhen(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('en-US', {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    });
  } catch {
    return String(iso).slice(0, 16);
  }
}

export default function StrategistScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const { theme: t } = useTheme();
  const s = useMemo(() => makeStyles(t), [t]);
  const md = useMemo(() => makeMdStyles(t), [t]);

  const [engine, setEngine] = useState('claude');
  const [funds, setFunds] = useState([]);
  const [selected, setSelected] = useState([]);
  const [fundsErr, setFundsErr] = useState(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(null);
  const [result, setResult] = useState(null);
  const [fundLabel, setFundLabel] = useState('');
  const [error, setError] = useState(null);
  const pollRef = useRef(null);

  const [reviews, setReviews] = useState([]);
  const [reviewsLoading, setReviewsLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const stopPoll = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  };

  const loadFunds = useCallback(async () => {
    setFundsErr(null);
    try {
      // Merge LP funds + managed accounts (fund token required)
      const [lp, ma] = await Promise.all([
        api.fundList('lp_fund').catch(() => null),
        api.fundList('managed_account').catch(() => null),
      ]);
      const arr = [];
      const push = (src) => {
        const list = Array.isArray(src) ? src : (src?.funds || src?.items || []);
        for (const f of list) {
          if (f && f.id) arr.push(f);
        }
      };
      push(lp);
      push(ma);
      // Dedupe by id
      const seen = new Set();
      const uniq = arr.filter((f) => {
        if (seen.has(f.id)) return false;
        seen.add(f.id);
        return true;
      });
      setFunds(uniq);
      if (!uniq.length) {
        setFundsErr('No funds found. Unlock Fund with the fund password first, then pull to refresh.');
      }
    } catch (e) {
      setFunds([]);
      setFundsErr(String(e?.message || e) + ' — unlock Fund tab first.');
    }
  }, []);

  const loadReviews = useCallback(async () => {
    try {
      const d = await api.listStrategistReviews();
      setReviews(Array.isArray(d?.reviews) ? d.reviews : []);
    } catch {
      setReviews([]);
    }
  }, []);

  useEffect(() => {
    AsyncStorage.getItem(ENGINE_KEY).then((v) => {
      if (v && ENGINES.some((e) => e.id === v)) setEngine(v);
    }).catch(() => {});
    setReviewsLoading(true);
    Promise.all([loadFunds(), loadReviews()]).finally(() => setReviewsLoading(false));
    return () => stopPoll();
  }, [loadFunds, loadReviews]);

  const pickEngine = useCallback((id) => {
    setEngine(id);
    AsyncStorage.setItem(ENGINE_KEY, id).catch(() => {});
    try { haptics.onPressPrimary?.(); } catch {}
  }, []);

  const toggleFund = (id) => {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([loadFunds(), loadReviews()]);
    setRefreshing(false);
  }, [loadFunds, loadReviews]);

  const run = useCallback(async () => {
    if (!selected.length) {
      setError('Pick at least one fund or managed account.');
      return;
    }
    try { haptics.onPressPrimary?.(); } catch {}
    const label =
      funds
        .filter((f) => selected.includes(f.id))
        .map((f) => f.short_name || f.name || f.id)
        .join(' + ') + (selected.length > 1 ? ' (combined)' : '');
    setRunning(true);
    setError(null);
    setResult(null);
    setFundLabel(label);
    setProgress({ label: `Loading book · ${engine}…`, steps: 0 });
    const t0 = Date.now();
    try {
      const d0 = await api.startPortfolioStrategist({
        fund_ids: selected,
        llm_provider: engine,
      });
      if (!d0.ok || !d0.job_id) throw new Error(d0.error || 'Failed to start');
      if (d0.fund_name) setFundLabel(d0.fund_name);
      const jobId = d0.job_id;
      // Strategist can run ~12 min on large books
      pollRef.current = setInterval(async () => {
        if (Date.now() - t0 > 12 * 60 * 1000) {
          stopPoll();
          setRunning(false);
          setError('Timed out after 12 min.');
          return;
        }
        try {
          const d = await api.getAgentic(jobId);
          if (d.status === 'done' && d.result) {
            stopPoll();
            setRunning(false);
            setProgress(null);
            setResult(d.result);
            setTimeout(() => { loadReviews(); }, 1800);
          } else if (d.status === 'error') {
            stopPoll();
            setRunning(false);
            setError(d.label || d.error || 'failed');
          } else {
            setProgress({
              label: d.label || 'Working…',
              steps: d.steps || 0,
              cost_usd: d.cost_usd || 0,
            });
          }
        } catch (_) { /* transient */ }
      }, 1400);
    } catch (e) {
      setRunning(false);
      setProgress(null);
      setError(String(e?.message || e));
    }
  }, [selected, funds, engine, loadReviews]);

  const openReview = useCallback(async (id) => {
    try { haptics.onPressPrimary?.(); } catch {}
    setError(null);
    try {
      const d = await api.getStrategistReview(id);
      if (!d?.ok || !d.review) throw new Error(d?.error || 'Not found');
      const rv = d.review;
      setFundLabel(rv.fund_name || rv.tickers || 'Review');
      setResult({
        answer: rv.answer || '',
        verification: rv.verification,
        cost_usd: rv.cost_usd,
        model: rv.model,
      });
    } catch (e) {
      Alert.alert('Could not open', String(e?.message || e));
    }
  }, []);

  const answer = cleanAnswer(result?.answer);

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <AppHeader
        title="Portfolio Strategist"
        left={<BackButton onPress={() => navigation.goBack()} />}
        showLogo={false}
      />
      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 32 }}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.primary} />}
      >
        <Text style={s.brandSub}>
          IC-style review of a live book · agentic · {engine}
        </Text>

        <Text style={s.section}>ENGINE</Text>
        <View style={s.engineRow}>
          {ENGINES.map((e) => {
            const on = engine === e.id;
            return (
              <TouchableOpacity
                key={e.id}
                style={[s.engineChip, on && s.engineChipOn]}
                onPress={() => pickEngine(e.id)}
                activeOpacity={0.8}
              >
                <Text style={[s.engineChipTxt, on && s.engineChipTxtOn]}>{e.label}</Text>
                <Text style={[s.engineChipSub, on && s.engineChipTxtOn]}>{e.sub}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <Text style={s.section}>BOOK</Text>
        {fundsErr ? (
          <Text style={s.hint}>{fundsErr}</Text>
        ) : funds.length === 0 && reviewsLoading ? (
          <ActivityIndicator color={t.primary} style={{ marginVertical: 12 }} />
        ) : (
          <View style={s.fundWrap}>
            {funds.map((f) => {
              const on = selected.includes(f.id);
              const label = f.short_name || f.name || f.id;
              const sub = f.fund_type === 'managed_account' ? 'Managed' : 'LP';
              return (
                <TouchableOpacity
                  key={f.id}
                  style={[s.fundChip, on && s.fundChipOn]}
                  onPress={() => toggleFund(f.id)}
                  activeOpacity={0.8}
                >
                  <Text style={[s.fundChipTxt, on && s.fundChipTxtOn]} numberOfLines={1}>
                    {label}
                  </Text>
                  <Text style={[s.fundChipSub, on && s.fundChipTxtOn]}>{sub}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        )}
        {selected.length > 1 && (
          <Text style={s.hint}>
            {selected.length} accounts will be combined into one book.
          </Text>
        )}

        <TouchableOpacity
          style={[s.runBtn, running && { opacity: 0.6 }]}
          onPress={run}
          disabled={running || !selected.length}
          activeOpacity={0.85}
        >
          {running ? (
            <ActivityIndicator color={t.onAccent} />
          ) : (
            <Text style={s.runBtnTxt}>
              🧭  Run IC Review · {ENGINES.find((x) => x.id === engine)?.label || 'Claude'}
            </Text>
          )}
        </TouchableOpacity>

        {error ? <Text style={s.err}>{error}</Text> : null}

        {progress && (
          <View style={s.progressCard}>
            <Text style={s.progressLabel}>{progress.label}</Text>
            <Text style={s.progressMeta}>
              {progress.steps ? `${progress.steps} steps` : '…'}
              {progress.cost_usd != null ? ` · $${Number(progress.cost_usd).toFixed(3)}` : ''}
            </Text>
          </View>
        )}

        {answer ? (
          <View style={s.answerCard}>
            <Text style={s.answerHead}>{fundLabel || 'Review'}</Text>
            <Markdown style={md}>{answer}</Markdown>
          </View>
        ) : null}

        <Text style={[s.section, { marginTop: spacing.xl }]}>SAVED REVIEWS</Text>
        {reviewsLoading && !reviews.length ? (
          <ActivityIndicator color={t.primary} />
        ) : reviews.length === 0 ? (
          <Text style={s.hint}>No IC reviews yet. Run one above.</Text>
        ) : (
          reviews.slice(0, 12).map((rv) => (
            <TouchableOpacity
              key={rv.id}
              style={s.reviewRow}
              onPress={() => openReview(rv.id)}
              activeOpacity={0.75}
            >
              <Text style={s.reviewTitle} numberOfLines={1}>
                {rv.fund_name || rv.tickers || 'Portfolio review'}
              </Text>
              <Text style={s.reviewMeta}>
                {formatWhen(rv.generated_at)}
                {rv.model ? ` · ${rv.model}` : ''}
                {rv.cost_usd != null ? ` · $${Number(rv.cost_usd).toFixed(2)}` : ''}
              </Text>
            </TouchableOpacity>
          ))
        )}
      </ScrollView>
    </View>
  );
}

function makeStyles(t) {
  return StyleSheet.create({
    brandSub: {
      fontSize: fontSize.caption, color: t.textSecondary, marginBottom: spacing.md,
    },
    section: {
      fontSize: fontSize.micro, fontWeight: '800', letterSpacing: 1,
      color: t.textSecondary, marginBottom: 8, marginTop: 4,
    },
    engineRow: { flexDirection: 'row', gap: 6, marginBottom: spacing.md },
    engineChip: {
      flex: 1, paddingVertical: 8, paddingHorizontal: 6, borderRadius: radius.lg,
      backgroundColor: t.surfaceAlt, borderWidth: 1, borderColor: t.border, alignItems: 'center',
    },
    engineChipOn: { backgroundColor: t.primary, borderColor: t.primary },
    engineChipTxt: { fontSize: fontSize.small, fontWeight: '800', color: t.textPrimary },
    engineChipTxtOn: { color: t.onAccent },
    engineChipSub: { fontSize: 9, color: t.textDim, marginTop: 1, fontWeight: '600' },
    fundWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
    fundChip: {
      paddingVertical: 7, paddingHorizontal: 10, borderRadius: radius.md,
      backgroundColor: t.surface, borderWidth: 1, borderColor: t.border, maxWidth: '48%',
    },
    fundChipOn: { backgroundColor: t.surfaceTint, borderColor: t.primary },
    fundChipTxt: { fontSize: fontSize.small, fontWeight: '700', color: t.textPrimary },
    fundChipTxtOn: { color: t.primary },
    fundChipSub: { fontSize: 9, color: t.textDim, marginTop: 1 },
    hint: { fontSize: fontSize.caption, color: t.textDim, lineHeight: 16, marginBottom: 8 },
    runBtn: {
      marginTop: 8, backgroundColor: t.primary, borderRadius: radius.lg,
      paddingVertical: 12, alignItems: 'center',
    },
    runBtnTxt: { color: t.onAccent, fontWeight: '800', fontSize: fontSize.body },
    err: { color: t.red, fontSize: fontSize.caption, marginTop: 8, lineHeight: 16 },
    progressCard: {
      marginTop: 12, padding: 12, borderRadius: radius.lg,
      backgroundColor: t.surface, borderWidth: 1, borderColor: t.border,
    },
    progressLabel: { fontSize: fontSize.body, fontWeight: '700', color: t.textPrimary },
    progressMeta: { fontSize: fontSize.caption, color: t.textDim, marginTop: 4 },
    answerCard: {
      marginTop: 14, padding: 12, borderRadius: radius.lg,
      backgroundColor: t.surface, borderWidth: 1, borderColor: t.border,
    },
    answerHead: {
      fontSize: fontSize.micro, fontWeight: '800', letterSpacing: 0.8,
      color: t.textSecondary, marginBottom: 8,
    },
    reviewRow: {
      paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: t.border,
    },
    reviewTitle: { fontSize: fontSize.body, fontWeight: '700', color: t.textPrimary },
    reviewMeta: { fontSize: fontSize.caption, color: t.textDim, marginTop: 2 },
  });
}
