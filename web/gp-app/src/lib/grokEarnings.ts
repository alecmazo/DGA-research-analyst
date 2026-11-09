/** Opens the free Grok at grok.com. The portal does not run this request. */

export function grokEarningsHref(ticker: string, company?: string | null): string {
  const tk = (ticker || '').trim().toUpperCase()
  const name = (company || '').replace(/\s+/g, ' ').trim()
  const who = name && name.toUpperCase() !== tk ? `${tk} (${name})` : tk
  const prompt = [
    `Dissect the latest earnings release for ${who}.`,
    `Read the company's own earnings release and the call transcript.`,
    `Cover the headline numbers versus consensus, whether it was a beat or a miss and why, any change in guidance, the important segment comments, and what a long-term investor should take from the release.`,
  ].join(' ')
  return `https://grok.com/?q=${encodeURIComponent(prompt)}`
}
