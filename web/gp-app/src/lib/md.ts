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

type IbKind = 'text' | 'money' | 'money_m' | 'money_bn' | 'pct' | 'multiple' | 'eps' | 'shares'

function stripMdMarks(s: string): string {
  return String(s || '')
    .replace(/\*\*/g, '')
    .replace(/<[^>]+>/g, '')
    .trim()
}

function ibColKind(header: string, colIndex: number): IbKind {
  const h = stripMdMarks(header)
  const low = h.toLowerCase()
  if (
    colIndex === 0 &&
    /^(metric|line item|item|step|method|scenario|firm|company|ticker|symbol|year|fiscal|segment|date|rating|action|notes?|formula|assumption|comment|rationale)$/i.test(
      h,
    )
  ) {
    return 'text'
  }
  if (/discount factor|^t$|^year$|fiscal|date|rating|action|notes?|formula|assumption|ticker|firm|company/i.test(low)) {
    if (!/\$(|m|b)|price|value|revenue|upside|%|p\/e|ev\//i.test(low)) return 'text'
  }
  if (/diluted eps|basic eps|\beps\b/i.test(low)) return 'eps'
  if (
    /%|margin|growth|upside|downside|weight|probability|cagr|yield|\byoy\b|return\b|ppt|implied return/i.test(
      low,
    ) &&
    !/price target|implied value/i.test(low)
  ) {
    return 'pct'
  }
  if (/\bp\/?e\b|ev\/ebitda|ev\/sales|ev\/revenue|ev\/rev|\bp\/?b\b|\bp\/?s\b|multiple|\bx\b/i.test(low)) {
    return 'multiple'
  }
  if (/shares|share count/i.test(low) && !/price|value|\$/i.test(low)) return 'shares'
  if (
    /\$|price|value|revenue|income|profit|ebitda|fcf|cash|debt|assets|equity|capex|target|market cap|enterprise|amount|sales|pv of|proceeds|book/i.test(
      low,
    )
  ) {
    if (/\$\s*m\b|\$m\b|\(\s*\$?m\s*\)|millions/i.test(low)) return 'money_m'
    if (/\$\s*b|\(\s*\$?b|billions/i.test(low)) return 'money_bn'
    return 'money'
  }
  return 'text'
}

function parseIbNum(plain: string): {
  n: number
  paren: boolean
  plus: boolean
} | null {
  let t = stripMdMarks(plain)
  const paren = t.startsWith('(') && t.endsWith(')')
  if (paren) t = t.slice(1, -1).trim()
  const plus = t.startsWith('+')
  if (plus) t = t.slice(1).trim()
  const neg = t.startsWith('-') || t.startsWith('−')
  t = t.replace(/^[-−]/, '').replace(/\$/g, '').replace(/,/g, '')
  t = t.replace(/(bn|mm|ppt|%|x)\s*$/i, '').trim()
  const n = Number(t)
  if (!Number.isFinite(n)) return null
  return { n: neg || paren ? -Math.abs(n) : n, paren, plus }
}

function looksIbNumeric(plain: string): boolean {
  const t = stripMdMarks(plain)
  if (!t || /^(—|–|-|n\/a|na|nm|n\.a\.|\.)$/i.test(t)) return false
  if (/^\d+\/\d+$/.test(t) || /^\d{4}-\d{2}-\d{2}/.test(t)) return false
  if (/[a-zA-Z]{3,}/.test(t.replace(/Bn|bn|ppt/g, ''))) return false
  const inner = t.replace(/,/g, '').replace(/\s/g, '')
  return /^\(?\+?\$?-?\d[\d.]*\)?(%|x|bn|mm|m|ppt)?$/i.test(inner)
}

function commas(n: number, decimals: number): string {
  return Math.abs(n).toLocaleString('en-US', {
    minimumFractionDigits: Math.max(0, decimals),
    maximumFractionDigits: Math.max(0, decimals),
  })
}

function moneyStr(n: number, decimals: number, paren: boolean): string {
  const body = `$${commas(n, decimals)}`
  if (n < 0 || paren) return `(${body})`
  return body
}

/** IB-style $ / commas / % / x for one table cell. Idempotent. */
export function formatIbTableCell(
  header: string,
  cell: string,
  colIndex = 0,
  rowLabel = '',
): string {
  const raw = cell ?? ''
  let kind = ibColKind(header, colIndex)
  if (kind === 'text' && colIndex > 0 && rowLabel.trim()) {
    const inherited = ibColKind(rowLabel, 1)
    if (inherited !== 'text') kind = inherited
  }
  if (kind === 'text') return raw
  const core = stripMdMarks(raw)
  if (!looksIbNumeric(core)) return raw
  const parsed = parseIbNum(core)
  if (!parsed) return raw
  const { n, paren, plus } = parsed
  let out = raw
  if (kind === 'pct') {
    const body =
      Math.abs(n - Math.round(n)) < 1e-9 ? String(Math.abs(Math.round(n))) : Math.abs(n).toFixed(1)
    if (n < 0) out = paren ? `(${body}%)` : `-${body}%`
    else if (plus) out = `+${body}%`
    else out = `${body}%`
  } else if (kind === 'multiple') {
    out = `${Math.abs(n).toFixed(1)}x`
    if (n < 0) out = `-${out}`
  } else if (kind === 'eps') {
    out = moneyStr(n, 2, paren)
  } else if (kind === 'shares') {
    out = commas(n, Math.abs(n - Math.round(n)) > 1e-9 ? 1 : 0)
    if (n < 0) out = `-${out}`
  } else if (kind === 'money_m' || kind === 'money_bn' || kind === 'money') {
    let dec = 2
    if (kind === 'money_m') dec = 1
    else if (kind === 'money_bn') dec = 2
    else if (Math.abs(n) < 100) dec = 2
    else if (Math.abs(n - Math.round(n)) < 1e-9) dec = 0
    out = moneyStr(n, dec, paren)
  }
  const trimmed = raw.trim()
  if (trimmed.startsWith('**') && trimmed.endsWith('**')) return `**${out}**`
  return out
}

/** Content-aware col widths so print/PDF don't equalize ticker vs rationale. */
function mdTableColgroup(head: string[], body: string[][]): string {
  const n = head.length
  if (n < 2) return ''
  const scores = head.map((h, i) => {
    const cells = [h, ...body.map((r) => r[i] || '')].map((c) =>
      String(c)
        .replace(/\*\*/g, '')
        .replace(/<[^>]+>/g, '')
        .trim(),
    )
    const lens = cells.map((c) => c.length)
    const bodyLens = lens.slice(1)
    const typical =
      bodyLens.sort((a, b) => a - b)[Math.max(0, Math.floor(bodyLens.length * 0.75))] ||
      lens[0] ||
      4
    const hLow = h.replace(/\*\*/g, '').trim().toLowerCase()
    const prose = /rationale|reason|notes?|comment|why|evidence|funds|sourced/.test(hLow)
    const id = /^(ticker|symbol|name|names|id|tk|sleeve)$/.test(hLow)
    const short = !prose && (id || typical <= 14)
    const ch = prose ? Math.max(typical, 40) : short ? Math.min(Math.max(typical, 6), 16) : Math.min(Math.max(typical, 10), 36)
    return { ch, short, prose }
  })
  const total = scores.reduce((s, x) => s + x.ch, 0) || n
  const pcts = scores.map((x) => Math.max(x.short ? 7 : 10, (x.ch / total) * 100))
  const drift = 100 - pcts.reduce((a, b) => a + b, 0)
  pcts[pcts.length - 1] += drift
  return `<colgroup>${pcts.map((p) => `<col style="width:${p.toFixed(1)}%" />`).join('')}</colgroup>`
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
    const ncols = head.length
    const padded = body.map((r) => {
      const row = r.slice(0, ncols)
      while (row.length < ncols) row.push('')
      return row
    })
    let html = '<table class="md-table">' + mdTableColgroup(head, padded) + '<thead><tr>'
    head.forEach((c) => {
      html += `<th>${c}</th>`
    })
    html += '</tr></thead><tbody>'
    padded.forEach((r) => {
      html += '<tr>'
      const label = r[0] || ''
      r.forEach((c, i) => {
        const formatted = formatIbTableCell(head[i] || '', c, i, label)
        const numeric =
          i > 0 && formatted !== c
            ? true
            : i > 0 && looksIbNumeric(stripMdMarks(formatted))
        html += numeric ? `<td class="md-num">${formatted}</td>` : `<td>${formatted}</td>`
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
