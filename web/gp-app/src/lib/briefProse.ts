/** Turn a local-model reply into the sentences a person should read. */

const MONOLOGUE = /^(the user|i need to|i should|i must|let me|we need to|we should|looking at the|first, i|okay[,.]|alright[,.]|the instructions|as an ai|analysis:|i will |i'll |i am going to)/i

function isMonologue(paragraph: string): boolean {
  const text = paragraph.trim()
  if (!text) return true
  const low = text.toLowerCase()
  if (MONOLOGUE.test(low)) return true
  if (/\b(the user (wants|asked)|my instructions|do not invent|chain of thought|internal monologue)\b/.test(low)) return true
  const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean)
  if (sentences.length < 2) return false
  const self = sentences.filter((line) => /^\s*(I|I'll|I'm|I’ve|Let me|We)\b/.test(line)).length
  return self / sentences.length >= 0.5
}

export function briefProse(raw: string): string {
  let text = (raw || '').replace(/\r/g, '')
  const finalAt = text.lastIndexOf('<|channel|>final')
  if (finalAt >= 0) {
    text = text.slice(finalAt)
    const msg = text.indexOf('<|message|>')
    text = msg >= 0 ? text.slice(msg + '<|message|>'.length) : ''
  }
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, '')
  text = text.replace(/<\/?think>/gi, '')
  text = text.replace(/<\|[^|]*\|>/g, '')
  text = text.replace(/^#{1,3}\s*(latest|setup|ask next)\s*$/gim, '')
  text = text.replace(/^ask next\s*\n(?:[-*].*\n?)*/im, '')

  const paragraphs = text
    .split(/\n{2,}/)
    .map((part) => part.replace(/[ \t]+\n/g, '\n').trim())
    .filter(Boolean)
    .filter((part) => !isMonologue(part))
  return paragraphs.join('\n\n').trim()
}
