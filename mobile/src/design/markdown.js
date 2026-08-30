/**
 * Shared markdown styles for all report/intel/summary screens.
 *
 * Three callers used to define their own copy of this:
 *   ReportScreen, IntelligenceScreen, PortfolioSummaryScreen
 * Each was slightly different — making a 5,000-word report look
 * subtly different depending on where you opened it. Now: one source.
 *
 * Two preset variants:
 *   `mdStyles`        — DGA standard (balanced, used for live briefs)
 *   `mdStylesReport`  — slightly larger headings for long-form reports
 */
import React from 'react';
import { Platform, ScrollView, View, Text } from 'react-native';
import { colors } from '../components/theme';

const monoFamily = Platform.OS === 'ios' ? 'Courier New' : 'monospace';

// Shared bits — exported so non-markdown views can match the report look.
export const markdownColors = {
  body:        colors.darkGray,
  heading:     colors.navy,
  emphasis:    colors.navy,
  italic:      colors.midGray,
  divider:     '#E8EDF3',
  quoteBg:     '#F0F4FA',
  quoteAccent: colors.primary,
  codeBg:      colors.lightGray,
  codeFg:      colors.navy,
};

// ── Standard ──────────────────────────────────────────────────────────────────
// Used everywhere markdown renders except long-form reports.
export const mdStyles = {
  body:     { color: markdownColors.body, fontSize: 14, lineHeight: 22 },
  heading1: { color: markdownColors.heading, fontSize: 20, fontWeight: '800', marginTop: 20, marginBottom: 8 },
  heading2: {
    color: markdownColors.heading, fontSize: 17, fontWeight: '700',
    marginTop: 18, marginBottom: 6,
    paddingBottom: 4, borderBottomWidth: 1, borderBottomColor: markdownColors.divider,
  },
  heading3: { color: colors.darkGray, fontSize: 15, fontWeight: '700', marginTop: 14, marginBottom: 4 },
  strong:   { fontWeight: '800', color: markdownColors.emphasis },
  em:       { fontStyle: 'italic', color: markdownColors.italic },
  hr:       { backgroundColor: markdownColors.divider, height: 1, marginVertical: 14 },
  blockquote: {
    backgroundColor: markdownColors.quoteBg,
    borderLeftWidth: 3,
    borderLeftColor: markdownColors.quoteAccent,
    paddingLeft: 12,
    paddingVertical: 6,
    marginVertical: 8,
    borderRadius: 4,
  },
  bullet_list: { marginVertical: 4 },
  list_item:   { marginVertical: 2 },
  code_inline: {
    backgroundColor: markdownColors.codeBg,
    color: markdownColors.codeFg,
    fontFamily: monoFamily,
    fontSize: 13,
    paddingHorizontal: 4,
    borderRadius: 3,
  },
  link: { color: '#1d6fbf', textDecorationLine: 'underline' },
  table: { borderWidth: 1, borderColor: colors.lightGray, borderRadius: 4, marginVertical: 12 },
  thead: { backgroundColor: colors.navy },
  th:    { color: colors.white, fontWeight: '700', padding: 8, fontSize: 12 },
  td:    { color: colors.darkGray, padding: 8, fontSize: 12, borderTopWidth: 1, borderColor: colors.lightGray },
};

// ── Report variant ────────────────────────────────────────────────────────────
// Slightly larger headings for long-form reports — gives 30+ page reports
// better hierarchy when scrolling.
export const mdStylesReport = {
  ...mdStyles,
  heading1: { ...mdStyles.heading1, fontSize: 22 },
  heading2: { ...mdStyles.heading2, fontSize: 18 },
  heading3: { ...mdStyles.heading3, fontSize: 16 },
};

// ── Theme-aware variant ─────────────────────────────────────────────────────────
// Builds markdown styles from the active light/dark theme (makeTheme). Pass
// report=true for the larger long-form headings. Used by migrated screens so the
// body text stays readable in dark mode.
export function makeMdStyles(t, report = false) {
  return {
    body:     { color: t.textPrimary, fontSize: 14, lineHeight: 22 },
    heading1: { color: t.textPrimary, fontSize: report ? 22 : 20, fontWeight: '800', marginTop: 20, marginBottom: 8 },
    heading2: {
      color: t.textPrimary, fontSize: report ? 18 : 17, fontWeight: '700',
      marginTop: 18, marginBottom: 6, paddingBottom: 4, borderBottomWidth: 1, borderBottomColor: t.border,
    },
    heading3: { color: t.textSecondary, fontSize: report ? 16 : 15, fontWeight: '700', marginTop: 14, marginBottom: 4 },
    strong:   { fontWeight: '800', color: t.textPrimary },
    em:       { fontStyle: 'italic', color: t.textSecondary },
    hr:       { backgroundColor: t.border, height: 1, marginVertical: 14 },
    blockquote: {
      backgroundColor: t.surfaceAlt, borderLeftWidth: 3, borderLeftColor: t.primary,
      paddingLeft: 12, paddingVertical: 6, marginVertical: 8, borderRadius: 4,
    },
    bullet_list: { marginVertical: 4 },
    list_item:   { marginVertical: 2 },
    code_inline: {
      backgroundColor: t.surfaceAlt, color: t.textPrimary, fontFamily: monoFamily,
      fontSize: 13, paddingHorizontal: 4, borderRadius: 3,
    },
    link:  { color: t.primary, textDecorationLine: 'underline' },
    table: { borderWidth: 1, borderColor: t.border, borderRadius: 4, marginVertical: 12 },
    thead: { backgroundColor: t.chromeNavy },
    th:    { color: '#FFFFFF', fontWeight: '700', padding: 8, fontSize: 12 },
    td:    { color: t.textPrimary, padding: 8, fontSize: 12, borderTopWidth: 1, borderColor: t.border },
  };
}

