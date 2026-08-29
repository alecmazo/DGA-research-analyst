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
 * Default markdown-display tables use flex:1 so every column is crushed into
 * the viewport — here columns keep a readable min-width and the table scrolls
 * sideways. Body type is also a step larger for reading, not scanning.
 */
export function makeReportMdStyles(t) {
  return {
    body: {
      color: t.textPrimary,
      fontSize: 16.5,
      lineHeight: 26,
    },
    paragraph: {
      marginTop: 8,
      marginBottom: 10,
      flexWrap: 'wrap',
      flexDirection: 'row',
      width: '100%',
    },
    text: { fontSize: 16.5, lineHeight: 26, color: t.textPrimary },
    heading1: {
      color: t.textPrimary, fontSize: 23, fontWeight: '800',
      marginTop: 22, marginBottom: 10, lineHeight: 30,
    },
    heading2: {
      color: t.textPrimary, fontSize: 19, fontWeight: '700',
      marginTop: 22, marginBottom: 8, paddingBottom: 5, lineHeight: 26,
      borderBottomWidth: 1, borderBottomColor: t.border,
    },
    heading3: {
      color: t.textSecondary, fontSize: 16.5, fontWeight: '700',
      marginTop: 16, marginBottom: 6, lineHeight: 22,
    },
    strong: { fontWeight: '800', color: t.textPrimary },
    em: { fontStyle: 'italic', color: t.textSecondary },
    hr: { backgroundColor: t.border, height: 1, marginVertical: 16 },
    blockquote: {
      backgroundColor: t.surfaceAlt, borderLeftWidth: 3, borderLeftColor: t.primary,
      paddingLeft: 12, paddingVertical: 8, marginVertical: 10, borderRadius: 4,
    },
    bullet_list: { marginVertical: 6 },
    ordered_list: { marginVertical: 6 },
    list_item: { marginVertical: 3 },
    bullet_list_content: { flex: 1, flexWrap: 'wrap' },
    ordered_list_content: { flex: 1, flexWrap: 'wrap' },
    code_inline: {
      backgroundColor: t.surfaceAlt, color: t.textPrimary, fontFamily: monoFamily,
      fontSize: 14, paddingHorizontal: 4, borderRadius: 3,
    },
    fence: {
      backgroundColor: t.surfaceAlt, color: t.textPrimary, fontFamily: monoFamily,
      fontSize: 13, lineHeight: 20, padding: 12, borderRadius: 6, marginVertical: 10,
    },
    link: { color: t.primary, textDecorationLine: 'underline' },
    table: {
      borderWidth: 1, borderColor: t.border, borderRadius: 6, overflow: 'hidden',
    },
    thead: { backgroundColor: t.chromeNavy || '#0A1628' },
    tbody: {},
    tr: {
      flexDirection: 'row',
      borderBottomWidth: 1,
      borderColor: t.border,
    },
    // flex:0 overrides the library default flex:1 that crushes columns.
    th: {
      flex: 0, flexGrow: 0, flexShrink: 0, flexBasis: 'auto',
      minWidth: 92, maxWidth: 280,
      paddingVertical: 8, paddingHorizontal: 10,
      color: '#FFFFFF', fontWeight: '700', fontSize: 13, lineHeight: 18,
    },
    td: {
      flex: 0, flexGrow: 0, flexShrink: 0, flexBasis: 'auto',
      minWidth: 92, maxWidth: 280,
      paddingVertical: 8, paddingHorizontal: 10,
      color: t.textPrimary, fontSize: 13.5, lineHeight: 19,
    },
  };
}

export function reportMdRules() {
  return {
    table: (node, children, parent, styles) => (
      <ScrollView
        key={node.key}
        horizontal
        nestedScrollEnabled
        showsHorizontalScrollIndicator
        bounces
        style={{ marginVertical: 12 }}
        contentContainerStyle={{ flexGrow: 1, paddingRight: 8 }}
      >
        <View style={styles._VIEW_SAFE_table}>{children}</View>
      </ScrollView>
    ),
    fence: (node, children, parent, styles) => {
      let content = typeof node.content === 'string' ? node.content : '';
      if (content.endsWith('\n')) content = content.slice(0, -1);
      return (
        <ScrollView
          key={node.key}
          horizontal
          nestedScrollEnabled
          showsHorizontalScrollIndicator
          style={{ marginVertical: 10 }}
        >
          <Text style={styles.fence}>{content}</Text>
        </ScrollView>
      );
    },
  };
}
