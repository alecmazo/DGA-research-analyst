/**
 * StockInfoCard — free (zero-LLM) stock snapshot.
 * Same fact sheet as desktop StockPeek: quote hero, 52-week range bar,
 * hairline rows grouped Market / Capital / FY. Not boxed tiles.
 * Payload: GET /api/stock-info/{ticker}
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ActivityIndicator, TouchableOpacity,
  ScrollView, Modal, Linking,
} from 'react-native';
import { api } from '../api/client';
import { spacing, radius, fontSize, useTheme } from '../design';

const GREEN = '#16A34A';
const RED = '#DC2626';

function fmtPx(v) {
  if (v == null || isNaN(v)) return null;
  return '$' + Number(v).toLocaleString('en-US', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
}
function fmtPct(v) {
  if (v == null || isNaN(v)) return null;
  const n = Number(v);
  return (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
}
function fmtCompact(v) {
  if (v == null || isNaN(v)) return null;
  const n = Number(v);
  const a = Math.abs(n);
  const sign = n < 0 ? '−' : '';
  if (a >= 1e12) return sign + '$' + (a / 1e12).toFixed(2) + 'T';
  if (a >= 1e9) return sign + '$' + (a / 1e9).toFixed(2) + 'B';
  if (a >= 1e6) return sign + '$' + (a / 1e6).toFixed(2) + 'M';
  if (a >= 1e3) return sign + '$' + (a / 1e3).toFixed(1) + 'K';
  return sign + '$' + a.toFixed(0);
}
function fmtMargin(v) {
  if (v == null || isNaN(v)) return null;
  const n = Number(v);
  const pct = Math.abs(n) <= 1.5 ? n * 100 : n;
  return pct.toFixed(1) + '%';
}
function tone(v) {
  if (v == null || isNaN(Number(v))) return null;
  return Number(v) >= 0 ? GREEN : RED;
}

function Row({ label, value, color, t, s }) {
  if (value == null || value === '') return null;
  return (
    <View style={[s.row, { borderBottomColor: t.border }]}>
      <Text style={[s.rowLbl, { color: t.textSecondary }]}>{label}</Text>
      <Text
        style={[s.rowVal, { color: color || t.textPrimary }]}
        numberOfLines={1}
      >
        {value}
      </Text>
    </View>
  );
}

function Section({ title, children, t, s }) {
  const items = React.Children.toArray(children).filter(Boolean);
  if (!items.length) return null;
  return (
    <View style={s.section}>
      <Text style={[s.secTitle, { color: t.textDim }]}>{title}</Text>
      <View style={[s.rows, { borderTopColor: t.border }]}>{items}</View>
    </View>
  );
}

function RangeBar({ low, high, last, t, s }) {
  if (low == null || high == null || high <= low) return null;
  const px = last != null && last > 0 ? last : (low + high) / 2;
  const pos = Math.max(0, Math.min(1, (px - low) / (high - low)));
  return (
    <View style={s.range}>
      <View style={s.rangeMeta}>
        <Text style={[s.rangePx, { color: t.textSecondary }]}>{fmtPx(low)}</Text>
        <Text style={[s.rangeCap, { color: t.textDim }]}>52-week range</Text>
        <Text style={[s.rangePx, { color: t.textSecondary }]}>{fmtPx(high)}</Text>
      </View>
      <View style={[s.rangeTrack, { backgroundColor: t.isDark ? 'rgba(255,255,255,0.12)' : '#e6eaf0' }]}>
        <View
          style={[
            s.rangeFill,
            {
              width: `${pos * 100}%`,
              backgroundColor: t.chromeNavy || t.primary || '#1c2b40',
            },
          ]}
        />
        <View
          style={[
            s.rangeDot,
            {
              left: `${pos * 100}%`,
              backgroundColor: t.chromeNavy || '#0a1628',
              borderColor: t.surface,
            },
          ]}
        />
      </View>
    </View>
  );
}

/**
 * @param {string} ticker
 * @param {object} [positionCtx] optional { qty, value, weight, avgCost, pl }
 * @param {function} [onOpenReport]
 * @param {function} [onRunAnalysis]
 * @param {boolean} [compact]
 * @param {boolean} [hideHero] skip ticker/price header (parent already shows it)
 */