/**
 * Long-form saved reports on a phone. Desktop report window stays as-is.
 *
 * Layout rules:
 *  - 1–3 column tables shrink to the page (cover / key-value).
 *  - 4+ column tables keep cell width and scroll sideways. The inner view
 *    is alignSelf:flex-start so RN actually sizes to the row, not the screen
 *    (otherwise overflow is clipped and there is nothing to scroll).
 *  - List items (Recent Developments) stay tight: no extra paragraph gaps,
 *    and minWidth:0 so text wraps instead of running off the right edge.
 */
export function makeReportMdStyles(t) {
  return {
    body: {
      color: t.textPrimary,
      fontSize: 16,
      lineHeight: 24,
    },
    paragraph: {
      marginTop: 4,
      marginBottom: 6,
      flexWrap: 'wrap',
      flexDirection: 'row',
      alignItems: 'flex-start',
    },
    text: { fontSize: 16, lineHeight: 24, color: t.textPrimary },
    heading1: {
      color: t.textPrimary, fontSize: 22, fontWeight: '800',
      marginTop: 16, marginBottom: 8, lineHeight: 28,
    },
    heading2: {
      color: t.textPrimary, fontSize: 18, fontWeight: '700',
      marginTop: 16, marginBottom: 6, paddingBottom: 4, lineHeight: 24,
      borderBottomWidth: 1, borderBottomColor: t.border,
    },
    heading3: {
      color: t.textSecondary, fontSize: 16, fontWeight: '700',
      marginTop: 12, marginBottom: 4, lineHeight: 22,
    },
    strong: { fontWeight: '800', color: t.textPrimary },
    em: { fontStyle: 'italic', color: t.textSecondary },
    hr: { backgroundColor: t.border, height: 1, marginVertical: 10 },
    blockquote: {
      backgroundColor: t.surfaceAlt, borderLeftWidth: 3, borderLeftColor: t.primary,
      paddingLeft: 10, paddingVertical: 4, marginVertical: 6, borderRadius: 4,
    },
    bullet_list: { marginTop: 2, marginBottom: 6 },
    ordered_list: { marginTop: 2, marginBottom: 6 },
    list_item: {
      marginTop: 0,
      marginBottom: 4,
      alignItems: 'flex-start',
    },
    bullet_list_icon: { marginLeft: 0, marginRight: 8, lineHeight: 22 },
    ordered_list_icon: { marginLeft: 0, marginRight: 8, minWidth: 16, lineHeight: 22 },
    // minWidth:0 is what lets flex children wrap instead of overflowing.
    bullet_list_content: { flex: 1, minWidth: 0 },
    ordered_list_content: { flex: 1, minWidth: 0 },
    code_inline: {
      backgroundColor: t.surfaceAlt, color: t.textPrimary, fontFamily: monoFamily,
      fontSize: 13.5, paddingHorizontal: 4, borderRadius: 3,
    },
    fence: {
      backgroundColor: t.surfaceAlt, color: t.textPrimary, fontFamily: monoFamily,
      fontSize: 12.5, lineHeight: 18, padding: 10, borderRadius: 6,
    },
    code_block: {
      backgroundColor: t.surfaceAlt, color: t.textPrimary, fontFamily: monoFamily,
      fontSize: 12.5, lineHeight: 18, padding: 10, borderRadius: 6,
    },
    link: { color: t.primary, textDecorationLine: 'underline' },
    table: {
      borderWidth: 1, borderColor: t.border, borderRadius: 6,
    },
    thead: { backgroundColor: t.chromeNavy || '#0A1628' },
    tbody: {},
    tr: {
      flexDirection: 'row',
      flexWrap: 'nowrap',
      borderBottomWidth: 1,
      borderColor: t.border,
      alignSelf: 'flex-start',
    },
    th: {
      paddingVertical: 7, paddingHorizontal: 8,
      color: '#FFFFFF', fontWeight: '700', fontSize: 12.5, lineHeight: 17,
    },
    td: {
      paddingVertical: 7, paddingHorizontal: 8,
      color: t.textPrimary, fontSize: 13, lineHeight: 18,
    },
  };
}

