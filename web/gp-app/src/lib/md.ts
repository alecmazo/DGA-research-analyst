/** Escape HTML, then apply a small markdown subset for agent answers. */
export function renderMd(src: string): string {
  let s = String(src || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

  // fenced code
  s = s.replace(/```[\w]*\n?([\s\S]*?)```/g, (_m, code) => {
    return `<pre class="md-pre"><code>${code.trim()}</code></pre>`
  })

  s = s
    .replace(/^#### (.+)$/gm, '<div class="md-h md-h4">$1</div>')
    .replace(/^### (.+)$/gm, '<div class="md-h md-h3">$1</div>')
    .replace(/^## (.+)$/gm, '<div class="md-h md-h2">$1</div>')
    .replace(/^# (.+)$/gm, '<div class="md-h md-h1">$1</div>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(
      /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>',
    )
    .replace(/^- (.+)$/gm, '<div class="md-li">• $1</div>')
    .replace(/\n{2,}/g, '</p><p>')
    .replace(/\n/g, '<br/>')

  return `<p>${s}</p>`
}