export default function StockInfoCard({
  ticker,
  positionCtx,
  onOpenReport,
  onRunAnalysis,
  compact = false,
  hideHero = false,
}) {
  const { theme: t } = useTheme();
  const s = useMemo(() => makeStyles(t, compact), [t, compact]);
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(true);

  const tk = String(ticker || '').trim().toUpperCase();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr(null);
    setData(null);
    if (!tk) {
      setLoading(false);
      setErr('No ticker');
      return undefined;
    }
    api.getStockInfo(tk)
      .then((d) => {
        if (!cancelled) setData(d || {});
      })
      .catch((e) => {
        if (!cancelled) setErr(String(e?.message || e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [tk]);

  if (loading) {
    return (
      <View style={s.box}>
        <ActivityIndicator color={t.primary} />
        <Text style={[s.muted, { marginTop: 8 }]}>Loading snapshot…</Text>
      </View>
    );
  }
  if (err) {
    return (
      <View style={s.box}>
        <Text style={[s.err, { color: t.red || RED }]}>Could not load {tk}: {err}</Text>
      </View>
    );
  }

  const q = data?.quote || {};
  const m = data?.meta || {};
  const w = data?.range52w || {};
  const fin = data?.financials || {};
  const dv = data?.derived || {};
  const sr = data?.saved_report || {};
  const name = m.name || fin.entity_name || tk;
  const sectorBits = [m.sector, m.industry].filter(Boolean).join(' · ');
  const pct = q.pct_change != null ? Number(q.pct_change) : null;
  const fy = fin.fy ? `FY${String(fin.fy).slice(-2)}` : 'Operations';
  const mktCap = dv.market_cap ?? dv.marketCap ?? m.market_cap ?? m.marketCap ?? q.market_cap;

  const openGuru = () => {
    const url = `https://www.gurufocus.com/stock/${encodeURIComponent(tk)}/summary`;
    Linking.openURL(url).catch(() => {});
  };

  return (
    <View style={s.box}>
      {!hideHero ? (
        <View style={s.hero}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[s.tk, { color: t.textPrimary }]}>{tk}</Text>
            {name && name !== tk ? (
              <Text style={[s.name, { color: t.textSecondary }]} numberOfLines={2}>{name}</Text>
            ) : null}
            {sectorBits ? (
              <Text style={[s.sector, { color: t.textDim }]} numberOfLines={1}>{sectorBits}</Text>
            ) : null}
          </View>
          <View style={s.priceCol}>
            <Text style={[s.price, { color: t.textPrimary }]}>
              {q.price != null ? fmtPx(q.price) : '—'}
            </Text>
            {pct != null ? (
              <Text style={[s.dayPct, { color: tone(pct) }]}>{fmtPct(pct)}</Text>
            ) : null}
          </View>
        </View>
      ) : null}

      <RangeBar low={w.low} high={w.high} last={q.price} t={t} s={s} />
      {w.off_high_pct != null ? (
        <Text style={[s.rangeNote, { color: t.textDim }]}>
          <Text style={{ color: tone(w.off_high_pct), fontWeight: '700' }}>
            {fmtPct(w.off_high_pct)}
          </Text>
          {' '}from 52-week high
        </Text>
      ) : null}

      <Section title="Market" t={t} s={s}>
        <Row label="Year to date" value={fmtPct(w.ytd_pct)} color={tone(w.ytd_pct)} t={t} s={s} />
        <Row label="One year" value={fmtPct(w.one_year_pct)} color={tone(w.one_year_pct)} t={t} s={s} />
        <Row
          label="Realized vol"
          value={q.realized_vol != null ? Number(q.realized_vol).toFixed(1) + '%' : null}
          t={t} s={s}
        />
        <Row label="Market cap" value={fmtCompact(mktCap)} t={t} s={s} />
        <Row label="P/E" value={dv.pe != null ? Number(dv.pe).toFixed(1) : null} t={t} s={s} />
      </Section>

      <Section title="Capital" t={t} s={s}>
        <Row
          label="FCF yield"
          value={dv.fcf_yield_pct != null ? Number(dv.fcf_yield_pct).toFixed(2) + '%' : null}
          t={t} s={s}
        />
        <Row label="Net cash" value={fmtCompact(dv.net_cash)} t={t} s={s} />
        <Row
          label="Debt / equity"
          value={dv.debt_to_equity != null ? Number(dv.debt_to_equity).toFixed(2) : null}
          t={t} s={s}
        />
      </Section>

      <Section title={fy} t={t} s={s}>
        <Row label="Revenue" value={fmtCompact(fin.revenue)} t={t} s={s} />
        <Row label="Net income" value={fmtCompact(fin.net_income)} t={t} s={s} />
        <Row label="EBITDA" value={fmtCompact(fin.ebitda)} t={t} s={s} />
        <Row label="Gross margin" value={fmtMargin(fin.gross_margin)} t={t} s={s} />
        <Row label="Operating margin" value={fmtMargin(fin.operating_margin)} t={t} s={s} />
        <Row label="Net margin" value={fmtMargin(fin.net_margin)} t={t} s={s} />
        <Row
          label="Diluted EPS"
          value={fin.diluted_eps != null ? '$' + Number(fin.diluted_eps).toFixed(2) : null}
          t={t} s={s}
        />
        <Row label="Free cash flow" value={fmtCompact(fin.free_cash_flow)} t={t} s={s} />
      </Section>

      {positionCtx ? (
        <Section title="Position" t={t} s={s}>
          <Row
            label="Quantity"
            value={positionCtx.qty != null
              ? Number(positionCtx.qty).toLocaleString('en-US', { maximumFractionDigits: 2 })
              : null}
            t={t} s={s}
          />
          <Row label="Market value" value={fmtCompact(positionCtx.value)} t={t} s={s} />
          <Row
            label="Weight"
            value={positionCtx.weight != null ? Number(positionCtx.weight).toFixed(2) + '%' : null}
            t={t} s={s}
          />
          <Row label="Avg cost" value={fmtPx(positionCtx.avgCost)} t={t} s={s} />
          <Row
            label="Unrealized P/L"
            value={fmtCompact(positionCtx.pl)}
            color={tone(positionCtx.pl)}
            t={t} s={s}
          />
        </Section>
      ) : null}

      {!q.price && !m.name && !fin.revenue ? (
        <Text style={s.muted}>
          No stored data for {tk} yet — the market-data store syncs on demand.
        </Text>
      ) : null}

      <View style={s.actions}>
        <TouchableOpacity onPress={openGuru} activeOpacity={0.7}>
          <Text style={[s.link, { color: t.primary }]}>GuruFocus ↗</Text>
        </TouchableOpacity>
        {sr.exists && onOpenReport ? (
          <TouchableOpacity
            style={[s.btn, s.btnSecondary, { borderColor: t.border }]}
            onPress={onOpenReport}
            activeOpacity={0.8}
          >
            <Text style={[s.btnSecondaryTxt, { color: t.textPrimary }]} numberOfLines={1}>
              Open report{sr.rating ? ` · ${sr.rating}` : ''}
              {sr.price_target != null ? ` · PT ${fmtPx(sr.price_target)}` : ''}
            </Text>
          </TouchableOpacity>
        ) : null}
        {onRunAnalysis ? (
          <TouchableOpacity
            style={[s.btn, { backgroundColor: t.primary }]}
            onPress={onRunAnalysis}
            activeOpacity={0.85}
          >
            <Text style={[s.btnPrimaryTxt, { color: t.onAccent || '#0A1628' }]}>
              Run analysis
            </Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
}

function makeStyles(t, compact) {
  const pad = compact ? 8 : 4;
  return StyleSheet.create({
    box: { padding: pad, backgroundColor: 'transparent' },
    muted: { fontSize: fontSize.small, color: t.textSecondary, fontStyle: 'italic', marginTop: 8 },
    err: { fontSize: fontSize.small, fontWeight: '600' },
    hero: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 14 },
    tk: {
      fontSize: 22,
      fontWeight: '700',
      letterSpacing: -0.6,
    },
    name: { marginTop: 4, fontSize: 13, fontWeight: '500', lineHeight: 17 },
    sector: { marginTop: 3, fontSize: 11 },
    priceCol: { alignItems: 'flex-end' },
    price: { fontSize: 20, fontWeight: '700', letterSpacing: -0.4, fontVariant: ['tabular-nums'] },
    dayPct: { fontSize: 13, fontWeight: '600', marginTop: 2, fontVariant: ['tabular-nums'] },
    range: { marginTop: 2, marginBottom: 6 },
    rangeMeta: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'baseline',
      marginBottom: 6,
    },
    rangePx: { fontSize: 11, fontVariant: ['tabular-nums'] },
    rangeCap: { fontSize: 10, letterSpacing: 0.8, textTransform: 'uppercase', fontWeight: '700' },
    rangeTrack: { height: 3, borderRadius: 99, position: 'relative' },
    rangeFill: { height: 3, borderRadius: 99 },
    rangeDot: {
      position: 'absolute',
      top: -3,
      width: 9,
      height: 9,
      borderRadius: 5,
      borderWidth: 2,
      marginLeft: -4.5,
    },
    rangeNote: { fontSize: 11.5, marginBottom: 14 },
    section: { marginTop: 4, marginBottom: 12 },
    secTitle: {
      fontSize: 10,
      fontWeight: '700',
      letterSpacing: 1,
      textTransform: 'uppercase',
      marginBottom: 4,
    },
    rows: { borderTopWidth: StyleSheet.hairlineWidth },
    row: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'baseline',
      gap: 16,
      paddingVertical: 7,
      borderBottomWidth: StyleSheet.hairlineWidth,
    },
    rowLbl: { fontSize: 12.5 },
    rowVal: { fontSize: 12.5, fontWeight: '600', fontVariant: ['tabular-nums'] },
    actions: { marginTop: 8, gap: 8 },
    link: { fontSize: fontSize.caption, fontWeight: '700', paddingVertical: 4 },
    btn: {
      borderRadius: radius.md,
      paddingVertical: 11,
      paddingHorizontal: 12,
      alignItems: 'center',
    },
    btnPrimaryTxt: { fontWeight: '800', fontSize: fontSize.small },
    btnSecondary: { borderWidth: 1, backgroundColor: t.surface },
    btnSecondaryTxt: { fontWeight: '700', fontSize: fontSize.caption },
  });
}

/** Scroll-friendly wrapper when used inside a bottom sheet. */
export function StockInfoScroll({ children, style }) {
  return (
    <ScrollView
      style={style}
      contentContainerStyle={{ paddingBottom: spacing.lg }}
      showsVerticalScrollIndicator={false}
      bounces
    >
      {children}
    </ScrollView>
  );
}

/** Full-screen sheet matching desktop StockPeek (watchlist tap). */
export function StockSnapshotSheet({
  ticker,
  visible,
  onClose,
  onOpenReport,
  onRunAnalysis,
  positionCtx,
}) {
  const { theme: t } = useTheme();
  const tk = String(ticker || '').trim().toUpperCase();
  return (
    <Modal
      visible={!!visible && !!tk}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <TouchableOpacity
          style={{
            ...StyleSheet.absoluteFillObject,
            backgroundColor: t.isDark ? 'rgba(0,0,0,0.55)' : 'rgba(10,22,40,0.42)',
          }}
          activeOpacity={1}
          onPress={onClose}
        />
        <View
          style={{
            maxHeight: '88%',
            backgroundColor: t.surface,
            borderTopLeftRadius: 12,
            borderTopRightRadius: 12,
            paddingHorizontal: 18,
            paddingTop: 10,
            paddingBottom: 18,
          }}
        >
        <View style={{ alignItems: 'center', marginBottom: 4 }}>
          <View
            style={{
              width: 36,
              height: 4,
              borderRadius: 2,
              backgroundColor: t.border,
            }}
          />
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={{ fontSize: 16, color: t.textDim, padding: 4 }}>✕</Text>
          </TouchableOpacity>
        </View>
        <StockInfoScroll style={{ maxHeight: 560 }}>
          <StockInfoCard
            ticker={tk}
            positionCtx={positionCtx}
            onOpenReport={onOpenReport}
            onRunAnalysis={onRunAnalysis}
          />
        </StockInfoScroll>
        </View>
      </View>
    </Modal>
  );
}