function tableColCount(node) {
  if (!node) return 0;
  if (node.type === 'tr') return (node.children || []).length;
  let max = 0;
  for (const c of node.children || []) max = Math.max(max, tableColCount(c));
  return max;
}

function ancestor(parent, type) {
  const arr = Array.isArray(parent) ? parent : [];
  for (let i = arr.length - 1; i >= 0; i--) {
    if (arr[i] && arr[i].type === type) return arr[i];
  }
  return null;
}

function inList(parent) {
  return !!(ancestor(parent, 'list_item') || ancestor(parent, 'bullet_list') || ancestor(parent, 'ordered_list'));
}

const WIDE_CELL = {
  flex: 0, flexGrow: 0, flexShrink: 0, flexBasis: 'auto', minWidth: 104, maxWidth: 200,
};
const FIT_CELL = {
  flex: 1, flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0,
};

export function reportMdRules() {
  return {
    paragraph: (node, children, parent, styles) => (
      <View
        key={node.key}
        style={[
          styles._VIEW_SAFE_paragraph,
          inList(parent) && { marginTop: 0, marginBottom: 2 },
        ]}
      >
        {children}
      </View>
    ),
    table: (node, children, parent, styles) => {
      const wide = tableColCount(node) >= 4;
      const inner = (
        <View
          style={[
            styles._VIEW_SAFE_table,
            wide ? { alignSelf: 'flex-start' } : { alignSelf: 'stretch', width: '100%' },
          ]}
        >
          {children}
        </View>
      );
      if (!wide) {
        return <View key={node.key} style={{ marginVertical: 8 }}>{inner}</View>;
      }
      return (
        <ScrollView
          key={node.key}
          horizontal
          nestedScrollEnabled
          showsHorizontalScrollIndicator
          style={{ marginVertical: 8 }}
        >
          {inner}
        </ScrollView>
      );
    },
    th: (node, children, parent, styles) => {
      const wide = tableColCount(ancestor(parent, 'table')) >= 4;
      return (
        <View key={node.key} style={[styles._VIEW_SAFE_th, wide ? WIDE_CELL : FIT_CELL]}>
          {children}
        </View>
      );
    },
    td: (node, children, parent, styles) => {
      const wide = tableColCount(ancestor(parent, 'table')) >= 4;
      return (
        <View key={node.key} style={[styles._VIEW_SAFE_td, wide ? WIDE_CELL : FIT_CELL]}>
          {children}
        </View>
      );
    },
    fence: (node, children, parent, styles) => {
      let content = typeof node.content === 'string' ? node.content : '';
      if (content.endsWith('\n')) content = content.slice(0, -1);
      return (
        <ScrollView
          key={node.key}
          horizontal
          nestedScrollEnabled
          showsHorizontalScrollIndicator
          style={{ marginVertical: 8 }}
        >
          <Text style={[styles.fence, { alignSelf: 'flex-start' }]}>{content}</Text>
        </ScrollView>
      );
    },
    code_block: (node, children, parent, styles) => {
      let content = typeof node.content === 'string' ? node.content : '';
      if (content.endsWith('\n')) content = content.slice(0, -1);
      return (
        <ScrollView
          key={node.key}
          horizontal
          nestedScrollEnabled
          showsHorizontalScrollIndicator
          style={{ marginVertical: 8 }}
        >
          <Text style={[styles.code_block, { alignSelf: 'flex-start' }]}>{content}</Text>
        </ScrollView>
      );
    },
  };
}

/** Tighten list gaps in stored report markdown (mobile display only). */
export function compactReportMd(md) {
  if (!md) return md;
  let s = String(md).replace(/\r\n/g, '\n');
  s = s.replace(/\n{3,}/g, '\n\n');
  const lines = s.split('\n');
  const out = [];
  const isItem = (l) => /^\s*(?:[*+\-]|\d+\.)\s+/.test(l);
  const isBlank = (l) => /^\s*$/.test(l);
  for (let i = 0; i < lines.length; i++) {
    // Drop a blank line sitting between two list items so markdown-it
    // keeps one list instead of N one-item lists with huge gaps.
    if (
      isBlank(lines[i]) &&
      out.length &&
      isItem(out[out.length - 1]) &&
      i + 1 < lines.length &&
      isItem(lines[i + 1])
    ) {
      continue;
    }
    out.push(lines[i]);
  }
  s = out.join('\n');
  // Bold lead-in on its own line, then a blank, then the body — keep together.
  s = s.replace(/(^|\n)(\*\*[^*\n]{4,120}\*\*[^\n]*)\n\n+(?=\S)/g, '$1$2\n');
  return s;
}
