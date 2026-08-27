/** True when Grok saved live-search / tool traces instead of a research note. */
export function looksLikeToolTrace(src: string): boolean {
  const t = String(src || '')
  if (!t.trim()) return false
  const low = t.toLowerCase()
  if (low.includes('potekle') || t.includes('<|eos|>') || low.includes('extra_query_')) {
    return true
  }
  const web = (t.match(/web_search/gi) || []).length
  const xs = (t.match(/x_search/gi) || []).length
  if (web >= 6 || xs >= 6) return true
  if ((t.match(/➞/g) || []).length >= 8) return true
  const nl = (t.match(/\n/g) || []).length
  if (t.length > 4000 && nl < Math.max(8, Math.floor(t.length / 800))) {
    if (/web_search|x_search|function_call/i.test(t)) return true
  }
  return false
}

/**
 * Repair Grok/Claude markdown so the report window can parse it.
 * TSLA Grok wrapped cover-table rows in **| … |** and copied prompt ━━━
 * banners; RIVN Grok is the gold format (plain GFM table + # SECTION).
 */
export function normalizeDgaReportMd(src: string): string {
  let s = String(src || '').replace(/\r\n/g, '\n')
  if (!s.trim()) return s
  s = s.replace(/^[ \t]*\*\*[ \t]*(\|.*)[ \t]*\*\*[ \t]*$/gm, '$1')
  s = s.replace(
    /(?:^[ \t]*[═━─\-—]{8,}[ \t]*\n)+[ \t]*(SECTION[ \t]+\d[\dA-Z.]*[ \t]*[—–\-:][ \t]*.+?)[ \t]*\n(?:[ \t]*[═━─\-—]{8,}[ \t]*\n)+/gm,
    '# $1\n\n',
  )
  s = s.replace(/^[ \t]*[═━─]{8,}[ \t]*$/gm, '')
  s = s.replace(/^(SECTION[ \t]+\d[\dA-Z.]*[ \t]*[—–\-:][ \t].+)$/gm, '# $1')
  s = s.replace(/\n{3,}/g, '\n\n')
  return s.trim() ? `${s.trim()}\n` : s
}

/**
 * Escape HTML, then apply a markdown subset suitable for DGA research reports
 * and agent answers (headings, lists, tables, code, links, bold/italic).
 */
export function renderMd(src: string): string {
  let s = normalizeDgaReportMd(String(src || ''))
  if (looksLikeToolTrace(s)) {
    return (
      '<div class="md-h md-h1">Report incomplete</div>' +
      '<p>The last Analyze run captured live-search / tool traces instead of the ' +
      'research note, so there is nothing to format. Re-run <strong>Analyze</strong> ' +
      'for this ticker, or open another engine if one is already saved.</p>'
    )
  }
  s = s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

  // Fenced code blocks first (protect contents)
  const codeBlocks: string[] = []
  s = s.replace(/```[\w]*\n?([\s\S]*?)```/g, (_m, code) => {
    const i = codeBlocks.length
    codeBlocks.push(
      `<pre class="md-pre"><code>${String(code).replace(/^\n+|\n+$/g, '')}</code></pre>`,
    )
    return `\n%%CODEBLOCK${i}%%\n`
  })

  // GFM-ish tables: consecutive lines with |
  s = s.replace(/(?:(?:^|\n)(?:\|?.+\|.+\n)+)/g, (block) => {
    const lines = block
      .trim()
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
    if (lines.length < 2) return block
    const isSep = (l: string) => /^\|?[\s:|-]+\|[\s:|-]+/.test(l)
    if (!lines.some(isSep)) return block
    const split = (l: string) =>
      l
        .replace(/^\|/, '')
        .replace(/\|$/, '')
        .split('|')
        .map((c) => c.trim())
    const rows = lines.filter((l) => !isSep(l)).map(split)
    if (!rows.length) return block
    const head = rows[0]
    const body = rows.slice(1)
    let html = '<table class="md-table"><thead><tr>'
    head.forEach((c) => {
      html += `<th>${c}</th>`
    })
    html += '</tr></thead><tbody>'
    body.forEach((r) => {
      html += '<tr>'
      r.forEach((c) => {
        html += `<td>${c}</td>`
      })
      html += '</tr>'
    })
    html += '</tbody></table>'
    return '\n' + html + '\n'
  })

  // Horizontal rules
  s = s.replace(/^ {0,3}([-*_])(?: *\1){2,} *$/gm, '<hr class="md-hr"/>')

  // Headings
  s = s
    .replace(/^###### (.+)$/gm, '<div class="md-h md-h4">$1</div>')
    .replace(/^##### (.+)$/gm, '<div class="md-h md-h4">$1</div>')
    .replace(/^#### (.+)$/gm, '<div class="md-h md-h4">$1</div>')
    .replace(/^### (.+)$/gm, '<div class="md-h md-h3">$1</div>')
    .replace(/^## (.+)$/gm, '<div class="md-h md-h2">$1</div>')
    .replace(/^# (.+)$/gm, '<div class="md-h md-h1">$1</div>')

  // Blockquotes
  s = s.replace(/^&gt; (.+)$/gm, '<blockquote class="md-bq">$1</blockquote>')

  // Unordered / ordered lists (line-level)
  s = s.replace(/^[-*+] (.+)$/gm, '<div class="md-li">• $1</div>')
  s = s.replace(/^\d+\. (.+)$/gm, '<div class="md-li md-ol">$1</div>')

  // Inline
  s = s
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/__(.+?)__/g, '<strong>$1</strong>')
    // italic: single * not part of **
    .replace(/(^|[^*])\*([^*\n]+)\*([^*]|$)/g, '$1<em>$2</em>$3')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(
      /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>',
    )

  // Paragraphs: split on blank lines, skip blocks already tagged
  const parts = s.split(/\n{2,}/)
  s = parts
    .map((part) => {
      const t = part.trim()
      if (!t) return ''
      if (
        t.startsWith('<div class="md-h') ||
        t.startsWith('<table') ||
        t.startsWith('<pre') ||
        t.startsWith('<hr') ||
        t.startsWith('<blockquote') ||
        t.startsWith('%%CODEBLOCK')
      ) {
        return t.replace(/\n/g, '')
      }
      // list-only blocks
      if (/^(?:<div class="md-li)/.test(t)) {
        return t.replace(/\n/g, '')
      }
      return `<p>${t.replace(/\n/g, '<br/>')}</p>`
    })
    .join('\n')

  // Restore code blocks
  s = s.replace(/%%CODEBLOCK(\d+)%%/g, (_m, i) => codeBlocks[Number(i)] || '')

  return s
}

/** Prefer API field names used by /api/report/{ticker}. */
export function reportMarkdown(data: {
  report_md?: string | null
  markdown?: string | null
  content?: string | null
  body_md?: string | null
} | null | undefined): string {
  if (!data) return ''
  return (
    data.report_md ||
    data.markdown ||
    data.content ||
    data.body_md ||
    ''
  ).trim()
}
