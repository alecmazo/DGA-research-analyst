"""Choose which stored transcript text is sent with a question.

No network and no database. The open document is capped so a local model
with a 32k context can still answer. Library search words are OR-ed; a
natural question must not have to match every word.
"""

from __future__ import annotations

import re

OPEN_CHAR_LIMIT = 22000
OPEN_HEAD_CHARS = 4000

_WORD_STOP = {
    "the", "and", "for", "with", "from", "this", "that", "what", "when",
    "have", "been", "said", "about", "call", "calls", "they", "their",
    "were", "will", "your", "into", "over", "just", "like", "some",
    "more", "than", "then", "also", "only", "does", "did", "how", "why",
    "who", "which", "earnings", "transcript", "year", "quarter", "say",
    "says", "saying", "tell", "open", "library", "please", "could",
    "would", "there", "where", "while", "after", "before", "during",
}


def content_words(question: str) -> list[str]:
    """Significant words and years. Order kept, duplicates dropped, max 8."""
    seen: set[str] = set()
    words: list[str] = []
    for raw in re.findall(r"[A-Za-z][A-Za-z'-]{2,}|(?:19|20)\d{2}", question or ""):
        word = raw.lower().strip("-'")
        if not word or word in seen or word in _WORD_STOP:
            continue
        if not re.fullmatch(r"(?:19|20)\d{2}", word) and len(word) < 4:
            continue
        seen.add(word)
        words.append(word)
        if len(words) >= 8:
            break
    return words


def or_tsquery(words: list[str]) -> str:
    """Postgres to_tsquery OR string. Empty when there is nothing to match."""
    safe = [w for w in words if re.fullmatch(r"[a-z0-9]+", w)]
    return " | ".join(safe)


def window_text(text: str, size: int = 180, step: int = 140) -> list[str]:
    """Split a long blob into overlapping word windows. Short text stays whole."""
    raw = [part.strip() for part in re.split(r"\n\s*\n", text or "") if part and part.strip()]
    pieces: list[str] = []
    for para in raw:
        if len(para) <= 1200:
            pieces.append(para)
            continue
        words = para.split()
        if not words:
            continue
        start = 0
        while start < len(words):
            piece = " ".join(words[start:start + size]).strip()
            if piece:
                pieces.append(piece)
            if start + size >= len(words):
                break
            start += step
    return pieces


def _slice_around(part: str, words: list[str], room: int) -> str:
    """Keep the neighborhood of the first question word that appears."""
    if room < 80 or not part:
        return ""
    low = part.lower()
    hits = [low.find(word) for word in words if word and word in low]
    at = min(hits) if hits else 0
    start = max(0, at - room // 3)
    return part[start:start + room].strip()


def select_passages(
    parts: list[str],
    question: str,
    limit: int = OPEN_CHAR_LIMIT,
    head_chars: int = OPEN_HEAD_CHARS,
) -> str:
    """Keep the opening, then the parts that share the question's words.

    Parts stay in document order. A long part is windowed first so a
    match late in the document is not cut off. A short document is returned whole.
    """
    cleaned: list[str] = []
    for part in parts or []:
        if not part or not part.strip():
            continue
        if len(part.strip()) > 1200:
            cleaned.extend(window_text(part))
        else:
            cleaned.append(part.strip())
    if not cleaned:
        return ""
    whole = "\n\n".join(cleaned)
    if len(whole) <= limit:
        return whole

    words = content_words(question)
    chosen: set[int] = set()
    used = 0
    for index, part in enumerate(cleaned):
        if used >= head_chars and chosen:
            break
        if used + len(part) + 2 > limit:
            if not chosen:
                head = part[:head_chars].rsplit(" ", 1)[0].strip() or part[:head_chars]
                cleaned[index] = head
                chosen.add(index)
                used = len(head) + 2
            break
        chosen.add(index)
        used += len(part) + 2

    scored: list[tuple[int, int]] = []
    for index, part in enumerate(cleaned):
        if index in chosen:
            continue
        low = part.lower()
        score = sum(low.count(word) for word in words)
        if score:
            scored.append((score, index))
    scored.sort(key=lambda row: (-row[0], row[1]))
    for _score, index in scored:
        part = cleaned[index]
        extra = len(part) + 2
        room = limit - used - 2
        if extra > room:
            piece = _slice_around(part, words, room)
            if not piece:
                continue
            cleaned[index] = piece
            extra = len(piece) + 2
        chosen.add(index)
        used += extra
        if room < 400:
            break

    ordered = [cleaned[index] for index in sorted(chosen)]
    text = "\n\n".join(ordered)
    if len(text) > limit:
        text = text[:limit].rsplit(" ", 1)[0].strip()
    return text


def pack_chosen(
    documents: list[tuple[str, str]],
    question: str,
    limit: int = OPEN_CHAR_LIMIT,
) -> str:
    """One block per chosen transcript. Each gets an equal share of the limit."""
    docs = [(label.strip(), text.strip()) for label, text in documents or [] if (text or "").strip()]
    if not docs:
        return ""
    share = max(800, limit // len(docs))
    head = min(OPEN_HEAD_CHARS, max(400, share // 5))
    blocks: list[str] = []
    for label, text in docs:
        body = select_passages([text], question, limit=share, head_chars=head)
        if not body:
            continue
        name = label or "Transcript"
        blocks.append(f"[{name}]\n{body}")
    packed = "\n\n".join(blocks)
    if len(packed) > limit:
        packed = packed[:limit].rsplit(" ", 1)[0].strip()
    return packed


def system_prompt(
    open_label: str,
    ticker: str = "",
    chosen_labels: list[str] | None = None,
) -> str:
    labels = [label.strip() for label in (chosen_labels or []) if label and label.strip()]
    if labels:
        named = "; ".join(labels[:8])
        return (
            "You answer questions about stored interview and earnings-call transcripts. "
            f"The user chose these transcripts: {named}. "
            "Answer only from the Chosen transcripts section. "
            "Integrate points that appear in more than one of them, and name the transcript for each point. "
            "If those transcripts do not contain the answer, say it is not in the chosen transcripts. "
            "Do not invent quotes."
        )
    label = (open_label or "").strip()
    if label:
        return (
            "You answer questions about stored interview and earnings-call transcripts. "
            f"The user has this transcript open: {label}. "
            "Answer only from the Open transcript section. "
            "If that section does not contain the answer, say it is not in the open transcript. "
            "Do not invent quotes. When you use a passage, name the show or the ticker and quarter."
        )
    scope = f" The ticker in view is {ticker}." if (ticker or "").strip() else ""
    return (
        "You answer questions about stored interview and earnings-call transcripts. "
        "Use only the excerpts in the user message. If they do not contain the answer, "
        "say that the library does not have it. Do not invent quotes. When you use a "
        "passage, name the show or the ticker and quarter."
        + scope
    )


def user_message(
    question: str,
    open_text: str,
    other_text: str = "",
    chosen_text: str = "",
) -> str:
    parts = [f"Question: {(question or '').strip()}"]
    if (chosen_text or "").strip():
        parts.append(f"Chosen transcripts:\n{chosen_text.strip()}")
    elif (open_text or "").strip():
        parts.append(f"Open transcript:\n{open_text.strip()}")
        if (other_text or "").strip():
            parts.append(f"Other library excerpts:\n{other_text.strip()}")
    elif (other_text or "").strip():
        parts.append(f"Other library excerpts:\n{other_text.strip()}")
    else:
        parts.append("Excerpts:\nNo stored transcript passages matched this question.")
    return "\n\n".join(parts)
